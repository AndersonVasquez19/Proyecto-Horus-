import { ForbiddenException, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { permissionsOf } from '../permissions/policy';
import { ASISTENTE_DATA, type AsistenteDataSource } from './asistente.data';
import { AsistenteExplainer, type ExplanationResult } from './asistente.explainer';
import { ASISTENTE_LIMITES, RATE_MESSAGE, type LimitesResumen } from './asistente.limites';
import {
  SECTION_SOURCES, authorizedSections, basicText, buildPendientes, type SectionData, type SectionKey,
} from './asistente.rules';
import { operatingDay } from './asistente.time';

// Mismos textos que AccessGuard (que es la única que puede usar AccountAccessService; ver test/access-guard.test.ts).
export const UNAUTHORIZED_MESSAGE = 'Usuario no encontrado o inactivo.';
export const NO_ROLE_MESSAGE = 'Esta función requiere permisos adicionales. Tu cuenta es básica: solicita a la gerencia que te asigne un rol.';
export { RATE_MESSAGE };

// Métricas que HORUS Assistant NO calcula porque el sistema no las registra (se informan como tales; no se estiman).
export const NO_REGISTRADO: readonly string[] = Object.freeze([
  'Personas únicas del chatbot: las interacciones del chatbot no guardan identidad del visitante (solo cuentan quienes dejaron sus datos en un formulario).',
  'Tiempo de primera respuesta y de resolución de consultas: el seguimiento guarda estados e historial, pero no hay una métrica definida de plazos.',
  'Asistencia y calificaciones de estudiantes: los módulos aún no existen.',
  'Pagos, comprobantes y ventas: el sistema no los registra.',
  'Visitas al sitio web: no hay analítica de tráfico en el backend.',
]);

type SectionOutcome = { estado: 'ok'; consultado_en: string } | { estado: 'no_disponible'; motivo: string } | { estado: 'error'; motivo: string };

// HORUS Assistant, versión 1: SOLO LECTURA. Lee agregados de los módulos existentes mediante consultas fijas, aplica reglas deterministas
// para identificar pendientes y, si se pide y está activado, pide a la IA que redacte lo que las reglas ya decidieron. No hay acciones
// administrativas, no hay consultas generadas por la IA y la IA no recibe acceso a la base (ver asistente.explainer.ts).
@Injectable()
export class AsistenteService {
  private readonly logger = new Logger(AsistenteService.name);
  // El límite por cuenta es COMPARTIDO entre instancias (rate_limit_buckets, ver asistente.limites.ts): 30 por 10 min y 6 con IA, que cuesta por llamada.
  constructor(
    @Inject(ASISTENTE_DATA) private readonly data: AsistenteDataSource,
    private readonly explainer: AsistenteExplainer,
    @Inject(ASISTENTE_LIMITES) private readonly limites: LimitesResumen,
  ) {}

  async resumen(actorId: number, options: { explicar?: boolean } = {}, now = new Date()) {
    const wantsAi = options.explicar === true;
    await this.limites.admitirResumen(actorId, now, wantsAi); // 429 si se excede; 503 sin tocar datos ni IA si el almacén compartido no responde

    // El rol sale de la base en esta misma solicitud (nunca del token ni del cliente).
    const account = await this.data.account(actorId);
    if (!account || !account.activo) throw new UnauthorizedException({ ok: false, mensaje: UNAUTHORIZED_MESSAGE });
    if (!account.rol) throw new ForbiddenException({ ok: false, mensaje: NO_ROLE_MESSAGE });
    const role = account.rol;

    const window = operatingDay(now);
    const sections = authorizedSections(role); // solo estas se consultan: las demás no generan ni una consulta
    const settled = await Promise.allSettled(sections.map(section => this.data.read(section, window, now)));

    const data: Partial<SectionData> = {};
    const estados: Partial<Record<SectionKey, SectionOutcome>> = {};
    const consultadoEn = now.toISOString();
    sections.forEach((section, index) => {
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

    const { items: pendientes, truncated } = buildPendientes(data, role);
    const explicacion = await this.explanation(wantsAi, window.fecha, window.zona, pendientes);

    return {
      ok: true,
      generado_en: consultadoEn,
      zona_horaria: window.zona,
      fecha_operativa: window.fecha,
      ventana_hoy: { desde_utc: window.desdeUtc.toISOString(), hasta_utc: window.hastaUtc.toISOString() },
      acceso: { rol: role, permisos_efectivos: permissionsOf(role).length, secciones_autorizadas: sections },
      resumen: {
        texto: basicText(window.fecha, pendientes, truncated),
        pendientes_total: pendientes.length,
        pendientes_truncados: truncated,
        vacio: pendientes.length === 0 && sections.every(section => estados[section]?.estado === 'ok'),
      },
      pendientes,
      indicadores_atencion: attentionIndicators(data),
      secciones: estados,
      fuentes: sections.map(section => ({
        seccion: section, tablas: SECTION_SOURCES[section], estado: estados[section]?.estado,
        consultado_en: consultadoEn, ventana: windowOf(section, window),
      })),
      explicacion,
      no_registrado: NO_REGISTRADO,
      alcance: 'solo_lectura',
    };
  }

  private async explanation(wantsAi: boolean, fecha: string, zona: string, pendientes: Parameters<AsistenteExplainer['explain']>[2]): Promise<ExplanationResult | { estado: 'no_solicitada' }> {
    if (!wantsAi) return { estado: 'no_solicitada' };
    // La explicación es opcional: nada de lo que ocurra con la IA puede impedir que el resumen determinista se entregue.
    try { return await this.explainer.explain(fecha, zona, pendientes); }
    catch (error) {
      this.logger.warn(`Asistente: la explicación con IA falló (${error instanceof Error ? error.name : 'error'}).`);
      return { estado: 'no_disponible', motivo: 'No se pudo generar la explicación con IA. Se muestra el resumen básico.' };
    }
  }
}

// Ventana temporal a la que se refieren las cifras de cada sección: «hoy» (Lima) para lo diario, «actual» para el estado vigente.
export function windowOf(section: SectionKey, window: ReturnType<typeof operatingDay>) {
  return section === 'atencion' || section === 'chatbot'
    ? { tipo: 'hoy_y_estado_actual', fecha: window.fecha, desde_utc: window.desdeUtc.toISOString(), hasta_utc: window.hastaUtc.toISOString() }
    : { tipo: 'estado_actual', fecha: window.fecha };
}

// Indicadores de atención al cliente. Se distinguen tres cosas que NO son lo mismo:
//  - consultas registradas: filas de contactos (una persona puede dejar varias);
//  - personas únicas: correos distintos entre esas consultas;
//  - mensajes del chatbot: preguntas hechas al chatbot (no tienen identidad: no se pueden convertir en personas).
function attentionIndicators(data: Partial<SectionData>) {
  const mensajes = data.atencion, chatbot = data.chatbot;
  if (!mensajes && !chatbot) return null;
  return {
    consultas_registradas: mensajes ? {
      hoy: mensajes.recibidosHoy, total: mensajes.total, pendientes: mensajes.nuevos + mensajes.enProceso, nuevas: mensajes.nuevos, en_proceso: mensajes.enProceso,
      mas_de_48_horas_sin_cerrar: mensajes.antiguos,
      definicion: 'Filas de la bandeja de Mensajes (formulario, chatbot con datos y registro manual). Una persona puede tener varias.',
      origen: 'contactos + attention_records',
    } : null,
    personas_unicas: mensajes ? {
      hoy: mensajes.personasUnicasHoy, con_pendientes: mensajes.personasPendientes,
      definicion: 'Correos distintos (sin distinguir mayúsculas) entre las consultas registradas. Si alguien usa dos correos cuenta como dos.',
      origen: 'contactos.email',
    } : null,
    chatbot: chatbot ? {
      mensajes_hoy: chatbot.interaccionesHoy, resueltos_hoy: chatbot.resueltasHoy, sin_resolver_hoy: chatbot.sinResolverHoy, con_ia_hoy: chatbot.conIaHoy,
      preguntas_sin_respuesta_vigentes: chatbot.preguntasSinRespuestaVigentes,
      consultas_con_datos_hoy: mensajes ? mensajes.recibidosHoyChatbot : null,
      personas: null,
      definicion: 'Preguntas hechas al chatbot público (sin identidad del visitante). «Consultas con datos» son las que dejaron un formulario y por eso aparecen también como consultas registradas.',
      origen: 'chatbot_interacciones + chatbot_preguntas_sin_respuesta' + (mensajes ? ' + contactos.origen' : ''),
    } : null,
  };
}
