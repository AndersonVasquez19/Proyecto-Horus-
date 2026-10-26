import { BadRequestException, ConflictException, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHmac } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { MailService } from '../../mail/mail.service';
import { corsOrigins } from '../../deployment.config';
import { ChangePasswordDto, ResetPasswordDto } from './dto/account.dto';
import { BCRYPT_COST } from './password-security';
import { RecoveryThrottle } from './recovery-throttle';
import { SELF_ROLE_MESSAGE, STALE_ROLE_MESSAGE, activeCount, activeGerentes, assertInvariants, planRoleChange, planStatusChange, toAccountState } from './account-rules';
import { AdminRole, isAdminRole } from '../../permissions/roles';
import { ACCOUNTS_BUSY_MESSAGE, isLockConflict, isLockNowait } from './account-locks';
import { setTimeout as sleep } from 'node:timers/promises';
@Injectable()
export class AccountsService implements OnModuleDestroy {
 private readonly logger=new Logger(AccountsService.name);
 // Envíos de recuperación en curso: se siguen para no perder ninguno al apagar y para limitar cuántos hay a la vez.
 private readonly pending=new Set<Promise<void>>();
 static readonly MAX_PENDING_MAIL=20;
 static readonly DRAIN_TIMEOUT_MS=10000;
 constructor(private readonly prisma:PrismaService,private readonly jwt:JwtService,private readonly config:ConfigService,private readonly mail:MailService){}
 private resetSecret(password:string){return createHmac('sha256',this.config.getOrThrow<string>('JWT_SECRET')).update('reset:'+password).digest('hex');}
 private readonly throttle=new RecoveryThrottle();
 async forgot(email:string){
 const user=await this.prisma.adminUser.findUnique({where:{email}});
 // Se cuenta toda solicitud (cuenta existente o no) y la respuesta no cambia: al superar el límite solo se omite el envío.
 const allowed=this.throttle.allow(email);
 if(user?.activo&&!allowed)this.logger.warn('Límite de recuperación por cuenta alcanzado: se omite el envío.');
 if(user?.activo&&allowed){const origin=corsOrigins(process.env)[0];if(origin){
 const token=this.jwt.sign({id:user.id},{secret:this.resetSecret(user.password),expiresIn:'30m',audience:'horus-password-reset'});
 const url=new URL('/admin/reset-password',origin);url.searchParams.set('token',token);
 await this.deliverResetMail({from:this.config.get<string>('MAIL_USER'),to:user.email,subject:'Restablecer contraseña de Horus',text:'Solicitaste cambiar tu contraseña. El enlace vence en 30 minutos y solo puede utilizarse una vez. Si no fuiste tú, ignora este mensaje.\n\n'+url.href});
 }}
 return {ok:true,mensaje:'Si el correo corresponde a una cuenta activa, recibirá un enlace de recuperación.'};
 }
 // La respuesta HTTP no espera al proveedor de correo: si esperara, una cuenta activa tardaría más que una inexistente.
 // El envío corre en este proceso, seguido en `pending`, con errores contenidos (sendMail no lanza) y un máximo simultáneo.
 // No es una cola persistente: si el proceso cae justo después de responder el correo se pierde y la persona puede volver a pedirlo.
 // En entornos serverless (VERCEL=1) no hay ejecución tras responder, así que allí se espera el envío como antes.
 private deliverResetMail(message:Parameters<MailService['sendMail']>[0]):Promise<void>{
 if(this.config.get<string>('VERCEL')==='1')return this.mail.sendMail(message).then(()=>undefined,()=>{this.logger.error('No se pudo enviar el enlace de recuperación.')});
 if(this.pending.size>=AccountsService.MAX_PENDING_MAIL){this.logger.warn('Demasiados envíos de recuperación en curso: se omite este envío.');return Promise.resolve();}
 const task:Promise<void>=this.mail.sendMail(message).then(()=>undefined,()=>{this.logger.error('No se pudo enviar el enlace de recuperación.')}).finally(()=>{this.pending.delete(task)});
 this.pending.add(task);return Promise.resolve();
 }
 async onModuleDestroy(){
 if(!this.pending.size)return;
 let timer:NodeJS.Timeout|undefined;
 await Promise.race([Promise.allSettled([...this.pending]),new Promise<void>(resolve=>{timer=setTimeout(resolve,AccountsService.DRAIN_TIMEOUT_MS)})]);
 clearTimeout(timer);
 }
 async reset(dto:ResetPasswordDto){
 const decoded=this.jwt.decode<{id?:number}>(dto.token);
 if(!decoded||!Number.isSafeInteger(decoded.id))throw new BadRequestException('Enlace inválido o vencido.');
 const user=await this.prisma.adminUser.findUnique({where:{id:decoded.id}});
 if(!user?.activo)throw new BadRequestException('Enlace inválido o vencido.');
 try{this.jwt.verify(dto.token,{secret:this.resetSecret(user.password),audience:'horus-password-reset',issuer:'horus-api'});}catch{throw new BadRequestException('Enlace inválido o vencido.');}
 const password=await bcrypt.hash(dto.password,BCRYPT_COST);
 const result=await this.prisma.adminUser.updateMany({where:{id:user.id,password:user.password,activo:true},data:{password,session_version:{increment:1}}});
 if(result.count!==1)throw new ConflictException('El enlace ya fue utilizado. Solicita otro.');
 return {ok:true,mensaje:'Contraseña actualizada. Inicia sesión nuevamente.'};
 }
 async password(id:number,dto:ChangePasswordDto){
 const user=await this.prisma.adminUser.findUnique({where:{id}});
 if(!user||!await bcrypt.compare(dto.current_password,user.password))throw new BadRequestException('La contraseña actual no coincide.');
 const password=await bcrypt.hash(dto.password,BCRYPT_COST);
 const result=await this.prisma.adminUser.updateMany({where:{id,password:user.password,activo:true},data:{password,session_version:{increment:1}}});
 if(result.count!==1)throw new ConflictException('La cuenta cambió. Inicia sesión nuevamente.');
 return {ok:true,mensaje:'Contraseña actualizada. Las sesiones anteriores fueron revocadas.'};
 }
 // Solo campos de identificación y acceso (nunca contraseña, session_version ni datos de recuperación). Un rol desconocido se informa como null.
 async list(){const users=await this.prisma.adminUser.findMany({select:{id:true,nombre:true,email:true,activo:true,rol:true,createdAt:true},orderBy:{nombre:'asc'}});return {ok:true,users:users.map(u=>({...u,rol:isAdminRole(u.rol)?u.rol:null}))};}
 // Activar o desactivar (reglas en account-rules.ts: M-1 último gerente, M-2 el rol queda en NULL). Todas las filas se bloquean en orden de id,
 // igual que admin:assign-role, así el panel y el script nunca deciden con datos que el otro está cambiando. El cambio, la revocación de
 // sesiones y su registro de auditoría se confirman juntos o no se confirma nada.
 // O-1: el bloqueo no espera (NOWAIT). Si otra transacción retiene las filas, se reintenta con una transacción nueva tras cada pausa de
 // LOCK_RETRY_DELAYS_MS (unos 1,5 s en total) y después se responde 409 sin cambios. Es seguro repetir: el bloqueo es la primera sentencia,
 // así que nada se escribió. Solo se traducen los conflictos de bloqueo (account-locks.ts); cualquier otro error sigue igual.
 static readonly LOCK_RETRY_DELAYS_MS:readonly number[]=[50,100,200,400,800];
 async status(id:number,activo:boolean,actor:number){
 if(id===actor&&!activo)throw new ConflictException('No puedes desactivar tu propia cuenta.');
 return this.withLockRetry(()=>this.applyStatus(id,activo,actor),'el cambio de estado');
 }
 // Cambio de rol desde el panel (reglas en account-rules.ts: planRoleChange). Mismo esquema que status: todas las filas bloqueadas en orden de
 // id con NOWAIT (igual que admin:assign-role, que también bloquea todas las filas), cambio + revocación de sesiones + auditoría juntos.
 async role(id:number,rol:AdminRole|null,expected:AdminRole|null,actor:number){
 if(id===actor)throw new ConflictException(SELF_ROLE_MESSAGE);
 return this.withLockRetry(()=>this.applyRole(id,rol,expected,actor),'el cambio de rol');
 }
 private async withLockRetry<T>(run:()=>Promise<T>,what:string):Promise<T>{
 const delays=AccountsService.LOCK_RETRY_DELAYS_MS;
 for(let attempt=0;;attempt++){
 try{return await run();}
 catch(error){
 if(isLockNowait(error)&&attempt<delays.length){await sleep(delays[attempt]);continue;}
 if(isLockConflict(error)){this.logger.warn('Cuentas bloqueadas por otra operación: se rechaza '+what+' sin aplicarlo.');throw new ConflictException(ACCOUNTS_BUSY_MESSAGE);}
 throw error;
 }
 }
 }
 private applyRole(id:number,rol:AdminRole|null,expected:AdminRole|null,actor:number){
 return this.prisma.$transaction(async tx=>{
 const rows=await tx.$queryRaw<{id:unknown;activo:unknown;rol:unknown}[]>`SELECT id, activo, rol FROM admin_users ORDER BY id FOR UPDATE NOWAIT`;
 const accounts=rows.map(toAccountState),plan=planRoleChange(accounts,id,rol,expected,actor);
 if(!plan.changed)return {ok:true,mensaje:plan.mensaje,user:{id,rol}};
 const result=await tx.adminUser.updateMany({where:{id,activo:true,rol:plan.before.rol},data:{rol,session_version:{increment:1}}});
 if(result.count!==1)throw new ConflictException(STALE_ROLE_MESSAGE);
 assertInvariants({activos:activeCount(accounts),gerentes:activeGerentes(accounts)},{activos:await tx.adminUser.count({where:{activo:true}}),gerentes:await tx.adminUser.count({where:{activo:true,rol:'GERENTE_GENERAL'}})});
 await tx.adminAuditoria.create({data:{origen:'panel',actor_id:actor,cuenta_id:id,operacion:plan.operacion,rol_anterior:plan.before.rol,rol_nuevo:rol,activo_anterior:true,activo_nuevo:true,resultado:'aplicado'}});
 return {ok:true,mensaje:plan.mensaje,user:{id,rol}};
 });
 }
 private applyStatus(id:number,activo:boolean,actor:number){
 return this.prisma.$transaction(async tx=>{
 const rows=await tx.$queryRaw<{id:unknown;activo:unknown;rol:unknown}[]>`SELECT id, activo, rol FROM admin_users ORDER BY id FOR UPDATE NOWAIT`;
 const accounts=rows.map(toAccountState),plan=planStatusChange(accounts,id,activo,actor);
 if(!plan.changed)return {ok:true,mensaje:plan.mensaje};
 const result=await tx.adminUser.updateMany({where:{id,activo:plan.before.activo},data:{activo,rol:null,session_version:{increment:1}}});
 if(result.count!==1)throw new ConflictException('La cuenta cambió durante la operación. Vuelve a intentarlo.');
 assertInvariants({activos:activeCount(accounts),gerentes:activeGerentes(accounts)},{activos:await tx.adminUser.count({where:{activo:true}}),gerentes:await tx.adminUser.count({where:{activo:true,rol:'GERENTE_GENERAL'}})});
 await tx.adminAuditoria.create({data:{origen:'panel',actor_id:actor,cuenta_id:id,operacion:plan.operacion,rol_anterior:plan.before.rol,rol_nuevo:null,activo_anterior:plan.before.activo,activo_nuevo:activo,resultado:'aplicado'}});
 return {ok:true,mensaje:plan.mensaje};
 });
 }
}
