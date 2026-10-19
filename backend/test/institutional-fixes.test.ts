import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createValidationPipe } from '../src/common/validation';
import { CreateContactoDto } from '../src/contacto/dto/create-contacto.dto';
import { CreateReclamacionDto } from '../src/reclamaciones/dto/create-reclamacion.dto';
import { SubscribeNewsletterDto } from '../src/newsletter/dto/subscribe-newsletter.dto';
import { ResetPasswordDto } from '../src/admin/auth/dto/account.dto';
import { UpdateCursoDto } from '../src/catalogo/catalogo.dto';
import { CatalogoService } from '../src/catalogo/catalogo.service';
import { ContactoService } from '../src/contacto/contacto.service';
import { MailService } from '../src/mail/mail.service';
import { PrismaService } from '../src/database/prisma.service';
import { JwtStrategy } from '../src/admin/auth/jwt.strategy';
import { redactPersonalData, ChatbotService } from '../src/chatbot/chatbot.service';
import { imageExtension } from '../src/uploads/uploads.service';
const validate=(value:unknown,metatype:new()=>object)=>createValidationPipe().transform(value,{type:'body',metatype});
test('contact trims before validation and rejects whitespace-only required fields',async()=>{
 const base={nombre:' Ana ',email:' ANA@example.com ',telefono:' 999888777 ',asunto:' Consulta ',mensaje:' Mensaje de prueba '};
 const dto=await validate(base,CreateContactoDto);assert.equal(dto.nombre,'Ana');assert.equal(dto.email,'ana@example.com');
 for(const key of ['nombre','telefono','asunto','mensaje'])await assert.rejects(()=>validate({...base,[key]:'    '},CreateContactoDto),BadRequestException);
});
test('complaint rejects strings longer than its storage and newsletter requires consent',async()=>{
 const dto={nombres:'Ana',apellidos:'Perez',email:'a@example.com',telefono:'999888777',tipo_registro:'reclamo',area:'Soporte',fecha_incidente:'2026-01-01',descripcion_bien:'Servicio',detalle_reclamo:'Prueba'};
 for(const key of ['nombres','apellidos','telefono','direccion','area'])await assert.rejects(()=>validate({...dto,[key]:'x'.repeat(256)},CreateReclamacionDto));
 await assert.rejects(()=>validate({email:'a@example.com'},SubscribeNewsletterDto));
 await validate({email:' A@example.com ',consentimiento:true},SubscribeNewsletterDto);
 await assert.rejects(()=>validate({token:'token',password:'é'.repeat(37)},ResetPasswordDto));
});
test('explicit optional clearing cannot erase required fields or accept an empty update',async()=>{
 let updates:unknown;
 const mock={curso:{findFirst:async()=>({id:1}),update:async({data}:{data:unknown})=>{updates=data;return{id:1}}}};
 const service=new CatalogoService(mock as unknown as PrismaService);
 const dto=await validate({limpiar:['imagen_url','fecha_inicio','temario']},UpdateCursoDto);
 await service.update('cursos',1,dto);assert.deepEqual(updates,{imagen_url:null,fecha_inicio:null,temario:null});
 for(const value of [{limpiar:['titulo']},{limpiar:[]},{limpiar:['temario'],temario:'Texto'}])await assert.rejects(()=>service.update('cursos',1,value),BadRequestException);
 await assert.rejects(()=>validate({limpiar:['titulo']},UpdateCursoDto));
});
test('mail failure leaves the contact saved and does not claim successful delivery',async()=>{
 let saves=0;
 const mail={sendContactoNotificacion:async()=>false};
 const service=new ContactoService({contacto:{create:async()=>{saves++;return{id:7}}}} as unknown as PrismaService,mail as unknown as MailService);
 const result=await service.create({nombre:'Ana',email:'a@example.com',telefono:'999888777',asunto:'Consulta',mensaje:'Mensaje'});
 assert.equal(result.ok,true);assert.equal(result.correo_enviado,false);assert.equal(saves,1);
});
test('JWT rejects revoked versions and inactive accounts',async()=>{
 let user={id:1,nombre:'Ana',email:'a@example.com',activo:true,session_version:2};
 const strategy=new JwtStrategy(new ConfigService({JWT_SECRET:'x'.repeat(32)}),{adminUser:{findUnique:async()=>user}} as unknown as PrismaService);
 await assert.rejects(()=>strategy.validate({id:1,email:user.email,version:1}),UnauthorizedException);
 assert.equal((await strategy.validate({id:1,email:user.email,version:2})).id,1);
 user={...user,activo:false};await assert.rejects(()=>strategy.validate({id:1,email:user.email,version:2}),UnauthorizedException);
});
test('provider text hides email, phone and document patterns',()=>{
 const result=redactPersonalData('Escríbeme a prueba@example.com, teléfono +51 999 888 777, DNI 12345678');
 assert.ok(!result.includes('prueba@example.com'));assert.ok(!result.includes('999'));assert.ok(!result.includes('12345678'));
 assert.equal(redactPersonalData('Curso de redes de 20 horas'),'Curso de redes de 20 horas');
});
test('chatbot reads only public institutional settings for contact questions',async()=>{
 let query:unknown;
 const client={setting:{findMany:async(options:unknown)=>{query=options;return[{clave:'telefono_principal',valor:'+51 999000111'}]}},curso:{findMany:async()=>[]},servicio:{findMany:async()=>[]},preguntaFrecuente:{findMany:async()=>[]}};
 const chatbot=new ChatbotService(client as unknown as PrismaService,new ConfigService({_PROCESS_ENV_VALIDATED:{CHATBOT_AI_ENABLED:'false'}}));
 const result=await chatbot.reply({message:'Cuál es su teléfono de contacto'});
 assert.equal(result.sources[0].id,'empresa');assert.ok(result.answer.includes('+51 999000111'));assert.ok(JSON.stringify(query).includes('horario_atencion'));assert.ok(!JSON.stringify(query).includes('MAIL_PASS'));
});

test('public course date filters cannot expose administrative counts',async()=>{
 const counts:unknown[]=[];
 const service=new CatalogoService({curso:{findMany:async()=>[],count:async({where}:{where:unknown})=>{counts.push(where);return 0}}} as unknown as PrismaService);
 const result=await service.list('cursos',{page:1,limit:20,periodo:'upcoming'},true);
 assert.equal(result.metrics,undefined);assert.equal(counts.length,1);assert.equal((counts[0] as {estado:string}).estado,'publicado');
});

test('image type uses file signature and rejects SVG, HTML and empty data',()=>{
 for(const value of ['<svg></svg>','<html>bad</html>',''])assert.equal(imageExtension(Buffer.from(value)),null);
 assert.equal(imageExtension(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(4)])),'png');
 assert.equal(imageExtension(Buffer.from('RIFF0000WEBP0000')),'webp');
});
