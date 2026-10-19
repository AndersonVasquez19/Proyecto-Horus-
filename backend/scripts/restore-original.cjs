// Acción explícita de mantenimiento local; utiliza el mismo servicio que el panel.
const {prisma}=require('./database.cjs');
const {OriginalContentService}=require('../dist/content-original/content-original.service');
async function restore(){
  const local=['localhost','127.0.0.1','::1'].includes(process.env.DB_HOST||'localhost');
  if(!local||process.env.NODE_ENV==='production')throw new Error('Este comando solo recupera contenido en MySQL local de desarrollo. En otros entornos utiliza el panel.');
  const client=prisma();
  try{
    const service=new OriginalContentService(client);
    for(const section of ['servicios','capacitaciones','galeria']){
      const result=await service.restore(section);
      console.log(section+': '+result.created+' creados, '+result.existing+' existentes conservados.');
    }
  }finally{await client.$disconnect();}
}
restore().catch(()=>{console.error('No se pudo recuperar el contenido. Revisa las migraciones y la conexión. Puedes reintentar sin duplicar los registros originales.');process.exitCode=1;});
