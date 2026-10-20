import { useEffect, useId, useState } from 'react';
import { useAdminAuth } from '../context';
import { useRequestStatus } from '../hooks/useRequestStatus';
import { errorMessage, panelRequest } from '../services/panelApi';
import type { EnrollmentList } from '../services/enrollments';

// Búsqueda y páginas explícitas; conserva la selección aunque quede fuera de la página consultada.
export default function AcademicSelect<T extends { id: number }>({ path, label, value, onChange, text, unavailable, disabled = false }: {
  path: string; label: string; value: T | null; onChange: (value: T | null) => void; text: (item: T) => string; unavailable?: (item: T) => boolean; disabled?: boolean;
}) {
  const { token } = useAdminAuth(); const id = useId();
  const [search, setSearch] = useState(''), [query, setQuery] = useState({ search: '', page: 1, refresh: 0 });
  const key = JSON.stringify([token, path, query]); const { loading, error, setLoading, setError } = useRequestStatus(key);
  const [data, setData] = useState<{ key: string; result: EnrollmentList<T> } | null>(null);
  const result = data?.key === key ? data.result : null;
  useEffect(() => {
    const controller = new AbortController(); let live = true; const timer = window.setTimeout(() => controller.abort(), 15000);
    const params = new URLSearchParams({ search: query.search, page: String(query.page), limit: '20' });
    panelRequest<EnrollmentList<T>>(path + (path.includes('?') ? '&' : '?') + params, token, 'GET', undefined, controller.signal)
      .then(r => { if (!Array.isArray(r.items) || !r.pagination) throw new Error('No se pudo interpretar la lista.'); if (live) setData({ key, result: r }); })
      .catch(e => { if (live) setError(controller.signal.aborted ? 'La consulta tardó demasiado. Reintenta.' : errorMessage(e)); })
      .finally(() => { window.clearTimeout(timer); if (live) setLoading(false); });
    return () => { live = false; window.clearTimeout(timer); controller.abort(); };
  }, [token, path, query, key, setError, setLoading]);
  return <div className="he-course-picker">
    <label htmlFor={id + '-search'}>Buscar {label.toLowerCase()}</label><div className="hp-actions"><input id={id + '-search'} type="search" maxLength={100} value={search} disabled={disabled} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); setQuery(q => ({ ...q, search: search.trim(), page: 1 })); } }} /><button type="button" className="hp-btn" disabled={disabled || loading} onClick={() => setQuery(q => ({ ...q, search: search.trim(), page: 1 }))}>Buscar {label.toLowerCase()}</button></div>
    <label htmlFor={id}>{label}</label><select id={id} aria-describedby={id + '-status'} value={value?.id || ''} disabled={disabled || loading || !!error} onChange={e => onChange(result?.items.find(i => i.id === Number(e.target.value)) ?? (value?.id === Number(e.target.value) ? value : null))}>
      <option value="">Selecciona una opción</option>{value && !result?.items.some(i => i.id === value.id) && <option value={value.id}>{text(value)}</option>}{result?.items.map(i => <option key={i.id} value={i.id} disabled={unavailable?.(i)}>{text(i)}</option>)}
    </select>
    <p id={id + '-status'} role="status">{loading ? 'Cargando opciones…' : result ? `${result.pagination.total} resultados · Página ${query.page} de ${Math.max(1, result.pagination.pages)}` : ''}</p>
    {error && <p className="hp-error" role="alert">{error} <button type="button" className="hp-btn" disabled={disabled} onClick={() => setQuery(q => ({ ...q, refresh: q.refresh + 1 }))}>Reintentar</button></p>}
    {result && <div className="hp-actions"><button type="button" className="hp-btn" disabled={disabled || loading || query.page <= 1} onClick={() => setQuery(q => ({ ...q, page: q.page - 1 }))}>Opciones anteriores</button><button type="button" className="hp-btn" disabled={disabled || loading || query.page >= result.pagination.pages} onClick={() => setQuery(q => ({ ...q, page: q.page + 1 }))}>Más opciones</button></div>}
  </div>;
}
