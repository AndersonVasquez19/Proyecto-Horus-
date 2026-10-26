// Reglas puras del módulo de Cotizaciones (sin base de datos): fechas de Lima, vencimiento, número legible y resumen de correo.
// Todo se deriva de columnas que ya existen (estado, validez, historial): no hay migración.

// Estados y transiciones permitidas. `aceptada`, `rechazada` y `anulada` son finales.
export const QUOTE_STATES = ['borrador', 'enviada', 'aceptada', 'rechazada', 'anulada'] as const;
export const transitions: Record<string, string[]> = { borrador: ['enviada', 'anulada'], enviada: ['aceptada', 'rechazada', 'anulada'], aceptada: [], rechazada: [], anulada: [] };

// Fecha de hoy en Perú (America/Lima, UTC-5 fijo) como YYYY-MM-DD. `validez` es un DATE sin hora: se compara como texto.
export const limaToday = (now: Date = new Date()): string => now.toLocaleDateString('en-CA', { timeZone: 'America/Lima' });

// Vencida = propuesta enviada cuya vigencia ya pasó. Es el mismo criterio de HORUS Assistant (estado «enviada» y validez < hoy).
// Un borrador con vigencia pasada no se llama «vencido»: simplemente no se puede enviar hasta corregir la fecha.
export const isExpired = (estado: string, validez: string, today: string = limaToday()): boolean => estado === 'enviada' && validez < today;

// Número legible a partir del id autoincremental (único por construcción, sin carreras): COT-2026-000123.
export const quoteNumber = (year: number, id: number): string => 'COT-' + year + '-' + String(id).padStart(6, '0');

export interface MailSummary { intentos: number; aceptados: number; fallidos: number; inciertos: number; en_curso: number; ultimo: { intento: string; estado: string; fecha: string } | null }

// Resume los envíos por correo registrados en `historial`. El estado de un intento es el de su última entrada.
// «aceptado» = el proveedor aceptó el correo; NO prueba que el cliente lo haya recibido ni leído, y mucho menos que acepte la propuesta.
export function mailSummary(historial: unknown): MailSummary {
  const attempts = new Map<string, { estado: string; fecha: string }>();
  if (Array.isArray(historial)) {
    for (const entry of historial as Array<{ fecha?: unknown; correo?: { tipo?: unknown; intento?: unknown; estado?: unknown } } | null>) {
      const info = entry?.correo;
      if (!info || info.tipo !== 'cotizacion' || typeof info.intento !== 'string' || typeof info.estado !== 'string') continue;
      attempts.set(info.intento, { estado: info.estado, fecha: String(entry?.fecha ?? '') });
    }
  }
  const list = [...attempts.entries()];
  const count = (state: string) => list.filter(([, value]) => value.estado === state).length;
  const last = list.length ? list[list.length - 1] : null;
  return { intentos: list.length, aceptados: count('aceptado'), fallidos: count('fallido'), inciertos: count('incierto'), en_curso: count('iniciado'),
    ultimo: last ? { intento: last[0], estado: last[1].estado, fecha: last[1].fecha } : null };
}
