import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { PrismaService } from '../database/prisma.service';
import type { Request } from 'express';
const limits:Record<string,number>={'/admin/login':10,'/admin/register':5,'/admin/signup':3,'/admin/forgot-password':5,'/admin/reset-password':5,'/admin/password':5,'/contacto':5,'/reclamaciones':5,'/newsletter':5,'/newsletter/unsubscribe':5,'/chatbot/message':20,'/chatbot/contact':5,'/preinscripciones':5,'/chatbot/preinscripcion':5,'/certificados/verificar':30,'/admin/asistente/consultar':20};
// El formulario y el chatbot comparten UNA cuota de preinscripciones por IP, por subred, por hora y global: alternar de canal no multiplica el límite.
const aliases:Record<string,string>={'/chatbot/preinscripcion':'/preinscripciones'};
// Rutas públicas con su propio tope global (no gastan ni agotan el de «all-public», compartido por el resto de formularios).
const ownGlobal=new Set(['/preinscripciones','/certificados/verificar']);
// Tope global por minuto de la ruta (todas las IP) sobre solicitudes ADMITIDAS. Por defecto 200; el registro público tiene uno menor para frenar altas masivas.
const globalLimits:Record<string,number>={'/admin/signup':30,'/preinscripciones':60,'/certificados/verificar':600};
// Tope adicional por IP y hora: el registro público crea cuentas, así que 3 por minuto no basta para frenar un goteo automatizado. El de preinscripciones
// (30/hora) deja registrarse a un aula completa que comparte una conexión (una por persona) sin permitir un goteo sostenido desde una sola IP.
// /admin/asistente/consultar: cada consulta cuesta hasta dos llamadas a OpenAI; el tope por cuenta (en el servicio) es el principal y este protege por IP entre instancias.
const hourlyLimits:Record<string,number>={'/admin/signup':10,'/preinscripciones':30,'/certificados/verificar':200,'/admin/asistente/consultar':150};
// Tope por minuto de la SUBRED (IPv4 /24, IPv6 /64): frena a quien rota direcciones vecinas para multiplicar su cuota por IP, y sigue dejando pasar
// a varias personas legítimas detrás de una misma conexión (4 veces el tope individual). Un atacante con muchas subredes distintas solo lo frena el tope global.
const subnetLimits:Record<string,number>={'/preinscripciones':20,'/certificados/verificar':90};
const MINUTE_MESSAGE='Has enviado varias solicitudes. Espera un minuto y vuelve a intentar.';
const HOUR_MESSAGE='Has enviado varias solicitudes. Espera un momento y vuelve a intentar.';
const BUSY_MESSAGE='El servicio está ocupado. Vuelve a intentarlo en unos segundos.';
const CLEANUP_EVERY_MS=30_000;
const MAX_ATTEMPTS=3;

type Bucket={id:string;max:number;message:string;expiresAt:Date};

// Subred de la dirección: la unidad que un atacante controla de forma realista. Una dirección que no se puede interpretar se usa tal cual (sin agrupar).
export function subnetOf(address:string):string{
 const mapped=/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
 const ip=mapped?mapped[1]:address;
 const version=isIP(ip);
 if(version===4)return ip.split('.').slice(0,3).join('.')+'.0/24';
 if(version===6){
  const [head,tail]=ip.split('::');
  const left=head?head.split(':'):[],right=tail?tail.split(':'):[];
  const groups=ip.includes('::')?[...left,...Array(Math.max(0,8-left.length-right.length)).fill('0'),...right]:left;
  return groups.slice(0,4).map(group=>group.toLowerCase().replace(/^0+(?=.)/,'')).join(':')+'::/64';
 }
 return ip;
}

