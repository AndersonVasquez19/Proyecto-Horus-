const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { connect } = require('./database.cjs');
const { canonical, definitionsFromMigration } = require('./sql-expression.cjs');
function expectedColumns(legacySesiones = false) {
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
  return [...auditoria, ...academicColumns(legacySesiones), ...chatbot, ...idempotencia, ...convenios, ...legacy.map(column=>column.table==='cursos'&&['modalidad','duracion'].includes(column.name)?{...column,nullable:true}:column.table==='servicios'&&column.name==='categoria'?{...column,type:"ENUM('cableado','camaras','soporte','asesoramiento')"}:column),...added,...visual];
}
// E4.2 (20261015-academico-estructura). CREATE TABLE IF NOT EXISTS no corrige una tabla que ya existiera con otra forma:
// por eso se comprueba la estructura real (columnas, índices, claves foráneas, CHECK y la columna generada), no solo su presencia.
// E4.3b (20261016-academico-solo-dni): el documento académico es solo DNI peruano; un esquema que aún admita CE o PASAPORTE se rechaza.
const DOC = "ENUM('DNI')", CONFIRMADOR = "ENUM('GERENTE_GENERAL','COORDINADORA_INSTITUCIONAL')";
// Migraciones que definen el esquema académico, en su orden de aplicación (el de `versions` en migrate.cjs).
const ACADEMIC_MIGRATIONS = ['20261015-academico-estructura', '20261016-academico-solo-dni', '20261018-convocatorias-capacidad', '20261019-importaciones-academicas', '20261020-docentes', '20261020-preinscripciones', '20261023-convocatoria-horarios'];
// Migración RETIRADA (ver `retired` en migrate.cjs): ya no se aplica, pero una base que la tenga registrada en horus_migrations conserva su
// tabla `sesiones` y los dos valores que añadió a los ENUM del historial. En ese caso se verifica esa estructura histórica completa (sin
// tolerar diferencias); si NO está registrada, cualquier resto de ella (la tabla o los valores del ENUM) es una inconsistencia y se informa.
const RETIRED_SESIONES = '20261020-sesiones-academicas';
// Esquema efectivo tras aplicar en orden las migraciones académicas: cada CHECK o columna generada redefinida en una migración
// posterior sustituye a la anterior, y un DROP CHECK sin redefinición en esa misma migración la elimina de lo esperado.
// `legacy` = la base tiene registrada la migración retirada de sesiones: se incluye en su posición histórica (justo después de docentes).
function academicDefinitions(legacy = false) {
  const effective = { checks: {}, generated: {} };
  const sequence = legacy ? ACADEMIC_MIGRATIONS.flatMap(name => name === '20261020-docentes' ? [name, RETIRED_SESIONES] : [name]) : ACADEMIC_MIGRATIONS;
  for (const name of sequence) {
    const sql = readFileSync(join(__dirname, '../migrations', name + '.sql'), 'utf8');
    const defined = definitionsFromMigration(sql);
    for (const [, dropped] of sql.matchAll(/DROP CHECK `(\w+)`/g)) if (!(dropped in defined.checks)) delete effective.checks[dropped];
    Object.assign(effective.checks, defined.checks);
    Object.assign(effective.generated, defined.generated);
  }
  return effective;
}
const ACADEMIC = {
  importaciones_academicas: [['id','char(36)',false],['archivo_sha256','char(64)',false],['convocatoria_id','int',false],['actor_id','int',false],['estado',"ENUM('confirmada')",false],['importados','int',false],['omitidos','int',false],['rechazados','int',false],['estudiantes_nuevos','int',false],['createdAt','datetime(3)',false]],
  estudiantes: [['id','int',false],['nombres','varchar(120)',false],['apellidos','varchar(120)',false],['doc_pais','char(2)',true],['doc_tipo',DOC,true],
    ['doc_numero','varchar(20)',true],['email','varchar(254)',true],['telefono','varchar(30)',true],['archivado_at','datetime(3)',true],['revision','int',false],['createdAt','datetime(3)',false],['updatedAt','datetime(3)',false]],
  convocatorias: [['capacidad','int',true],['minimo_apertura','int',true],['preinscripcion_estado',"ENUM('abierta','cerrada')",false],['codigo_publico','char(32)',true],['id','int',false],['curso_id','int',false],['nombre','varchar(160)',false],['fecha_inicio','date',true],['fecha_fin','date',true],
    ['estado',"ENUM('planificada','abierta','cerrada','cancelada')",false],['archivado_at','datetime(3)',true],['revision','int',false],['createdAt','datetime(3)',false],['updatedAt','datetime(3)',false]],
  matriculas: [['id','int',false],['estudiante_id','int',false],['convocatoria_id','int',false],['estado',"ENUM('activa','anulada')",false],
    ['cumplimiento',"ENUM('pendiente','cumplido','no_cumplido')",false],['confirmado_por','int',true],['confirmado_rol',CONFIRMADOR,true],['confirmado_at','datetime(3)',true],
    ['revision','int',false],['createdAt','datetime(3)',false],['updatedAt','datetime(3)',false]],
  certificados: [['id','int',false],['matricula_id','int',false],['codigo_verificacion','varchar(32)',false],['estado',"ENUM('vigente','anulado')",false],['vigente_matricula_id','int',true],
    ['estudiante_nombres','varchar(120)',false],['estudiante_apellidos','varchar(120)',false],['estudiante_doc_pais','char(2)',false],['estudiante_doc_tipo',DOC,false],
    ['estudiante_doc_numero','varchar(20)',false],['curso_titulo','varchar(160)',false],['curso_tipo',"ENUM('curso','capacitacion')",false],['curso_duracion','varchar(120)',true],
    ['convocatoria_nombre','varchar(160)',false],['convocatoria_fecha_inicio','date',true],['convocatoria_fecha_fin','date',true],['emitido_por','int',false],['emitido_at','datetime(3)',false],
    ['anulado_por','int',true],['anulado_at','datetime(3)',true],['anulacion_motivo','varchar(300)',true],['sustituye_a_id','int',true]],
  docentes: [['id','int',false],['nombres','varchar(120)',false],['apellidos','varchar(120)',false],['doc_pais','char(2)',true],['doc_tipo',DOC,true],['doc_numero','varchar(20)',true],
    ['especialidad','varchar(120)',true],['profesion','varchar(120)',true],['email','varchar(254)',true],['telefono','varchar(30)',true],['activo','tinyint',false],['revision','int',false],
    ['createdAt','datetime(3)',false],['updatedAt','datetime(3)',false]],
  docente_asignaciones: [['id','int',false],['docente_id','int',false],['convocatoria_id','int',false],['rol',"ENUM('principal','participante')",false],['estado',"ENUM('activa','retirada')",false],
    ['principal_activo_convocatoria_id','int',true],['sustituye_a_id','int',true],['retirado_at','datetime(3)',true],['retiro_motivo','varchar(300)',true],['revision','int',false],
    ['createdAt','datetime(3)',false],['updatedAt','datetime(3)',false]],
  convocatoria_horarios: [['id','int',false],['convocatoria_id','int',false],['dia_semana','tinyint',false],['hora_inicio','time',false],['hora_fin','time',false],['createdAt','datetime(3)',false]],
  preinscripciones: [['id','int',false],['convocatoria_id','int',false],['nombres','varchar(120)',false],['apellidos','varchar(120)',false],['email','varchar(254)',false],['telefono','varchar(30)',false],
    ['canal',"ENUM('formulario','chatbot')",false],['estado',"ENUM('recibida','validada','matriculada','desistida','descartada')",false],['vigente_email','varchar(254)',true],
    ['consentimiento_at','datetime(3)',false],['aviso_version','varchar(30)',false],['estudiante_id','int',true],['matricula_id','int',true],['convertida_por','int',true],['convertida_at','datetime(3)',true],
    ['revision','int',false],['createdAt','datetime(3)',false],['updatedAt','datetime(3)',false]],
  preinscripciones_historial: [['id','int',false],['preinscripcion_id','int',false],['createdAt','datetime(3)',false],['operacion',"ENUM('creacion','correccion','validacion','descarte','desistimiento','conversion')",false],
    ['canal',"ENUM('formulario','chatbot')",true],['actor_id','int',true],['actor_rol',"ENUM('GERENTE_GENERAL','COORDINADORA_INSTITUCIONAL','SECRETARIA')",true],
    ['estado_anterior',"ENUM('recibida','validada','matriculada','desistida','descartada')",true],['estado_nuevo',"ENUM('recibida','validada','matriculada','desistida','descartada')",true],
    ['campos','json',true],['revision','int',false],['motivo','varchar(300)',true]],
  academico_historial: [['id','int',false],['createdAt','datetime(3)',false],['entidad',"ENUM('estudiante','convocatoria','matricula','certificado','docente','asignacion_docente')",false],['entidad_id','int',false],
    ['operacion',"ENUM('creacion','edicion','archivado','restauracion','cambio_estado','anulacion','confirmacion','emision','sustitucion')",false],['origen',"ENUM('panel','terminal')",false],
    ['actor_id','int',true],['actor_rol',"ENUM('GERENTE_GENERAL','COORDINADORA_INSTITUCIONAL','SECRETARIA')",true],['operador','varchar(100)',true],['estado_anterior','varchar(30)',true],
    ['estado_nuevo','varchar(30)',true],['campos','json',true],['revision','int',true],['motivo','varchar(300)',true]],
};
// [tabla, índice, columnas en orden, único, longitudes de prefijo opcionales (una por columna; omitido = ninguna columna con prefijo)]
const ACADEMIC_INDEXES = [
  ['importaciones_academicas','importaciones_archivo_destino_uq',['archivo_sha256','convocatoria_id'],true],
  ['estudiantes','estudiantes_documento_uq',['doc_pais','doc_tipo','doc_numero'],true], ['estudiantes','estudiantes_nombre_idx',['apellidos','nombres'],false],
  ['convocatorias','convocatorias_curso_idx',['curso_id','fecha_inicio'],false], ['convocatorias','convocatorias_estado_idx',['estado','fecha_inicio'],false],
  ['matriculas','matriculas_estudiante_convocatoria_uq',['estudiante_id','convocatoria_id'],true], ['matriculas','matriculas_convocatoria_idx',['convocatoria_id','estado'],false],
  ['matriculas','matriculas_confirmado_por_idx',['confirmado_por'],false],
  ['certificados','certificados_codigo_uq',['codigo_verificacion'],true], ['certificados','certificados_vigente_uq',['vigente_matricula_id'],true],
  ['certificados','certificados_id_matricula_uq',['id','matricula_id'],true], ['certificados','certificados_sustituye_uq',['sustituye_a_id','matricula_id'],true],
  ['certificados','certificados_matricula_idx',['matricula_id','emitido_at'],false], ['certificados','certificados_emitido_por_idx',['emitido_por'],false],
  ['certificados','certificados_anulado_por_idx',['anulado_por'],false],
  ['docentes','docentes_documento_uq',['doc_pais','doc_tipo','doc_numero'],true], ['docentes','docentes_email_uq',['email'],true], ['docentes','docentes_nombre_idx',['apellidos','nombres'],false],
  ['docente_asignaciones','docente_asignaciones_docente_edicion_uq',['docente_id','convocatoria_id'],true], ['docente_asignaciones','docente_asignaciones_principal_uq',['principal_activo_convocatoria_id'],true],
  ['docente_asignaciones','docente_asignaciones_id_edicion_uq',['id','convocatoria_id'],true], ['docente_asignaciones','docente_asignaciones_edicion_idx',['convocatoria_id','estado'],false],
  ['docente_asignaciones','docente_asignaciones_sustituye_idx',['sustituye_a_id','convocatoria_id'],false],
  ['convocatoria_horarios','convocatoria_horarios_inicio_uq',['convocatoria_id','dia_semana','hora_inicio'],true],
  ['convocatorias','convocatorias_codigo_publico_uq',['codigo_publico'],true], ['matriculas','matriculas_id_relaciones_uq',['id','estudiante_id','convocatoria_id'],true],
  ['preinscripciones','preinscripciones_vigente_email_uq',['convocatoria_id','vigente_email'],true], ['preinscripciones','preinscripciones_matricula_uq',['matricula_id'],true],
  ['preinscripciones','preinscripciones_edicion_idx',['convocatoria_id','estado','createdAt'],false], ['preinscripciones','preinscripciones_email_idx',['email'],false],
  ['preinscripciones','preinscripciones_estado_idx',['estado','createdAt'],false], ['preinscripciones','preinscripciones_matricula_rel_idx',['matricula_id','estudiante_id','convocatoria_id'],false],
  ['preinscripciones','preinscripciones_estudiante_idx',['estudiante_id'],false], ['preinscripciones','preinscripciones_convertida_por_idx',['convertida_por'],false],
  ['preinscripciones_historial','preinscripciones_historial_item_idx',['preinscripcion_id','createdAt'],false], ['preinscripciones_historial','preinscripciones_historial_actor_idx',['actor_id','createdAt'],false],
  ['academico_historial','academico_historial_entidad_idx',['entidad','entidad_id','createdAt'],false], ['academico_historial','academico_historial_actor_idx',['actor_id','createdAt'],false],
];
// [tabla, clave foránea, columnas, tabla referenciada, columnas referenciadas]; todas RESTRICT al borrar y al actualizar.
const ACADEMIC_FOREIGN_KEYS = [
  ['importaciones_academicas','importaciones_convocatoria_fk',['convocatoria_id'],'convocatorias',['id']],
  ['importaciones_academicas','importaciones_actor_fk',['actor_id'],'admin_users',['id']],
  ['convocatorias','convocatorias_curso_fk',['curso_id'],'cursos',['id']],
  ['matriculas','matriculas_estudiante_fk',['estudiante_id'],'estudiantes',['id']], ['matriculas','matriculas_convocatoria_fk',['convocatoria_id'],'convocatorias',['id']],
  ['matriculas','matriculas_confirmado_por_fk',['confirmado_por'],'admin_users',['id']],
  ['certificados','certificados_matricula_fk',['matricula_id'],'matriculas',['id']], ['certificados','certificados_emitido_por_fk',['emitido_por'],'admin_users',['id']],
  ['certificados','certificados_anulado_por_fk',['anulado_por'],'admin_users',['id']],
  ['certificados','certificados_sustituye_fk',['sustituye_a_id','matricula_id'],'certificados',['id','matricula_id']],
  ['docente_asignaciones','docente_asignaciones_docente_fk',['docente_id'],'docentes',['id']],
  ['docente_asignaciones','docente_asignaciones_convocatoria_fk',['convocatoria_id'],'convocatorias',['id']],
  ['docente_asignaciones','docente_asignaciones_sustituye_fk',['sustituye_a_id','convocatoria_id'],'docente_asignaciones',['id','convocatoria_id']],
  ['convocatoria_horarios','convocatoria_horarios_convocatoria_fk',['convocatoria_id'],'convocatorias',['id']],
  ['preinscripciones','preinscripciones_convocatoria_fk',['convocatoria_id'],'convocatorias',['id']],
  ['preinscripciones','preinscripciones_matricula_fk',['matricula_id','estudiante_id','convocatoria_id'],'matriculas',['id','estudiante_id','convocatoria_id']],
  ['preinscripciones','preinscripciones_convertida_por_fk',['convertida_por'],'admin_users',['id']],
  ['preinscripciones_historial','preinscripciones_historial_fk',['preinscripcion_id'],'preinscripciones',['id']],
];
const ACADEMIC_CHECKS = {
  importaciones_academicas: ['importaciones_conteos_ck'],
  estudiantes: ['estudiantes_nombres_chk','estudiantes_documento_completo_chk','estudiantes_documento_formato_chk','estudiantes_revision_chk'],
  convocatorias: ['convocatorias_nombre_chk','convocatorias_fechas_chk','convocatorias_revision_chk','convocatorias_capacidad_chk','convocatorias_minimo_chk','convocatorias_codigo_chk'],
  matriculas: ['matriculas_confirmacion_chk','matriculas_revision_chk'],
  certificados: ['certificados_codigo_chk','certificados_anulacion_chk','certificados_nombres_chk','certificados_documento_chk','certificados_fechas_chk'],
  academico_historial: ['academico_historial_origen_chk','academico_historial_campos_chk'],
  docentes: ['docentes_nombres_chk','docentes_texto_chk','docentes_documento_completo_chk','docentes_documento_formato_chk','docentes_activo_chk','docentes_revision_chk'],
  docente_asignaciones: ['docente_asignaciones_retiro_chk','docente_asignaciones_revision_chk'],
  convocatoria_horarios: ['convocatoria_horarios_dia_chk','convocatoria_horarios_horas_chk'],
  preinscripciones: ['preinscripciones_nombres_chk','preinscripciones_contacto_chk','preinscripciones_conversion_chk','preinscripciones_revision_chk'],
  preinscripciones_historial: ['preinscripciones_historial_origen_chk','preinscripciones_historial_campos_chk','preinscripciones_historial_revision_chk'],
};
// Estructura histórica de la migración retirada 20261020-sesiones-academicas: solo se espera (y se verifica entera) si está registrada.
const LEGACY_SESIONES = {
  columns: [['id','int',false],['convocatoria_id','int',false],['asignacion_id','int',true],['titulo','varchar(160)',false],['fecha','date',false],['hora_inicio','time',false],['hora_fin','time',false],
    ['modalidad',"ENUM('presencial','virtual','hibrida')",false],['lugar','varchar(200)',true],['enlace_url','varchar(2048)',true],['estado',"ENUM('programada','realizada','cancelada')",false],
    ['cancelada_at','datetime(3)',true],['cancelacion_motivo','varchar(300)',true],['observaciones','varchar(500)',true],['revision','int',false],['createdAt','datetime(3)',false],['updatedAt','datetime(3)',false]],
  indexes: [['sesiones','sesiones_id_edicion_uq',['id','convocatoria_id'],true], ['sesiones','sesiones_edicion_idx',['convocatoria_id','fecha','hora_inicio'],false],
    ['sesiones','sesiones_asignacion_idx',['asignacion_id','convocatoria_id','fecha'],false], ['sesiones','sesiones_fecha_idx',['fecha','hora_inicio'],false]],
  foreignKeys: [['sesiones','sesiones_convocatoria_fk',['convocatoria_id'],'convocatorias',['id']],
    ['sesiones','sesiones_asignacion_fk',['asignacion_id','convocatoria_id'],'docente_asignaciones',['id','convocatoria_id']]],
  checks: ['sesiones_titulo_chk','sesiones_texto_chk','sesiones_fecha_chk','sesiones_horas_chk','sesiones_modalidad_chk','sesiones_enlace_chk','sesiones_cancelacion_chk','sesiones_revision_chk'],
  // Valores que la migración retirada AÑADIÓ al final de los ENUM del historial (las filas históricas pueden usarlos).
  entidad: 'sesion', operacion: 'reprogramacion',
};
// Esquema académico esperado: el vigente y, si la base registra la migración retirada de sesiones, también su estructura histórica.
function academicSchema(legacy = false) {
  if (!legacy) return { tables: ACADEMIC, indexes: ACADEMIC_INDEXES, foreignKeys: ACADEMIC_FOREIGN_KEYS, checks: ACADEMIC_CHECKS };
  const widen = (type, value) => type.replace(/\)$/, ",'" + value + "')");
  const historial = ACADEMIC.academico_historial.map(([name, type, nullable]) =>
    [name, name === 'entidad' ? widen(type, LEGACY_SESIONES.entidad) : name === 'operacion' ? widen(type, LEGACY_SESIONES.operacion) : type, nullable]);
  return {
    tables: { ...ACADEMIC, academico_historial: historial, sesiones: LEGACY_SESIONES.columns },
    indexes: [...ACADEMIC_INDEXES, ...LEGACY_SESIONES.indexes],
    foreignKeys: [...ACADEMIC_FOREIGN_KEYS, ...LEGACY_SESIONES.foreignKeys],
    checks: { ...ACADEMIC_CHECKS, sesiones: LEGACY_SESIONES.checks },
  };
}
function academicColumns(legacy = false) {
  return Object.entries(academicSchema(legacy).tables).flatMap(([table, columns]) => columns.map(([name, type, nullable]) => ({ table, name, type, nullable, unique: ['id','codigo_verificacion'].includes(name) })));
}
async function checkAcademic(db, indexes, legacy = false) {
  const problems = [];
  const { tables: ACADEMIC, indexes: ACADEMIC_INDEXES, foreignKeys: ACADEMIC_FOREIGN_KEYS, checks: ACADEMIC_CHECKS } = academicSchema(legacy);
  // Migración retirada SIN registro: cualquier resto suyo es una aplicación parcial o una tabla creada a mano. No se acepta en silencio
  // (tampoco se corrige: nada se borra); hay que revisarlo antes de continuar. Los ENUM ampliados los informa la comprobación de tipos.
  if (!legacy) {
    const [leftovers] = await db.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sesiones'");
    if (leftovers.length) problems.push('sesiones: la tabla existe pero ' + RETIRED_SESIONES + ' (migración retirada) no está registrada en horus_migrations; revisa si fue una aplicación parcial antes de continuar. No se borra nada');
  }
  const [columns] = await db.query("SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, EXTRA, GENERATION_EXPRESSION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)", [Object.keys(ACADEMIC)]);
  for (const [table, expected] of Object.entries(ACADEMIC)) {
    const extra = columns.filter(c => c.TABLE_NAME === table).map(c => c.COLUMN_NAME).filter(name => !expected.some(([e]) => e === name));
    if (extra.length) problems.push(table + ': columnas no previstas (' + extra.join(', ') + ')');
  }
  // Aviso explícito (además del «tipo distinto» general): el tipo de documento solo puede ser DNI.
  for (const [table, column] of [['estudiantes', 'doc_tipo'], ['certificados', 'estudiante_doc_tipo']]) {
    const actual = columns.find(c => c.TABLE_NAME === table && c.COLUMN_NAME === column);
    if (actual && normalizeType(actual.COLUMN_TYPE) !== normalizeType(DOC)) problems.push(table + '.' + column + ': admite tipos de documento distintos de DNI (' + actual.COLUMN_TYPE + '); falta aplicar 20261016-academico-solo-dni');
  }
  // Las expresiones (CHECK y columna generada) se comparan por su forma canónica con las del esquema efectivo de las migraciones: se
  // toleran el formato y los paréntesis que añade MySQL, no un cambio de lógica (TRUE, condición invertida, otro operando).
  const migration = academicDefinitions(legacy);
  const sameExpression = (actual, expected) => { try { return canonical(actual) === canonical(expected); } catch { return false; } };
  for (const key of ['certificados.vigente_matricula_id', 'docente_asignaciones.principal_activo_convocatoria_id', 'preinscripciones.vigente_email']) {
    const [table, column] = key.split('.');
    const generated = columns.find(c => c.TABLE_NAME === table && c.COLUMN_NAME === column);
    if (generated && !(/^STORED GENERATED$/i.test(generated.EXTRA) && sameExpression(generated.GENERATION_EXPRESSION, migration.generated[key]))) problems.push(key + ': no es la columna generada STORED prevista');
  }
  // Clave primaria (id) con AUTO_INCREMENT en cada tabla académica.
  for (const table of Object.keys(ACADEMIC)) {
    const primary = indexes.filter(i => i.TABLE_NAME === table && i.INDEX_NAME === 'PRIMARY').map(i => i.COLUMN_NAME);
    if (primary.join(',') !== 'id') problems.push(table + ': la clave primaria no es (id)');
    const id = columns.find(c => c.TABLE_NAME === table && c.COLUMN_NAME === 'id');
    if (id && table !== 'importaciones_academicas' && !/\bauto_increment\b/i.test(id.EXTRA)) problems.push(table + '.id: falta AUTO_INCREMENT');
  }
  // Índices reales de cada tabla académica: { columnas en orden, único }. Los nombres de índice son locales a su tabla, así que cada
  // índice se compara con lo previsto para ESA tabla: certificados_codigo_uq creado en estudiantes no es el índice de certificados.
  const actual = new Map();
  for (const i of [...indexes].sort((a, b) => Number(a.SEQ_IN_INDEX) - Number(b.SEQ_IN_INDEX))) {
    if (!ACADEMIC[i.TABLE_NAME] || i.INDEX_NAME === 'PRIMARY') continue;
    const key = i.TABLE_NAME + '.' + i.INDEX_NAME;
    const index = actual.get(key) ?? { table: i.TABLE_NAME, name: i.INDEX_NAME, columns: [], unique: [], prefixes: [] };
    index.columns.push(i.COLUMN_NAME); index.unique.push(Number(i.NON_UNIQUE) === 0);
    index.prefixes.push(i.SUB_PART === null || i.SUB_PART === undefined ? null : Number(i.SUB_PART));
    actual.set(key, index);
  }
  const shared = columns => columns.some(c => ['email', 'telefono'].includes(c)) ? ': email y telefono deben poder compartirse' : '';
  // Ningún índice único fuera de los previstos en su tabla (p. ej. UNIQUE(email) impediría que varios estudiantes compartan contacto).
  for (const index of actual.values()) {
    if (!index.unique.some(Boolean) || ACADEMIC_INDEXES.some(([table, name]) => table === index.table && name === index.name)) continue;
    problems.push(index.table + ': índice único no previsto ' + index.name + ' (' + index.columns.join(', ') + ')' + shared(index.columns));
  }
  // Cada índice previsto: en su tabla, con las mismas columnas en el mismo orden y la misma unicidad.
  // Un índice por prefijo (SUB_PART no nulo) no equivale al índice completo: UNIQUE(doc_numero(1)) trataría como duplicados dos DNI distintos.
  const prefixText = prefixes => prefixes.map(p => p ?? 'completa').join(', ');
  for (const [table, name, expected, unique, expectedPrefixes = expected.map(() => null)] of ACADEMIC_INDEXES) {
    const index = actual.get(table + '.' + name);
    if (!index) problems.push(table + ': falta índice ' + name);
    else if (index.columns.join(',') === expected.join(',') && index.prefixes.join(',') !== expectedPrefixes.join(',')) problems.push(table + ': índice ' + name + ' con longitud de prefijo distinta (columnas ' + index.columns.join(', ') + '; longitud ' + prefixText(index.prefixes) + '; se esperaba ' + prefixText(expectedPrefixes) + ')' + (index.unique.some(Boolean) && index.columns.some(c => ['email', 'telefono'].includes(c)) ? shared(index.columns) : ''));
    else if (index.columns.join(',') !== expected.join(',') || index.unique.some(u => u !== unique)) problems.push(table + ': índice ' + name + ' distinto (' + (index.unique.every(Boolean) ? 'único' : 'no único') + ' sobre ' + index.columns.join(', ') + '; se esperaba ' + (unique ? 'único' : 'no único') + ' sobre ' + expected.join(', ') + ')' + (index.unique.some(Boolean) ? shared(index.columns) : ''));
  }
  const [keys] = await db.query("SELECT k.TABLE_NAME, k.CONSTRAINT_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME, r.DELETE_RULE, r.UPDATE_RULE FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME WHERE k.TABLE_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY k.ORDINAL_POSITION");
  for (const [table, name, cols, referenced, refCols] of ACADEMIC_FOREIGN_KEYS) {
    const parts = keys.filter(k => k.TABLE_NAME === table && k.CONSTRAINT_NAME === name);
    if (!parts.length) { problems.push(table + ': falta clave foránea ' + name); continue; }
    const same = parts.map(k => k.COLUMN_NAME).join(',') === cols.join(',') && parts.every(k => k.REFERENCED_TABLE_NAME === referenced) && parts.map(k => k.REFERENCED_COLUMN_NAME).join(',') === refCols.join(',');
    if (!same) problems.push(table + ': clave foránea ' + name + ' distinta');
    if (!parts.every(k => ['RESTRICT','NO ACTION'].includes(k.DELETE_RULE) && ['RESTRICT','NO ACTION'].includes(k.UPDATE_RULE))) problems.push(table + ': clave foránea ' + name + ' no es restrictiva');
  }
  const [checks] = await db.query("SELECT t.TABLE_NAME, t.CONSTRAINT_NAME, t.ENFORCED, c.CHECK_CLAUSE FROM information_schema.TABLE_CONSTRAINTS t JOIN information_schema.CHECK_CONSTRAINTS c ON c.CONSTRAINT_SCHEMA = t.CONSTRAINT_SCHEMA AND c.CONSTRAINT_NAME = t.CONSTRAINT_NAME WHERE t.TABLE_SCHEMA = DATABASE() AND t.CONSTRAINT_TYPE = 'CHECK'");
  for (const [table, names] of Object.entries(ACADEMIC_CHECKS)) {
    for (const name of names) {
      const row = checks.find(c => c.TABLE_NAME === table && c.CONSTRAINT_NAME === name);
      if (!row) problems.push(table + ': falta restricción ' + name);
      else if (row.ENFORCED !== 'YES') problems.push(table + ': restricción ' + name + ' no se aplica');
      else if (!sameExpression(row.CHECK_CLAUSE, migration.checks[name])) problems.push(table + ': restricción ' + name + ' con otra expresión');
    }
    for (const row of checks) if (row.TABLE_NAME === table && !names.includes(row.CONSTRAINT_NAME)) problems.push(table + ': restricción no prevista ' + row.CONSTRAINT_NAME);
  }
  const [engines] = await db.query("SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)", [Object.keys(ACADEMIC)]);
  for (const row of engines) if (row.ENGINE !== 'InnoDB') problems.push(row.TABLE_NAME + ': motor distinto de InnoDB');
  return problems;
}
// ¿La base registra una migración retirada? Solo lee horus_migrations (si aún no existe, nada está registrado).
async function retiredApplied(db, name) {
  const [table] = await db.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'horus_migrations'");
  if (!table.length) return false;
  const [rows] = await db.query('SELECT name FROM horus_migrations WHERE name = ?', [name]);
  return rows.length > 0;
}
function normalizeType(type) { return type.toLowerCase().replace(/\binteger\b/g, 'int').replace(/int\(\d+\)/g, 'int').replace(/\s/g, ''); }
async function check(db) {
  const [columns] = await db.query('SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()');
  const [indexes] = await db.query('SELECT TABLE_NAME, INDEX_NAME, COLUMN_NAME, NON_UNIQUE, SEQ_IN_INDEX, SUB_PART FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()');
  const legacySesiones = await retiredApplied(db, RETIRED_SESIONES);
  const problems = [];
  for (const expected of expectedColumns(legacySesiones)) {
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
  problems.push(...await checkAcademic(db, indexes, legacySesiones));
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
module.exports = { check, academicDefinitions, academicSchema, ACADEMIC_MIGRATIONS, RETIRED_SESIONES };
