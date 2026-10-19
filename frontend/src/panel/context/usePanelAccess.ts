import { useMemo } from 'react';
import { useAdminAuth } from './adminAuth';
import { panelNavigation, type PanelNavigation } from './panelAccess';

// Navegación y operaciones permitidas de la sesión actual (E3.4.3). Solo adapta la interfaz: la autorización es del backend.
export function usePanelAccess(): PanelNavigation {
  const { access } = useAdminAuth();
  return useMemo(() => panelNavigation(access), [access]);
}