@Injectable()
export class PublicRateLimitGuard implements CanActivate {
 private lastCleanup=0;
 constructor(private readonly prisma:PrismaService){}
 async canActivate(context:ExecutionContext) {
 const request=context.switchToHttp().getRequest<Request>();
 const path=request.path.toLowerCase().replace(/^\/api(?=\/)/,'').replace(/\/$/,'');
 // La verificación pública de certificados es un GET: todas las consultas (código válido, inexistente o mal formado) comparten la misma cuota por IP,
 // así que el límite no revela si un código existe. Las demás rutas limitadas son POST.
 const scope=request.method==='GET'&&/^\/certificados\/verificar\/[^/]+$/.test(path)?'/certificados/verificar':request.method==='POST'?path:'';
 if(!scope)return true;
 const limit=limits[scope];if(!limit)return true;
 const quota=aliases[scope]??scope;
 const now=Date.now(),window=Math.floor(now/60000),expiresAt=new Date((window+2)*60000);
 const hour=Math.floor(now/3600000),hourExpiresAt=new Date((hour+1)*3600000+60000);
 // Solo se guardan HASHES de la IP y de la subred: nunca correos, teléfonos ni otros datos del formulario (el guard no lee el cuerpo).
 const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
 const ip=request.ip||request.socket.remoteAddress||'unknown';
 const globalName=quota.startsWith('/admin/')?'all-admin:'+quota:ownGlobal.has(quota)?'all-scope:'+quota:'all-public';
 // Orden FIJO de bloqueo (individual → hora → subred → global): todas las transacciones toman las filas en el mismo orden, así que no se cruzan.
 const buckets:Bucket[]=[{id:hash('ip:'+quota+':'+ip+':'+window),max:limit,message:MINUTE_MESSAGE,expiresAt}];
 if(hourlyLimits[quota])buckets.push({id:hash('hour:'+quota+':'+ip+':'+hour),max:hourlyLimits[quota],message:HOUR_MESSAGE,expiresAt:hourExpiresAt});
 if(subnetLimits[quota])buckets.push({id:hash('net:'+quota+':'+subnetOf(ip)+':'+window),max:subnetLimits[quota],message:MINUTE_MESSAGE,expiresAt});
 buckets.push({id:hash(globalName+':'+window),max:globalLimits[quota]??200,message:MINUTE_MESSAGE,expiresAt});
 await this.admit(buckets);
 await this.cleanup(now);
 return true;
 }

 // Admisión ATÓMICA. Cada cubo solo sube si todavía tiene cupo (UPDATE … WHERE count < max), de modo que:
 //  - una solicitud rechazada NO consume ninguna cuota ajena: una IP abusiva se queda en su propio tope y no puede agotar el global;
 //  - si cualquier cubo (p. ej. el global) rechaza, TODA la transacción se revierte y la solicitud tampoco gasta la cuota individual;
 //  - dos procesos NestJS comparten los mismos cubos en MySQL y el UPDATE condicional impide superar el tope con solicitudes simultáneas.
 // READ COMMITTED evita los bloqueos de hueco de InnoDB entre inserciones concurrentes de cubos distintos.
 private async admit(buckets:Bucket[]){
  for(let attempt=1;;attempt++){
   try{
    await this.prisma.$transaction(async tx=>{
     for(const bucket of buckets){
      await tx.$executeRaw`INSERT INTO rate_limit_buckets (id, count, expiresAt) VALUES (${bucket.id}, 0, ${bucket.expiresAt}) ON DUPLICATE KEY UPDATE count = count`;
      const admitted=await tx.$executeRaw`UPDATE rate_limit_buckets SET count = count + 1 WHERE id = ${bucket.id} AND count < ${bucket.max}`;
      if(!admitted)throw new HttpException({ok:false,mensaje:bucket.message},429);
     }
    },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
    return;
   }catch(error){
    const conflict=error instanceof Prisma.PrismaClientKnownRequestError&&['P2034','P2028'].includes(error.code);
    if(!conflict)throw error;
    // Interbloqueo o conflicto de escritura bajo mucha concurrencia: se reintenta unas veces y, si persiste, se rechaza sin admitir (nunca se omite el límite).
    if(attempt>=MAX_ATTEMPTS)throw new HttpException({ok:false,mensaje:BUSY_MESSAGE},503);
   }
  }
 }

 // Limpieza de cubos vencidos como mucho cada 30 s por proceso: las solicitudes rechazadas ya no disparan un DELETE cada una.
 private async cleanup(now:number){
  if(now-this.lastCleanup<CLEANUP_EVERY_MS)return;
  this.lastCleanup=now;
  try{await this.prisma.rateLimitBucket.deleteMany({where:{expiresAt:{lt:new Date(now)}}});}
  catch{this.lastCleanup=0;} // mantenimiento: si falla se reintenta en la siguiente solicitud y no afecta a quien consulta
 }
}
