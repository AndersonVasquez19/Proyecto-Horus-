import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { ResultadoHerramienta } from '../src/asistente/asistente.catalogo';
import {
  ENCABEZADO_RESUMEN, claveDe, conceptoDe, datosParaModelo, indicadoresDe, instruccionesDeRedaccion, resumenDeDatos, validarRedaccion,
} from '../src/asistente/asistente.fidelidad';

// Pruebas del validador PURO de la redacción de la IA (v2.1). Sin red, sin base, sin NestJS y sin .env: solo datos ficticios.
const ok = (herramienta: string, titulo: string, hechos: [string, string, number][], extra: object = {}): ResultadoHerramienta =>
  ({ herramienta: herramienta as never, titulo, estado: 'ok', parametros: {}, hechos: hechos.map(([id, etiqueta, valor]) => ({ id, etiqueta, valor })), ...extra }) as ResultadoHerramienta;

// El resultado «sesiones» es SINTÉTICO: la herramienta real se retiró con el módulo de Sesiones, pero el validador de periodos (día concreto
// frente a semana) es genérico y se sigue probando con estas etiquetas fechadas.
const RESULTADOS: ResultadoHerramienta[] = [
  ok('cotizaciones', 'Cotizaciones', [['estado_enviada', 'Cotizaciones en estado «enviada»', 8], ['estado_borrador', 'Cotizaciones en estado «borrador»', 8], ['vencidas', 'Enviadas con la validez vencida', 2]]),
  ok('preinscripciones', 'Preinscripciones', [['recibidas', 'Recibidas (sin revisar)', 5], ['validadas', 'Validadas sin convertir en matrícula', 5], ['total', 'Total registradas', 30]]),
  ok('sesiones', 'Sesiones de clase', [['semana_programadas', 'Sesiones programadas esta semana (lunes a domingo)', 6], ['programadas_2026-10-22', 'Programadas el 22/10', 4], ['programadas_2026-10-24', 'Programadas el 24/10', 2]], { ventana: { desde: '2026-10-19', hasta: '2026-10-25' } }),
  ok('mensajes', 'Mensajes', [['nuevos', 'Mensajes nuevos sin atender', 3], ['en_proceso', 'Mensajes en proceso', 2], ['antiguos_48h', 'Mensajes nuevos o en proceso con más de 48 horas', 1]]),
];
const INDICADORES = indicadoresDe(RESULTADOS);
const check = (text: string) => validarRedaccion(text, INDICADORES);
const accepted = (text: string) => { const v = check(text); assert.equal(v.valida, true, text + ' → ' + JSON.stringify(v)); return (v as { texto: string }).texto; };
const rejected = (text: string, motivo?: string) => { const v = check(text); assert.equal(v.valida, false, text); if (motivo) assert.equal((v as { motivo: string }).motivo, motivo, text); };

test('el servidor sustituye cada marcador por el valor de ESE indicador', () => {
  assert.equal(accepted('{{cotizaciones.estado_enviada}} cotizaciones en estado enviada y {{preinscripciones.recibidas}} preinscripciones recibidas sin revisar.'),
    '8 cotizaciones en estado enviada y 5 preinscripciones recibidas sin revisar.');
  assert.equal(accepted('Hay {{mensajes.nuevos}} mensajes nuevos sin atender y {{mensajes.en_proceso}} mensajes en proceso.'), 'Hay 3 mensajes nuevos sin atender y 2 mensajes en proceso.');
  assert.equal(accepted('Mensajes nuevos sin atender: {{mensajes.nuevos}}.'), 'Mensajes nuevos sin atender: 3.', 'el concepto puede ir antes del marcador');
});

test('dos indicadores con cantidades intercambiadas se rechazan (el caso «8 preinscripciones y 5 cotizaciones»)', () => {
  rejected('{{preinscripciones.recibidas}} cotizaciones en estado enviada y {{cotizaciones.estado_enviada}} preinscripciones recibidas sin revisar.', 'concepto');
  rejected('{{cotizaciones.estado_enviada}} preinscripciones recibidas sin revisar.', 'concepto');
  rejected('{{preinscripciones.recibidas}} cotizaciones en estado enviada.', 'concepto');
  rejected('Hay {{cotizaciones.vencidas}} cotizaciones en estado enviada.', 'concepto');
});

test('cantidades iguales con etiquetas diferentes (8 y 8; 5 y 5): el marcador decide, no el número', () => {
  assert.equal(INDICADORES.find(i => i.clave === 'cotizaciones.estado_enviada')!.valor, INDICADORES.find(i => i.clave === 'cotizaciones.estado_borrador')!.valor);
  assert.equal(accepted('{{cotizaciones.estado_borrador}} cotizaciones en estado borrador.'), '8 cotizaciones en estado borrador.');
  rejected('{{cotizaciones.estado_borrador}} cotizaciones en estado enviada.', 'concepto');
  rejected('{{cotizaciones.estado_enviada}} cotizaciones en estado borrador.', 'concepto');
  rejected('{{preinscripciones.validadas}} preinscripciones recibidas sin revisar.', 'concepto');
  assert.equal(accepted('{{preinscripciones.validadas}} preinscripciones validadas sin convertir en matrícula.'), '5 preinscripciones validadas sin convertir en matrícula.');
});

