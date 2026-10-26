import { Link } from 'react-router-dom';
import PanelIcon from './PanelIcon';

// Avisos de la navegación por permisos (E3.4.3). Sustituyen a la sección: el componente de una sección sin permiso no se monta y,
// por tanto, no hace ninguna solicitud. No redirigen solos: quien llegó por un enlace directo ve por qué no puede entrar.
// La cuenta sin rol ya no ve un aviso bloqueante: tiene su espacio básico (PanelBasicHome). Aquí solo quedan los avisos puntuales.
type Kind = 'denegado' | 'sin-secciones';
const TEXT: Record<Kind, { kicker: string; title: string; body: string }> = {
  denegado: { kicker: 'PERMISOS ADICIONALES', title: 'Esta sección requiere permisos adicionales', body: 'Tu cuenta puede iniciar sesión y usar su espacio básico, pero no tiene permiso para abrir esta parte del panel. Si la necesitas, solicítala a la gerencia.' },
  'sin-secciones': { kicker: 'SIN SECCIONES', title: 'Tu cuenta no tiene secciones disponibles', body: 'Ninguna sección del panel está habilitada para tu cuenta. Puedes cambiar tu contraseña en Mi cuenta o cerrar sesión; si necesitas acceso, consúltalo con la gerencia.' },
};

// Sección que la cuenta puede consultar pero no modificar (o una dirección que pide una operación sin permiso, como ?crear=1).
export function PanelReadOnlyNotice({ children }: { children: string }) {
  return <p className="hp-notice" role="status" data-panel-readonly><PanelIcon name="lock" size={16} /> {children}</p>;
}

export default function PanelAccessNotice({ kind, homeTarget, hasHome }: { kind: Kind; homeTarget: string; hasHome: boolean }) {
  const text = TEXT[kind];
  return <>
    <div className="hp-heading"><div><p className="hp-kicker">{text.kicker}</p><h1>{text.title}</h1></div></div>
    <section className="hp-card" data-panel-access={kind}><div className="hp-empty">
      <span className="hp-empty-icon"><PanelIcon name="lock" size={28} /></span>
      <p>{text.body}</p>
      {kind === 'denegado' && hasHome
        ? <Link className="hp-btn hp-btn-primary" to={homeTarget}>Ir a mi inicio</Link>
        : <Link className="hp-btn" to={kind === 'denegado' ? '/admin/dashboard' : '/admin/dashboard?section=configuracion'}>{kind === 'denegado' ? 'Volver a mi espacio' : 'Ir a Mi cuenta'}</Link>}
    </div></section>
  </>;
}
