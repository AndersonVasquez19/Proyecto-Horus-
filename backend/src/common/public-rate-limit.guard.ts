import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import type { Request } from 'express';
const limits:Record<string,number>={'/admin/login':10,'/admin/register':5,'/admin/signup':3,'/admin/forgot-password':5,'/admin/reset-password':5,'/admin/password':5,'/contacto':5,'/reclamaciones':5,'/newsletter':5,'/newsletter/unsubscribe':5,'/chatbot/message':20,'/chatbot/contact':5};
// Tope global por minuto de la ruta (todas las IP). Por defecto 200; el registro público tiene uno menor para frenar altas masivas.
const globalLimits:Record<string,number>={'/admin/signup':30};
// Tope adicional por IP y hora: el registro público crea cuentas, así que 3 por minuto no basta para frenar un goteo automatizado.
const hourlyLimits:Record<string,number>={'/admin/signup':10};
@Injectable()
export class PublicRateLimitGuard implements CanActivate {
 constructor(private readonly prisma:PrismaService){}
 async canActivate(context:ExecutionContext) {
 const request=context.switchToHttp().getRequest<Request>();
 if(request.method!=='POST')return true;
 const scope=request.path.toLowerCase().replace(/^\/api(?=\/)/,'').replace(/\/$/,'');
 const limit=limits[scope];if(!limit)return true;
 const now=Date.now(),window=Math.floor(now/60000),expiresAt=new Date((window+2)*60000);
 const key=(value:string)=>createHash('sha256').update(value+':'+window).digest('hex');
 const ip=request.ip||request.socket.remoteAddress||'unknown';
 const id=key(scope+':'+ip),global=key(scope.startsWith('/admin/')?'all-admin:'+scope:'all-public');
 const hourLimit=hourlyLimits[scope],hour=Math.floor(now/3600000);
 const hourId=hourLimit?createHash('sha256').update(scope+':hour:'+ip+':'+hour).digest('hex'):null,hourExpiresAt=new Date((hour+1)*3600000+60000);
 // Atomic increments in MySQL share the quota between API processes. Each admin route (login, recovery, reset, password) has its own global
 // bucket, so neither public form traffic nor another admin route can exhaust the quota of /admin/login.
 const [individual,total,hourly]=await this.prisma.$transaction(async tx=>{
 await tx.$executeRaw`INSERT INTO rate_limit_buckets (id, count, expiresAt) VALUES (${id}, 1, ${expiresAt}) ON DUPLICATE KEY UPDATE count = count + 1`;
 await tx.$executeRaw`INSERT INTO rate_limit_buckets (id, count, expiresAt) VALUES (${global}, 1, ${expiresAt}) ON DUPLICATE KEY UPDATE count = count + 1`;
 if(hourId)await tx.$executeRaw`INSERT INTO rate_limit_buckets (id, count, expiresAt) VALUES (${hourId}, 1, ${hourExpiresAt}) ON DUPLICATE KEY UPDATE count = count + 1`;
 return Promise.all([tx.rateLimitBucket.findUniqueOrThrow({where:{id}}),tx.rateLimitBucket.findUniqueOrThrow({where:{id:global}}),hourId?tx.rateLimitBucket.findUniqueOrThrow({where:{id:hourId}}):null]);
 });
 await this.prisma.rateLimitBucket.deleteMany({where:{expiresAt:{lt:new Date(now)}}});
 if(individual.count>limit||total.count>(globalLimits[scope]??200))throw new HttpException({ok:false,mensaje:'Has enviado varias solicitudes. Espera un minuto y vuelve a intentar.'},429);
 if(hourly&&hourLimit&&hourly.count>hourLimit)throw new HttpException({ok:false,mensaje:'Has enviado varias solicitudes. Espera un momento y vuelve a intentar.'},429);
 return true;
 }
}
