import { useLayoutEffect, useRef, useState } from 'react'
import { useInstitutionalResource } from '../../institutional/useInstitutionalResource'
import type { ConvenioResponse } from '../../types/convenios'
import PublicImage from '../PublicImage'
import { agreementSummary, toAgreementData } from './agreementsData'
import type { AgreementData } from './agreementsData'
import styles from './AgreementCard.module.css'

export default function AgreementCard({ agreement, onActivities }: {
  agreement: AgreementData
  onActivities: (id: number) => void
}) {
  const [flipped, setFlipped] = useState(false)
  const frontButton = useRef<HTMLButtonElement>(null)
  const backButton = useRef<HTMLButtonElement>(null)
  const moveFocus = useRef(false)
  const detail = useInstitutionalResource<ConvenioResponse>('convenios/' + agreement.id)
  const item = detail.data?.item
  const data = item ? toAgreementData(item) : agreement
  const summary = item ? agreementSummary(item) : ''
  const backId = 'agreement-back-' + agreement.id

  useLayoutEffect(() => {
    if (moveFocus.current) {
      const target = flipped ? backButton : frontButton
      target.current?.focus({ preventScroll: true })
      moveFocus.current = false
    }
  }, [flipped])

  function flip(value: boolean) {
    moveFocus.current = true
    setFlipped(value)
  }

  return <article className={styles.card} data-agreement-card aria-label={'Convenio con ' + data.nombre}
    onKeyDown={event => {
      if (flipped && event.key === 'Escape') { event.preventDefault(); flip(false) }
    }}>
    <div className={styles.inner} data-flipped={flipped}>
      <div className={styles.front} inert={flipped} aria-hidden={flipped}>
        <button type="button" ref={frontButton} className={styles.frontButton} data-agreement-toggle
          aria-expanded={flipped} aria-controls={backId} aria-label={'Conocer convenio con ' + data.nombre}
          onClick={() => flip(true)}>
          <span className={styles.logo} data-agreement-logo><PublicImage src={data.logoUrl} title="" /></span>
          <span className={styles.identity}>
            {data.siglas && <span className={styles.initials}>{data.siglas}</span>}
            <span className={styles.name}>{data.nombre}</span>
          </span>
          <span className={styles.cta}><span className={styles.ctaLabel} data-agreement-cta>Conocer convenio <span aria-hidden="true">→</span></span></span>
        </button>
      </div>
      <div id={backId} className={styles.back} inert={!flipped} aria-hidden={!flipped}>
        <div className={styles.backHeader}>
          <span className={styles.thumbnail}><PublicImage src={data.logoUrl} title="" /></span>
          <div><span className={styles.eyebrow}>Alianza institucional</span><h3>{data.siglas || data.nombre}</h3></div>
        </div>
        <div className={styles.description} tabIndex={flipped ? 0 : -1} role="region"
          aria-label={'Información del convenio con ' + data.nombre}>
          {detail.loading ? <p role="status">Cargando información…</p> : detail.error ?
            <div role="alert"><p>{detail.error}</p><button type="button" className={styles.action} onClick={detail.reload}>Reintentar información</button></div> :
            summary && <p data-agreement-summary>{summary}</p>}
        </div>
        <div className={styles.actions}>
          {item && <button type="button" className={styles.action} aria-haspopup="dialog" data-agreement-detail
            aria-label={'Ver detalle completo del convenio con ' + data.nombre}
            onClick={() => onActivities(data.id)}>Ver detalle completo <span aria-hidden="true">↗</span></button>}
          <button type="button" ref={backButton} className={styles.returnButton} aria-expanded={flipped} data-agreement-return
            aria-controls={backId} aria-label={'Volver al frente del convenio con ' + data.nombre}
            onClick={() => flip(false)}><span aria-hidden="true">←</span> Volver al frente</button>
        </div>
      </div>
    </div>
  </article>
}
