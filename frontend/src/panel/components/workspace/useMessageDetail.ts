import { useEffect, useState } from 'react';
import { useLatest } from '../../hooks/useLatest';
import { PanelApiError, panelRequest } from '../../services/panelApi';
import type { Row } from '../../types/workspace';

// Detalle de una consulta INDEPENDIENTE del listado paginado: la consulta abierta (?id=) no depende de que aparezca en la página, la búsqueda
// o el filtro actuales. Fuentes, de más a menos directa:
//  1. la lista, cuando la contiene (sin petición extra);
//  2. la última versión conocida (la que ya se vio en la lista o se pidió por id), aunque la lista cambie o falle;
//  3. GET /admin/messages/:id, solo cuando no hay ninguna de las anteriores y la lista ya respondió (o falló).
// El estado de la petición se guarda con el id al que pertenece: una respuesta antigua no puede mostrarse sobre otra consulta.
export type DetailStatus = 'none' | 'loading' | 'ready' | 'missing' | 'error';
const DETAIL_TIMEOUT_MS = 15_000;

export function useMessageDetail(id: number, token: string | null, rows: Row[], listLoading: boolean) {
  const latestToken = useLatest(token);
  const inList = id > 0 ? rows.find(row => row.id === id) ?? null : null;
  const [cache, setCache] = useState<Row | null>(null);
  const [lastListed, setLastListed] = useState<Row | null>(null);
  const [failure, setFailure] = useState<{ id: number; status: 'missing' | 'error' } | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Al cambiar de consulta se olvida el fallo anterior: volver a una consulta que falló antes intenta cargarla de nuevo.
  const [trackedId, setTrackedId] = useState(id);
  if (trackedId !== id) { setTrackedId(id); setFailure(null); }
  // Cuando la lista trae una versión nueva de la consulta abierta (otra identidad de objeto) esa versión pasa a ser la conocida.
  // Un cambio local (patch) no se revierte hasta que la lista traiga datos nuevos.
  if (inList !== lastListed) { setLastListed(inList); if (inList) setCache(inList); }
  const row = cache && cache.id === id ? cache : inList;
  const needsFetch = id > 0 && !row && !listLoading;

  useEffect(() => {
    if (!needsFetch) return;
    const controller = new AbortController();
    let live = true;
    const timer = window.setTimeout(() => controller.abort(), DETAIL_TIMEOUT_MS);
    panelRequest<{ message?: Row }>('messages/' + id, latestToken.current, 'GET', undefined, controller.signal).then(response => {
      if (!live) return; // cambió la selección o llegó antes la lista: esta respuesta ya no corresponde
      if (!response.message || response.message.id !== id) throw new Error('Respuesta sin la consulta pedida.');
      setCache(response.message); setFailure(null);
    }).catch(error => {
      if (!live) return;
      // Solo un 404/410 significa "ya no existe". Un fallo de red, un 5xx o un tiempo agotado NO se confunden con una consulta eliminada.
      setFailure({ id, status: error instanceof PanelApiError && (error.status === 404 || error.status === 410) ? 'missing' : 'error' });
    }).finally(() => window.clearTimeout(timer));
    return () => { live = false; controller.abort(); window.clearTimeout(timer); };
  }, [id, needsFetch, attempt, latestToken]);

  const status: DetailStatus = id <= 0 ? 'none' : row ? 'ready' : failure?.id === id ? failure.status : 'loading';
  return {
    row, status,
    // Actualiza la copia local tras un cambio confirmado (p. ej. el estado) sin esperar al listado ni volver a pedirla.
    patch: (changes: Partial<Row>) => setCache(current => current && current.id === id ? { ...current, ...changes } : current),
    retry: () => { setFailure(null); setAttempt(value => value + 1); },
  };
}
