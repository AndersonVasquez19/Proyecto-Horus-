export interface QuoteLine { descripcion: string; cantidad: number; precio: number; importe?: number }
export interface QuoteInput { cliente:string; email:string; telefono:string; documento:string; direccion:string; emisor:string; datos_emisor:string; moneda:string; validez:string; condiciones:string; conceptos:QuoteLine[]; descuento:number; tasa:number; contacto_id?:number }
export interface Quote extends QuoteInput { id:number; numero:string; estado:string; revision:number; subtotal:number|string; impuesto:number|string; total:number|string; historial:{accion:string;usuario:number;fecha:string}[]; createdAt?:string }
export const quoteTransitions:Record<string,string[]>={borrador:['enviada','anulada'],enviada:['aceptada','rechazada','anulada'],aceptada:[],rechazada:[],anulada:[]};
