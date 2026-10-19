import { useEffect, useRef } from 'react'
import { usePublicResource } from '../../hooks/usePublicResource'
import type { ConvenioResponse } from '../../types/convenios'
import PublicImage from '../PublicImage'
import HomeConvenioGallery from './HomeConvenioGallery'

// Compare presentation only; the institution's stored content is never changed.
function identityText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim()
}

export default function HomeConvenioDetail({ id, onClose, inline = false }: { id: number; onClose: () => void; inline?: boolean }) {
  const closeButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (inline) closeButton.current?.focus({ preventScroll: true })
  }, [inline])
  const { data, loading, error, reload } = usePublicResource<ConvenioResponse>('convenios/' + id)
  const item = !loading && !error ? data?.item : null
  const short = item?.descripcion_corta.trim() || ''
  const shortIdentity = identityText(short).replace(/^convenio (?:interinstitucional )?con (?:el |la )?/, '')
  const nameIdentity = identityText(item?.nombre || '')
  const redundantShort = !!nameIdentity && [nameIdentity, nameIdentity + ' ' + identityText(item?.sigla || '')].includes(shortIdentity)
  const description = item?.descripcion_completa?.trim() || (redundantShort ? '' : short)
  return <>
    <div className="home-dialog-header">
      <button ref={closeButton} type="button" id="convClose" aria-label="Cerrar información del convenio" onClick={onClose}>
        <i className="fas fa-times" aria-hidden="true" />
      </button>
      {loading && <div className="home-conv-loading-media" aria-hidden="true" />}
      {item && <>
        {item.fotos.length > 1 ?
          <HomeConvenioGallery key={item.fotos.map(f => f.id + ':' + f.orden + ':' + f.imagen_url).join(',')} fotos={item.fotos} nombre={item.nombre} /> :
          <div className={'home-conv-feature' + (!item.fotos.length ? ' is-logo' : '')}>
            <PublicImage src={item.fotos[0]?.imagen_url || item.logo_url} title={item.fotos.length ? item.nombre : 'Logo de ' + item.nombre} />
          </div>}
        {item.sigla && <span className="home-eyebrow">{item.sigla}</span>}
      </>}
      <h3 id="convNombre">{item?.nombre || 'Información del convenio'}</h3>
    </div>
    <div className="home-dialog-body">
      {loading ? <><p role="status">Cargando información…</p>
        <div className="home-conv-loading-lines" aria-hidden="true"><span /><span /></div></> :
        error ? <div role="alert"><p>{error}</p><button className="home-button" onClick={reload}>Reintentar información</button></div> :
        item && <>
          <span className="home-dialog-status"><i className="fas fa-handshake" aria-hidden="true" /> Convenio activo</span>
          {description && <p id="convDesc">{description}</p>}
          {item.informacion_adicional?.trim() && <section className="home-conv-additional" aria-labelledby="convAdditional">
            <h4 id="convAdditional">Información adicional</h4><p>{item.informacion_adicional}</p></section>}
        </>}
    </div>
  </>
}
