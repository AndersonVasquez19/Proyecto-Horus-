import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { datosParaModelo, indicadoresDe, instruccionesDeExplicacion, resultadoDePendientes, validarRedaccion } from './asistente.fidelidad';
import type { Pendiente } from './asistente.rules';

// Explicación OPCIONAL del resumen en lenguaje sencillo. Reutiliza la misma API de OpenAI y la misma clave que el chatbot público, pero:
//  - NO tiene acceso a Prisma, MySQL ni a ningún servicio: recibe únicamente lo que las reglas ya calcularon (marcador, título fijo sin la cantidad
//    y severidad). Nunca nombres, correos, teléfonos, DNI, mensajes ni texto escrito por visitantes o estudiantes. Tampoco recibe los valores.
//  - No ejecuta ni propone acciones; solo redacta. Escribe marcadores {{pendientes.<id>}} y el SERVIDOR pone la cifra real; la redacción se descarta si
//    trae cifras propias, un marcador desconocido o una cifra junto al concepto de otro pendiente (fidelidad, igual que las consultas v2.1).
//  - Si falla, está apagada o responde algo que no se puede comprobar, el resumen se entrega igual con el texto básico (nunca un error para el usuario).
export type ExplanationResult =
  | { estado: 'generada'; texto: string; modelo: string; validacion: 'cifras_verificadas' }
  | { estado: 'no_configurada' | 'no_disponible' | 'ocupada'; motivo: string };

const MAX_CONCURRENT = 2;
const TIMEOUT_MS = 12_000;

export type AskResult = { ok: true; texto: string; modelo: string } | { ok: false; estado: 'no_configurada' | 'ocupada' | 'no_disponible' };

export type Fetcher = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

@Injectable()
export class AsistenteExplainer {
  private readonly logger = new Logger(AsistenteExplainer.name);
  private active = 0;
  // Sustituible en las pruebas: ninguna prueba contacta con OpenAI.
  fetcher: Fetcher = (url, init) => fetch(url, init);

  constructor(private readonly config: ConfigService) {}

  async explain(fecha: string, zona: string, pendientes: readonly Pendiente[]): Promise<ExplanationResult> {
    const settings = this.settings();
    if (!settings) return { estado: 'no_configurada', motivo: 'La explicación con IA no está activada en este entorno.' };
    if (!pendientes.length) return { estado: 'no_disponible', motivo: 'No hay pendientes que explicar.' };
    if (this.active >= MAX_CONCURRENT) return { estado: 'ocupada', motivo: 'El servicio de explicación está ocupado. Intenta de nuevo en unos segundos.' };
    const resultado = resultadoDePendientes(pendientes);
    const indicadores = indicadoresDe([resultado]);
    if (!indicadores.length) return { estado: 'no_disponible', motivo: 'No hay pendientes que explicar.' };
    this.active++;
    try {
      // El modelo recibe marcador + etiqueta (SIN la cantidad) y redacta con marcadores; el servidor pone las cifras y comprueba que cada una
      // acompañe a SU pendiente (mismo mecanismo que las consultas v2.1, asistente.fidelidad.ts). Nada de lo que escribe el modelo llega al usuario sin pasar por ahí.
      const text = await this.send(settings, instruccionesDeExplicacion(), JSON.stringify({ zona_horaria: zona, DATOS: datosParaModelo([resultado]) }), 500, TIMEOUT_MS);
      const veredicto = validarRedaccion(text, indicadores);
      if (veredicto.valida === false) {
        this.logger.warn(`Asistente: explicación del modelo descartada (${veredicto.motivo}).`); // solo el motivo: nunca el texto
        return { estado: 'no_disponible', motivo: 'No se pudo comprobar la explicación con IA contra los datos. Se muestra el resumen básico.' };
      }
      return { estado: 'generada', texto: veredicto.texto, modelo: settings.model, validacion: 'cifras_verificadas' };
    } catch (error) {
      this.logFailure(error);
      return { estado: 'no_disponible', motivo: 'No se pudo generar la explicación con IA. Se muestra el resumen básico.' };
    } finally { this.active--; }
  }

  // Pregunta genérica al mismo proveedor (consultas conversacionales de HORUS Assistant v2): misma clave, mismo modelo, misma configuración,
  // mismo límite de llamadas simultáneas y mismo manejo de errores que la explicación. Nunca lanza: devuelve el motivo del fallo.
  // Recibe únicamente texto ya preparado por el servicio (sin acceso a Prisma ni a la base).
  async ask(instructions: string, input: string, options: { maxTokens: number; timeoutMs?: number }): Promise<AskResult> {
    const settings = this.settings();
    if (!settings) return { ok: false, estado: 'no_configurada' };
    if (this.active >= MAX_CONCURRENT) return { ok: false, estado: 'ocupada' };
    this.active++;
    try { return { ok: true, texto: await this.send(settings, instructions, input, options.maxTokens, options.timeoutMs ?? TIMEOUT_MS), modelo: settings.model }; }
    catch (error) { this.logFailure(error); return { ok: false, estado: 'no_disponible' }; }
    finally { this.active--; }
  }

  // ¿Está activada la IA del asistente en este entorno? (sin llamar al proveedor)
  get disponible(): boolean { return this.settings() !== null; }

  private settings(): { key: string; model: string } | null {
    const key = this.config.get<string>('OPENAI_API_KEY');
    const model = this.config.get<string>('ASISTENTE_MODEL') || this.config.get<string>('CHATBOT_MODEL');
    return this.config.get<string>('ASISTENTE_AI_ENABLED') !== 'true' || !key || !model ? null : { key, model };
  }

  private async send({ key, model }: { key: string; model: string }, instructions: string, input: string, maxTokens: number, timeoutMs: number): Promise<string> {
    const response = await this.fetcher('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({ model, store: false, max_output_tokens: maxTokens, instructions, input: [{ role: 'user', content: input }] }),
    });
    if (!response.ok) throw new Error('provider_status_' + response.status);
    const result = await response.json() as { status?: string; output?: { type: string; content?: { type: string; text?: string }[] }[] };
    const text = result.output?.filter(part => part.type === 'message').flatMap(part => part.content || []).filter(part => part.type === 'output_text')
      .map(part => part.text || '').join('\n').trim();
    if (result.status !== 'completed' || !text) throw new Error('invalid_provider_response');
    return text;
  }

  // Solo el tipo de fallo: nunca el cuerpo de la petición, la respuesta, la clave ni los datos.
  private logFailure(error: unknown) {
    this.logger.warn('Asistente: llamada a la IA no disponible (' + (error instanceof Error && /^(provider_status_\d+|invalid_provider_response)$/.test(error.message) ? error.message : error instanceof Error ? error.name : 'error') + ').');
  }
}
