import { createContext, useContext, useId, useLayoutEffect } from 'react';

// Registro ligero de formularios con cambios sin guardar. No guarda ningún contenido: solo el hecho de que hay cambios
// y una etiqueta legible para el aviso. Nada se escribe en localStorage ni sessionStorage.
export interface UnsavedChangesValue {
  register: (id: string, label: string) => void;
  unregister: (id: string) => void;
  // Ejecuta `action` ya, o primero pide confirmación si algún formulario tiene cambios sin guardar.
  confirmLeave: (action: () => void) => void;
}
export const UnsavedChangesContext = createContext<UnsavedChangesValue | null>(null);
// Fuera del panel (o en pruebas aisladas) no hay nada que proteger y las acciones se ejecutan directamente.
const passthrough: UnsavedChangesValue = { register() {}, unregister() {}, confirmLeave: action => action() };

export function useConfirmLeave() {
  return (useContext(UnsavedChangesContext) ?? passthrough).confirmLeave;
}

// El formulario declara si tiene cambios (`dirty`) y recibe `confirmLeave` para sus propias salidas (cerrar, recargar…) y `clear`:
// tras un guardado confirmado, `clear` libera el aviso de forma SÍNCRONA, para que una navegación inmediata (p. ej. quitar un parámetro de la URL)
// no choque con un registro que el siguiente render todavía no ha retirado.
export function useUnsavedChangesControl(dirty: boolean, label: string) {
  const context = useContext(UnsavedChangesContext) ?? passthrough;
  const id = useId();
  useLayoutEffect(() => { // síncrono con el pintado: tras guardar o cerrar, el registro ya está al día cuando la persona puede actuar
    if (!dirty) return;
    context.register(id, label);
    return () => context.unregister(id);
  }, [dirty, label, id, context]);
  return { confirmLeave: context.confirmLeave, clear: () => context.unregister(id) };
}

export function useUnsavedChanges(dirty: boolean, label: string) {
  return useUnsavedChangesControl(dirty, label).confirmLeave;
}
