export interface QuoteLine { descripcion: string; cantidad: number; precio: number; importe?: number }
export interface QuoteInput { cliente:string; email:string; telefono:string; documento:string; direccion:string; emisor:string; datos_emisor:string; moneda:string; validez:string; condiciones:string; conceptos:QuoteLine[]; descuento:number; tasa:number; contacto_id?:number }
export interface Quote extends QuoteInput { id:number; numero:string; estado:string; revision:number; subtotal:number|string; impuesto:number|string; total:number|string; historial:{accion:string;usuario:number;fecha:string}[]; createdAt?:string }
export const quoteTransitions:Record<string,string[]>={borrador:['enviada','anulada'],enviada:['aceptada','rechazada','anulada'],aceptada:[],rechazada:[],anulada:[]};
// Permiso ADICIONAL que exige cada estado destino. Espejo del `when` de byField('POST','admin/cotizaciones/:id/estado',…) en
// backend/src/permissions/route-inventory.ts: cambiar el estado siempre exige editar, y «enviada» y «anulada» exigen además el suyo.
// Vive aquí, y no dentro del componente, para que la prueba lo compare con el inventario del backend (tests/panel-access.test.mjs).
export const quoteTransitionPermission:Record<string,'enviar'|'anular'|undefined>={enviada:'enviar',anulada:'anular'};
export interface QuotePermissions { edit:boolean; send:boolean; void:boolean }
// No ofrecer nunca una transición que el backend rechazaría con 403.
export function canMoveQuote(target:string,perms:QuotePermissions):boolean{
 if(!perms.edit)return false;
 const extra=quoteTransitionPermission[target];
 if(extra===undefined)return true;
 return extra==='enviar'?perms.send:perms.void;
}
