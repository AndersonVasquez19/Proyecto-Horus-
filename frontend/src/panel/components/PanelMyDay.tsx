import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAdminAuth } from '../context';
import { usePanelAccess } from '../context/usePanelAccess';
import { PANEL_ACTIONS } from '../context/panelAccess';
import { PanelApiError, errorMessage, panelRequest } from '../services/panelApi';
import { ROLE_LABELS } from '../services/accountRoles';
import {
  AREA_INFO, SEVERITY_LABEL, formatLimaTime, formatOperatingDate, parseMyDay, pendingLink, queueSummary, visibleMyDay, type MyDaySummary,
} from '../services/myDay';
import PanelIcon from './PanelIcon';
import '../styles/my-day.css';

// «Mi Día» (Fase 4C-B): pendientes del día según el rol, con los conteos de GET /admin/asistente/resumen. Solo lectura: sin escrituras,
// sin explicación con IA (nunca envía `explicar`) y sin sondeo; se actualiza solo con el botón. Complementa el Resumen, no lo sustituye.
type Failure = { kind: 'error' | 'limite' | 'denegado'; message: string; retryAt?: number };
const FORMAT_ERROR = 'El servidor devolvió datos con un formato inesperado.';

export default function PanelMyDay() {
  const { token, user, access: session } = useAdminAuth();
  const access = usePanelAccess();
  const [reload, setReload] = useState(0);
  const key = JSON.stringify([token, reload]);
  // Último resumen válido de ESTE token (si cambia la sesión no se muestra el de otra cuenta).
  const [result, setResult] = useState<{ token: string; data: MyDaySummary } | null>(null);
  // Resultado de la solicitud identificada por `key`: mientras no coincide, está cargando (sin un render extra desde el efecto).
  const [outcome, setOutcome] = useState<{ key: string; failure: Failure | null } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    panelRequest<unknown>('asistente/resumen', token, 'GET', undefined, controller.signal)
      .then(data => {
        if (controller.signal.aborted) return;
        const parsed = parseMyDay(data);
        if (!parsed) { setOutcome({ key, failure: { kind: 'error', message: FORMAT_ERROR } }); return; }
        setResult({ token, data: parsed });
        setOutcome({ key, failure: null });
      })
      .catch(err => {
        if (controller.signal.aborted) return;
        const status = err instanceof PanelApiError ? err.status : 0;
        const body = err instanceof PanelApiError && err.body && typeof err.body === 'object' ? err.body as Record<string, unknown> : {};
        const seconds = typeof body.reintentar_en_segundos === 'number' && body.reintentar_en_segundos > 0 ? Math.min(Math.ceil(body.reintentar_en_segundos), 900) : 60;
        setOutcome({ key, failure: status === 429
          ? { kind: 'limite', message: 'Actualizaste Mi Día muchas veces seguidas. Podrás volver a hacerlo en ' + (seconds < 60 ? seconds + ' s' : Math.ceil(seconds / 60) + ' min') + '.', retryAt: Date.now() + seconds * 1000 }
          : status === 403 ? { kind: 'denegado', message: errorMessage(err) }
            : { kind: 'error', message: errorMessage(err) } });
      });
    return () => controller.abort(); // una respuesta tardía de una solicitud anterior nunca pisa la actual
  }, [key, token]);
  const retryAt = outcome?.key === key ? outcome.failure?.retryAt : undefined;
  useEffect(() => {
    if (!retryAt) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, retryAt - Date.now()) + 50);
    return () => window.clearTimeout(timer);
  }, [retryAt]);

  const loading = !!token && outcome?.key !== key;
  const failure = outcome?.key === key ? outcome.failure : null;
  const waiting = !!retryAt && retryAt > now;
  const data = result?.token === token ? result.data : null;
  const view = data ? visibleMyDay(data, access.can) : null;
  const name = user?.nombre?.trim().split(/\s+/)[0] ?? '';
  const role = session?.rol ? ROLE_LABELS[session.rol] : null;
  const shortcuts = [
    { show: access.canOpen('mensajes') && access.can(PANEL_ACTIONS.crearMensaje), to: '/admin/messages?crear=1', title: 'Registrar consulta', text: 'Atención presencial o telefónica.', icon: 'plus' },
    { show: access.canOpen('mensajes'), to: '/admin/messages?estado=nuevo', title: 'Consultas nuevas', text: 'Bandeja filtrada por estado «nuevo».', icon: 'mail' },
    { show: access.canOpen('preinscripciones'), to: AREA_INFO.preinscripciones.href, title: 'Preinscripciones', text: 'Validar, descartar o convertir.', icon: 'user-plus' },
    { show: access.canOpen('matriculas'), to: AREA_INFO.matriculas.href, title: 'Matrículas', text: 'Registros e historial.', icon: 'book' },
    { show: access.canOpen('ediciones'), to: AREA_INFO.ediciones.href, title: 'Ediciones', text: 'Fechas, cupos y horarios.', icon: 'calendar' },
    { show: access.canOpen('cotizaciones'), to: '/admin/dashboard?section=cotizaciones&vista=tablero', title: 'Tablero de cotizaciones', text: 'Propuestas por estado.', icon: 'file' },
  ].filter(item => item.show);
  const refresh = () => { if (!loading && !waiting) setReload(n => n + 1); };

  return <div className="hp-myday">
    <div className="hp-heading">
      <div>
        <p className="hp-kicker">CENTRO DE TRABAJO</p>
        <h1>Mi Día</h1>
        <p className="hp-myday-sub">
          <span>{name ? 'Hola, ' + name + '.' : 'Hola.'}</span>
          {role && <span className="hp-myday-role">{role}</span>}
          {data && <span>{formatOperatingDate(data.fechaOperativa)} · hora de Lima</span>}
        </p>
      </div>
      <div className="hp-myday-actions">
        <span className="hp-myday-stamp" role="status">{loading ? 'Consultando…' : data ? 'Consultado a las ' + formatLimaTime(data.generadoEn) : ''}</span>
        <button type="button" className="hp-btn" disabled={loading || waiting} onClick={refresh}><PanelIcon name="refresh" />Actualizar</button>
      </div>
    </div>

    {failure && data && <p className={'hp-myday-alert' + (failure.kind === 'limite' ? ' is-limit' : '')} role="alert">{failure.kind === 'limite' ? failure.message : 'No se pudo actualizar: ' + failure.message} Se conserva la información consultada a las {formatLimaTime(data.generadoEn).replace(/\.?$/, '.')}</p>}

    <section className="hp-myday-queue" aria-labelledby="hp-myday-queue-title" aria-busy={loading}>
      <div className="hp-myday-queue-head">
        <div><h2 id="hp-myday-queue-title">Para atender primero</h2>{view && <p>{queueSummary(view)}{data?.truncados ? ' Se muestran los más importantes.' : ''}</p>}</div>
      </div>
      {!data && loading ? <div className="hp-myday-state" role="status"><span className="hp-loading" /><p>Cargando tus pendientes…</p></div>
        : !data && failure ? <div className="hp-myday-state is-error" role="alert">
          <strong>{failure.kind === 'limite' ? 'Espera un momento' : failure.kind === 'denegado' ? 'No puedes consultar Mi Día en este momento' : 'No se pudo cargar Mi Día'}</strong>
          <p>{failure.message}</p>
          {failure.kind === 'error' && <button type="button" className="hp-btn" onClick={refresh}><PanelIcon name="refresh" />Reintentar</button>}
          <p className="hp-myday-muted">Las secciones del menú siguen disponibles.</p>
        </div>
        : view && !view.pendientes.length ? <div className="hp-myday-state is-empty"><PanelIcon name="check" size={26} /><strong>No tienes pendientes en tus áreas</strong><p>{view.areas.some(area => data?.estados[area].estado !== 'ok') ? 'Revisa abajo las áreas que no se pudieron consultar.' : 'Las áreas que tu cuenta puede consultar no tienen asuntos por revisar.'}</p></div>
          : view && <ol className="hp-myday-list">{view.pendientes.map(item => {
            const section = AREA_INFO[item.area].section, open = access.canOpen(section);
            return <li key={item.id} className={'hp-myday-item is-' + item.severidad} data-myday-pending={item.id}>
              <span className="hp-myday-count" aria-hidden="true">{item.cantidad}</span>
              <div className="hp-myday-item-text">
                <strong>{item.titulo}</strong>
                <small>{item.detalle}</small>
                <span className="hp-myday-chips"><span className={'hp-myday-chip is-' + item.severidad}>{SEVERITY_LABEL[item.severidad]}</span><span className="hp-myday-chip is-area">{AREA_INFO[item.area].title}</span>{!item.accionable && <span className="hp-myday-chip is-readonly">Solo informativo: tu cuenta no puede resolverlo</span>}</span>
              </div>
              {open && <Link className="hp-myday-go" to={pendingLink(item)}>{item.accionable ? 'Atender' : 'Ver'}<span className="hp-sr"> en {AREA_INFO[item.area].destination}: {item.titulo}</span><PanelIcon name="arrow" size={15} /></Link>}
            </li>;
          })}</ol>}
    </section>

    {view && view.areas.length > 0 && <section aria-labelledby="hp-myday-areas-title">
      <h2 id="hp-myday-areas-title" className="hp-myday-section-title">Estado de tus áreas</h2>
      <div className="hp-myday-areas">{view.areas.map(area => {
        const status = data!.estados[area], info = AREA_INFO[area], points = view.pendientes.filter(item => item.area === area).length;
        return <article key={area} className={'hp-myday-area' + (status.estado === 'ok' ? '' : ' is-unavailable')} data-myday-area={area}>
          <h3>{info.title}</h3>
          <p className="hp-myday-area-desc">{info.description}</p>
          {status.estado === 'ok' ? <dl>
            <dt>Puntos para revisar</dt><dd>{points}</dd>
            {area === 'atencion' && view.atencion && <><dt>Consultas registradas hoy</dt><dd>{view.atencion.hoy}</dd><dt>Nuevas y en proceso</dt><dd>{view.atencion.pendientes}</dd></>}
            {area === 'chatbot' && view.chatbot && <><dt>Preguntas al chatbot hoy</dt><dd>{view.chatbot.mensajesHoy}</dd></>}
          </dl> : <p className="hp-myday-unavailable"><strong aria-hidden="true">—</strong> {status.motivo}</p>}
          {access.canOpen(info.section) && <Link className="hp-myday-area-link" to={info.href}>Ir a {info.destination}<PanelIcon name="arrow" size={14} /></Link>}
        </article>;
      })}</div>
    </section>}

    {shortcuts.length > 0 && <section aria-labelledby="hp-myday-quick-title">
      <h2 id="hp-myday-quick-title" className="hp-myday-section-title">Accesos rápidos</h2>
      <div className="hp-myday-quick">{shortcuts.map(item => <Link key={item.to} to={item.to}><span className="hp-shortcut-icon"><PanelIcon name={item.icon} size={20} /></span><span><strong>{item.title}</strong><small>{item.text}</small></span></Link>)}</div>
    </section>}

    <p className="hp-myday-note">Solo lectura. Las cifras son conteos calculados por el servidor con las áreas que tu cuenta puede consultar. Tiempos de respuesta, pagos, asistencia y notas no se muestran porque el sistema no los registra.</p>
  </div>;
}
