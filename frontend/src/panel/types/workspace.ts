export type Row = { id: number; [key: string]: string | number | boolean | null };
export type Field = { key: string; label: string; type?: 'textarea' | 'select' | 'number' | 'email' | 'url' | 'date'; required?: boolean; courseOnly?: boolean; hint?: string; virtual?: boolean; min?: number; max?: number; options?: string[] };
export type Resource = { label: string; singular: string; endpoint: string; icon: string; description: string; catalog?: boolean; hardDelete?: boolean; title: string; fields: Field[]; states: string[] };
type CatalogCount = { total: number; publicados: number; borradores: number; archivados: number };
export type DashboardStats = {
  stats: {
    mensajes: { total: number; nuevos: number; enProceso: number; atendidos: number; archivados: number };
    contenido: { total: number };
    catalogo: Record<string, CatalogCount & { por_tipo?: Record<string, CatalogCount> }>;
  };
  actividadReciente: { mensajes: { id: number; nombre: string; asunto: string; estado: string; createdAt: string }[] };
};
export type ActivityStats = {
  dias: number; desde: string; hasta: string;
  mensajes: { fecha: string; total: number; chatbot: number }[];
  cotizaciones: { total: number; porEstado: Record<string, number> };
};
const title: Field ={ key: 'titulo', label: 'Título', required: true, max: 160 };
const slug: Field = { key: 'slug', label: 'Identificador URL (slug)', required: true, max: 180 };
const description: Field = { key: 'descripcion', label: 'Descripción', type: 'textarea', required: true, max: 20000 };
const states = ['borrador', 'publicado', 'archivado'];
const visualFields:Field[]=[{key:'color',label:'Color de la tarjeta',type:'select',options:['indigo','coral','verde','violeta','oscuro'],required:true},{key:'icono',label:'Icono',type:'select',options:['','heart','legal','finance','technology','education','business','network','camera','bell','cloud','mobile','tools','software','emergency','star','users','target','handshake']},{key:'orden',label:'Orden en la web',type:'number',min:0,max:1000000}];
const state: Field = { key: 'estado', label: 'Estado', type: 'select', options: states, required: true };
export const resources: Record<string, Resource> = {
  cursos: { label: 'Cursos y capacitaciones', singular: 'curso', endpoint: 'cursos', icon: 'book', catalog: true, title: 'titulo',
    description: 'Organiza tu oferta educativa, sus temarios y fechas de inicio.', states,
    fields: [title, slug, description, { key: 'tipo', label: 'Tipo', type: 'select', options: ['curso', 'capacitacion'], required: true },
      { key: 'modalidad', label: 'Modalidad', type: 'select', options: ['', 'presencial', 'virtual', 'hibrida'], required: true, courseOnly:true },
      { key: 'duracion', label: 'Duración', required: true, courseOnly:true, max: 120 },
      {key:'area',label:'Área de capacitación',max:80},{key:'certificacion',label:'Certificación publicada',max:150},...visualFields,
      { key: 'temario', label: 'Temario', type: 'textarea', max: 20000 },
      { key: 'fecha_inicio', label: 'Fecha de inicio', type: 'date' },
      { key: 'imagen_url', label: 'URL de imagen', type: 'url', max: 2048 }, state] },
  servicios: { label: 'Servicios tecnológicos', singular: 'servicio', endpoint: 'servicios', icon: 'tools', catalog: true, hardDelete: true, title: 'titulo',
    description: 'Administra las soluciones tecnológicas que ofrece Horus.', states,
    fields: [title, slug, description, { key: 'categoria', label: 'Categoría', type: 'select', options: ['cableado', 'camaras', 'soporte', 'asesoramiento'], required: true },
      {key:'presentacion',label:'Diseño de tarjeta',type:'select',options:['normal','cableado','camara','alertas','nube','app','mantenimiento','software','redes','emergencia','asesoria','beneficio'],required:true},
      {key:'contenido_tipo',label:'Tipo',type:'select',options:['linea','beneficio'],required:true,virtual:true},
      {key:'nombre_corto',label:'Nombre de pestaña',max:80},{key:'destacado',label:'Texto destacado sobre la imagen',max:100},{key:'dato_principal',label:'Dato principal (por ejemplo, velocidad)',max:40},{key:'dato_secundario',label:'Unidad o explicación del dato',max:100},{key:'etiquetas',label:'Características (una por línea)',type:'textarea',max:2000},...visualFields,
      { key: 'alcance', label: 'Alcance del servicio', type: 'textarea', max: 20000 },
      { key: 'imagen_url', label: 'URL de imagen', type: 'url', max: 2048 }, state] },
  faq: { label: 'Preguntas frecuentes', singular: 'pregunta', endpoint: 'preguntas-frecuentes', icon: 'help', catalog: true, title: 'pregunta',
    description: 'Mantén respuestas claras y actualizadas para tus visitantes.', states,
    fields: [{ key: 'pregunta', label: 'Pregunta', required: true, max: 300 },
      { key: 'respuesta', label: 'Respuesta', type: 'textarea', required: true, max: 12000 },
      { key: 'categoria', label: 'Categoría', required: true, max: 100 },
      { key: 'orden', label: 'Orden', type: 'number', min: 0, max: 1000000 }, state] },
  contenido: { label: 'Biblioteca de contenido', singular: 'contenido', endpoint: 'items', icon: 'file', title: 'titulo',
    description: 'Conserva y organiza los elementos de tu biblioteca administrativa.', states: ['activo', 'inactivo'],
    fields: [{ ...title, max: 150 }, { ...description, max: 5000 },
      { key: 'categoria', label: 'Categoría', type: 'select', options: ['general', 'servicio', 'contenido'], required: true },
      { ...state, options: ['activo', 'inactivo'] }] },
  galeria: { label: 'Galería de proyectos', singular: 'imagen', endpoint: 'galeria', icon: 'image', title: 'titulo',
    description: 'Organiza las imágenes de tus proyectos y actividades.', states: ['activo', 'inactivo'],
    fields: [{ ...title, max: 150 }, { ...description, required: false },
      { key: 'categoria', label: 'Categoría', required: true, max: 50 },
      { key: 'imagen_url', label: 'URL o ruta de imagen', required: true, max: 500 },
      { key: 'orden', label: 'Orden', type: 'number', min: 0 },
      { key: 'activo', label: 'Visibilidad', type: 'select', options: ['activo', 'inactivo'], required: true }] },
};
export const labels: Record<string, string> = { '':'Por confirmar',indigo:'Índigo',coral:'Coral',verde:'Verde',violeta:'Violeta',oscuro:'Oscuro',normal:'Tarjeta general',camara:'Cámara con monitor',alertas:'Notificaciones',nube:'Almacenamiento en la nube',app:'Aplicación móvil',mantenimiento:'Ciclo de mantenimiento',software:'Terminal de software',redes:'Diagrama de redes',emergencia:'Atención urgente',asesoria:'Asesoramiento',beneficio:'Beneficio (Por qué elegirnos)',linea:'Línea de asesoramiento',heart:'Salud',legal:'Derecho',finance:'Finanzas',technology:'Tecnología',education:'Educación',business:'Empresa',network:'Red',camera:'Cámara',bell:'Campana',cloud:'Nube',mobile:'Móvil',tools:'Herramientas',emergency:'Urgencia',star:'Estrella',users:'Especialistas',target:'Soluciones',handshake:'Acompañamiento', en_proceso: 'En proceso', capacitacion: 'Capacitación', hibrida: 'Híbrida', camaras: 'Cámaras', publicado: 'Publicado', borrador: 'Borrador', archivado: 'Archivado', activo: 'Activo', inactivo: 'Inactivo', nuevo: 'Nuevo', atendido: 'Atendido', enviada: 'Enviada', aceptada: 'Aceptada', rechazada: 'Rechazada', anulada: 'Anulada' };
// A panel section shows one slice of a resource. Its filters are the backend query, the form defaults and the allowed options.
// `choices` fixes the values a select may offer (creating and editing); without it only the filters restrict new records.
export type PanelScope = { key: string; label: string; singular: string; kicker: string; description: string; resource: string; filters: Record<string, string>; choices?: Record<string, string[]> };
// The public technology pages: cableado, cámaras and soporte. Asesoramiento belongs to Education.
const technologyCategories = ['cableado', 'camaras', 'soporte'];
const serviceScope = (key: string, label: string, categoria: string): PanelScope => ({ key, label, singular: 'servicio', kicker: 'SERVICIOS TECNOLÓGICOS', description: 'Gestiona los servicios de esta sección del sitio.', resource: 'servicios', filters: { categoria }, choices: { categoria: technologyCategories } });
// Whole "Servicios tecnológicos" section: only the three technology categories.
export const servicesOverview: PanelScope = { key: 'todos', label: 'Servicios tecnológicos', singular: 'servicio', kicker: 'ESPACIO DE TRABAJO', description: 'Administra las soluciones tecnológicas que ofrece Horus.', resource: 'servicios', filters: { categoria: technologyCategories.join(',') }, choices: { categoria: technologyCategories } };
export const serviceSections: PanelScope[] = [
  serviceScope('cableado', 'Cableado estructurado', 'cableado'),
  serviceScope('camaras', 'Cámaras de seguridad', 'camaras'),
  serviceScope('soporte', 'Soporte y mantenimiento', 'soporte'),
];
export const educationSections: PanelScope[] = [
  { key: 'asesoramiento', label: 'Asesoramiento', singular: 'servicio', kicker: 'EDUCACIÓN', description: 'Gestiona los tipos de asesoramiento y los beneficios que se muestran en la página de Asesoramiento.', resource: 'servicios', filters: { categoria: 'asesoramiento' }, choices: { categoria: ['asesoramiento'] } },
  { key: 'capacitaciones', label: 'Capacitaciones', singular: 'capacitación', kicker: 'EDUCACIÓN', description: 'Gestiona las capacitaciones que se publican en la página de Capacitaciones.', resource: 'cursos', filters: { tipo: 'capacitacion' }, choices: { tipo: ['capacitacion'] } },
  { key: 'cursos', label: 'Cursos', singular: 'curso', kicker: 'EDUCACIÓN', description: 'Gestiona los cursos que se publican en la página de Cursos.', resource: 'cursos', filters: { tipo: 'curso' }, choices: { tipo: ['curso'] } },
];
// ---------- Fields shown per kind of content ----------
// The panel manages content; the website decides the design. Each section therefore shows only the fields its public page renders.
// Hidden fields keep whatever is stored: they are never part of the form, so saving cannot overwrite them.
// Groups and rows only organise the form on screen; they never decide what is saved.
export type FieldGroup = { key: string; title: string; rows: Field[][] };
type FieldSet = { main: Field[]; advanced: Field[]; groups?: FieldGroup[] };
type Layout = { key: string; title: string; rows: string[][] }[];
const publish = { key: 'publish', title: 'Publicación', rows: [['orden', 'estado']] };
const serviceInfo = (...first: string[][]) => ({ key: 'info', title: 'Información principal', rows: [...first, ['titulo'], ['descripcion'], ['imagen_url']] });
const technologyLayout = (content: string[][]): Layout => [serviceInfo(['categoria']), { key: 'content', title: 'Contenido', rows: content }, publish];
const serviceLayouts: Record<string, Layout> = {
  cableado: technologyLayout([['nombre_corto', 'icono'], ['destacado'], ['dato_principal', 'dato_secundario'], ['etiquetas'], ['alcance']]),
  camaras: technologyLayout([['icono', 'destacado'], ['etiquetas'], ['alcance']]),
  soporte: technologyLayout([['icono', 'destacado'], ['etiquetas'], ['alcance']]),
  linea: [{ key: 'info', title: 'Información principal', rows: [['contenido_tipo'], ['titulo'], ['descripcion'], ['imagen_url']] }, { key: 'content', title: 'Contenido', rows: [['icono'], ['alcance']] }, publish],
  beneficio: [{ key: 'info', title: 'Información principal', rows: [['contenido_tipo'], ['titulo'], ['descripcion']] }, { key: 'content', title: 'Contenido', rows: [['icono']] }, publish],
};
const courseLayout: Layout = [
  { key: 'info', title: 'Información', rows: [['titulo'], ['tipo'], ['descripcion'], ['imagen_url']] },
  { key: 'program', title: 'Datos del programa', rows: [['modalidad', 'duracion'], ['fecha_inicio', 'area'], ['certificacion']] },
  { key: 'content', title: 'Contenido', rows: [['temario']] },
  publish,
];
const badgeExample: Record<string, string> = { cableado: 'Ejemplo: MÁXIMA VELOCIDAD', camaras: 'Ejemplo: EN VIVO, DESTACADO o NUEVO', soporte: 'Ejemplo: DESTACADO' };
const serviceOverrides = (category: string): Record<string, Partial<Field>> => ({
  imagen_url: { label: 'Imagen' },
  orden: { hint: 'El número menor aparece primero.' },
  estado: { hint: 'Solo «Publicado» se ve en la web.' },
  nombre_corto: { hint: 'Texto corto de la pestaña. Si lo dejas vacío se usa el título.' },
  icono: { hint: 'Opcional. Acompaña al título en la web.' },
  destacado: { label: 'Insignia de la imagen', hint: 'Opcional. Texto corto sobre la imagen. ' + (badgeExample[category] ?? 'Ejemplo: DESTACADO') + '.' },
  dato_principal: { label: 'Dato principal', hint: 'Cifra que se muestra en grande. Ejemplo: 40' },
  dato_secundario: { hint: 'Texto junto a la cifra. Ejemplo: Gbps y más' },
  etiquetas: { hint: 'Una característica por línea. Se muestran como etiquetas en la tarjeta.' },
  alcance: category === 'asesoramiento'
    ? { label: 'Alcance / Qué incluye', hint: 'Una línea por cada aspecto que incluye.' }
    : { hint: 'Detalle ampliado: se ve al pulsar «Ver alcance».' },
});
const courseOverrides: Record<string, Partial<Field>> = {
  imagen_url: { label: 'Imagen' },
  orden: { hint: 'El número menor aparece primero.' },
  estado: { hint: 'Solo «Publicado» se ve en la web.' },
  fecha_inicio: { hint: 'Opcional. Sin fecha: «Por confirmar».' },
  area: { label: 'Área', hint: 'Opcional. Ejemplo: Ofimática' },
  certificacion: { label: 'Certificación', hint: 'Opcional. Qué certificado se entrega.' },
  temario: { hint: 'Un tema por línea.' },
};
// Value of the "Tipo" selector of Asesoramiento, derived from the stored presentacion (only "beneficio" is special).
export const adviceKind = (row?: Row) => row?.presentacion === 'beneficio' ? 'beneficio' : 'linea';
export function fieldsFor(resource: Resource, scope: PanelScope | undefined, form: Record<string, string>): FieldSet {
  const slugField = resource.fields.find(field => field.key === 'slug');
  const advanced = slugField ? [{ ...slugField, required: false }] : [];
  const build = (layout: Layout, overrides: Record<string, Partial<Field>>, skip: string[]): FieldGroup[] => layout
    .map(group => ({
      key: group.key, title: group.title,
      rows: group.rows
        .map(row => row.filter(key => !skip.includes(key)).map(key => resource.fields.find(field => field.key === key)).filter((field): field is Field => !!field).map(field => ({ ...field, ...overrides[field.key] })))
        .filter(row => row.length),
    }))
    .filter(group => group.rows.length);
  const finish = (groups: FieldGroup[]): FieldSet => ({ main: groups.flatMap(group => group.rows.flat()), advanced, groups });
  if (resource.endpoint === 'servicios') {
    const fixedCategory = scope?.filters.categoria;
    const categoryFixed = !!fixedCategory && !fixedCategory.includes(',');
    const category = categoryFixed ? fixedCategory : form.categoria;
    const set = category === 'asesoramiento' ? (form.contenido_tipo === 'beneficio' ? 'beneficio' : 'linea') : category in serviceLayouts ? category : 'camaras';
    return finish(build(serviceLayouts[set], serviceOverrides(category), categoryFixed ? ['categoria'] : []));
  }
  if (resource.endpoint === 'cursos') return finish(build(courseLayout, courseOverrides, scope?.filters.tipo ? ['tipo'] : []));
  return { main: resource.fields, advanced: [] };
}
// Fields the section fixes on its own (category, course type): sent when a record is created, never when it is edited.
export const fixedFieldKeys = (scope?: PanelScope) => Object.entries(scope?.filters ?? {}).filter(([, value]) => !value.includes(',')).map(([name]) => name);

export const removeVerb = (resource: Resource) => resource.hardDelete || !resource.catalog ? 'Eliminar' : 'Archivar';
// Course conservation is a resource rule, independent of the account's permissions or access mode.
export const supportsRemove = (resource: Resource) => resource.endpoint !== 'cursos';
export const canRemove = (resource: Resource, row: Row) => supportsRemove(resource) && (!!resource.hardDelete || !resource.catalog || row.estado !== 'archivado');
export const slugify = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 180);
export const label = (value: unknown) => labels[String(value)] || String(value ?? '').replace(/_/g, ' ');
export const rowState = (row: Row) => row.activo !== undefined ? row.activo ? 'activo' : 'inactivo' : String(row.estado || 'nuevo');
