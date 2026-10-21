import { registerDecorator, ValidationOptions } from 'class-validator';

// Minimización del historial y de los registros. El historial guarda NOMBRES de campos, códigos de control y estados; el único texto libre es el
// motivo que escribe una persona al descartar o desistir. Ese texto no puede llevar datos personales: ni de la preinscripción, ni de otros estudiantes.
// Es una barrera de MINIMIZACIÓN (patrones inequívocos), no una detección completa: un nombre propio no se puede reconocer con fiabilidad, por eso el
// mensaje pide describir el motivo sin identificar a nadie y el procedimiento lo repite.

export const PERSONAL_DATA_MESSAGE = 'El motivo no debe incluir correos, teléfonos, documentos ni contraseñas. Descríbelo sin datos personales.';

const PATTERNS: Array<[string, RegExp]> = [
  ['correo', /@/],
  // 7 o más dígitos aunque vengan separados por espacios, puntos, guiones, paréntesis o «+»: DNI (8), teléfonos (9), CE y pasaportes numéricos.
  // La barra no cuenta como separador: «12/10/2026» (una fecha) no es un documento.
  ['numero', /(?:\d[\s.\-()+]*){7,}/],
  // «contraseña: …», «password = …», «token: …»: un valor asignado a una credencial.
  ['credencial', /\b(contrase[ñn]a|password|passwd|clave|token|api[\s_-]?key|secreto)\b\s*[:=]/i],
];

// Devuelve el TIPO de dato hallado (nunca el dato) o null.
export function findPersonalData(text: string): string | null {
  for (const [kind, pattern] of PATTERNS) if (pattern.test(text)) return kind;
  return null;
}

// Campos del historial: identificadores en minúsculas (con un único «tipo:valor» para los controles). Cualquier otra cosa podría ser un valor personal.
export const SAFE_FIELD = /^[a-z][a-z_]{0,29}(:[a-z_]{1,29})?$/;

export function NoPersonalData(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => registerDecorator({
    name: 'noPersonalData', target: target.constructor, propertyName: key as string, options: { message: PERSONAL_DATA_MESSAGE, ...options },
    validator: { validate: (value: unknown) => typeof value !== 'string' || findPersonalData(value) === null },
  });
}
