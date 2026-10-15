import { Link } from 'react-router-dom';
import PanelIcon from './PanelIcon';

// Avisos de la navegación por permisos (E3.4.3). Sustituyen a la sección: el componente de una sección sin permiso no se monta y,
// por tanto, no hace ninguna solicitud. No redirigen solos: quien llegó por un enlace directo ve por qué no puede entrar.
type Kind = 'denegado' | 'sin-rol' | 'sin-secciones';
const TEXT: Record<Kind, { kicker: string; title: string; body: string }> = {
  denegado: { kicker: 'ACCESO NO AUTORIZADO', title: 'No tienes acceso a esta sección', body: 'Tu cuenta no tiene permiso para abrir esta parte del panel. Si necesitas usarla, consúltalo con la gerencia.' },
  'sin-rol': { kicker: 'CUENTA SIN ROL', title: 'Tu cuenta todavía no tiene un rol asignado', body: 'Mientras la gerencia no te asigne un rol no podrás usar las secciones de trabajo. Puedes cambiar tu contraseña en Ajustes o cerrar sesión.' },
  'sin-secciones': { kicker: 'SIN SECCIONES', title: 'Tu cuenta no tiene secciones disponibles', body: 'Ninguna sección del panel está habilitada para tu cuenta. Puedes cambiar tu contraseña en Ajustes o cerrar sesión; si necesitas acceso, consúltalo con la gerencia.' },
};

export default function PanelAccessNotice({ kind, homeTarget, hasHome }: { kind: Kind; homeTarget: string; hasHome: boolean }) {
  const text = TEXT[kind];
  return <>
    <div className="hp-heading"><div><p className="hp-kicker">{text.kicker}</p><h1>{text.title}</h1></div></div>
    <section className="hp-card" data-panel-access={kind}><div className="hp-empty">
      <span className="hp-empty-icon"><PanelIcon name="lock" size={28} /></span>
      <p>{text.body}</p>
      {kind === 'denegado' && hasHome
        ? <Link className="hp-btn hp-btn-primary" to={homeTarget}>Ir a mi inicio</Link>
        : <Link className="hp-btn" to="/admin/dashboard?section=configuracion">Ir a Ajustes</Link>}
    </div></section>
  </>;
}
