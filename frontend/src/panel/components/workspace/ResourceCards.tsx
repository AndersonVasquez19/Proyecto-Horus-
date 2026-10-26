import { useState } from 'react';
import type { Resource, Row } from '../../types/workspace';
import { canRemove, label, removeVerb, rowState, supportsRemove } from '../../types/workspace';
import { dateLabel, plainText } from './useCollection';
import PanelIcon from '../PanelIcon';

function Picture({ src, title }: { src: string; title: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <div className="hw-image-empty"><PanelIcon name="image" size={32} /><span>Sin imagen disponible</span></div>;
  return <img src={src} alt={title} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}
export function ResourceImage({ value, title }: { value: unknown; title: string }) {
  let src = '';
  try { const url = new URL(String(value || ''), window.location.origin); if (value && ['http:', 'https:'].includes(url.protocol)) src = url.href; } catch { /* Display placeholder for invalid URLs. */ }
  return <Picture key={src} src={src} title={title} />;
}
// `allow`: operaciones que ofrece la cuenta (E3.4.3, fase 2). Sin editar, la tarjeta solo se abre en modo consulta.
export default function ResourceCards({ resource: r, rows, busy, allow, onOpen, onDuplicate, onRemove }: {
  resource: Resource; rows: Row[]; busy: boolean; allow: { edit: boolean; duplicate: boolean; remove: boolean };
  onOpen: (row: Row, view?: boolean) => void; onDuplicate: (row: Row, copiedAt: number) => void; onRemove: (row: Row) => void;
}) {
  if (r.endpoint === 'preguntas-frecuentes') return <div className="hw-faq">
    {[...new Set(rows.map(row => String(row.categoria || 'General')))].map(category => <section key={category}>
      <h3>{category}</h3>
      {rows.filter(row => String(row.categoria || 'General') === category).map(row => <details key={row.id}>
        <summary><span>{String(row.pregunta)}</span><span className={'hp-badge hp-state-' + rowState(row)}>{label(rowState(row))}</span></summary>
        <p>{plainText(row.respuesta)}</p>{(allow.edit || allow.duplicate || allow.remove) && <div className="hp-actions">
          {allow.edit && <button className="hp-btn" disabled={busy} onClick={() => onOpen(row)}>Editar respuesta</button>}
          {allow.duplicate && <button className="hp-btn" disabled={busy} onClick={() => onDuplicate(row, Date.now())}>Duplicar como borrador</button>}
          {allow.remove && <button className="hp-btn" disabled={busy || row.estado === 'archivado'} onClick={() => onRemove(row)}>Archivar</button>}
        </div>}
      </details>)}
    </section>)}
  </div>;
  return <div className={'hw-cards' + (r.endpoint === 'galeria' ? ' hw-gallery' : '')}>
    {rows.map(row => <article className="hw-resource" key={row.id}>
      <button className="hw-cover" aria-label={'Ver ' + row[r.title]} onClick={() => onOpen(row, true)} disabled={busy}>
        <ResourceImage value={row.imagen_url} title={String(row[r.title])} />
        <span className={'hp-badge hp-state-' + rowState(row)}>{label(rowState(row))}</span>
      </button>
      <div className="hw-resource-body">
        <small className="hw-eyebrow">{label(row.categoria || row.tipo || r.singular)}</small>
        <h3>{String(row[r.title])}</h3>
        <p className="hw-excerpt">{plainText(row.descripcion) || 'Añade una descripción para presentar este contenido.'}</p>
        {r.endpoint === 'cursos' && <div className="hw-facts"><span>{label(row.modalidad)||'Modalidad por confirmar'}</span><span>{String(row.duracion || 'Duración por confirmar')}</span><span>Inicio: {dateLabel(row.fecha_inicio, true)}</span></div>}
        {r.endpoint === 'servicios' && <p className="hw-completeness"><PanelIcon name={row.alcance ? 'check' : 'help'} size={14} />{row.alcance ? 'Alcance del servicio definido' : 'Falta detallar el alcance'}</p>}
        {r.endpoint === 'galeria' && <small>Orden de presentación: {String(row.orden ?? 0)}</small>}
        <footer>{allow.edit ? <button className="hp-btn" disabled={busy} onClick={() => onOpen(row)}><PanelIcon name="edit" size={15} />Editar</button>
          : <button className="hp-btn" disabled={busy} onClick={() => onOpen(row, true)}><PanelIcon name="eye" size={15} />Ver detalle</button>}
          {r.catalog && allow.duplicate && <button className="hp-icon-btn" disabled={busy} title="Duplicar como borrador" aria-label={'Duplicar ' + row[r.title]} onClick={() => onDuplicate(row, Date.now())}><PanelIcon name="copy" size={16} /></button>}
          {allow.remove && supportsRemove(r) && <button className="hp-icon-btn hp-danger" disabled={busy || !canRemove(r, row)} title={removeVerb(r)} aria-label={removeVerb(r) + ' ' + row[r.title]} onClick={() => onRemove(row)}><PanelIcon name="trash" size={16} /></button>}
        </footer>
      </div>
    </article>)}
  </div>;
}
