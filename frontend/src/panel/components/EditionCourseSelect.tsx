import { useEffect, useState } from 'react';
import { useAdminAuth } from '../context';
import { errorMessage, panelRequest } from '../services/panelApi';
import type { EditionCourse, EditionList } from '../services/editions';

export default function EditionCourseSelect({ value, onChange, selected, disabled, error, allowAll = false }: {
  value: string; onChange: (value: string) => void; selected?: EditionCourse; disabled?: boolean; error?: string; allowAll?: boolean;
}) {
  const { token } = useAdminAuth();
  const [search, setSearch] = useState(''), [query, setQuery] = useState({ search: '', page: 1, refresh: 0 });
  const [data, setData] = useState<EditionList<EditionCourse> | null>(null), [failure, setFailure] = useState(''), [loading, setLoading] = useState(true);
  useEffect(() => {
    if (disabled) return;
    let live = true; const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15000);
    panelRequest<EditionList<EditionCourse>>('convocatorias/cursos?' + new URLSearchParams({ search: query.search, page: String(query.page), limit: '20' }), token, 'GET', undefined, controller.signal)
      .then(result => { if (!Array.isArray(result.items) || !result.pagination) throw new Error('No se pudo interpretar la lista de cursos.'); if (live) { setData(result); setFailure(''); } })
      .catch(err => { if (live) setFailure(errorMessage(err)); })
      .finally(() => { window.clearTimeout(timer); if (live) setLoading(false); });
    return () => { live = false; window.clearTimeout(timer); controller.abort(); };
  }, [token, query, disabled]);
  const load = (next: typeof query) => { setLoading(true); setQuery(next); };
  return <div className="he-course-picker">
    {!disabled && <div className="hp-actions"><input aria-label="Buscar curso asociado" type="search" maxLength={100} value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar curso…" /><button type="button" className="hp-btn" disabled={loading} onClick={() => load({ ...query, search: search.trim(), page: 1 })}>Buscar curso</button></div>}
    <label>Curso asociado<select name="curso_id" value={value} disabled={disabled || loading} aria-invalid={!!error} onChange={e => onChange(e.target.value)}>
      <option value="">{allowAll ? 'Todos los cursos' : 'Selecciona un curso'}</option>
      {selected && !data?.items.some(item => item.id === selected.id) && <option value={selected.id}>{selected.titulo}</option>}
      {value && !selected && !data?.items.some(item => String(item.id) === value) && <option value={value}>Curso #{value}</option>}
      {data?.items.map(item => <option key={item.id} value={item.id}>{item.titulo} · {item.tipo} · {item.estado}</option>)}
    </select>{error && <small className="hs-field-error">{error}</small>}</label>
    {loading && !disabled && <small role="status">Cargando cursos…</small>}
    {failure && <p role="alert" className="hp-error">{failure} <button type="button" className="hp-btn" onClick={() => load({ ...query, refresh: query.refresh + 1 })}>Reintentar cursos</button></p>}
    {!disabled && data && <div className="hp-actions"><small>{data.pagination.total} cursos · Página {query.page} de {Math.max(1, data.pagination.pages)}</small><button type="button" className="hp-btn" disabled={loading || query.page === 1} onClick={() => load({ ...query, page: query.page - 1 })}>Cursos anteriores</button><button type="button" className="hp-btn" disabled={loading || query.page >= data.pagination.pages} onClick={() => load({ ...query, page: query.page + 1 })}>Más cursos</button></div>}
  </div>;
}
