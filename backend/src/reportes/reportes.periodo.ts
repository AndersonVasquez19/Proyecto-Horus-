import { BadRequestException } from '@nestjs/common';
import { LIMA_OFFSET_HOURS } from '../admin/stats/stats.service';
import { MAX_RANGE_DAYS } from './reportes.limites';

// Días de Perú (America/Lima, UTC-5 fijo: Perú no aplica horario de verano), igual que GET /admin/stats/actividad.
// Las columnas createdAt se guardan en UTC; las fechas de edición son DATE de calendario y se comparan sin zona horaria.
export { LIMA_OFFSET_HOURS };
const DAY_MS = 86_400_000;
const OFFSET_MS = LIMA_OFFSET_HOURS * 3_600_000;

export interface Period {
  desde: string | null; // 'AAAA-MM-DD' (incluido)
  hasta: string | null; // 'AAAA-MM-DD' (incluido)
  fromUtc: Date | null; // inicio del día «desde» en Lima, en UTC
  toUtc: Date | null; // inicio del día SIGUIENTE a «hasta» en Lima, en UTC (exclusivo)
  etiqueta: string;
}

export const calendarDate = (value: string) => new Date(value + 'T00:00:00.000Z');
export const toCalendar = (date: Date | null | undefined) => date ? date.toISOString().slice(0, 10) : null;
export const limaDayStartUtc = (day: string) => new Date(calendarDate(day).getTime() + OFFSET_MS);
export const limaToday = (now: Date) => new Date(now.getTime() - OFFSET_MS).toISOString().slice(0, 10);
// 'AAAA-MM-DD HH:mm' en hora de Lima.
export const limaDateTime = (date: Date) => new Date(date.getTime() - OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ');
export const displayDate = (day: string) => day.slice(8, 10) + '/' + day.slice(5, 7) + '/' + day.slice(0, 4);

const addDays = (day: string, days: number) => new Date(calendarDate(day).getTime() + days * DAY_MS).toISOString().slice(0, 10);
const diffDays = (from: string, to: string) => Math.round((calendarDate(to).getTime() - calendarDate(from).getTime()) / DAY_MS);

export function periodLabel(desde: string | null, hasta: string | null): string {
  if (desde && hasta) return 'Del ' + displayDate(desde) + ' al ' + displayDate(hasta);
  if (desde) return 'Desde el ' + displayDate(desde);
  if (hasta) return 'Hasta el ' + displayDate(hasta);
  return 'Todo el historial';
}

// `defaultLastMonths`: el período queda siempre acotado (lo usa el resumen general, que necesita una serie mensual): sin «hasta»
// termina hoy y sin «desde» empieza el día 1 del mes N-1 anterior a «hasta». Sin él, omitir las fechas significa «todo el historial».
export function resolvePeriod(desde: string | undefined, hasta: string | undefined, now: Date, defaultLastMonths?: number): Period {
  let from = desde ?? null;
  let to = hasta ?? null;
  if (defaultLastMonths) {
    to = to ?? limaToday(now);
    if (!from) {
      const first = calendarDate(to.slice(0, 8) + '01');
      first.setUTCMonth(first.getUTCMonth() - (defaultLastMonths - 1));
      from = first.toISOString().slice(0, 10);
    }
  }
  if (from && to && from > to) throw new BadRequestException('La fecha inicial no puede ser posterior a la fecha final.');
  if (from && to && diffDays(from, to) + 1 > MAX_RANGE_DAYS) {
    throw new BadRequestException('El período no puede superar ' + MAX_RANGE_DAYS + ' días. Acota las fechas.');
  }
  return {
    desde: from, hasta: to,
    fromUtc: from ? limaDayStartUtc(from) : null,
    toUtc: to ? limaDayStartUtc(addDays(to, 1)) : null,
    etiqueta: periodLabel(from, to),
  };
}

// Meses 'AAAA-MM' entre dos fechas de calendario, ambos incluidos.
export function monthsBetween(desde: string, hasta: string): string[] {
  const months: string[] = [];
  const cursor = calendarDate(desde.slice(0, 8) + '01');
  const last = hasta.slice(0, 7);
  while (cursor.toISOString().slice(0, 7) <= last) {
    months.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}
