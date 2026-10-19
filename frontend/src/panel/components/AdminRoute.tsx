import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAdminAuth } from '../context';
import { safeAdminReturn } from '../context/returnPath';
import UnsavedChangesProvider from '../unsaved/UnsavedChangesProvider';
import RouteLoading from '../../components/RouteLoading';
import PanelToaster from './PanelToaster';
export default function AdminRoute() {
  const { isAuthenticated, checking, sessionError, retrySession, logout, user, endReason } = useAdminAuth();
  const location = useLocation();
  if (checking) return <RouteLoading label="Cargando panel…" />;
  if (sessionError) return <main className="hp-empty"><p role="alert">{sessionError}</p><button className="hp-btn" onClick={retrySession}>Reintentar</button><button className="hp-btn" onClick={logout}>Volver al login</button></main>;
  if (!isAuthenticated) {
    // Una sesión que el servidor invalidó (o una visita sin sesión) vuelve a la misma sección tras iniciar sesión; un cierre voluntario no.
    // Solo viaja una ruta interna validada (sin tokens ni destinos externos). Este redireccionamiento es forzoso: no pasa por el aviso de cambios sin guardar.
    const from = endReason === 'logout' ? null : safeAdminReturn(location.pathname + location.search);
    return <Navigate to="/admin/login" replace state={{ from, expired: endReason === 'expired' }} />;
  }
  // `key`: si la identidad cambia, el panel se vuelve a montar y no conserva formularios ni datos de la cuenta anterior.
  return <UnsavedChangesProvider key={user?.id}><PanelToaster /><Outlet /></UnsavedChangesProvider>;
}
