export type Pagination = { page: number; limit: number; total: number; pages: number }
export type PublicList<T> = { ok: boolean; items: T[]; total?: number; pagination: Pagination }
export type CursoPublico = {
  id: number; titulo: string; slug: string; descripcion: string; tipo: 'curso' | 'capacitacion';
  modalidad: 'presencial' | 'virtual' | 'hibrida' | null; duracion: string | null;
  area?: string | null; certificacion?: string | null; icono?: string | null; color?: string; orden?: number; fecha_inicio: string | null;
  imagen_url: string | null; temario: string | null;
}
export type ServicioPublico = { id: number; titulo: string; slug: string; descripcion: string; categoria: string; alcance: string | null; imagen_url: string | null;
  presentacion?:string; nombre_corto?:string|null; destacado?:string|null; dato_principal?:string|null; dato_secundario?:string|null; etiquetas?:string|null; icono?:string|null; color?:string; orden?:number }
export type GaleriaPublica = { id: number; titulo: string; descripcion: string | null; categoria: string; imagen_url: string }
export type FaqPublica = { id: number; pregunta: string; respuesta: string; categoria: string; orden: number }
