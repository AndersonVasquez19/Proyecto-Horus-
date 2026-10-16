// Validación de documentos académicos (E4.3a). Funciones puras: sin base de datos, sin red y sin NestJS.
// Reglas (espejo de las restricciones CHECK de la migración 20261015-academico-estructura):
//   DNI        país PE         número: exactamente 8 dígitos
//   CE         país PE         número: 1 a 12 caracteres [A-Z0-9]
//   PASAPORTE  país [A-Z]{2}   número: 1 a 20 caracteres [A-Z0-9]
// País, tipo y número son los tres null/ausentes o los tres completos. Los números son SIEMPRE texto (conservan los
// ceros iniciales). Este módulo no verifica identidades: no hay RENIEC ni ninguna fuente oficial.

export const TIPOS_DOCUMENTO = ['DNI', 'CE', 'PASAPORTE'] as const;
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number];

export interface Documento {
  readonly doc_pais: string;
  readonly doc_tipo: TipoDocumento;
  readonly doc_numero: string;
}

export type CodigoErrorDocumento =
  | 'DOCUMENTO_FORMATO_INVALIDO' // la entrada no es un objeto
  | 'DOCUMENTO_INCOMPLETO'
  | 'DOCUMENTO_REQUERIDO'
  | 'DOCUMENTO_CAMPO_NO_TEXTO'
  | 'DOCUMENTO_CARACTERES_INVALIDOS'
  | 'DOCUMENTO_TIPO_INVALIDO'
  | 'DOCUMENTO_PAIS_INVALIDO'
  | 'DOCUMENTO_NUMERO_INVALIDO';

export type CampoDocumento = 'doc_pais' | 'doc_tipo' | 'doc_numero';

// Los mensajes no incluyen nunca el valor recibido: solo describen la regla incumplida.
export interface ErrorDocumento {
  readonly codigo: CodigoErrorDocumento;
  readonly campo?: CampoDocumento;
  readonly mensaje: string;
}

export type ResultadoDocumento =
  | { readonly ok: true; readonly documento: Documento | null }
  | { readonly ok: false; readonly error: ErrorDocumento };

export type ResultadoDocumentoCertificable =
  | { readonly ok: true; readonly documento: Documento }
  | { readonly ok: false; readonly error: ErrorDocumento };

const CAMPOS: readonly CampoDocumento[] = ['doc_pais', 'doc_tipo', 'doc_numero'];

// Mismas expresiones que la migración (MySQL REGEXP_LIKE con 'c': distingue mayúsculas). Sin banderas i/u/m.
export const PATRONES_DOCUMENTO = {
  paisPeru: /^PE$/,
  paisPasaporte: /^[A-Z]{2}$/,
  dni: /^[0-9]{8}$/,
  ce: /^[A-Z0-9]{1,12}$/,
  pasaporte: /^[A-Z0-9]{1,20}$/,
} as const;

const ERRORES = {
  incompleto: { codigo: 'DOCUMENTO_INCOMPLETO', mensaje: 'El documento debe indicar país, tipo y número, o dejarse completamente vacío.' },
  requerido: { codigo: 'DOCUMENTO_REQUERIDO', mensaje: 'El estudiante no tiene un documento registrado, necesario para emitir el certificado.' },
  formato: { codigo: 'DOCUMENTO_FORMATO_INVALIDO', mensaje: 'Los datos del documento no tienen un formato válido.' },
} as const;

function fallo(error: ErrorDocumento): { ok: false; error: ErrorDocumento } {
  return { ok: false, error };
}

function ausente(valor: unknown): boolean {
  return valor === undefined || valor === null;
}

// Solo ASCII imprimible (0x20-0x7E). Se comprueba ANTES de pasar a mayúsculas: toUpperCase() convierte «ß» en «SS»,
// «ı» en «I», «ſ» en «S» o «ﬁ» en «FI», y eso haría pasar por ASCII válido texto que no lo es. Tampoco se aplica
// ninguna normalización Unicode (NFKC convertiría dígitos de ancho completo o «Ａ» en ASCII).
function esAsciiImprimible(texto: string): boolean {
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    if (c < 0x20 || c > 0x7e) return false;
  }
  return true;
}

