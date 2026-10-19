// Política de notificaciones del panel (Sonner). Sin importaciones: se prueba con `node --test` inyectando un motor falso.
//
// Reglas:
//  - Éxito: solo se emite DESPUÉS de que el servidor confirmó la operación. Un error HTTP nunca llega aquí como éxito.
//  - Error: el texto ya debe estar saneado (errorMessage de panelApi: un 5xx o un fallo de red nunca exponen detalles técnicos).
//  - Resultado incierto (red, timeout, 5xx, 2xx ilegible): aviso de advertencia que no caduca; nunca reintenta nada.
//  - Un mismo aviso (tipo + texto) comparte identidad: peticiones concurrentes o dobles clics lo REEMPLAZAN, no lo apilan.
//  - Un toast es efímero: no sustituye a la información indispensable (errores y conflictos siguen en línea, con sus controles)
//    ni a la protección de cambios sin guardar. Con un diálogo modal abierto el resto de la página es inerte: allí el aviso es en línea.

export type NotifyKind = 'success' | 'error' | 'warning' | 'info' | 'loading';
export type NotifyOptions = { id?: string; description?: string; duration?: number };
export type NotifyEngine = {
  show: (kind: NotifyKind, message: string, options: { id: string; description?: string; duration: number }) => unknown;
  dismiss: (id?: string) => unknown;
};

export const NOTIFY_DURATION: Record<NotifyKind, number> = { success: 4500, info: 5000, error: 9000, warning: 12000, loading: Infinity };
export const MAX_NOTIFY_LENGTH = 240;

// Texto en una sola línea, sin espacios sobrantes y con un tope de longitud (un aviso no es un informe).
export function cleanNotifyText(text: unknown): string {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  return value.length > MAX_NOTIFY_LENGTH ? value.slice(0, MAX_NOTIFY_LENGTH - 1) + '…' : value;
}

export function createNotifier(engine: NotifyEngine) {
  const emit = (kind: NotifyKind, message: string, options: NotifyOptions = {}) => {
    const text = cleanNotifyText(message);
    if (!text) return ''; // un aviso vacío no se muestra
    const id = options.id ?? kind + ':' + text;
    const description = options.description ? cleanNotifyText(options.description) : undefined;
    engine.show(kind, text, { id, description, duration: options.duration ?? NOTIFY_DURATION[kind] });
    return id;
  };
  return {
    success: (message: string, options?: NotifyOptions) => emit('success', message, options),
    error: (message: string, options?: NotifyOptions) => emit('error', message, options),
    warning: (message: string, options?: NotifyOptions) => emit('warning', message, options),
    info: (message: string, options?: NotifyOptions) => emit('info', message, options),
    // Operación en curso: se actualiza con el mismo `id` por success/error cuando termina (o se retira con dismiss).
    loading: (message: string, options: NotifyOptions & { id: string }) => emit('loading', message, options),
    // El servidor pudo haber procesado la operación: no caduca y NO implica un reintento.
    uncertain: (message: string, options?: NotifyOptions) => emit('warning', message, { ...options, duration: Infinity, id: options?.id ?? 'uncertain:' + cleanNotifyText(message) }),
    dismiss: (id?: string) => { engine.dismiss(id); },
  };
}
export type Notifier = ReturnType<typeof createNotifier>;
