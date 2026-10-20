import type { CursoPublico, FaqPublica, GaleriaPublica, ServicioPublico } from '../types/public';
import type { ConvenioDetalle } from '../types/convenios';

// El mismo contrato público de lectura; no contiene estados administrativos ni IDs académicos.
export interface InstitutionalCatalog {
  cursos: CursoPublico[];
  servicios: ServicioPublico[];
  galeria: (GaleriaPublica & { orden: number })[];
  preguntasFrecuentes: FaqPublica[];
  convenios: ConvenioDetalle[];
  settings: Record<string, string>;
}
