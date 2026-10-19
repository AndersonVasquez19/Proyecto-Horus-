import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { originalCourses, originalGallery, originalServices } from './data';

@Injectable()
export class OriginalContentService {
  constructor(private readonly prisma: PrismaService) {}

  inventory() {
    return { ok:true, sections:[
      { key:'servicios', label:'Cableado, cámaras, soporte y asesoramiento', total:originalServices.length, titles:originalServices.map(x=>x.titulo) },
      { key:'capacitaciones', label:'Programas de capacitación', total:originalCourses.length, titles:originalCourses.map(x=>x.titulo) },
      { key:'galeria', label:'Fotografías de la galería original', total:originalGallery.length, titles:originalGallery.map(x=>x.titulo) },
    ] };
  }

  async restore(section:string, state:'borrador'|'publicado'='publicado') {
    if(!['servicios','capacitaciones','galeria'].includes(section)) throw new BadRequestException('Sección no válida.');
    const result=await this.prisma.$transaction(async tx=>{
      if(section==='servicios') return tx.servicio.createMany({data:originalServices.map(x=>({...x,origen_original:x.slug,estado:state})),skipDuplicates:true});
      if(section==='capacitaciones') return tx.curso.createMany({data:originalCourses.map(x=>({...x,origen_original:x.slug,estado:state})),skipDuplicates:true});
      const existing=await tx.galeriaItem.findMany({where:{imagen_url:{in:originalGallery.map(x=>x.imagen_url)}},select:{imagen_url:true}});
      const urls=new Set(existing.map(x=>x.imagen_url));
      return tx.galeriaItem.createMany({data:originalGallery.filter(x=>!urls.has(x.imagen_url)).map(x=>({...x,activo:state==='publicado'})),skipDuplicates:true});
    });
    const total=section==='servicios'?originalServices.length:section==='capacitaciones'?originalCourses.length:originalGallery.length;
    return {ok:true,created:result.count,existing:total-result.count,mensaje:result.count+' registros recuperados. Los existentes se conservaron.'};
  }
}
