import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { permissionsOf } from '../permissions/policy';
import {
  ejecutar, herramientasPara, seccionesDe, type ResultadoHerramienta,
} from './asistente.catalogo';
import {
  MAX_PREGUNTA, MENSAJES, answerInput, answerInstructions, areasSinAcceso, containsPersonalData, parsePlan, plannerInput, plannerInstructions, type DatosParaRedactar,
} from './asistente.consulta';
import { ASISTENTE_CONSULTA_DATA, type ConsultaDataSource } from './asistente.data';
import { AsistenteExplainer } from './asistente.explainer';
import { indicadoresDe, resumenDeDatos, validarRedaccion } from './asistente.fidelidad';
import { ASISTENTE_LIMITES, type LimitesConsulta } from './asistente.limites';
import { SECTION_SOURCES, authorizedSections, type SectionData, type SectionKey } from './asistente.rules';
import { NO_REGISTRADO, NO_ROLE_MESSAGE, UNAUTHORIZED_MESSAGE, windowOf } from './asistente.service';
import { operatingDay } from './asistente.time';

export const DATOS_PERSONALES_MESSAGE = 'Tu pregunta incluye datos personales (correo, teléfono o número de documento). Reformúlala sin ellos: HORUS Assistant responde con cifras.';
export const IA_MESSAGES = Object.freeze({
  no_configurada: 'Las consultas con IA no están activadas en este entorno. El resumen del día sigue disponible.',
  no_disponible: 'El asistente no pudo procesar la consulta en este momento. Intenta de nuevo en unos minutos. El resumen del día sigue disponible.',
  ocupada: 'El asistente está atendiendo otras consultas. Intenta de nuevo en unos segundos.',
  respuesta_invalida: 'El asistente no pudo preparar una respuesta confiable. Intenta reformular la pregunta. El resumen del día sigue disponible.',
});
type IaFailure = keyof typeof IA_MESSAGES;

// Tiempo máximo que se espera a cada llamada a OpenAI (el límite total de una consulta es la suma de las dos).
const PLAN_TIMEOUT_MS = 10_000;
const ANSWER_TIMEOUT_MS = 12_000;

export const AVISO_RESUMEN = Object.freeze({
  redaccion_no_validada: 'La redacción con IA no se pudo comprobar contra los datos, así que se muestra un resumen de los datos generado por el sistema.',
  ia_no_disponible: 'La IA no pudo redactar la respuesta en este momento, así que se muestra un resumen de los datos generado por el sistema.',
});

type SectionOutcome = { estado: 'ok'; consultado_en: string } | { estado: 'no_disponible'; motivo: string } | { estado: 'error'; motivo: string };

// HORUS Assistant v2: consultas en lenguaje natural, SOLO LECTURA. Flujo (ver docs/procedimientos/horus-assistant.md):
//   1. NestJS identifica la cuenta y lee su rol VIGENTE de la base; calcula el catálogo de herramientas de ese rol.
//   2. OpenAI recibe la pregunta y SOLO ese catálogo, y devuelve qué herramientas usar. No recibe datos, no ve la base.
//   3. NestJS valida la elección (lo que no esté en el catálogo del rol no se ejecuta) y ejecuta consultas FIJAS ya escritas (asistente.data.ts).
//   4. OpenAI recibe los hechos (etiqueta y marcador, SIN el valor) y redacta con marcadores {{herramienta.hecho}}; NestJS sustituye cada marcador por
//      su valor real y descarta la redacción si una cifra no acompaña a su indicador (asistente.fidelidad.ts). Entonces entrega un resumen determinista.
// La IA nunca ejecuta SQL ni usa Prisma, y ninguna herramienta escribe. Sin IA para ELEGIR herramientas no se inventa respuesta: 503.
@Injectable()
export class AsistenteConsultaService {
  private readonly logger = new Logger(AsistenteConsultaService.name);
  // El límite por cuenta es COMPARTIDO entre instancias (rate_limit_buckets, ver asistente.limites.ts). Cada consulta cuesta hasta dos llamadas a OpenAI.
  constructor(
    @Inject(ASISTENTE_CONSULTA_DATA) private readonly data: ConsultaDataSource,
    private readonly ai: AsistenteExplainer,
    @Inject(ASISTENTE_LIMITES) private readonly limites: LimitesConsulta,
  ) {}

