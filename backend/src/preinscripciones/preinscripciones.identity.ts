// Controles de identidad de la conversión. Funciones PURAS (sin base de datos) para poder probar cada regla por separado.
//
// Qué se compara y por qué:
//  - El DNI lo teclea el administrador desde el documento de la persona (la preinscripción pública no lo recoge). Es el ancla: el
//    estudiante solo se vincula si su DNI registrado es ese. Un `estudiante_id` suelto NO basta: debe coincidir con el DNI.
//  - Nombres y apellidos de la preinscripción frente a los del estudiante: deben ser compatibles. Si no lo son, se trata de otra
//    persona (o de un error de digitación que se corrige con la corrección auditada de la preinscripción).
//  - Correo y teléfono son indicios de apoyo, nunca una prueba por sí solos: si el estudiante tiene contactos registrados y NINGUNO
//    coincide con los de la preinscripción, la conversión se bloquea hasta una revisión administrativa.
//  - Un estudiante NUEVO no se crea si ya existe uno con el mismo nombre y el mismo correo o teléfono bajo otro DNI (posible DNI mal digitado).
// Los resultados son CÓDIGOS ('nombres', 'contacto'…), nunca los valores comparados: así pueden viajar en errores, registros e historial.

export type Person = { nombres: string; apellidos: string; email?: string | null; telefono?: string | null };

// Partículas que no distinguen a una persona de otra («de la Cruz» / «Cruz»).
const PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'da', 'di', 'van', 'von']);

export function nameTokens(value: string): string[] {
  return [...new Set(value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().split(/[^a-zñ]+/).filter(token => token && !PARTICLES.has(token)))];
}

const subset = (a: string[], b: string[]) => a.length > 0 && a.every(token => b.includes(token));
// Dos conjuntos de palabras son compatibles si uno contiene al otro: «Rosa» ~ «Rosa María», «Pérez» ~ «Pérez Quispe». Nombres y apellidos se
// comparan por separado: «Ana Pérez» no coincide con «Pérez Ana» (nombres y apellidos invertidos), que requiere corregir el dato.
const related = (a: string[], b: string[]) => subset(a, b) || subset(b, a);

export function namesMatch(a: Person, b: Person): boolean {
  return related(nameTokens(a.nombres), nameTokens(b.nombres)) && related(nameTokens(a.apellidos), nameTokens(b.apellidos));
}

export const normalizeEmail = (value?: string | null) => (value ?? '').trim().toLowerCase();
// Solo dígitos y los últimos 9 (ignora «+51», espacios y guiones). Menos de 6 dígitos no es un teléfono comparable.
export function normalizePhone(value?: string | null): string {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.length < 6 ? '' : digits.slice(-9);
}

export type ContactEvidence = { email: boolean; telefono: boolean; referencia: boolean };
// referencia = el estudiante tiene algún contacto registrado con el que comparar. Sin referencia no hay nada que contrastar (ni a favor ni en contra).
export function contactEvidence(preinscription: Person, student: Person): ContactEvidence {
  const studentEmail = normalizeEmail(student.email), studentPhone = normalizePhone(student.telefono);
  return {
    email: !!studentEmail && studentEmail === normalizeEmail(preinscription.email),
    telefono: !!studentPhone && studentPhone === normalizePhone(preinscription.telefono),
    referencia: !!studentEmail || !!studentPhone,
  };
}

export type IdentityVerdict = { ok: boolean; discrepancias: string[]; controles: string[] };

// Vinculación con un estudiante YA registrado, cuyo DNI ya coincide con el tecleado.
export function verifyExistingStudent(preinscription: Person, student: Person): IdentityVerdict {
  const discrepancias: string[] = [], controles = ['control:dni_coincide'];
  if (namesMatch(preinscription, student)) controles.push('control:nombres_coinciden'); else discrepancias.push('nombres');
  const contact = contactEvidence(preinscription, student);
  if (contact.email) controles.push('control:contacto_email');
  if (contact.telefono) controles.push('control:contacto_telefono');
  if (!contact.email && !contact.telefono) {
    if (contact.referencia) discrepancias.push('contacto'); else controles.push('control:contacto_sin_referencia');
  }
  return { ok: discrepancias.length === 0, discrepancias, controles };
}

// Creación de un estudiante NUEVO. `candidates` son estudiantes con el mismo correo o teléfono (otro DNI): si alguno tiene además un nombre
// compatible se bloquea por posible duplicado; si solo comparte el contacto (p. ej. familiares) se permite y queda anotado.
export function verifyNewStudent(preinscription: Person, candidates: Person[]): IdentityVerdict {
  const duplicated = candidates.some(candidate => namesMatch(preinscription, candidate));
  if (duplicated) return { ok: false, discrepancias: ['posible_duplicado'], controles: [] };
  return { ok: true, discrepancias: [], controles: ['control:dni_nuevo', ...(candidates.length ? ['control:contacto_compartido'] : ['control:sin_duplicado_aparente'])] };
}
