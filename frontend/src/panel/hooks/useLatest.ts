import { useLayoutEffect, useRef } from 'react';

// Último valor de una variable sin que sus cambios reinicien efectos. Se usa para el token: si la misma cuenta recibe un token
// nuevo, las pantallas con formularios no deben volver a cargar sus datos ni pisar lo que se está escribiendo.
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => { ref.current = value; }, [value]);
  return ref;
}
