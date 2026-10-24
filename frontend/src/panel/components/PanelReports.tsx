import { useEffect, useRef, useState } from 'react';
import { useAdminAuth } from '../context';
import { usePanelAccess } from '../context/usePanelAccess';
import { PANEL_ACTIONS } from '../context/panelAccess';
import { useRequestStatus } from '../hooks/useRequestStatus';
import { errorMessage, panelRequest } from '../services/panelApi';
import { downloadReport, saveBlob } from '../services/reportDownload';
import { notify } from '../services/notify';
import { EMPTY_FILTERS, FILTER_LABELS, FILTER_OPTIONS, REPORT_FORMATS, STATE_LABELS, alignRight, exportQuery, filterErrors, formatCell, formatSummary, parseCatalog, parseReportPage, reportQuery, sameFilters, type ReportCatalog, type ReportEntry, type ReportFilters, type ReportFormat, type ReportPage } from '../services/reports';
import type { SeatEdition } from '../services/enrollments';
import AcademicSelect from './AcademicSelect';
import EditionCourseSelect from './EditionCourseSelect';
import PanelIcon from './PanelIcon';

const PAGE_SIZE = 20;
const GROUPS: [ReportEntry['ambito'], string][] = [['academico', 'Académicos'], ['comercial', 'Comerciales y de atención']];