test('periodos incorrectos: otro día, la semana por un día, un día por la semana, fecha inventada', () => {
  assert.equal(accepted('{{sesiones.programadas_2026-10-24}} sesiones programadas el 24/10.'), '2 sesiones programadas el 24/10.');
  assert.equal(accepted('{{sesiones.semana_programadas}} sesiones programadas esta semana.'), '6 sesiones programadas esta semana.');
  rejected('{{sesiones.programadas_2026-10-24}} sesiones programadas el 22/10.');
  rejected('{{sesiones.programadas_2026-10-24}} sesiones programadas el 25/10.', 'cifras_propias');
  rejected('{{sesiones.semana_programadas}} sesiones programadas el 22/10.');
  rejected('{{sesiones.programadas_2026-10-22}} sesiones programadas esta semana.');
});

test('unidades incorrectas: 48 horas no es 48 días ni 72 horas, y la cifra del texto nunca es del modelo', () => {
  assert.equal(accepted('{{mensajes.antiguos_48h}} mensajes nuevos o en proceso con más de 48 horas.'), '1 mensajes nuevos o en proceso con más de 48 horas.');
  rejected('{{mensajes.antiguos_48h}} mensajes nuevos o en proceso con más de 48 días.', 'cifras_propias');
  rejected('{{mensajes.antiguos_48h}} mensajes nuevos o en proceso con más de 72 horas.', 'cifras_propias');
  rejected('{{mensajes.nuevos}} mensajes nuevos sin atender hace más de 48 horas.', 'cifras_propias');
});

test('una etiqueta contenida en otra no se confunde: «nuevos» frente a «nuevos o en proceso con más de 48 horas»', () => {
  rejected('{{mensajes.antiguos_48h}} mensajes nuevos.', 'concepto');
  rejected('{{mensajes.nuevos}} mensajes en proceso.', 'concepto');
  rejected('{{mensajes.en_proceso}} mensajes nuevos sin atender.', 'concepto');
  assert.equal(accepted('{{mensajes.nuevos}} mensajes nuevos sin atender, {{mensajes.en_proceso}} mensajes en proceso.'), '3 mensajes nuevos sin atender, 2 mensajes en proceso.');
});

test('cifras propias, en letras, porcentajes, cálculos y comparaciones se rechazan', () => {
  rejected('Hay 8 cotizaciones en estado enviada.', 'sin_cifras');
  rejected('{{cotizaciones.estado_enviada}} cotizaciones en estado enviada, 8 en total.', 'cifras_propias');
  rejected('{{cotizaciones.estado_enviada}} cotizaciones en estado enviada, ocho en total.', 'cifras_propias');
  rejected('{{cotizaciones.estado_enviada}} cotizaciones en estado enviada, la mitad.', 'cifras_propias');
  rejected('{{cotizaciones.estado_enviada}} cotizaciones en estado enviada, un 80 %.', 'cifras_propias');
  rejected('{{cotizaciones.estado_enviada}} cotizaciones en estado enviada, más que las vencidas.', 'comparacion');
  rejected('{{cotizaciones.estado_enviada}} cotizaciones en estado enviada, menos de las esperadas.', 'comparacion');
  rejected('{{mensajes.nuevos}} mensajes nuevos sin atender y pocos en proceso.', 'cifras_propias');
  rejected('Se suman {{mensajes.nuevos}} mensajes nuevos sin atender.', 'comparacion');
  rejected('{{mensajes.nuevos}} mensajes nuevos sin atender, ningún mensaje en proceso.', 'cifras_propias');
  // «Total registradas» está en la etiqueta citada: repetirla no es un cálculo.
  assert.equal(accepted('{{preinscripciones.total}} total registradas.'), '30 total registradas.');
  rejected('{{preinscripciones.recibidas}} preinscripciones recibidas sin revisar, total aparte.', 'comparacion');
});

test('marcadores desconocidos, mal formados o de otra área; formato; enlaces y longitud', () => {
  rejected('{{cotizaciones.inexistente}} cotizaciones en estado enviada.', 'marcador_desconocido');
  rejected('{{certificados.vigentes}} certificados vigentes.', 'marcador_desconocido');
  rejected('{{ __proto__.constructor }} cotizaciones.', 'marcador_desconocido');
  rejected('{{constructor}} cotizaciones.', 'sin_cifras');
  rejected('{{cotizaciones.estado_enviada}', 'sin_cifras');
  rejected('Solo texto, sin cifras.', 'sin_cifras');
  rejected('', 'formato');
  rejected('   ', 'formato');
  rejected('{{cotizaciones.estado_enviada}} cotizaciones en estado enviada. https://x.pe', 'formato');
  rejected('{{cotizaciones.estado_enviada}} cotizaciones en estado enviada. a@b.co', 'formato');
  rejected('<b>{{cotizaciones.estado_enviada}}</b> cotizaciones en estado enviada', 'formato');
  rejected('{{cotizaciones.estado_enviada}} cotizaciones en estado enviada. ' + 'x'.repeat(1200), 'formato');
  rejected(Array.from({ length: 13 }, () => '{{cotizaciones.estado_enviada}} cotizaciones en estado enviada').join(', '), 'formato');
  assert.equal(validarRedaccion(undefined, INDICADORES).valida, false);
  assert.equal(validarRedaccion({ texto: 'x' }, INDICADORES).valida, false);
  assert.equal(validarRedaccion('{{cotizaciones.estado_enviada}} cotizaciones en estado enviada.', []).valida, false, 'sin indicadores no hay nada que citar');
});

