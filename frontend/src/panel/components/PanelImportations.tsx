import { useEffect, useRef, useState } from 'react';
import { useAdminAuth } from '../context';
import { usePanelAccess } from '../context/usePanelAccess';
import { useUnsavedChangesControl } from '../unsaved/unsavedContext';
import { errorMessage, panelRequest } from '../services/panelApi';
import { IMPORT_FIELDS, importOperationId, validateImportFile, type ImportField, type ImportFile, type ImportInput, type ImportInspection, type ImportMapping, type ImportPreview, type ImportResult } from '../services/importations';
import { seatLabel, unavailableEdition, type SeatEdition } from '../services/enrollments';
import AcademicSelect from './AcademicSelect';
import PanelDialog from './PanelDialog';
import './importations.css';

export default function PanelImportations() {
  const { token } = useAdminAuth(), { can } = usePanelAccess();
  const [file, setFile] = useState<ImportFile | null>(null), [inspection, setInspection] = useState<ImportInspection | null>(null);
  const [edition, setEdition] = useState<SeatEdition | null>(null), [mapping, setMapping] = useState<ImportMapping>({});
  const [header, setHeader] = useState(1), [encoding, setEncoding] = useState('auto');
  const [preview, setPreview] = useState<ImportPreview | null>(null), [previewInput, setPreviewInput] = useState<ImportInput | null>(null), [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [dialog, setDialog] = useState(false), [consent, setConsent] = useState(false), [uncertain, setUncertain] = useState('');
  const mounted = useRef(true), locked = useRef(false), request = useRef<AbortController | null>(null);
  const { clear } = useUnsavedChangesControl(!!file && !result, 'la importación académica');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);
  const invalidate = () => { setPreview(null); setPreviewInput(null); setConsent(false); setResult(null); setUncertain(''); setError(''); };
  const run = async (operation: (signal: AbortSignal) => Promise<void>) => {
    if (locked.current) return; locked.current = true; setBusy(true); setError('');
    const controller = new AbortController(); request.current = controller; const timer = window.setTimeout(() => controller.abort(), 45000);
    try { await operation(controller.signal); } catch (e) { if (mounted.current) setError(controller.signal.aborted ? 'La consulta tardó demasiado. Revisa el estado antes de continuar.' : errorMessage(e)); }
    finally { window.clearTimeout(timer); locked.current = false; if (mounted.current) setBusy(false); }
  };
  const selectFile = (selected?: File) => {
    if (locked.current) return; invalidate(); setFile(null); setInspection(null); setMapping({});
    if (!selected) return;
    const problem = validateImportFile(selected); if (problem) { setError(problem); return; }
    void run(async signal => {
      const buffer = new Uint8Array(await selected.arrayBuffer());
      const input = { nombre: selected.name, mime: selected.type, contenido: btoa(String.fromCharCode(...buffer)) };
      const r = await panelRequest<ImportInspection>('importaciones/archivo', token, 'POST', input, signal);
      if (mounted.current) { setFile(input); setInspection(r); setMapping(r.mapeo); setHeader(r.encabezado); setEncoding(r.codificacion); }
    });
  };
  const analyze = () => {
    if (!file || !edition || locked.current) return;
    const input = { ...file, convocatoria_id: edition.id, encabezado: header, codificacion: encoding, mapeo: mapping };
    invalidate(); void run(async signal => {
      const r = await panelRequest<ImportPreview>('importaciones/vista-previa', token, 'POST', input, signal);
      if (mounted.current) { setPreview(r); setPreviewInput(input); }
    });
  };
  const confirm = () => {
    if (locked.current || !consent || !preview || !previewInput || !can('importaciones:aplicar') || uncertain) return;
    const operation = importOperationId(preview.comprobante);
    void run(async signal => {
      // Se bloquea antes de enviar: incluso una respuesta perdida exige consultar el resultado.
      setUncertain(operation); setDialog(false);
      const r = await panelRequest<ImportResult>('importaciones/confirmacion', token, 'POST', { ...previewInput, confirmar: true, comprobante: preview.comprobante }, signal);
      if (mounted.current) { setResult(r); setUncertain(''); setPreview(null); clear(); }
    });
  };
  const checkResult = () => { if (!uncertain) return; void run(async signal => {
    const r = await panelRequest<{ item: { id: string; importados: number; omitidos: number; rechazados: number; estudiantes_nuevos: number } }>('importaciones/resultado/' + uncertain, token, 'GET', undefined, signal);
    if (mounted.current) { setResult({ operacion: r.item.id, resumen: r.item, filas: [] }); setPreview(null); setUncertain(''); clear(); }
  }); };
  const columns = inspection?.muestra[header - 1] || inspection?.columnas || [];
  const rows = result?.filas || preview?.filas || [];
  return <section className="hi-import">
    <div className="hp-heading"><div><p className="hp-kicker">GESTIÓN ACADÉMICA</p><h1>Importación académica CSV</h1><p>Importa estudiantes y matrículas a una edición existente desde una hoja exportada como CSV.</p></div></div>
    <p className="hp-notice">CSV: coma, punto y coma o tabulación · UTF-8, UTF-16LE o Windows-1252 · 48 KiB · 200 filas. XLSX pendiente de soporte seguro. No se importan notas, pagos, asistencia ni certificados.</p>
    <div className="hp-card"><h2>1. Archivo y edición</h2>
      <fieldset className="hp-form-grid" disabled={busy || !!uncertain}><legend className="hp-sr">Archivo y destino</legend>
        <label>Archivo CSV<input type="file" accept=".csv,text/csv" onChange={e => selectFile(e.target.files?.[0])} /></label>
        <AcademicSelect<SeatEdition> path="importaciones/ediciones" label="Edición de destino" value={edition} onChange={e => { invalidate(); setEdition(e); }} text={seatLabel} unavailable={unavailableEdition} disabled={busy || !!uncertain} />
      </fieldset>
    </div>
    {inspection && <div className="hp-card"><h2>2. Columnas</h2><p>Selecciona la fila de encabezados y asigna DNI, nombres y apellidos por separado. Prepara una lista que contenga solo estudiantes; excluye docentes y ponentes.</p>
      <fieldset className="hp-form-grid" disabled={busy || !!uncertain}><legend className="hp-sr">Mapeo de columnas</legend>
        <label>Fila de encabezados<select value={header} onChange={e => { invalidate(); setHeader(Number(e.target.value)); setMapping({}); }}>{inspection.muestra.map((_, i) => <option key={i} value={i + 1}>Fila {i + 1}</option>)}</select></label>
        <label>Codificación<select value={encoding} onChange={e => { invalidate(); setEncoding(e.target.value); }}><option value="utf-8">UTF-8</option><option value="utf-16le">UTF-16LE</option><option value="windows-1252">Windows-1252</option></select></label>
        {(Object.entries(IMPORT_FIELDS) as [ImportField, string][]).map(([key, label]) => <label key={key}>{label}{['doc_numero', 'nombres', 'apellidos'].includes(key) ? ' *' : ' (opcional)'}<select value={mapping[key] ?? ''} onChange={e => { invalidate(); setMapping(m => { const copy = { ...m }; if (e.target.value === '') delete copy[key]; else copy[key] = Number(e.target.value); return copy; }); }}><option value="">Sin asignar</option>{columns.map((c, i) => <option key={i} value={i}>{i + 1}. {c || '(sin título)'}</option>)}</select></label>)}
      </fieldset>
      <details><summary>Primeras filas del archivo</summary><div className="hi-scroll"><table className="hs-table"><tbody>{inspection.muestra.slice(0, 5).map((r, i) => <tr key={i}><th>Fila {i + 1}</th>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table></div></details>
      <button className="hp-btn hp-btn-primary" disabled={busy || !edition || !!uncertain} onClick={analyze}>Generar vista previa</button>
    </div>}
    {busy && <p role="status">Procesando…</p>}{error && <p className="hp-error" role="alert">{error}</p>}
    {uncertain && <div className="hp-notice" role="status"><p>El envío se realizó y el resultado debe comprobarse. No se reenviará automáticamente. Operación: {uncertain}</p><button className="hp-btn" disabled={busy} onClick={checkResult}>Consultar resultado</button><button className="hp-btn" disabled={busy} onClick={() => { invalidate(); }}>Volver a generar vista previa</button></div>}
    {preview && <div className="hp-card"><h2>3. Vista previa</h2><p><strong>{preview.destino.curso} · {preview.destino.nombre}</strong> · Cupos disponibles: {preview.destino.disponibles ?? 'sin definir'}</p><p>{preview.resumen.importados} aceptables · {preview.resumen.estudiantes_nuevos} estudiantes nuevos · {preview.resumen.omitidos} omitidos · {preview.resumen.rechazados} rechazados</p>
      {preview.bloqueos.map(b => <p className="hp-error" key={b}>{b}</p>)}
      <p>La vista previa no guarda datos. Las filas omitidas o rechazadas no se importarán.</p>
      {can('importaciones:aplicar') ? <button className="hp-btn hp-btn-primary" disabled={busy || !!uncertain || !!preview.bloqueos.length} onClick={() => { setConsent(false); setDialog(true); }}>Revisar y confirmar importación</button> : <p className="hp-notice">Tu permiso permite previsualizar. Solo Gerencia puede aplicar la importación.</p>}
    </div>}
    {result && <div className="hp-card" role="status"><h2>Importación confirmada</h2><p>Operación {result.operacion}</p><p>{result.resumen.importados} importados · {result.resumen.estudiantes_nuevos} estudiantes nuevos · {result.resumen.omitidos} omitidos · {result.resumen.rechazados} rechazados</p><p>Las matrículas tienen su historial con el actor y el identificador de esta operación.</p></div>}
    {!!rows.length && <div className="hp-card hi-scroll" tabIndex={0} aria-label="Resultados por fila"><table className="hs-table"><thead><tr><th>Fila</th><th>DNI</th><th>Estudiante</th><th>Resultado</th><th>Errores y advertencias</th></tr></thead><tbody>{rows.map(r => <tr key={r.fila}><td>{r.fila}</td><td>{r.datos?.doc_numero || '—'}</td><td>{r.datos ? r.datos.apellidos + ', ' + r.datos.nombres : '—'}</td><td>{r.estado}</td><td>{[...r.errores, ...r.avisos].join(' · ') || 'Sin observaciones'}</td></tr>)}</tbody></table></div>}
    {dialog && preview && <PanelDialog title="Confirmar importación académica" busy={busy} onClose={() => setDialog(false)} lockScroll><p>{preview.resumen.importados} matrículas en {preview.destino.curso} · {preview.destino.nombre}. Se crearán {preview.resumen.estudiantes_nuevos} estudiantes. Se omitirán {preview.resumen.omitidos} filas y se rechazarán {preview.resumen.rechazados}.</p><p>Se conservarán los estudiantes existentes. Las matrículas anuladas no se reactivan. Un conflicto revierte todo el lote.</p><label className="hi-consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />Revisé las filas, excluí docentes y ponentes y autorizo importar únicamente los estudiantes aceptables.</label><div className="hp-dialog-footer"><button className="hp-btn" onClick={() => setDialog(false)}>Cancelar</button><button className="hp-btn hp-btn-primary" disabled={!consent || busy} onClick={confirm}>Confirmar y guardar</button></div></PanelDialog>}
  </section>;
}
