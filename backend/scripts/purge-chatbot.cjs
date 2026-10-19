// Limpieza programable de la retención de 90 días del chatbot: `npm run chatbot:purge [-- --dry-run]` (requiere `npm run build`).
// Elimina SOLO filas vencidas de chatbot_interacciones y chatbot_preguntas_sin_respuesta; nunca contactos, cotizaciones, reclamaciones ni seguimientos.
// Es idempotente (se puede repetir o solapar) y acotada por lotes. `--dry-run` solo cuenta. Programación y supervisión: backend/CHATBOT.md.
const { prisma } = require('./database.cjs');
const { parseArgs } = require('./backup-lib.cjs');

async function purge({ client, dryRun, now = new Date(), log = console.log }) {
  const { ChatbotMetricsService } = require('../dist/chatbot/chatbot-metrics.service');
  const result = await new ChatbotMetricsService(client).purgeExpiredBatches(now, { dryRun });
  log((dryRun ? 'Simulación (no se borró nada). Vencidas: ' : 'Eliminadas: ') + result.preguntas + ' preguntas sin respuesta y ' + result.interacciones + ' métricas de interacción.');
  if (result.truncado) log('Quedan más filas vencidas: el límite por ejecución se alcanzó. La próxima ejecución continuará.');
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const unknown = Object.keys(args).filter(key => key !== 'dry-run');
  if (unknown.length) throw new Error('Argumento no reconocido: --' + unknown[0]);
  const client = prisma();
  try { await purge({ client, dryRun: args['dry-run'] === true }); }
  finally { await client.$disconnect(); }
}

if (require.main === module) main().catch(error => {
  // Sin trazas ni mensajes del servidor: podrían incluir rutas o datos de conexión.
  console.error(error && /^Argumento/.test(error.message) ? error.message : 'No se pudo completar la limpieza del chatbot. Revisa la conexión y que el backend esté compilado (npm run build). Es seguro repetirla.');
  process.exitCode = 1;
});
module.exports = { purge };
