import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { useAdminAuth } from '../context';
import { usePanelAccess } from '../context/usePanelAccess';
import { PANEL_ACTIONS } from '../context/panelAccess';
import { useRequestStatus } from '../hooks/useRequestStatus';
import { errorMessage, panelRequest } from '../services/panelApi';
import { notify } from '../services/notify';
import {
  ACCOUNT_ROLES, ROLE_HINTS, ROLE_LABELS, accountStatus, accountSummary, canChangeRole, filterAccounts, parseAccounts, roleChangeWarning, roleErrorMessage, roleLabel, rolePayload,
  type Account, type AccountRole, type RoleFilter, type StatusFilter,
} from '../services/accountRoles';
import PanelDialog from './PanelDialog';
import PanelIcon from './PanelIcon';

const SAVE_TIMEOUT_MS = 20_000;
// «pendiente» es la clave interna de una cuenta activa sin rol: se muestra como cuenta básica (puede usar su espacio, no administrar).
const STATUS_TEXT = { pendiente: 'Cuenta básica', activa: 'Activa', inactiva: 'Desactivada' } as const;
const STATUS_CLASS = { pendiente: 'hp-state-borrador', activa: 'hp-state-activo', inactiva: '' } as const;

// «Roles y usuarios»: listado de cuentas (GET /admin/users, cuentas:leer), asignación o retiro de rol (PUT /admin/users/:id/rol,
// cuentas:asignar_rol) y activación (PUT /admin/users/:id, cuentas:editar). Ocultar un botón no protege nada: el backend vuelve a
// comprobar el permiso, impide cambiar el propio rol, conceder más permisos que los propios y dejar el sistema sin gerente activo.
export default function PanelAccounts() {
  const { token, user } = useAdminAuth();
  const { can } = usePanelAccess();
  const mayAssign = can(PANEL_ACTIONS.asignarRol), mayEdit = can(PANEL_ACTIONS.editarCuenta);
  const [revision, setRevision] = useState(0);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const { loading, error, setLoading, setError } = useRequestStatus(String(revision));
  const [search, setSearch] = useState(''), [rol, setRol] = useState<RoleFilter>('todos'), [estado, setEstado] = useState<StatusFilter>('todas');
  const [editing, setEditing] = useState<Account | null>(null), [choice, setChoice] = useState<AccountRole | null>(null);
  const [toggling, setToggling] = useState<Account | null>(null);
  const [saving, setSaving] = useState(false), [dialogError, setDialogError] = useState(''), [uncertain, setUncertain] = useState(false);
  const locked = useRef(false); // candado síncrono: doble clic o Enter repetido no envían otra solicitud mientras hay una pendiente

  useEffect(() => {
    const controller = new AbortController(); let live = true;
    panelRequest<unknown>('users', token, 'GET', undefined, controller.signal)
      .then(result => { const parsed = parseAccounts(result); if (!parsed) throw new Error('El servidor devolvió datos con un formato inesperado.'); if (live) setAccounts(parsed); })
      .catch(err => { if (live && !controller.signal.aborted) setError(errorMessage(err)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; controller.abort(); };
  }, [token, revision, setLoading, setError]);

  const reload = () => setRevision(value => value + 1);
  const openRole = (account: Account) => { setEditing(account); setChoice(account.rol); setDialogError(''); setUncertain(false); };
  const openStatus = (account: Account) => { setToggling(account); setDialogError(''); setUncertain(false); };
  const closeDialogs = () => { if (saving) return; setEditing(null); setToggling(null); if (uncertain) reload(); };

  // Envío común: bloqueo síncrono, tiempo máximo y ningún reintento automático. El éxito solo se anuncia con la respuesta del servidor.
  const send = async (path: string, body: object, done: (mensaje: string) => void) => {
    if (locked.current) return;
    locked.current = true; setSaving(true); setDialogError('');
    const controller = new AbortController(); let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, SAVE_TIMEOUT_MS);
    try {
      const result = await panelRequest<{ mensaje?: string }>(path, token, 'PUT', body, controller.signal);
      done(result.mensaje || 'Cambio guardado.');
    } catch (err) {
      const outcome = roleErrorMessage(err, timedOut);
      setDialogError(outcome.message); setUncertain(outcome.uncertain);
    } finally { window.clearTimeout(timer); locked.current = false; setSaving(false); }
  };

  const saveRole = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing || !mayAssign || uncertain || choice === editing.rol || !canChangeRole(editing, user?.id, mayAssign)) return;
    void send('users/' + editing.id + '/rol', rolePayload(editing, choice), mensaje => { setEditing(null); notify.success(mensaje); reload(); });
  };
  const saveStatus = () => {
    if (!toggling || !mayEdit || uncertain || toggling.id === user?.id) return;
    void send('users/' + toggling.id, { activo: !toggling.activo }, mensaje => { setToggling(null); notify.success(mensaje); reload(); });
  };

  const visible = accounts ? filterAccounts(accounts, { search, rol, estado }) : [];
  const summary = accountSummary(accounts ?? []);
  const metric = (value: number) => (loading && !accounts ? '…' : error && !accounts ? '—' : String(value));
  const filtered = !!search.trim() || rol !== 'todos' || estado !== 'todas';

  return <>
    <div className="hp-heading"><div><p className="hp-kicker">ADMINISTRACIÓN</p><h1>Roles y usuarios</h1>
      <p>Cuentas del panel y su rol. Las cuentas nuevas son cuentas básicas: inician sesión y usan su espacio, y solo administran el panel cuando se les asigna un rol.</p></div>
      <button className="hp-btn" onClick={reload} disabled={loading || saving}><PanelIcon name="refresh" />Actualizar</button></div>
    {error && <p className="hp-error" role="alert">{error}</p>}
    <section className="hw-insights" aria-label="Resumen de cuentas" aria-busy={loading}>
      <article><span className="hp-badge">Cuentas</span><strong>{metric(summary.total)}</strong><span>Activas y desactivadas</span></article>
      <article><span className="hp-badge hp-state-borrador">Básicas</span><strong>{metric(summary.pendientes)}</strong><span>Activas sin rol asignado</span></article>
      <article><span className="hp-badge">Gerencia</span><strong>{metric(summary.gerentes)}</strong><span>Gerentes generales activos</span></article>
    </section>
    <section className="hp-card" data-accounts>
      <div className="hp-card-heading"><div><h2>Cuentas</h2><p role="status">{loading && !accounts ? 'Cargando…' : accounts ? visible.length + ' de ' + accounts.length + ' cuentas' : 'Datos no disponibles'}</p></div></div>
      <form className="hp-toolbar" role="search" onSubmit={event => event.preventDefault()}>
        <div className="hp-search"><PanelIcon name="search" /><input type="search" aria-label="Buscar por nombre o correo" placeholder="Buscar por nombre o correo…" maxLength={100} value={search} onChange={event => setSearch(event.target.value)} /></div>
        <select aria-label="Filtrar por rol" value={rol} onChange={event => setRol(event.target.value as RoleFilter)}>
          <option value="todos">Todos los roles</option><option value="pendientes">Cuentas básicas (sin rol)</option>
          {ACCOUNT_ROLES.map(value => <option key={value} value={value}>{ROLE_LABELS[value]}</option>)}
        </select>
        <select aria-label="Filtrar por estado" value={estado} onChange={event => setEstado(event.target.value as StatusFilter)}>
          <option value="todas">Todos los estados</option><option value="activas">Activas</option><option value="inactivas">Desactivadas</option>
        </select>
      </form>
      {loading && !accounts ? <div className="hp-empty" role="status"><span className="hp-loading" /><p>Cargando cuentas…</p></div>
        : !accounts ? <div className="hp-empty"><p>No se pudieron cargar las cuentas.</p><button className="hp-btn" onClick={reload}>Reintentar</button></div>
        : !visible.length ? <div className="hp-empty"><h3>{filtered ? 'No encontramos coincidencias' : 'No hay cuentas'}</h3><p>{filtered ? 'Prueba con otra búsqueda o filtro.' : 'Las cuentas creadas aparecerán aquí.'}</p></div>
        : <div className="hp-table-wrap" aria-busy={loading}><table className="hp-table hp-accounts-table"><caption className="hp-sr">Cuentas del panel con su rol y estado</caption>
          <thead><tr><th scope="col">Cuenta</th><th scope="col">Rol</th><th scope="col">Estado</th><th scope="col" className="hp-align-right">Acciones</th></tr></thead>
          <tbody>{visible.map(account => {
            const status = accountStatus(account), own = account.id === user?.id;
            return <tr key={account.id} data-account-status={status}>
              <td role="rowheader"><div className="hp-record"><div><strong>{account.nombre}{own && <span className="hp-count">Tu cuenta</span>}</strong><small>{account.email}</small></div></div></td>
              <td><span className={'hp-badge' + (account.rol ? '' : ' hp-state-borrador')}>{roleLabel(account.rol)}</span></td>
              <td><span className={'hp-badge ' + STATUS_CLASS[status]}>{STATUS_TEXT[status]}</span></td>
              <td className="hp-align-right"><div className="hp-row-actions">
                {canChangeRole(account, user?.id, mayAssign) && <button className="hp-btn" onClick={() => openRole(account)} disabled={saving} aria-label={'Cambiar el rol de ' + account.nombre}><PanelIcon name="shield" size={16} />{account.rol ? 'Cambiar rol' : 'Asignar rol'}</button>}
                {mayEdit && !own && <button className="hp-btn" onClick={() => openStatus(account)} disabled={saving} aria-label={(account.activo ? 'Desactivar ' : 'Activar ') + account.nombre}>{account.activo ? 'Desactivar' : 'Activar'}</button>}
              </div></td>
            </tr>;
          })}</tbody></table></div>}
    </section>

    {editing && <PanelDialog title={editing.rol ? 'Cambiar rol' : 'Asignar rol'} busy={saving} onClose={closeDialogs}>
      <form className="hp-role-form" onSubmit={saveRole} aria-busy={saving}>
        <p className="hp-role-target"><strong>{editing.nombre}</strong><small>{editing.email}</small><span>Rol actual: {roleLabel(editing.rol)}</span></p>
        <fieldset disabled={saving || uncertain}><legend>Nuevo rol</legend>
          {[...ACCOUNT_ROLES, null].map(value => <label key={value ?? 'ninguno'} className={'hp-role-option' + (choice === value ? ' is-selected' : '')}>
            <input type="radio" name="rol" checked={choice === value} onChange={() => { setChoice(value); setDialogError(''); }} />
            <span><strong>{value ? ROLE_LABELS[value] : 'Sin rol (cuenta básica)'}</strong><small>{value ? ROLE_HINTS[value] : 'Inicia sesión y usa su espacio, sin funciones administrativas.'}</small></span>
          </label>)}
        </fieldset>
        {choice !== editing.rol && <p className="hp-notice" role="status" data-role-warning><PanelIcon name="lock" size={16} /> {roleChangeWarning(editing, choice)} La cuenta deberá iniciar sesión de nuevo.</p>}
        {dialogError && <p className="hp-error" role="alert">{dialogError}</p>}
        <footer className="hp-dialog-footer">
          {uncertain ? <button type="button" className="hp-btn hp-btn-primary" onClick={closeDialogs}>Actualizar la lista</button> : <>
            <button type="button" className="hp-btn" onClick={closeDialogs} disabled={saving} data-autofocus>Cancelar</button>
            <button type="submit" className="hp-btn hp-btn-primary" disabled={saving || choice === editing.rol}>{saving ? 'Guardando…' : 'Confirmar cambio'}</button></>}
        </footer>
      </form>
    </PanelDialog>}

    {toggling && <PanelDialog title={toggling.activo ? 'Desactivar cuenta' : 'Activar cuenta'} busy={saving} onClose={closeDialogs}
      footer={uncertain ? <button type="button" className="hp-btn hp-btn-primary" onClick={closeDialogs}>Actualizar la lista</button> : <>
        <button type="button" className="hp-btn" onClick={closeDialogs} disabled={saving} data-autofocus>Cancelar</button>
        <button type="button" className="hp-btn hp-btn-primary" onClick={saveStatus} disabled={saving}>{saving ? 'Guardando…' : toggling.activo ? 'Desactivar' : 'Activar'}</button></>}>
      <div className="hp-role-form">
        <p className="hp-role-target"><strong>{toggling.nombre}</strong><small>{toggling.email}</small><span>Rol actual: {roleLabel(toggling.rol)}</span></p>
        <p className="hp-notice" role="status"><PanelIcon name="lock" size={16} /> {toggling.activo ? 'Se cerrarán sus sesiones y perderá su rol. Si se reactiva, será una cuenta básica sin funciones administrativas.' : 'Se activará sin rol, como cuenta básica: podrá iniciar sesión, pero no administrar el panel hasta que se le asigne uno.'}</p>
        {dialogError && <p className="hp-error" role="alert">{dialogError}</p>}
      </div>
    </PanelDialog>}
  </>;
}
