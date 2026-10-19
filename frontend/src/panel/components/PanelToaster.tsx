import { useEffect } from 'react';
import { Toaster } from 'sonner';
import { notify } from '../services/notify';
import '../styles/panel-toast.css';

// Único Toaster de la aplicación: se monta dentro del panel autenticado (AdminRoute). Las páginas públicas no tienen notificaciones.
// Al desmontarse (cierre de sesión, cambio de cuenta) se retiran los avisos pendientes: no deben verlos otra cuenta ni la pantalla de acceso.
export default function PanelToaster() {
  useEffect(() => () => notify.dismiss(), []);
  return <Toaster position="top-right" theme="light" closeButton visibleToasts={4} containerAriaLabel="Notificaciones"
    offset={{ top: 76, right: 16 }} mobileOffset={{ top: 72, left: 12, right: 12 }}
    toastOptions={{ classNames: { toast: 'hp-toast' }, closeButtonAriaLabel: 'Cerrar notificación' }} />;
}