export default function PanelReports() {
  const { token } = useAdminAuth(); const { can } = usePanelAccess();
  const [refresh, setRefresh] = useState(0);
  const catalogKey = JSON.stringify([token, refresh]);
  const { loading, error, setError, setLoading } = useRequestStatus(catalogKey);
  const [catalog, setCatalog] = useState<{ key: string; value: ReportCatalog } | null>(null);
  const [selected, setSelected] = useState(''), [filters, setFilters] = useState<ReportFilters>(EMPTY_FILTERS), [edition, setEdition] = useState<SeatEdition | null>(null);
  const [separator, setSeparator] = useState<'punto_y_coma' | 'coma'>('punto_y_coma');
  const [report, setReport] = useState<{ tipo: string; filters: ReportFilters; page: ReportPage } | null>(null), [running, setRunning] = useState(false), [runError, setRunError] = useState('');
  const [downloading, setDownloading] = useState<ReportFormat | null>(null), [downloadError, setDownloadError] = useState(''), [downloaded, setDownloaded] = useState('');
  const sequence = useRef(0), runRequest = useRef<AbortController | null>(null), downloadRequest = useRef<AbortController | null>(null), downloadLock = useRef(false);
  const entries = catalog?.key === catalogKey ? catalog.value.reportes : null;
  const entry = entries?.find(item => item.tipo === selected && item.puede_consultar) ?? null;
  const errors = entry ? filterErrors(entry, filters) : {};
  const hasErrors = Object.keys(errors).length > 0;
  const limits = catalog?.value.limites.filas_exportacion;

  useEffect(() => {
    let live = true; const controller = new AbortController(); const timer = window.setTimeout(() => controller.abort(), 15000);
    panelRequest<unknown>('reportes', token, 'GET', undefined, controller.signal)
      .then(result => { const parsed = parseCatalog(result); if (!parsed) throw new Error('No se pudo interpretar el catálogo de reportes.'); if (live) setCatalog({ key: catalogKey, value: parsed }); })
      .catch(err => { if (live) setError(controller.signal.aborted ? 'La consulta tardó demasiado. Reintenta.' : errorMessage(err)); })
      .finally(() => { window.clearTimeout(timer); if (live) setLoading(false); });
    return () => { live = false; window.clearTimeout(timer); controller.abort(); };
  }, [token, catalogKey, setError, setLoading]);
  useEffect(() => () => { sequence.current++; runRequest.current?.abort(); downloadRequest.current?.abort(); }, []);

  const choose = (tipo: string) => {
    if (tipo === selected || downloadLock.current) return;
    sequence.current++; runRequest.current?.abort(); // una respuesta del reporte anterior no debe pintarse en el nuevo
    setSelected(tipo); setFilters(EMPTY_FILTERS); setEdition(null); setReport(null); setRunning(false); setRunError(''); setDownloadError(''); setDownloaded('');
  };
  const setFilter = (key: keyof ReportFilters, value: string) => setFilters(previous => ({ ...previous, [key]: value }));
  // `applied`: al paginar se reutilizan los filtros de la consulta mostrada, no los que se estén escribiendo, para que todas las páginas sean del mismo reporte.
  const run = async (page: number, applied?: ReportFilters) => {
    if (!entry || (!applied && hasErrors)) return;
    runRequest.current?.abort(); const controller = new AbortController(); runRequest.current = controller;
    const current = ++sequence.current; const used = applied ?? { ...filters }; const tipo = entry.tipo;
    setRunning(true); setRunError('');
    const timer = window.setTimeout(() => controller.abort(), 30000);
    try {
      const result = parseReportPage(await panelRequest<unknown>('reportes/' + encodeURIComponent(tipo) + '?' + reportQuery(entry, used, { page, limit: PAGE_SIZE }), token, 'GET', undefined, controller.signal));
      if (!result) throw new Error('No se pudo interpretar el reporte. Inténtalo de nuevo.');
      if (current === sequence.current) setReport({ tipo, filters: used, page: result });
    } catch (err) { if (current === sequence.current) setRunError(controller.signal.aborted ? 'La consulta tardó demasiado. Acota el período o los filtros e inténtalo de nuevo.' : errorMessage(err)); }
    finally { window.clearTimeout(timer); if (current === sequence.current) setRunning(false); }
  };
  const download = async (format: ReportFormat) => {
    if (!entry || !entry.puede_exportar || !can(PANEL_ACTIONS.exportarReporte) || downloadLock.current || hasErrors) return;
    downloadLock.current = true; setDownloading(format); setDownloadError(''); setDownloaded('');
    const controller = new AbortController(); downloadRequest.current = controller; const timer = window.setTimeout(() => controller.abort(), 60000);
    try {
      const { blob, fileName } = await downloadReport(entry.tipo, exportQuery(entry, filters, format, separator), format, token, controller.signal);
      saveBlob(blob, fileName); setDownloaded(fileName); notify.success('Descarga lista: ' + fileName);
    } catch (err) { setDownloadError(controller.signal.aborted ? 'La descarga se canceló o tardó demasiado. No se guardó ningún archivo.' : errorMessage(err)); }
    finally { window.clearTimeout(timer); downloadLock.current = false; downloadRequest.current = null; setDownloading(null); }
  };
  const stale = !!report && !!entry && report.tipo === entry.tipo && !sameFilters(report.filters, filters);
  const shown = report && entry && report.tipo === entry.tipo ? report.page : null;

  return <div className="hs-students hr-reports">
    <div className="hp-heading"><div><p className="hp-kicker">GESTIÓN ACADÉMICA</p><h1>Reportes</h1><p>Consulta indicadores y descarga los datos en CSV, Excel o PDF. Los archivos muestran las mismas cifras que la consulta.</p></div>
      <div className="hp-actions"><button className="hp-btn" disabled={loading} onClick={() => setRefresh(v => v + 1)}><PanelIcon name="refresh" />Actualizar catálogo</button></div></div>
    {error ? <section className="hp-card"><div className="hp-empty"><p className="hp-error" role="alert">{error}</p><button className="hp-btn" onClick={() => { setLoading(true); setRefresh(v => v + 1); }}>Reintentar</button></div></section>
      : loading || !entries ? <section className="hp-card" aria-busy="true"><div className="hp-empty" role="status"><span className="hp-loading" /><p>Cargando reportes…</p></div></section>
        : !entries.some(item => item.puede_consultar) ? <section className="hp-card"><div className="hp-empty"><PanelIcon name="file" size={32} /><h3>No hay reportes disponibles para tu cuenta</h3><p>Si los necesitas, consúltalo con la gerencia.</p></div></section>
          : <>
            {GROUPS.map(([scope, title]) => { const list = entries.filter(item => item.ambito === scope && item.puede_consultar); return list.length > 0 && <section key={scope} className="hp-card hr-catalog" aria-label={'Reportes ' + title.toLowerCase()}>
              <div className="hp-card-heading"><div><h2>{title}</h2></div></div>
              <ul className="hr-report-grid">{list.map(item => <li key={item.tipo}><button className={'hr-report-card' + (item.tipo === selected ? ' is-selected' : '')} aria-pressed={item.tipo === selected} onClick={() => choose(item.tipo)} disabled={!!downloading}>
                <strong>{item.titulo}</strong><span>{item.descripcion}</span>{item.datos_personales && <em>Contiene datos personales</em>}</button></li>)}</ul></section>; })}
            {entry && <section className="hp-card" aria-label={'Filtros de ' + entry.titulo}>
              <div className="hp-card-heading"><div><h2>{entry.titulo}</h2><p>{entry.descripcion}</p></div>{entry.datos_personales && <span className="hp-badge">Confidencial</span>}</div>
              <form className="hr-filters" noValidate onSubmit={e => { e.preventDefault(); void run(1); }}>
                {entry.filtros.includes('desde') && <label>Desde<input type="date" name="desde" min="1000-01-01" max="9999-12-31" value={filters.desde} onChange={e => setFilter('desde', e.target.value)} aria-invalid={!!errors.desde} aria-describedby={errors.desde ? 'report-error-desde' : undefined} />{errors.desde && <small id="report-error-desde" className="hs-field-error">{errors.desde}</small>}</label>}
                {entry.filtros.includes('hasta') && <label>Hasta<input type="date" name="hasta" min="1000-01-01" max="9999-12-31" value={filters.hasta} onChange={e => setFilter('hasta', e.target.value)} aria-invalid={!!errors.hasta} aria-describedby={errors.hasta ? 'report-error-hasta' : undefined} />{errors.hasta && <small id="report-error-hasta" className="hs-field-error">{errors.hasta}</small>}</label>}
                {entry.estados.length > 0 && entry.filtros.includes('estado') && <label>{FILTER_LABELS.estado}<select name="estado" value={filters.estado} onChange={e => setFilter('estado', e.target.value)}><option value="">Todos</option>{entry.estados.map(state => <option key={state} value={state}>{STATE_LABELS[state] ?? state}</option>)}</select></label>}
                {(['cumplimiento', 'archivo', 'agrupar', 'moneda'] as const).filter(key => entry.filtros.includes(key)).map(key => <label key={key}>{FILTER_LABELS[key]}<select name={key} value={filters[key]} onChange={e => setFilter(key, e.target.value)}><option value="">{key === 'agrupar' ? 'Predeterminado' : 'Todos'}</option>{Object.entries(FILTER_OPTIONS[key]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>)}
                {entry.filtros.includes('curso_id') && can('convocatorias:leer') && <details className="hr-picker" open={!!filters.curso_id}><summary>Curso{filters.curso_id ? ' · filtro aplicado' : ''}</summary><EditionCourseSelect value={filters.curso_id} onChange={value => setFilter('curso_id', value)} allowAll /></details>}
                {entry.filtros.includes('convocatoria_id') && can('matriculas:leer') && <details className="hr-picker" open={!!filters.convocatoria_id}><summary>Edición{filters.convocatoria_id ? ' · filtro aplicado' : ''}</summary>
                  <AcademicSelect<SeatEdition> path="matriculas/ediciones" label="Edición" value={edition} onChange={value => { setEdition(value); setFilter('convocatoria_id', value ? String(value.id) : ''); }} text={item => item.curso.titulo + ' · ' + item.nombre} /></details>}
                <div className="hr-filter-actions"><button type="submit" className="hp-btn hp-btn-primary" disabled={running || !!downloading || hasErrors}><PanelIcon name="search" />{running ? 'Consultando…' : 'Consultar'}</button>
                  <button type="button" className="hp-btn" disabled={running || !!downloading} onClick={() => { setFilters(EMPTY_FILTERS); setEdition(null); }}>Limpiar filtros</button></div>
              </form>
              {entry.puede_exportar && can(PANEL_ACTIONS.exportarReporte) && <div className="hr-export" role="group" aria-label="Descargar reporte">
                <strong>Descargar con estos filtros</strong>
                <div className="hp-actions">{(Object.keys(REPORT_FORMATS) as ReportFormat[]).map(format => <button key={format} type="button" className="hp-btn" disabled={!!downloading || running || hasErrors} onClick={() => void download(format)}><PanelIcon name="download" size={16} />{downloading === format ? 'Generando…' : REPORT_FORMATS[format]}</button>)}
                  {downloading && <button type="button" className="hp-btn" onClick={() => downloadRequest.current?.abort()}>Cancelar descarga</button>}</div>
                <label className="hr-separator">Separador del CSV<select value={separator} disabled={!!downloading} onChange={e => setSeparator(e.target.value as 'punto_y_coma' | 'coma')}><option value="punto_y_coma">Punto y coma (Excel en español)</option><option value="coma">Coma</option></select></label>
                {limits && <small>Máximo {limits.csv?.toLocaleString('es-PE')} filas en CSV y Excel, y {limits.pdf?.toLocaleString('es-PE')} en PDF. Si hay más, acota el período o los filtros.</small>}
                <p role="status" aria-live="polite" className="hr-status">{downloading ? 'Generando el archivo…' : downloaded ? 'Descarga lista: ' + downloaded : ''}</p>
                {downloadError && <p className="hp-error" role="alert">{downloadError}</p>}
              </div>}
            </section>}
            {entry && <section className="hp-card hr-result" aria-label="Resultado del reporte" aria-busy={running}>
              {runError ? <div className="hp-empty"><p className="hp-error" role="alert">{runError}</p><button className="hp-btn" onClick={() => void run(shown?.pagination.page ?? 1, shown ? report?.filters : undefined)}>Reintentar</button></div>
                : !shown ? (running ? <div className="hp-empty" role="status"><span className="hp-loading" /><p>Consultando reporte…</p></div> : <div className="hp-empty"><PanelIcon name="file" size={32} /><h3>Elige los filtros y pulsa «Consultar»</h3><p>Verás aquí el resumen y la tabla del reporte.</p></div>)
                  : <>
                    <div className="hp-card-heading"><div><h2>{shown.reporte.titulo}</h2><p>{shown.reporte.periodo.etiqueta} · generado el {shown.reporte.generado_local} (hora de Lima)</p></div>{shown.reporte.datos_personales && <span className="hp-badge">Confidencial</span>}</div>
                    {stale && <p className="hp-notice" role="status">Cambiaste los filtros. Pulsa «Consultar» para actualizar esta vista.</p>}
                    {shown.reporte.filtros.length > 0 && <p className="hr-applied">Filtros: {shown.reporte.filtros.map(item => item.etiqueta + ': ' + item.valor).join(' · ')}</p>}
                    {shown.reporte.resumen.length > 0 && <dl className="hr-summary">{shown.reporte.resumen.map(item => <div key={item.clave}><dt>{item.etiqueta}</dt><dd>{formatSummary(item)}</dd></div>)}</dl>}
                    {shown.reporte.tabla.filas.length === 0 ? <div className="hp-empty"><h3>No hay datos para estos filtros</h3><p>Prueba con otro período o quita algún filtro.</p></div>
                      : <div className="hp-table-wrap" tabIndex={0} role="region" aria-label={'Tabla: ' + shown.reporte.tabla.titulo}><table className="hp-table hr-table"><caption className="hp-sr">{shown.reporte.tabla.titulo}</caption>
                        <thead><tr>{shown.reporte.tabla.columnas.map(column => <th key={column.clave} scope="col" className={alignRight(column.tipo) ? 'hp-align-right' : undefined}>{column.titulo}</th>)}</tr></thead>
                        <tbody>{shown.reporte.tabla.filas.map((row, index) => <tr key={String(row.id ?? index) + '-' + index}>{shown.reporte.tabla.columnas.map(column => <td key={column.clave} data-label={column.titulo} className={alignRight(column.tipo) ? 'hp-align-right' : undefined}>{formatCell(row[column.clave], column.tipo)}</td>)}</tr>)}</tbody>
                        {shown.reporte.tabla.totales && <tfoot><tr>{shown.reporte.tabla.columnas.map(column => <td key={column.clave} data-label={column.titulo} className={alignRight(column.tipo) ? 'hp-align-right' : undefined}><strong>{formatCell(shown.reporte.tabla.totales![column.clave], column.tipo)}</strong></td>)}</tr></tfoot>}</table></div>}
                    <div className="hp-pagination"><span role="status">{shown.reporte.tabla.total_filas} filas · Página {shown.pagination.page} de {Math.max(1, shown.pagination.pages)}</span><div>
                      <button className="hp-btn" disabled={running || shown.pagination.page <= 1} onClick={() => void run(shown.pagination.page - 1, report?.filters)}>Anterior</button>
                      <button className="hp-btn" disabled={running || shown.pagination.page >= shown.pagination.pages} onClick={() => void run(shown.pagination.page + 1, report?.filters)}>Siguiente</button></div></div>
                    {shown.reporte.notas.length > 0 && <ul className="hr-notes" aria-label="Notas del reporte">{shown.reporte.notas.map(note => <li key={note}>{note}</li>)}</ul>}
                  </>}
            </section>}
          </>}
  </div>;
}