// Normalización controlada: quita solo espacios U+0020 y guiones «-» U+002D (el tabulador, el salto de línea, el espacio
// de no separación, el guion largo, etc. no se tocan y por tanto se rechazan), y pasa a mayúsculas ASCII.
function normalizarTexto(campo: CampoDocumento, valor: unknown): { ok: true; texto: string } | { ok: false; error: ErrorDocumento } {
  if (typeof valor !== 'string') {
    return fallo({ codigo: 'DOCUMENTO_CAMPO_NO_TEXTO', campo, mensaje: `El campo ${campo} debe enviarse como texto.` });
  }
  if (!esAsciiImprimible(valor)) {
    return fallo({ codigo: 'DOCUMENTO_CARACTERES_INVALIDOS', campo, mensaje: `El campo ${campo} solo admite letras y números ASCII, espacios y guiones.` });
  }
  // Número: se quitan todos los espacios y guiones (agrupaciones como «1234-5678»). País y tipo: solo los espacios de los extremos.
  const limpio = campo === 'doc_numero' ? valor.replace(/[ -]/g, '') : valor.replace(/^ +| +$/g, '');
  return { ok: true, texto: limpio.toUpperCase() };
}

function leer(entrada: object, campo: CampoDocumento): unknown {
  return Object.prototype.hasOwnProperty.call(entrada, campo) ? (entrada as Record<string, unknown>)[campo] : undefined;
}

/**
 * Normaliza y valida un documento `{ doc_pais, doc_tipo, doc_numero }`.
 * - Los tres ausentes (undefined/null), o la entrada misma undefined/null: `{ ok: true, documento: null }`.
 * - Parcial, de tipo no texto, con caracteres no ASCII, tipo desconocido o formato incumplido: `{ ok: false, error }`.
 * - Completo y válido: documento con país, tipo y número normalizados (texto, ceros iniciales conservados).
 * Una cadena vacía cuenta como valor presente (y, por tanto, inválido): no se interpreta como «ausente».
 */
export function normalizarDocumento(entrada: unknown): ResultadoDocumento {
  if (ausente(entrada)) return { ok: true, documento: null };
  if (typeof entrada !== 'object' || Array.isArray(entrada)) return fallo(ERRORES.formato);

  const crudos = CAMPOS.map(campo => leer(entrada, campo));
  const presentes = crudos.filter(valor => !ausente(valor)).length;
  if (presentes === 0) return { ok: true, documento: null };
  if (presentes < CAMPOS.length) return fallo(ERRORES.incompleto);

  const normalizados: string[] = [];
  for (let i = 0; i < CAMPOS.length; i++) {
    const r = normalizarTexto(CAMPOS[i], crudos[i]);
    if (r.ok === false) return fallo(r.error);
    normalizados.push(r.texto);
  }
  const [pais, tipo, numero] = normalizados;

  if (!(TIPOS_DOCUMENTO as readonly string[]).includes(tipo)) {
    return fallo({ codigo: 'DOCUMENTO_TIPO_INVALIDO', campo: 'doc_tipo', mensaje: 'El tipo de documento debe ser DNI, CE o PASAPORTE.' });
  }
  const t = tipo as TipoDocumento;

  const paisValido = t === 'PASAPORTE' ? PATRONES_DOCUMENTO.paisPasaporte.test(pais) : PATRONES_DOCUMENTO.paisPeru.test(pais);
  if (!paisValido) {
    return fallo({
      codigo: 'DOCUMENTO_PAIS_INVALIDO',
      campo: 'doc_pais',
      mensaje: t === 'PASAPORTE' ? 'El país del pasaporte debe ser un código de dos letras (A-Z).' : 'El país de un DNI o un CE debe ser PE.',
    });
  }

  const patronNumero = t === 'DNI' ? PATRONES_DOCUMENTO.dni : t === 'CE' ? PATRONES_DOCUMENTO.ce : PATRONES_DOCUMENTO.pasaporte;
  if (!patronNumero.test(numero)) {
    const regla = t === 'DNI' ? 'exactamente 8 dígitos' : t === 'CE' ? 'de 1 a 12 letras o números' : 'de 1 a 20 letras o números';
    return fallo({ codigo: 'DOCUMENTO_NUMERO_INVALIDO', campo: 'doc_numero', mensaje: `El número de ${t} debe tener ${regla}.` });
  }

  return { ok: true, documento: { doc_pais: pais, doc_tipo: t, doc_numero: numero } };
}

/**
 * Exige que el estudiante (`{ doc_pais, doc_tipo, doc_numero }`) tenga un documento válido para emitir un certificado.
 * Sin documento devuelve DOCUMENTO_REQUERIDO; un documento parcial o inválido devuelve el error de normalizarDocumento.
 */
export function exigirDocumentoCertificable(estudiante: unknown): ResultadoDocumentoCertificable {
  const r = normalizarDocumento(estudiante);
  if (r.ok === false) return fallo(r.error);
  if (r.documento === null) return fallo(ERRORES.requerido);
  return { ok: true, documento: r.documento };
}
