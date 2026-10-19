import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { createValidationPipe } from '../src/common/validation';
import { PrismaService } from '../src/database/prisma.service';
import { CreateCursoDto, CreateServicioDto, UpdateCursoDto } from '../src/catalogo/catalogo.dto';
import { CreateGaleriaDto } from '../src/galeria/dto/create-galeria.dto';
import { CatalogoService } from '../src/catalogo/catalogo.service';
import { OriginalContentService } from '../src/content-original/content-original.service';
import { OriginalContentController, RestoreOriginalDto } from '../src/content-original/content-original.module';
import { originalCourses, originalGallery, originalServices } from '../src/content-original/data';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
const validate=(value:unknown,metatype:new()=>object)=>createValidationPipe().transform(value,{type:'body',metatype});

test('original content satisfies public content validation without fabricated scheduling',async()=>{
 assert.equal(originalServices.length,19);assert.equal(originalCourses.length,4);assert.equal(originalGallery.length,61);
 for(const item of originalServices)await validate(item,CreateServicioDto);
 for(const item of originalCourses){await validate(item,CreateCursoDto);assert.equal(item.modalidad,undefined);assert.equal(item.duracion,undefined);assert.equal(item.fecha_inicio,undefined);}
 for(const item of originalGallery){const {origen_original,...fields}=item;assert.ok(origen_original);await validate(fields,CreateGaleriaDto);}
 assert.equal(new Set(originalServices.map(x=>x.slug)).size,19);
 assert.equal(new Set(originalGallery.map(x=>x.origen_original)).size,61);
});
test('visual metadata and image paths reject invalid values and nulls',async()=>{
 for(const value of [{color:'red'},{icono:'<svg>'},{orden:-1},{presentacion:'fake'},{nombre_corto:null},{imagen_url:'/site-original/../private.png'},{imagen_url:'javascript:alert(1)'},{imagen_url:'https://%%%%'},{imagen_url:'ftp://example.com/file.png'}])
  await assert.rejects(()=>validate({...originalServices[0],...value},CreateServicioDto),BadRequestException);
 await assert.rejects(()=>validate({limpiar:['color']},UpdateCursoDto),BadRequestException);
});
test('courses require modality and duration while unscheduled programs may omit them',async()=>{
 const base={titulo:'Programa',slug:'programa',descripcion:'Descripción'};
 await validate({...base,tipo:'capacitacion'},CreateCursoDto);
 await assert.rejects(()=>validate({...base,tipo:'curso'},CreateCursoDto),BadRequestException);
 await assert.rejects(()=>validate({...base,tipo:'capacitacion',modalidad:null},CreateCursoDto),BadRequestException);
 let writes=0;
 const model={findFirst:async()=>({id:1,tipo:'capacitacion',modalidad:null,duracion:null}),update:async()=>{writes++;return{id:1}}};
 const service=new CatalogoService({curso:model} as unknown as PrismaService);
 await assert.rejects(()=>service.update('cursos',1,{tipo:'curso'}),BadRequestException);
 assert.equal(writes,0);
 await service.update('cursos',1,{titulo:'Título revisado'});assert.equal(writes,1);
});
test('inventory is read-only and restoration endpoints require an authenticated administrator',async()=>{
 const service=new OriginalContentService({} as PrismaService);
 assert.deepEqual(service.inventory().sections.map(x=>x.total),[19,4,61]);
 assert.ok(Reflect.getMetadata(GUARDS_METADATA,OriginalContentController).includes(JwtAuthGuard));
 await assert.rejects(()=>service.restore('settings'),BadRequestException);
 assert.equal((await validate({},RestoreOriginalDto)).estado,'publicado');
 await assert.rejects(()=>validate({estado:'archivado'},RestoreOriginalDto),BadRequestException);
});
