import { ZONA_HORARIA, formatDate, limaClock, limaToUtc, parseDate } from '../common/lima-time';

// Fechas de HORUS Assistant. La zona de operación es la ya declarada por el proyecto (common/lima-time.ts: America/Lima, UTC-5 sin horario
// de verano); no se lee la zona del sistema operativo ni la de MySQL. «Hoy» es el día de calendario de Lima en el instante `now`.
export { ZONA_HORARIA };

export interface DayWindow {
  zona: string;
  fecha: string;      // día operativo AAAA-MM-DD (Lima)
  desdeUtc: Date;     // 00:00 de Lima de ese día, en UTC (inclusivo)
  hastaUtc: Date;     // 00:00 de Lima del día siguiente, en UTC (exclusivo)
  fechaDb: Date;      // el mismo día como DATE de MySQL (medianoche UTC del día de calendario)
}

const nextDay = (fecha: string) => formatDate(new Date(parseDate(fecha).getTime() + 86_400_000));

export function operatingDay(now: Date): DayWindow {
  const { fecha } = limaClock(now);
  return { zona: ZONA_HORARIA, fecha, desdeUtc: limaToUtc(fecha, '00:00'), hastaUtc: limaToUtc(nextDay(fecha), '00:00'), fechaDb: parseDate(fecha) };
}