test('lo que se envía al modelo lleva marcador y etiqueta, nunca el valor; las etiquetas con la cantidad inicial se limpian', () => {
  const pendientes = ok('pendientes', 'Pendientes', [['mensajes_antiguos', '1 mensaje sin cerrar desde hace más de 48 horas', 1], ['mensajes_nuevos', '3 mensajes nuevos sin atender', 3]]);
  assert.equal(conceptoDe('1 mensaje sin cerrar desde hace más de 48 horas'), 'mensaje sin cerrar desde hace más de 48 horas');
  assert.equal(conceptoDe('Recibidas (sin revisar)'), 'Recibidas (sin revisar)');
  const enviado = JSON.stringify(datosParaModelo([...RESULTADOS, pendientes]));
  assert.ok(!/"valor"/.test(enviado) && !/:\s*(30|8)\b/.test(enviado));
  assert.ok(enviado.includes('{{cotizaciones.estado_enviada}}') && enviado.includes('{{pendientes.mensajes_nuevos}}'));
  assert.ok(!enviado.includes('3 mensajes') && !enviado.includes('1 mensaje sin'), 'la cantidad que trae el título no llega al modelo');
  // Con la cantidad fuera del concepto, el modelo no puede «citarla» como si fuera una frase de la etiqueta.
  const refs = indicadoresDe([pendientes]);
  assert.equal(validarRedaccion('{{pendientes.mensajes_nuevos}} mensajes nuevos sin atender.', refs).valida, true);
  assert.equal(validarRedaccion('3 mensajes nuevos sin atender {{pendientes.mensajes_nuevos}}.', refs).valida, false);
  assert.match(instruccionesDeRedaccion(), /NUNCA escribas una cifra/);
});

test('indicadoresDe: id estable herramienta.hecho, sin duplicados y sin áreas no disponibles', () => {
  const unavailable: ResultadoHerramienta = { herramienta: 'chatbot', titulo: 'Chatbot', estado: 'no_disponible', parametros: {}, hechos: [], motivo: 'x' };
  const refs = indicadoresDe([...RESULTADOS, RESULTADOS[0], unavailable]);
  assert.equal(refs.length, new Set(refs.map(r => r.clave)).size);
  assert.ok(refs.some(r => r.clave === claveDe('sesiones', 'programadas_2026-10-22')));
  assert.ok(!refs.some(r => r.clave.startsWith('chatbot.')));
  // Claves que no se pueden escribir como marcador (mayúsculas, espacios) no se ofrecen al modelo.
  const odd = ok('cotizaciones', 'Cotizaciones', [['estado_En Revisión', 'Cotizaciones en revisión', 1]]);
  assert.deepEqual(indicadoresDe([odd]), []);
  assert.ok(!JSON.stringify(datosParaModelo([odd])).includes('marcador'));
});

test('resumen determinista: encabezado que lo identifica, etiqueta + valor reales, ventana, áreas no disponibles y recorte', () => {
  const unavailable: ResultadoHerramienta = { herramienta: 'chatbot', titulo: 'Chatbot público', estado: 'no_disponible', parametros: {}, hechos: [], motivo: 'x' };
  assert.match(resumenDeDatos([unavailable, RESULTADOS[0]]), /Chatbot público: no disponible en este momento\./);
  const text = resumenDeDatos(RESULTADOS);
  assert.ok(text.startsWith(ENCABEZADO_RESUMEN));
  assert.match(text, /no es una redacción de IA/);
  assert.match(text, /• Cotizaciones en estado «enviada»: 8/);
  assert.match(text, /• Recibidas \(sin revisar\): 5/);
  assert.match(text, /Sesiones de clase \(del 2026-10-19 al 2026-10-25\):/);
  assert.match(text, /El detalle completo está en los datos/, 'se recorta con aviso cuando es largo');
  const truncated = resumenDeDatos([ok('pendientes', 'Pendientes', [['truncado', 'Hay más pendientes de menor prioridad que no se muestran', 1]])]);
  assert.match(truncated, /• Hay más pendientes de menor prioridad que no se muestran\./);
  assert.ok(!/prioridad que no se muestran: 1/.test(truncated));
  // Mismo valor y misma etiqueta que la fuente: ningún cálculo.
  for (const r of RESULTADOS) if (r.estado === 'ok') for (const h of r.hechos) if (text.includes(conceptoDe(h.etiqueta))) assert.ok(text.includes(`${conceptoDe(h.etiqueta)}: ${h.valor}`), h.id);
});
