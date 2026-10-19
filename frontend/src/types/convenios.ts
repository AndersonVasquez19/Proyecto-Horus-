import type { PublicList } from './public'
export type Convenio = {
  id: number; nombre: string; sigla: string | null; logo_url: string | null;
  descripcion_corta: string; orden: number; visible: boolean;
}
export type ConvenioFoto = { id: number; convenio_id: number; imagen_url: string; orden: number; createdAt: string }
export type ConvenioDetalle = Convenio & {
  descripcion_completa: string | null; informacion_adicional: string | null; fotos: ConvenioFoto[];
}
export type ConvenioList = PublicList<Convenio>
export type ConvenioResponse = { ok: boolean; item: ConvenioDetalle }
export type ConvenioResource = { data: ConvenioList | null; loading: boolean; error: string; reload: () => void }
