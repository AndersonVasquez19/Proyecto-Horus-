import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { MailService, type MailOutcome } from '../mail/mail.service';
import { attemptEntry, decideSend, fingerprint, lastAttempt, stateOfOutcome, type AttemptKind, type SendBlock } from '../mail/mail-attempts';
import { isUniqueViolation } from '../database/serialization';
import { AttentionDto } from './attention.dto';
import { administrativeState, lockMessage } from './message-state';

// Textos para la persona que administra. Nunca incluyen detalles del proveedor, destinatarios ni identificadores internos.
const BLOCKED: Record<SendBlock, string> = {
 en_curso: 'Hay un envío iniciado de este contenido que todavía no tiene resultado, así que puede haberse enviado. Revisa el historial antes de enviarlo otra vez.',
 ya_aceptado: 'El proveedor ya aceptó este contenido. Aceptado no significa entregado. Confirma si de verdad quieres enviarlo otra vez.',
 incierto: 'No pudimos confirmar si el proveedor aceptó el envío anterior; es posible que el destinatario lo reciba. Revisa el historial antes de reenviarlo.',
};
const WORDS: Record<'respuesta' | 'constancia', { accepted: string; failed: string }> = {
 respuesta: { accepted: 'El proveedor aceptó el correo con la respuesta. Esto no confirma que ya esté en la bandeja del destinatario.', failed: 'No se pudo enviar el correo. La respuesta sigue guardada y puedes volver a intentarlo.' },
 constancia: { accepted: 'El proveedor aceptó la constancia para la persona. Esto no confirma que ya esté en su bandeja.', failed: 'No se pudo enviar la constancia. Puedes volver a intentarlo.' },
};
const UNCERTAIN = 'No pudimos confirmar si el proveedor aceptó el correo. Es posible que el destinatario lo reciba. Revisa el historial antes de reenviarlo.';
const STALE = 'La respuesta cambió. Recarga el caso antes de enviarla.';
@Injectable()
export class AttentionService {
 private readonly logger=new Logger(AttentionService.name);
 constructor(private readonly prisma:PrismaService,private readonly mail:MailService,private readonly config:ConfigService){}
 private async record(recurso:string,id:number){
 if(recurso==='messages'){const item=await this.prisma.contacto.findUnique({where:{id}});if(!item)throw new NotFoundException('Consulta no encontrada.');return{email:item.email,subject:'Re: '+item.asunto,estado:item.estado};}
 if(recurso==='reclamaciones'){const item=await this.prisma.reclamacion.findUnique({where:{id}});if(!item)throw new NotFoundException('Reclamación no encontrada.');return{email:item.email,subject:'Respuesta a '+item.numero_reclamo,estado:'nuevo'};}
 throw new BadRequestException('Recurso no válido.');
 }
 // Huella del envío lógico: recurso, destinatario y contenido. Un texto nuevo (o un destinatario nuevo) es otro envío y no hereda el bloqueo del anterior.
 private huellaRespuesta(recurso:string,id:number,email:string,respuesta:string){return fingerprint('respuesta',recurso,String(id),email.toLowerCase(),respuesta);}
 private huellaConstancia(recurso:string,id:number,email:string){return fingerprint('constancia',recurso,String(id),email.toLowerCase());}
 // Estado del último envío de la respuesta guardada y de la constancia, derivado del historial (la interfaz no recalcula huellas).
 private envios(recurso:string,id:number,email:string,item:{respuesta:string;historial:unknown}){
 const resumen=(kind:AttemptKind,huella:string)=>{const last=lastAttempt(item.historial,kind,huella);return last?{estado:last.estado,fecha:last.fecha,intento:last.intento}:null;};
 return{respuesta:item.respuesta.trim()?resumen('respuesta',this.huellaRespuesta(recurso,id,email,item.respuesta)):null,constancia:resumen('constancia',this.huellaConstancia(recurso,id,email))};
 }
 async get(recurso:string,id:number){
 const record=await this.record(recurso,id);
 const item=await this.prisma.attentionRecord.findUnique({where:{recurso_registro_id:{recurso,registro_id:id}}});
 const estado=administrativeState(record.estado,item);
 const base=item?{...item,estado}:{estado,responsable:'',notas:'',respuesta:'',revision:1,historial:[] as unknown[]};
 return{ok:true,item:{...base,envios:this.envios(recurso,id,record.email,base)}};
 }
 async save(recurso:string,id:number,dto:AttentionDto,user:number){
 const record=await this.record(recurso,id);
 if(dto.estado==='atendido'&&recurso==='reclamaciones'&&!dto.respuesta.trim())throw new BadRequestException('Registra la respuesta antes de marcar el caso como atendido.');
 try{const saved=await this.prisma.$transaction(async tx=>{
 if(recurso==='messages'&&!(await lockMessage(tx,id)).length)throw new NotFoundException('Consulta no encontrada.');
 const where={recurso_registro_id:{recurso,registro_id:id}};
 const old=await tx.attentionRecord.findUnique({where});
 if(old&&old.revision!==dto.revision||!old&&dto.revision!==1)throw new ConflictException('El seguimiento cambió en otra sesión. Recarga el caso.');
 const historial=[...(old?.historial as Prisma.JsonArray||[]),{accion:'Seguimiento actualizado: '+dto.estado,usuario:user,fecha:new Date().toISOString()}];
 const data={estado:dto.estado,responsable:dto.responsable,notas:dto.notas,respuesta:dto.respuesta,historial,revision:(old?.revision||1)+1};
 if(old){const result=await tx.attentionRecord.updateMany({where:{id:old.id,revision:dto.revision},data});if(result.count!==1)throw new ConflictException('El seguimiento cambió en otra sesión. Recarga el caso.');}
 else await tx.attentionRecord.create({data:{...data,recurso,registro_id:id,...(recurso==='messages'?{contacto_id:id}:{reclamacion_id:id})}});
 if(recurso==='messages')await tx.contacto.update({where:{id},data:{estado:dto.estado==='archivado'?'atendido':dto.estado}});
 return{ok:true,item:await tx.attentionRecord.findUniqueOrThrow({where})};
 });return{ok:true,item:{...saved.item,envios:this.envios(recurso,id,record.email,saved.item)}};}catch(e){if(e instanceof Prisma.PrismaClientKnownRequestError&&e.code==='P2003')throw new ConflictException('El registro de origen cambió. Recarga el caso.');if(isUniqueViolation(e))throw new ConflictException('El seguimiento cambió en otra sesión. Recarga el caso.');throw e;}
 }
 // Reclama el envío ANTES de contactar al proveedor, en una transacción corta (sin red dentro): el intento queda en el historial como «iniciado»
 // y la revisión sube. Compare-and-swap sobre `revision`: de dos peticiones simultáneas solo una lo consigue; la otra recibe 409 sin llegar al proveedor.
 // Garantía real: evita duplicados por concurrencia o por reintento manual sobre un intento registrado. NO garantiza idempotencia absoluta
 // (si el backend cae después de que el proveedor acepta y antes de registrar el resultado, el intento queda «iniciado» y exige confirmación).
 private async claim(recurso:string,id:number,kind:AttemptKind,huella:string,expectedRevision:number|null,estado:string,user:number,confirmed:boolean){
 const intento=randomUUID();
 try{await this.prisma.$transaction(async tx=>{
 if(recurso==='messages'&&!(await lockMessage(tx,id)).length)throw new NotFoundException('Consulta no encontrada.');
 const where={recurso_registro_id:{recurso,registro_id:id}};
 const old=await tx.attentionRecord.findUnique({where});
 const stale=()=>new ConflictException(STALE);
 const entry=()=>attemptEntry(kind,'iniciado',user,huella,intento);
 if(old){
 if(expectedRevision!==null&&old.revision!==expectedRevision)throw stale();
 const decision=decideSend(lastAttempt(old.historial,kind,huella),confirmed);
 if(!decision.allow)throw new HttpException({ok:false,envio:'bloqueado',motivo:decision.motivo,requiere_confirmacion:true,mensaje:BLOCKED[decision.motivo as SendBlock]},HttpStatus.CONFLICT);
 const result=await tx.attentionRecord.updateMany({where:{id:old.id,revision:old.revision},data:{historial:[...(old.historial as Prisma.JsonArray),entry()] as unknown as Prisma.InputJsonValue,revision:old.revision+1}});
 if(result.count!==1)throw stale();
 }else{
 if(expectedRevision!==null&&expectedRevision!==1)throw stale();
 // Sin seguimiento todavía (p. ej. primera constancia): se crea con el intento iniciado, igual que haría el primer guardado.
 await tx.attentionRecord.create({data:{recurso,registro_id:id,estado,responsable:'',notas:'',respuesta:'',revision:2,historial:[entry()] as unknown as Prisma.InputJsonValue,...(recurso==='messages'?{contacto_id:id}:{reclamacion_id:id})}});
 }
 });}catch(e){if(isUniqueViolation(e))throw new ConflictException(STALE);throw e;}
 return intento;
 }
 // Registra el desenlace (transacción corta, con reintento si alguien guardó entre medias). Cada escritura sube la revisión para no perder
 // el historial frente a un guardado simultáneo. Devuelve false si no pudo registrarse: el intento queda «iniciado» y exige confirmación.
 private async finish(recurso:string,id:number,kind:AttemptKind,huella:string,intento:string,outcome:MailOutcome,user:number){
 const entry=attemptEntry(kind,stateOfOutcome(outcome),user,huella,intento,outcome.providerId);
 for(let attempt=0;attempt<3;attempt++){
 try{await this.prisma.$transaction(async tx=>{
 if(recurso==='messages'&&!(await lockMessage(tx,id)).length)throw new NotFoundException('Consulta no encontrada.');
 const old=await tx.attentionRecord.findUnique({where:{recurso_registro_id:{recurso,registro_id:id}}});
 if(!old)throw new NotFoundException('Seguimiento no encontrado.');
 const result=await tx.attentionRecord.updateMany({where:{id:old.id,revision:old.revision},data:{historial:[...(old.historial as Prisma.JsonArray),entry] as unknown as Prisma.InputJsonValue,revision:old.revision+1}});
 if(result.count!==1)throw new ConflictException('reintentar');
 });return true;}catch{/* otra persona guardó entre medias: se vuelve a leer */}
 }
 this.logger.warn('No se pudo registrar el resultado de un envío de correo; el intento queda sin resultado.');
 return false;
 }
 // Reclamar -> enviar -> registrar -> responder con el estado persistido. `item` permite a la interfaz sincronizar revisión e historial sin otra lectura.
 private async dispatch(recurso:string,id:number,kind:'respuesta'|'constancia',huella:string,expectedRevision:number|null,estado:string,user:number,confirmed:boolean,send:()=>Promise<MailOutcome>){
 const intento=await this.claim(recurso,id,kind,huella,expectedRevision,estado,user,confirmed);
 let outcome:MailOutcome;
 try{outcome=await send();}catch{outcome={status:'uncertain',reason:'error inesperado al enviar'};}
 const registrado=await this.finish(recurso,id,kind,huella,intento,outcome,user);
 const item=await this.get(recurso,id).then(r=>r.item).catch(()=>undefined);
 const common={intento,registrado,...(item?{item,revision:item.revision}:{})};
 if(outcome.status==='accepted')return{ok:true,envio:'aceptado',mensaje:WORDS[kind].accepted+(registrado?'':' El resultado no pudo registrarse en el historial.'),...common};
 if(outcome.status==='failed')throw new HttpException({ok:false,envio:'fallido',mensaje:WORDS[kind].failed,...common},HttpStatus.SERVICE_UNAVAILABLE);
 throw new HttpException({ok:false,envio:'incierto',mensaje:UNCERTAIN,...common},HttpStatus.BAD_GATEWAY);
 }
 // Reenvío manual de la constancia. Contactos: SOLO la confirmación a la persona (el aviso interno no se repite). Reclamaciones: es un único
 // correo —constancia a la persona con copia oculta interna, como en el registro original—, que no se puede dividir sin cambiar la constancia.
 async receipt(recurso:string,id:number,user:number,confirmed=false){
 if(recurso==='messages'){
 const item=await this.prisma.contacto.findUnique({where:{id}});if(!item)throw new NotFoundException('Consulta no encontrada.');
 return this.dispatch(recurso,id,'constancia',this.huellaConstancia(recurso,id,item.email),null,item.estado,user,confirmed,()=>this.mail.deliverContactoConfirmacion(item));
 }
 if(recurso==='reclamaciones'){
 const item=await this.prisma.reclamacion.findUnique({where:{id}});if(!item)throw new NotFoundException('Reclamación no encontrada.');
 if(!item.numero_reclamo)throw new BadRequestException('El registro no tiene código de constancia.');
 return this.dispatch(recurso,id,'constancia',this.huellaConstancia(recurso,id,item.email),null,'nuevo',user,confirmed,()=>this.mail.deliverReclamoConstancia({...item,numero_reclamo:item.numero_reclamo}));
 }
 throw new BadRequestException('Recurso no válido.');
 }
 async send(recurso:string,id:number,revision:number,user:number,confirmed=false){
 const record=await this.record(recurso,id);const {item}=await this.get(recurso,id);
 if(item.revision!==revision)throw new ConflictException(STALE);
 if(!item.respuesta.trim())throw new BadRequestException('Guarda una respuesta antes de enviarla.');
 // El contenido enviado es el de la revisión guardada que la persona vio (la comprobación de revisión de arriba y la del claim lo garantizan).
 const message={from:this.config.get<string>('MAIL_USER'),to:record.email,subject:record.subject,text:item.respuesta};
 return this.dispatch(recurso,id,'respuesta',this.huellaRespuesta(recurso,id,record.email,item.respuesta),revision,record.estado,user,confirmed,()=>this.mail.deliver(message));
 }
}
