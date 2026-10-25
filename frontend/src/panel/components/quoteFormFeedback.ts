// Reutiliza la validez nativa del control; solo completa el obligatorio de texto
// con espacios, que el DTO del servidor normaliza antes de validar.
export function quoteFieldError(control: Pick<HTMLInputElement, 'required' | 'value' | 'validity' | 'validationMessage'>): string {
  if (control.required && !control.value.trim()) return 'Completa este campo obligatorio.';
  return control.validity.valid ? '' : control.validationMessage;
}

export function quoteRetryWarning(unchanged: boolean): string {
  return unchanged
    ? 'Si conservas estos datos, el reintento reutiliza la misma clave de la solicitud anterior: el servidor devuelve la cotización ya creada si existe. Revisa la lista antes de continuar.'
    : 'Los datos cambiaron desde el intento anterior. Al guardar se usará una clave nueva y, si la solicitud anterior se guardó, podrías crear otra cotización. Revisa la lista antes de continuar.';
}
