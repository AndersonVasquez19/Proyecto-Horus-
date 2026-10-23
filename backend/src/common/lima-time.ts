// Fecha y hora de pared de America/Lima (UTC-5 todo el año, sin horario de verano), compartidas por los módulos que trabajan con el
// calendario de la empresa: los horarios recurrentes de las ediciones (backend/src/horarios/) y las ventanas «hoy» de HORUS Assistant.
// Procede de backend/src/sesiones/sesiones.time.ts, retirado junto con el módulo de Sesiones (octubre de 2026).
//
// Nada de aquí lee la zona horaria del sistema operativo ni la de MySQL: la conversión usa Intl con la zona declarada. Funciones puras,
// probadas sin base de datos (test/lima-time.test.ts), también con otra TZ del proceso.

export const ZONA_HORARIA = 'America/Lima';

const wallClock = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA_HORARIA, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

// Hora de reloj HH:MM de 24 horas, con dos dígitos (00:00 … 23:59). Con este formato, comparar las cadenas equivale a comparar las horas.
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isClockTime = (value: unknown): value is string => typeof value === 'string' && TIME_PATTERN.test(value);

// DATE de MySQL ⇄ cadena AAAA-MM-DD. Prisma entrega y recibe medianoche UTC del día de calendario: sin conversión de zona.
export const parseDate = (value: string) => new Date(value + 'T00:00:00.000Z');
export const formatDate = (value: Date) => value.toISOString().slice(0, 10);

// TIME de MySQL ⇄ cadena HH:MM. Prisma lo representa como 1970-01-01 en UTC.
export const parseTime = (value: string) => new Date(`1970-01-01T${value}:00.000Z`);
export const formatTime = (value: Date) => value.toISOString().slice(11, 16);

const partsOf = (instant: Date) => {
  const parts: Record<string, number> = {};
  for (const part of wallClock.formatToParts(instant)) if (part.type !== 'literal') parts[part.type] = Number(part.value);
  if (parts.hour === 24) parts.hour = 0; // algunas versiones de ICU expresan la medianoche como 24
  return parts;
};

// Desfase de America/Lima respecto a UTC en ese instante, en minutos (−300). Se calcula, no se escribe a mano.
function offsetMinutes(instant: Date): number {
  const p = partsOf(instant);
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

// Fecha y hora local de Lima en un instante UTC (por ejemplo, «ahora»).
export function limaClock(instant: Date): { fecha: string; hora: string } {
  const p = partsOf(instant);
  const two = (n: number) => String(n).padStart(2, '0');
  return { fecha: `${p.year}-${two(p.month)}-${two(p.day)}`, hora: `${two(p.hour)}:${two(p.minute)}` };
}

// Instante UTC de una fecha y hora de pared de Lima.
export function limaToUtc(fecha: string, hora: string): Date {
  const [year, month, day] = fecha.split('-').map(Number);
  const [hour, minute] = hora.split(':').map(Number);
  const local = Date.UTC(year, month - 1, day, hour, minute);
  const first = local - offsetMinutes(new Date(local)) * 60000;
  return new Date(local - offsetMinutes(new Date(first)) * 60000);
}
