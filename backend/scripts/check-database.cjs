const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { connect } = require('./database.cjs');
function expectedColumns() {
  const sql = readFileSync(join(__dirname, '../migrations/00000000-initial.sql'), 'utf8');
  const legacy = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS \x60([^\x60]+)\x60 \(\n([\s\S]*?)\n\)/g)].flatMap(([, table, body]) =>
    [...body.matchAll(/^\s*\x60([^\x60]+)\x60 (.+)$/gm)].map(([, name, definition]) => ({
      table, name, type: definition.match(/^(\w+(?:\([^)]*\))?)/)[1],
      nullable: !definition.includes('NOT NULL'),
      unique: definition.includes('UNIQUE') || name === 'id',
    })),
  );
  const added = [
    ['admin_users','activo','tinyint',false],['admin_users','session_version','int',false],
    ['admin_users','rol',"ENUM('GERENTE_GENERAL','COORDINADORA_INSTITUCIONAL','SECRETARIA')",true],
    ['newsletter_subscribers','consent_at','datetime',true],
    ['attention_records','contacto_id','int',true],['attention_records','reclamacion_id','int',true],
    ...[['id','int'],['recurso','varchar(20)'],['registro_id','int'],['estado','varchar(20)'],['responsable','varchar(100)'],['notas','text'],['respuesta','text'],['revision','int'],['historial','json'],['updatedAt','datetime']].map(([name,type])=>['attention_records',name,type,false]),
    ...[['id','varchar(64)'],['count','int'],['expiresAt','datetime']].map(([name,type])=>['rate_limit_buckets',name,type,false]),
  ].map(([table,name,type,nullable])=>({table,name,type,nullable,unique:name==='id'}));
  const visual=[...['cursos','servicios'].map(table=>({table,name:'origen_original',type:'varchar(150)',nullable:true,unique:true})),...['area','certificacion','icono','color'].map((name,i)=>({table:'cursos',name,type:['varchar(80)','varchar(150)','varchar(30)','varchar(20)'][i],nullable:name!=='color',unique:false})),{table:'cursos',name:'orden',type:'int',nullable:false,unique:false},...['presentacion','nombre_corto','destacado','dato_principal','dato_secundario','etiquetas','icono','color','orden'].map((name,i)=>({table:'servicios',name,type:['varchar(30)','varchar(80)','varchar(100)','varchar(40)','varchar(100)','text','varchar(30)','varchar(20)','int'][i],nullable:!['presentacion','color','orden'].includes(name),unique:false})),{table:'galeria_items',name:'origen_original',type:'varchar(150)',nullable:true,unique:true}];
  const chatbot = [
    {table:'contactos',name:'origen',type:'varchar(20)',nullable:false,unique:false},
    ...[['id','int',false],['modo','varchar(10)',false],['resuelta','tinyint',false],['fuentes','int',false],['createdAt','datetime',false]].map(([name,type,nullable])=>({table:'chatbot_interacciones',name,type,nullable,unique:name==='id'})),
    ...[['id','int',false],['huella','char(64)',false],['pregunta','varchar(500)',false],['veces','int',false],['createdAt','datetime',false],['updatedAt','datetime',false]].map(([name,type,nullable])=>({table:'chatbot_preguntas_sin_respuesta',name,type,nullable,unique:['id','huella'].includes(name)})),
  ];
  const idempotencia = [
    {table:'cotizaciones',name:'idempotencia_clave',type:'varchar(128)',nullable:true,unique:true},
    {table:'cotizaciones',name:'idempotencia_huella',type:'char(64)',nullable:true,unique:false},
  ];
  const convenios = [
    ...[
      ['id','int',false], ['nombre','varchar(160)',false], ['sigla','varchar(50)',true],
      ['logo_url','varchar(2048)',true], ['descripcion_corta','text',false],
      ['descripcion_completa','text',true], ['informacion_adicional','text',true],
      ['orden','int',false], ['visible','tinyint',false], ['origen_local','varchar(150)',true],
      ['createdAt','datetime',false], ['updatedAt','datetime',false],
    ].map(([name,type,nullable])=>({table:'convenios',name,type,nullable,unique:['id','origen_local'].includes(name)})),
    ...[
      ['id','int'], ['convenio_id','int'], ['imagen_url','varchar(2048)'], ['orden','int'], ['createdAt','datetime'],
    ].map(([name,type])=>({table:'convenio_fotos',name,type,nullable:false,unique:name==='id'})),
  ];
  const ROL = "ENUM('GERENTE_GENERAL','COORDINADORA_INSTITUCIONAL','SECRETARIA')";
  const auditoria = [
    ['id','int',false], ['createdAt','datetime(3)',false], ['origen',"ENUM('panel','terminal')",false], ['actor_id','int',true],
    ['operador','varchar(100)',true], ['cuenta_id','int',false],
    ['operacion',"ENUM('cuenta_creada','cuenta_activada','cuenta_desactivada','rol_asignado','rol_retirado')",false],
    ['rol_anterior',ROL,true], ['rol_nuevo',ROL,true], ['activo_anterior','tinyint',true], ['activo_nuevo','tinyint',true],
    ['resultado',"ENUM('aplicado','rechazado')",false], ['motivo','varchar(200)',true],
  ].map(([name,type,nullable])=>({table:'admin_auditoria',name,type,nullable,unique:name==='id'}));
  return [...auditoria, ...academicColumns(), ...chatbot, ...idempotencia, ...convenios, ...legacy.map(column=>column.table==='cursos'&&['modalidad','duracion'].includes(column.name)?{...column,nullable:true}:column.table==='servicios'&&column.name==='categoria'?{...column,type:"ENUM('cableado','camaras','soporte','asesoramiento')"}:column),...added,...visual];
}
// E4.2 (20261015-academico-estructura). CREATE TABLE IF NOT EXISTS no corrige una tabla que ya existiera con otra forma:
// por eso se comprueba la estructura real (columnas, índices, claves foráneas, CHECK y la columna generada), no solo su presencia.
const DOC = "ENUM('DNI','CE','PASAPORTE')", CONFIRMADOR = "ENUM('GERENTE_GENERAL','COORDINADORA_INSTITUCIONAL')";
const ACADEMIC = {
  estudiantes: [['id','int',false],['nombres','varchar(120)',false],['apellidos','varchar(120)',false],['doc_pais','char(2)',true],['doc_tipo',DOC,true],
    ['doc_numero','varchar(20)',true],['archivado_at','datetime(3)',true],['revision','int',false],['createdAt','datetime(3)',false],['updatedAt','datetime(3)',false]],
  convocatorias: [['id','int',false],['curso_id','int',false],['nombre','varchar(160)',false],['fecha_inicio','date',true],['fecha_fin','date',true],
    ['estado',"ENUM('planificada','abierta','cerrada','cancelada')",false],['archivado_at','datetime(3)',true],['revision','int',false],['createdAt','datetime(3)',false],['updatedAt','datetime(3)',false]],
  matriculas: [['id','int',false],['estudiante_id','int',false],['convocatoria_id','int',false],['estado',"ENUM('activa','anulada')",false],
    ['cumplimiento',"ENUM('pendiente','cumplido','no_cumplido')",false],['confirmado_por','int',true],['confirmado_rol',CONFIRMADOR,true],['confirmado_at','datetime(3)',true],
    ['revision','int',false],['createdAt','datetime(3)',false],['updatedAt','datetime(3)',false]],
  certificados: [['id','int',false],['matricula_id','int',false],['codigo_verificacion','varchar(32)',false],['estado',"ENUM('vigente','anulado')",false],['vigente_matricula_id','int',true],
    ['estudiante_nombres','varchar(120)',false],['estudiante_apellidos','varchar(120)',false],['estudiante_doc_pais','char(2)',false],['estudiante_doc_tipo',DOC,false],
    ['estudiante_doc_numero','varchar(20)',false],['curso_titulo','varchar(160)',false],['curso_tipo',"ENUM('curso','capacitacion')",false],['curso_duracion','varchar(120)',true],
    ['convocatoria_nombre','varchar(160)',false],['convocatoria_fecha_inicio','date',true],['convocatoria_fecha_fin','date',true],['emitido_por','int',false],['emitido_at','datetime(3)',false],
    ['anulado_por','int',true],['anulado_at','datetime(3)',true],['anulacion_motivo','varchar(300)',true],['sustituye_a_id','int',true]],
  academico_historial: [['id','int',false],['createdAt','datetime(3)',false],['entidad',"ENUM('estudiante','convocatoria','matricula','certificado')",false],['entidad_id','int',false],
    ['operacion',"ENUM('creacion','edicion','archivado','restauracion','cambio_estado','anulacion','confirmacion','emision','sustitucion')",false],['origen',"ENUM('panel','terminal')",false],
    ['actor_id','int',true],['actor_rol',"ENUM('GERENTE_GENERAL','COORDINADORA_INSTITUCIONAL','SECRETARIA')",true],['operador','varchar(100)',true],['estado_anterior','varchar(30)',true],
    ['estado_nuevo','varchar(30)',true],['campos','json',true],['revision','int',true],['motivo','varchar(300)',true]],
};
// [tabla, índice, columnas en orden, único]
const ACADEMIC_INDEXES = [
  ['estudiantes','estudiantes_documento_uq',['doc_pais','doc_tipo','doc_numero'],true], ['estudiantes','estudiantes_nombre_idx',['apellidos','nombres'],false],
  ['convocatorias','convocatorias_curso_idx',['curso_id','fecha_inicio'],false], ['convocatorias','convocatorias_estado_idx',['estado','fecha_inicio'],false],
  ['matriculas','matriculas_estudiante_convocatoria_uq',['estudiante_id','convocatoria_id'],true], ['matriculas','matriculas_convocatoria_idx',['convocatoria_id','estado'],false],
  ['matriculas','matriculas_confirmado_por_idx',['confirmado_por'],false],
  ['certificados','certificados_codigo_uq',['codigo_verificacion'],true], ['certificados','certificados_vigente_uq',['vigente_matricula_id'],true],
  ['certificados','certificados_id_matricula_uq',['id','matricula_id'],true], ['certificados','certificados_sustituye_uq',['sustituye_a_id','matricula_id'],true],
  ['certificados','certificados_matricula_idx',['matricula_id','emitido_at'],false], ['certificados','certificados_emitido_por_idx',['emitido_por'],false],
  ['certificados','certificados_anulado_por_idx',['anulado_por'],false],
  ['academico_historial','academico_historial_entidad_idx',['entidad','entidad_id','createdAt'],false], ['academico_historial','academico_historial_actor_idx',['actor_id','createdAt'],false],
];
// [tabla, clave foránea, columnas, tabla referenciada, columnas referenciadas]; todas RESTRICT al borrar y al actualizar.
const ACADEMIC_FOREIGN_KEYS = [
  ['convocatorias','convocatorias_curso_fk',['curso_id'],'cursos',['id']],
  ['matriculas','matriculas_estudiante_fk',['estudiante_id'],'estudiantes',['id']], ['matriculas','matriculas_convocatoria_fk',['convocatoria_id'],'convocatorias',['id']],
  ['matriculas','matriculas_confirmado_por_fk',['confirmado_por'],'admin_users',['id']],
  ['certificados','certificados_matricula_fk',['matricula_id'],'matriculas',['id']], ['certificados','certificados_emitido_por_fk',['emitido_por'],'admin_users',['id']],
  ['certificados','certificados_anulado_por_fk',['anulado_por'],'admin_users',['id']],
  ['certificados','certificados_sustituye_fk',['sustituye_a_id','matricula_id'],'certificados',['id','matricula_id']],
];
const ACADEMIC_CHECKS = {
  estudiantes: ['estudiantes_nombres_chk','estudiantes_documento_completo_chk','estudiantes_documento_formato_chk','estudiantes_revision_chk'],
  convocatorias: ['convocatorias_nombre_chk','convocatorias_fechas_chk','convocatorias_revision_chk'],
  matriculas: ['matriculas_confirmacion_chk','matriculas_revision_chk'],
  certificados: ['certificados_codigo_chk','certificados_anulacion_chk','certificados_nombres_chk','certificados_documento_chk','certificados_fechas_chk'],
  academico_historial: ['academico_historial_origen_chk','academico_historial_campos_chk'],
};
function academicColumns() {
  return Object.entries(ACADEMIC).flatMap(([table, columns]) => columns.map(([name, type, nullable]) => ({ table, name, type, nullable, unique: ['id','codigo_verificacion'].includes(name) })));
}
async function checkAcademic(db, indexes) {
  const problems = [];
  const [columns] = await db.query("SELECT TABLE_NAME, COLUMN_NAME, EXTRA, GENERATION_EXPRESSION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)", [Object.keys(ACADEMIC)]);
  for (const [table, expected] of Object.entries(ACADEMIC)) {
    const extra = columns.filter(c => c.TABLE_NAME === table).map(c => c.COLUMN_NAME).filter(name => !expected.some(([e]) => e === name));
    if (extra.length) problems.push(table + ': columnas no previstas (' + extra.join(', ') + ')');
  }
  const generated = columns.find(c => c.TABLE_NAME === 'certificados' && c.COLUMN_NAME === 'vigente_matricula_id');
  const expression = String(generated?.GENERATION_EXPRESSION ?? '').toLowerCase();
  if (generated && !(/stored generated/i.test(generated.EXTRA) && expression.includes('estado') && expression.includes('vigente') && expression.includes('matricula_id'))) problems.push('certificados.vigente_matricula_id: no es la columna generada STORED prevista');
  for (const [table, name, expected, unique] of ACADEMIC_INDEXES) {
    const parts = indexes.filter(i => i.TABLE_NAME === table && i.INDEX_NAME === name).sort((a, b) => Number(a.SEQ_IN_INDEX) - Number(b.SEQ_IN_INDEX));
    if (!parts.length) problems.push(table + ': falta índice ' + name);
    else if (parts.map(i => i.COLUMN_NAME).join(',') !== expected.join(',') || parts.some(i => (Number(i.NON_UNIQUE) === 0) !== unique)) problems.push(table + ': índice ' + name + ' distinto');
  }
  const [keys] = await db.query("SELECT k.TABLE_NAME, k.CONSTRAINT_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME, r.DELETE_RULE, r.UPDATE_RULE FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME WHERE k.TABLE_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY k.ORDINAL_POSITION");
  for (const [table, name, cols, referenced, refCols] of ACADEMIC_FOREIGN_KEYS) {
    const parts = keys.filter(k => k.TABLE_NAME === table && k.CONSTRAINT_NAME === name);
    if (!parts.length) { problems.push(table + ': falta clave foránea ' + name); continue; }
    const same = parts.map(k => k.COLUMN_NAME).join(',') === cols.join(',') && parts.every(k => k.REFERENCED_TABLE_NAME === referenced) && parts.map(k => k.REFERENCED_COLUMN_NAME).join(',') === refCols.join(',');
    if (!same) problems.push(table + ': clave foránea ' + name + ' distinta');
    if (!parts.every(k => ['RESTRICT','NO ACTION'].includes(k.DELETE_RULE) && ['RESTRICT','NO ACTION'].includes(k.UPDATE_RULE))) problems.push(table + ': clave foránea ' + name + ' no es restrictiva');
  }
  const [checks] = await db.query("SELECT TABLE_NAME, CONSTRAINT_NAME, ENFORCED FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND CONSTRAINT_TYPE = 'CHECK'");
  for (const [table, names] of Object.entries(ACADEMIC_CHECKS)) for (const name of names) {
    const row = checks.find(c => c.TABLE_NAME === table && c.CONSTRAINT_NAME === name);
    if (!row) problems.push(table + ': falta restricción ' + name);
    else if (row.ENFORCED !== 'YES') problems.push(table + ': restricción ' + name + ' no se aplica');
  }
  const [engines] = await db.query("SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)", [Object.keys(ACADEMIC)]);
  for (const row of engines) if (row.ENGINE !== 'InnoDB') problems.push(row.TABLE_NAME + ': motor distinto de InnoDB');
  return problems;
}
function normalizeType(type) { return type.toLowerCase().replace(/\binteger\b/g, 'int').replace(/int\(\d+\)/g, 'int').replace(/\s/g, ''); }
async function check(db) {
  const [columns] = await db.query('SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()');
  const [indexes] = await db.query('SELECT TABLE_NAME, INDEX_NAME, COLUMN_NAME, NON_UNIQUE, SEQ_IN_INDEX FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()');
  const problems = [];
  for (const expected of expectedColumns()) {
    const actual = columns.find(c => c.TABLE_NAME === expected.table && c.COLUMN_NAME === expected.name);
    const key = expected.table + '.' + expected.name;
    if (!actual) { problems.push(key + ': falta'); continue; }
    if (normalizeType(actual.COLUMN_TYPE) !== normalizeType(expected.type)) problems.push(key + ': tipo distinto (' + actual.COLUMN_TYPE + ' / ' + expected.type + ')');
    if ((actual.IS_NULLABLE === 'YES') !== expected.nullable) problems.push(key + ': nulabilidad distinta');
    if (expected.unique && !indexes.some(i => i.TABLE_NAME === expected.table && i.COLUMN_NAME === expected.name && Number(i.NON_UNIQUE) === 0 &&
      indexes.filter(j => j.TABLE_NAME === i.TABLE_NAME && j.INDEX_NAME === i.INDEX_NAME).length === 1)) problems.push(key + ': falta indice unico');
  }
  const [constraints] = await db.query("SELECT CONSTRAINT_NAME, TABLE_NAME, REFERENCED_TABLE_NAME, DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE()");
  if (!constraints.some(row=>row.TABLE_NAME==='cotizaciones'&&row.REFERENCED_TABLE_NAME==='contactos'&&['RESTRICT','NO ACTION'].includes(row.DELETE_RULE))) problems.push('cotizaciones.contacto_id: falta protección de referencia');
  for(const referenced of ['contactos','reclamaciones']) if(!constraints.some(row=>row.TABLE_NAME==='attention_records'&&row.REFERENCED_TABLE_NAME===referenced&&['RESTRICT','NO ACTION'].includes(row.DELETE_RULE))) problems.push('attention_records: falta protección de referencia a '+referenced);
  if (!indexes.some(row=>row.TABLE_NAME==='attention_records'&&row.INDEX_NAME==='attention_record_resource'&&Number(row.NON_UNIQUE)===0)) problems.push('attention_records: falta índice único de recurso');
  if (!constraints.some(row=>row.TABLE_NAME==='convenio_fotos'&&row.REFERENCED_TABLE_NAME==='convenios'&&row.DELETE_RULE==='CASCADE')) problems.push('convenio_fotos: falta referencia con borrado en cascada');
  for (const [table,index] of [['admin_auditoria','admin_auditoria_cuenta_idx'],['admin_auditoria','admin_auditoria_actor_idx'],['convenios','convenios_visible_orden_idx'],['convenios','convenios_orden_idx'],['convenio_fotos','convenio_fotos_convenio_orden_idx']]) if(!indexes.some(row=>row.TABLE_NAME===table&&row.INDEX_NAME===index)) problems.push(table+': falta índice '+index);
  problems.push(...await checkAcademic(db, indexes));
  return problems;
}
if (require.main === module) (async () => {
  const db = await connect();
  try {
    const problems = await check(db);
    if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }
    else console.log('Esquema compatible: tablas, columnas, tipos, nulabilidad e indices unicos. No se modificaron datos.');
  } finally { await db.end(); }
})().catch(() => { console.error('No se pudo verificar el esquema. Revisa conexion y permisos.'); process.exitCode = 1; });
module.exports = { check };
