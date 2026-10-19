import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException, StreamableFile } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
export function imageExtension(buffer:Buffer):'png'|'jpg'|'webp'|null {
 if(buffer.length<12)return null;
 if(buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'png';
 if(buffer[0]===255&&buffer[1]===216&&buffer[2]===255)return 'jpg';
 if(buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP')return 'webp';
 return null;
}
@Injectable()
export class UploadsService {
 constructor(private readonly config:ConfigService){}
 private directory(){
 const configured=this.config.get<string>('UPLOAD_DIR');
 if(!configured&&this.config.get<string>('NODE_ENV')==='production')throw new ServiceUnavailableException('Configura almacenamiento persistente para subir imágenes.');
 return resolve(configured||'uploads');
 }
 async save(buffer:Buffer){
 if(!buffer?.length||buffer.length>5*1024*1024)throw new BadRequestException('La imagen debe pesar como máximo 5 MB.');
 const extension=imageExtension(buffer);if(!extension)throw new BadRequestException('Solo se admiten imágenes PNG, JPEG y WebP.');
 const directory=this.directory(),filename=randomUUID()+'.'+extension;
 await mkdir(directory,{recursive:true});await writeFile(resolve(directory,filename),buffer,{flag:'wx'});
 return {ok:true,path:'/uploads/'+filename};
 }
 async read(filename:string){
 if(!/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(filename))throw new NotFoundException('Imagen no encontrada.');
 let data:Buffer;
 try{data=await readFile(resolve(this.directory(),filename));}catch(error){if(error instanceof Error&&'code' in error&&error.code==='ENOENT')throw new NotFoundException('Imagen no encontrada.');throw error;}
 const extension=imageExtension(data);if(!extension)throw new NotFoundException('Imagen no encontrada.');
 return new StreamableFile(data,{type:extension==='jpg'?'image/jpeg':'image/'+extension});
 }
}
