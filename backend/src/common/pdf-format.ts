// Utilidades de formato compartidas por los PDF del sistema (hoy, Cotizaciones). Antes vivían en el módulo de certificados, que se
// retiró del alcance académico: Cotizaciones no debe depender de él.

export const INSTITUTION = 'Horus Group SRL';
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// Las fechas de edición son DATE (medianoche UTC): se leen en UTC para no retroceder un día con la zona horaria.
export function longDate(value: Date): string {
  return value.getUTCDate() + ' de ' + MONTHS[value.getUTCMonth()] + ' de ' + value.getUTCFullYear();
}

// Instantes (emisión, generación): se muestran en hora de Lima.
export function limaDateTime(value: Date): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(value).map(part => [part.type, part.value]));
  return parts.day + '/' + parts.month + '/' + parts.year + ' ' + parts.hour + ':' + parts.minute + ' (hora de Lima)';
}
