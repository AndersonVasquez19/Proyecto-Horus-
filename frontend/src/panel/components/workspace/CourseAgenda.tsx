import { useState } from 'react';
import type { Row } from '../../types/workspace';
import { label } from '../../types/workspace';
import { useCollection, dateLabel } from './useCollection';
import PanelIcon from '../PanelIcon';

export default function CourseAgenda({ revision, tipo, onOpen, readOnly = false }: { revision: number; tipo?: string; onOpen: (row: Row) => void; readOnly?: boolean }) {
  const [period, setPeriod] = useState('upcoming');
  const [state, setState] = useState('');
  const [page,setPage]=useState(1);
  const q=new URLSearchParams({page:String(page),limit:'20',periodo:period,...(tipo?{tipo}:{}),...(state?{estado:state}:{})});
  const {rows,loading,error,pages,metrics:counts}=useCollection('cursos',true,revision,String(q));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = (row: Row) => row.fecha_inicio ? new Date(String(row.fecha_inicio).slice(0, 10) + 'T00:00:00').getTime() : NaN;
  const current = rows.filter(row => row.estado !== 'archivado');
  const visible = current.filter(row => (!state || row.estado === state) && (period === 'unscheduled' ? !Number.isFinite(day(row)) : period === 'past' ? day(row) < today.getTime() : day(row) >= today.getTime()))
    .sort((a, b) => (day(a) || 0) - (day(b) || 0));
  if (loading) return <div className="hp-empty" role="status">Cargando agenda…</div>;
  if (error) return <p className="hp-error" role="alert">{error} Usa Actualizar para volver a consultar.</p>;
  return <div className="hw-agenda">
    <div className="hw-insights"><article><PanelIcon name="calendar" /><strong>{counts.upcoming||0}</strong><span>Inicios próximos</span></article><article><PanelIcon name="help" /><strong>{counts.unscheduled||0}</strong><span>Por programar</span></article><article><PanelIcon name="book" /><strong>{counts.total||0}</strong><span>Cursos sin archivar</span></article></div>
    <div className="hw-agenda-toolbar"><div className="hw-tabs" aria-label="Periodo de agenda">{[['upcoming', 'Próximos'], ['unscheduled', 'Sin fecha'], ['past', 'Fechas pasadas']].map(([value, name]) => <button key={value} aria-pressed={period === value} onClick={() => {setPage(1);setPeriod(value)}}>{name}</button>)}</div>
      <label className="hw-select">Publicación<select value={state} onChange={e => {setPage(1);setState(e.target.value)}}><option value="">Todos</option><option value="publicado">Publicados</option><option value="borrador">Borradores</option></select></label></div>
    <p className="hw-caption">{tipo ? 'Fechas de esta sección.' : 'Fechas del catálogo completo.'} No incluyen cupos, inscripciones ni confirmación de apertura.</p>
    {visible.length ? <div className="hw-timeline">{visible.map(row => <button key={row.id} onClick={() => onOpen(row)}><span className="hw-date-tile"><PanelIcon name="calendar" size={21} /><small>{dateLabel(row.fecha_inicio, true)}</small></span>
      <span className="hw-timeline-info"><strong>{String(row.titulo)}</strong><small>{label(row.modalidad)} · {String(row.duracion || '')}</small></span><span className={'hp-badge hp-state-' + row.estado}>{label(row.estado)}</span><PanelIcon name={readOnly ? "eye" : "edit"} size={16} /></button>)}</div> : <div className="hp-empty hp-empty-compact"><PanelIcon name="calendar" size={30} /><h3>No hay cursos en esta vista</h3><p>Revisa otro periodo o asigna una fecha desde la ficha del curso.</p></div>}
  <footer className="hp-pagination"><button className="hp-btn" disabled={page===1} onClick={()=>setPage(v=>v-1)}>Anterior</button><span>Página {page}</span><button className="hp-btn" disabled={page>=pages} onClick={()=>setPage(v=>v+1)}>Siguiente</button></footer></div>;
}