  async consultar(actorId: number, rawQuestion: string, now = new Date()) {
    const pregunta = rawQuestion.trim();
    await this.limites.admitir(actorId, now);

    // El rol sale de la base en esta misma solicitud (nunca del token ni de la pregunta).
    const account = await this.data.account(actorId);
    if (!account || !account.activo) throw new UnauthorizedException({ ok: false, mensaje: UNAUTHORIZED_MESSAGE });
    if (!account.rol) throw new ForbiddenException({ ok: false, mensaje: NO_ROLE_MESSAGE });
    const role = account.rol;

    if (!pregunta || pregunta.length > MAX_PREGUNTA) throw new BadRequestException({ ok: false, codigo: 'pregunta_invalida', mensaje: `Escribe una pregunta de hasta ${MAX_PREGUNTA} caracteres.` });
    if (containsPersonalData(pregunta)) throw new BadRequestException({ ok: false, codigo: 'datos_personales', mensaje: DATOS_PERSONALES_MESSAGE });
    if (!this.ai.disponible) throw this.unavailable('no_configurada');

    const window = operatingDay(now);
    const sections = authorizedSections(role);
    const envelope = {
      ok: true as const,
      generado_en: now.toISOString(), zona_horaria: window.zona, fecha_operativa: window.fecha,
      acceso: { rol: role, permisos_efectivos: permissionsOf(role).length, secciones_autorizadas: sections },
      alcance: 'solo_lectura' as const,
    };
    const suggestions = () => herramientasPara(role).map(tool => tool.ejemplo);
    const withoutData = (estado: 'fuera_de_alcance' | 'sin_permiso' | 'aclaracion', texto: string, extra: Record<string, unknown> = {}) => ({
      ...envelope, estado, respuesta: { texto, origen: 'sistema' as const }, datos: [], fuentes: [], avisos: [], sugerencias: suggestions(), ...extra,
    });

    // Paso 1: el modelo elige herramientas del catálogo de ESTE rol. No recibe ningún dato.
    const planned = await this.ai.ask(plannerInstructions(), plannerInput(pregunta, role, window.fecha), { maxTokens: 300, timeoutMs: PLAN_TIMEOUT_MS });
    if (planned.ok === false) throw this.unavailable(planned.estado);
    const plan = parsePlan(planned.texto, role);
    if (plan.tipo === 'invalida') { this.logger.warn('Asistente: el modelo devolvió una selección de herramientas inválida.'); throw this.unavailable('respuesta_invalida'); }

    if (plan.tipo === 'ambigua') return withoutData('aclaracion', MENSAJES.ambigua);
    if (plan.tipo === 'sin_permiso') return withoutData('sin_permiso', MENSAJES.sin_permiso);
    if (plan.tipo === 'fuera_de_alcance') {
      // Si menciona un área que su rol no ve, se dice con claridad que es un tema de permisos.
      if ((plan.motivo === 'otro' || plan.motivo === 'no_registrado') && areasSinAcceso(pregunta, role).length) return withoutData('sin_permiso', MENSAJES.sin_permiso);
      return withoutData('fuera_de_alcance', MENSAJES[plan.motivo], { no_registrado: NO_REGISTRADO });
    }

    // Paso 2: consultas fijas, solo las secciones de las herramientas elegidas (todas dentro de las autorizadas).
    const wanted = new Set<SectionKey>();
    for (const { tool } of plan.herramientas) for (const section of seccionesDe(tool, role)) wanted.add(section);
    const list = [...wanted];
    const settled = await Promise.allSettled(list.map(section => this.data.read(section, window, now)));

    const data: Partial<SectionData> = {};
    const estados: Partial<Record<SectionKey, SectionOutcome>> = {};
    const consultadoEn = now.toISOString();
    list.forEach((section, index) => {
      const outcome = settled[index];
      if (outcome.status === 'rejected') {
        // Solo el tipo del fallo: nunca el mensaje (podría contener SQL o datos).
        this.logger.warn(`Asistente: no se pudo leer la sección «${section}» (${outcome.reason instanceof Error ? outcome.reason.name : 'error'}).`);
        estados[section] = { estado: 'error', motivo: 'No se pudo consultar esta área. Intenta de nuevo más tarde.' };
      } else if (outcome.value === null) {
        estados[section] = { estado: 'no_disponible', motivo: 'Este módulo todavía no está disponible en la base de datos de este entorno.' };
      } else {
        (data as Record<string, unknown>)[section] = outcome.value;
        estados[section] = { estado: 'ok', consultado_en: consultadoEn };
      }
    });
    const resultados: ResultadoHerramienta[] = plan.herramientas.map(({ tool, parametros }) => ejecutar(tool, parametros, { role, data }));
    const avisos: string[] = [];
    if (plan.denegadas.length) avisos.push(MENSAJES.sin_permiso + ' Se respondió solo la parte permitida.');
    if (list.some(section => estados[section]?.estado !== 'ok')) avisos.push('Algunas áreas no se pudieron consultar; las cifras pueden estar incompletas.');

    const fuentes = list.map(section => ({ seccion: section, tablas: SECTION_SOURCES[section], estado: estados[section]?.estado, consultado_en: consultadoEn, ventana: windowOf(section, window) }));

    if (resultados.every(result => result.estado !== 'ok')) {
      return { ...envelope, estado: 'sin_datos' as const, respuesta: { texto: MENSAJES.sin_datos, origen: 'sistema' as const }, datos: resultados, fuentes, avisos, sugerencias: [] as string[] };
    }

    // Paso 3: el modelo redacta con marcadores; el servidor pone las cifras y comprueba que cada una acompañe a SU indicador.
    // Si la IA falla o su texto no se puede validar, ya hay datos fiables: se entrega un resumen determinista, identificado como tal.
    const forModel: DatosParaRedactar = { fecha: window.fecha, zona: window.zona, pregunta, resultados, avisos };
    const answered = await this.ai.ask(answerInstructions(), answerInput(forModel), { maxTokens: 400, timeoutMs: ANSWER_TIMEOUT_MS });
    let motivoResumen: keyof typeof AVISO_RESUMEN = 'ia_no_disponible';
    if (answered.ok) {
      const veredicto = validarRedaccion(answered.texto, indicadoresDe(resultados));
      if (veredicto.valida === false) {
        this.logger.warn(`Asistente: redacción del modelo descartada (${veredicto.motivo}).`); // solo el motivo: nunca el texto
        motivoResumen = 'redaccion_no_validada';
      } else {
        return {
          ...envelope, estado: 'respondida' as const,
          respuesta: { texto: veredicto.texto, origen: 'ia' as const, modelo: answered.modelo, validacion: 'cifras_verificadas' as const },
          datos: resultados, fuentes, avisos, sugerencias: [] as string[],
        };
      }
    }
    return {
      ...envelope, estado: 'respondida' as const,
      respuesta: { texto: resumenDeDatos(resultados), origen: 'sistema' as const, validacion: 'resumen_de_datos' as const },
      datos: resultados, fuentes, avisos: [...avisos, AVISO_RESUMEN[motivoResumen]], sugerencias: [] as string[],
    };
  }

  private unavailable(motivo: IaFailure): HttpException {
    return new HttpException({ ok: false, codigo: 'ia_no_disponible', motivo, mensaje: IA_MESSAGES[motivo] }, HttpStatus.SERVICE_UNAVAILABLE);
  }
}
