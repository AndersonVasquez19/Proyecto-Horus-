import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useBlocker } from 'react-router-dom';
import PanelDialog from '../components/PanelDialog';
import PanelIcon from '../components/PanelIcon';
import { UnsavedChangesContext, type UnsavedChangesValue } from './unsavedContext';

// Un único aviso para todo el panel: navegación (enlaces, menú, filtros de la URL y botón Atrás) y acciones internas
// que reemplazarían un formulario con cambios (`confirmLeave`). "Seguir editando" siempre está disponible y "Descartar"
// siempre permite salir, de modo que la navegación nunca queda bloqueada de forma permanente.
// Si la sesión se invalida a la fuerza, AdminRoute desmonta este proveedor: el aviso no puede retener ese cierre.
export default function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const entries = useRef(new Map<string, string>());
  const [labels, setLabels] = useState<string[]>([]); // etiquetas de los formularios con cambios (solo texto de aviso, nunca contenido)
  const [epoch, setEpoch] = useState(0);
  const [action, setAction] = useState<(() => void) | null>(null);
  // Ir exactamente a la misma URL (p. ej. pulsar la sección en la que ya estás) no cambia la vista: no hay nada que perder ni que avisar.
  const blocker = useBlocker(useCallback(({ currentLocation, nextLocation }: { currentLocation: { pathname: string; search: string }; nextLocation: { pathname: string; search: string } }) =>
    entries.current.size > 0 && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search), []));
  const asking = action !== null || blocker.state === 'blocked';

  const register = useCallback((id: string, label: string) => { entries.current.set(id, label); setLabels([...entries.current.values()]); }, []);
  const unregister = useCallback((id: string) => { entries.current.delete(id); setLabels([...entries.current.values()]); }, []);
  const confirmLeave = useCallback((next: () => void) => {
    if (entries.current.size === 0) next(); else setAction(() => next);
  }, []);
  // `epoch` cambia el valor del contexto tras descartar: los formularios que sigan montados y modificados se vuelven a registrar.
  const value = useMemo<UnsavedChangesValue>(() => ({ register, unregister, confirmLeave }), [register, unregister, confirmLeave, epoch]); // eslint-disable-line react-hooks/exhaustive-deps

  // Recargar o cerrar la pestaña: el navegador muestra su propio aviso genérico.
  useEffect(() => {
    if (labels.length === 0) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [labels.length]);

  const keepEditing = () => { setAction(null); if (blocker.state === 'blocked') blocker.reset(); };
  const discard = () => {
    const next = action;
    entries.current.clear(); setLabels([]); setEpoch(n => n + 1); setAction(null);
    if (blocker.state === 'blocked') blocker.proceed(); else next?.();
  };

  return <UnsavedChangesContext.Provider value={value}>
    {children}
    {asking && <PanelDialog title="Cambios sin guardar" onClose={keepEditing} className="hp-unsaved-dialog">
      <div className="hp-confirm" role="alertdialog" aria-describedby="hp-unsaved-text">
        <PanelIcon name="help" size={34} />
        <h3>Tienes cambios sin guardar</h3>
        <p id="hp-unsaved-text">{labels.length ? 'Cambios pendientes en: ' + labels.join(', ') + '. ' : ''}Si continúas, se perderán.</p>
      </div>
      <div className="hp-dialog-footer">
        <button type="button" className="hp-btn hp-btn-primary" data-autofocus onClick={keepEditing}>Seguir editando</button>
        <button type="button" className="hp-btn hp-btn-danger" onClick={discard}>Descartar cambios</button>
      </div>
    </PanelDialog>}
  </UnsavedChangesContext.Provider>;
}
