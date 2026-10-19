import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { MailService } from '../mail/mail.service';
import { corsOrigins } from '../deployment.config';
import { SubscribeNewsletterDto } from './dto/subscribe-newsletter.dto';
import { ListQueryDto, pageArgs, pageResult } from '../common/list-query.dto';
@Injectable()
export class NewsletterService {
 constructor(private readonly prisma:PrismaService,@Optional() private readonly config?:ConfigService,@Optional() private readonly mail?:MailService){}
 private signature(value:string){return createHmac('sha256',this.config!.getOrThrow<string>('JWT_SECRET')).update('newsletter:'+value).digest('base64url');}
 async subscribe(dto:SubscribeNewsletterDto){
 const email=dto.email.toLowerCase().trim();
 // Market ya no es un producto: se rechaza (no se convierte) aunque la llamada no pase por el DTO.
 if(typeof dto.interes==='string'&&dto.interes.trim().toLowerCase()==='market')throw new BadRequestException('El interés "market" ya no está disponible.');
 const item=await this.prisma.newsletter.upsert({where:{email},create:{email,interes:dto.interes||'novedades',activo:true,consent_at:new Date()},update:{activo:true,consent_at:new Date(),...(dto.interes?{interes:dto.interes}:{})}});
 let delivered=false;
 if(this.config&&this.mail&&item){const origin=corsOrigins(process.env)[0];if(origin){
 const value=String(item.id),url=new URL('/newsletter/baja',origin);url.searchParams.set('token',value+'.'+this.signature(value));
 delivered=await this.mail.sendMail({from:this.config.get<string>('MAIL_USER'),to:email,subject:'Suscripción a novedades de Horus',text:'Autorizaste recibir novedades de Horus. Puedes dar de baja tu suscripción en cualquier momento:\n'+url.href});
 }}
 return{ok:true,mensaje:'Suscripción registrada. Puedes cancelar desde el enlace del correo o contactando con el equipo.',correo_enviado:delivered};
 }
 async unsubscribe(token:string){
 const [id,signature,...extra]=token.split('.');
 if(extra.length||!/^\d+$/.test(id)||!signature||!this.config)throw new BadRequestException('Enlace de baja inválido.');
 const expected=Buffer.from(this.signature(id)),actual=Buffer.from(signature);
 if(expected.length!==actual.length||!timingSafeEqual(expected,actual))throw new BadRequestException('Enlace de baja inválido.');
 await this.prisma.newsletter.updateMany({where:{id:Number(id)},data:{activo:false}});
 return{ok:true,mensaje:'Suscripción desactivada. Ya no recibirás novedades.'};
 }
 async findAll(q:ListQueryDto={}){
 const where:Prisma.NewsletterWhereInput={...(q.interes?{interes:q.interes}:{}),AND:[q.estado?(q.estado==='activo'?{activo:true}:{OR:[{activo:false},{activo:null}]}):{},q.search?{OR:[{email:{contains:q.search}},{interes:{contains:q.search}}]}:{}]};
 const subscribers=await this.prisma.newsletter.findMany({where,...pageArgs(q),orderBy:[{createdAt:'desc'},{id:'desc'}]});
 if(q.page===undefined)return{ok:true,total:subscribers.length,subscribers};
 const [total,all,activo,inactivo,interests]=await Promise.all([this.prisma.newsletter.count({where}),this.prisma.newsletter.count(),this.prisma.newsletter.count({where:{activo:true}}),this.prisma.newsletter.count({where:{OR:[{activo:false},{activo:null}]}}),this.prisma.newsletter.groupBy({by:['interes']})]);
 return{ok:true,subscribers,...pageResult(q,total),metrics:{total:all,activo,inactivo},interests:interests.map(x=>x.interes)};
 }
 async remove(id:number){
 if(!await this.prisma.newsletter.findUnique({where:{id}}))throw new NotFoundException('Suscriptor no encontrado.');
 await this.prisma.newsletter.update({where:{id},data:{activo:false}});
 return{ok:true,mensaje:'Suscripción desactivada.'};
 }
}
