import type { InstitutionalCatalog } from './types';

export class InstitutionalContentError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const pageNumber = (value: string | null, fallback: number, max = Number.MAX_SAFE_INTEGER) => {
  if (value === null) return fallback;
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) throw new InstitutionalContentError(400, 'Paginación inválida.');
  return Number(value);
};
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const order = (row: { id: number; orden?: number }) => row.orden ?? row.id;

// Solo lectura local: no consulta fetch, sesión, storage ni variables de entorno. El catálogo se inyecta para poder probarlo sin Vite.
export function createInstitutionalReader(catalog: InstitutionalCatalog) {
  return function readInstitutionalResource(path: string) {
    if (!/^[a-z][a-z-]*(?:\/[^/?#]+)?(?:\?[^#]*)?$/.test(path)) throw new InstitutionalContentError(404, 'Contenido no disponible.');
    const [pathname, search = ''] = path.split('?');
    const [resource, detail] = pathname.split('/');
    const params = new URLSearchParams(search);
    if (resource === 'settings' && !detail) return { ok: true, settings: { ...catalog.settings } };
    const list = resource === 'cursos' ? catalog.cursos : resource === 'servicios' ? catalog.servicios : resource === 'galeria' ? catalog.galeria
      : resource === 'preguntas-frecuentes' ? catalog.preguntasFrecuentes : resource === 'convenios' ? catalog.convenios.filter(row => row.visible) : null;
    if (!list) throw new InstitutionalContentError(404, 'Contenido no disponible.');
    if (detail) {
      const item = list.find(row => String(row.id) === detail || ('slug' in row && row.slug === detail));
      if (!item) throw new InstitutionalContentError(404, 'Contenido no disponible.');
      return { ok: true, item: structuredClone(item) };
    }
    const filtered = list.filter(row => {
      for (const key of ['tipo', 'categoria', 'presentacion', 'modalidad']) {
        const wanted = params.get(key);
        if (wanted && !Object.entries(row).some(([field, value]) => field === key && value === wanted)) return false;
      }
      const search = params.get('search')?.trim();
      return !search || Object.entries(row).some(([key, value]) => ['titulo', 'descripcion', 'pregunta', 'respuesta', 'nombre', 'sigla'].includes(key) && typeof value === 'string' && normalize(value).includes(normalize(search)));
    }).sort((a, b) => order(a) - order(b) || a.id - b.id);
    const page = pageNumber(params.get('page'), 1), limit = pageNumber(params.get('limit'), 20, 100);
    return { ok: true, items: structuredClone(filtered.slice((page - 1) * limit, page * limit)), total: filtered.length,
      ...(resource === 'galeria' ? { categorias: [...new Set(catalog.galeria.map(row => row.categoria))].sort() } : {}),
      pagination: { page, limit, total: filtered.length, pages: Math.max(1, Math.ceil(filtered.length / limit)) } };
  };
}
