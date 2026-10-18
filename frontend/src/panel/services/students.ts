export interface Student {
  id: number;
  nombres: string;
  apellidos: string;
  doc_pais: string | null;
  doc_tipo: 'DNI' | null;
  doc_numero: string | null;
  email: string | null;
  telefono: string | null;
  archivado_at: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface StudentForm {
  nombres: string;
  apellidos: string;
  doc_numero: string;
  email: string;
  telefono: string;
}

export interface StudentList {
  ok: boolean;
  items: Student[];
  pagination: { total: number; page: number; limit: number; pages: number };
}

export const EMPTY_STUDENT: StudentForm = { nombres: '', apellidos: '', doc_numero: '', email: '', telefono: '' };

export function studentFormErrors(form: StudentForm, original?: Pick<Student, 'doc_numero'> | null): Partial<Record<keyof StudentForm, string>> {
  const errors: Partial<Record<keyof StudentForm, string>> = {};
  for (const key of ['nombres', 'apellidos'] as const) {
    if (!form[key].trim()) errors[key] = key === 'nombres' ? 'Introduce los nombres.' : 'Introduce los apellidos.';
    else if (form[key].trim().length > 120) errors[key] = 'Máximo 120 caracteres.';
  }
  if (!(original && !original.doc_numero && form.doc_numero === '') && !/^[0-9]{8}$/.test(form.doc_numero)) errors.doc_numero = 'El DNI debe tener exactamente 8 dígitos.';
  const email = form.email.trim(), phone = form.telefono.trim();
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) errors.email = 'Introduce un correo válido (máximo 254 caracteres).';
  if (phone && (phone.length > 30 || !/^(?=.*\d)[+()\d\s.-]+$/.test(phone))) errors.telefono = 'Introduce un teléfono válido (máximo 30 caracteres).';
  return errors;
}

export function studentPayload(form: StudentForm, revision?: number) {
  return { nombres: form.nombres.trim(), apellidos: form.apellidos.trim(),
    ...(form.doc_numero || revision === undefined ? { doc_numero: form.doc_numero } : {}),
    email: form.email.trim().toLowerCase(), telefono: form.telefono.trim(),
    ...(revision !== undefined ? { revision } : {}),
  };
}

export function studentForm(student: Student): StudentForm {
  return { nombres: student.nombres, apellidos: student.apellidos, doc_numero: student.doc_numero || '', email: student.email || '', telefono: student.telefono || '' };
}
