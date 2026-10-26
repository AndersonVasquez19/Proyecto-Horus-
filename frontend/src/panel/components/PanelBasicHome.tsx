import { Link } from 'react-router-dom';
import { useAdminAuth } from '../context';
import PanelIcon from './PanelIcon';

// Espacio básico de una cuenta autenticada sin rol administrativo (por ejemplo, recién registrada). No es un bloqueo: la persona puede
// usar su cuenta (datos de acceso y contraseña). Solo ofrece lo que el backend permite a toda sesión válida (rutas «autenticadas»);
// las funciones administrativas no se listan y siguen protegidas por AccessGuard en el servidor, no por esta pantalla.
export default function PanelBasicHome() {
  const { user } = useAdminAuth();
  const name = user?.nombre?.trim().split(/\s+/)[0] ?? '';
  return <>
    <div className="hp-heading"><div><p className="hp-kicker">MI ESPACIO</p><h1>{name ? 'Hola, ' + name : 'Bienvenido'}</h1><p>Tu cuenta está activa y lista para usar.</p></div></div>
    <section className="hp-card" data-panel-access="sin-rol"><div className="hp-empty">
      <span className="hp-empty-icon"><PanelIcon name="user" size={28} /></span>
      <p><strong>Cuenta básica.</strong> Puedes consultar tus datos de acceso y cambiar tu contraseña desde Mi cuenta.</p>
      <p>Las herramientas de administración (contenido, mensajes, cotizaciones y cuentas) requieren permisos adicionales. Si las necesitas, solicítalas a la gerencia: no hace falta que vuelvas a registrarte.</p>
      <Link className="hp-btn hp-btn-primary" to="/admin/dashboard?section=configuracion">Ir a Mi cuenta</Link>
    </div></section>
  </>;
}
