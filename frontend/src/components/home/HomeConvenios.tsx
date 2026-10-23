import { useState } from 'react'
import AgreementCard from './AgreementCard'
import { toAgreementData } from './agreementsData'
import styles from './AgreementCard.module.css'
import HomeConvenioDialog from './HomeConvenioDialog'
import type { ConvenioResource } from '../../types/convenios'

export default function HomeConvenios({ resource, page, onPage }: {
  resource: ConvenioResource; page: number; onPage: (page: number) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null)
  const { data, loading, error, reload } = resource
  const agreementsData = data?.items.map(toAgreementData) ?? []
  return <section className="home-convenios" aria-labelledby="home-convenios-title">
    <div className="container">
      <div className="home-section-head fade-up">
        <span className="home-eyebrow">Alianzas</span>
        <h2 id="home-convenios-title">Convenios que respaldan tu certificación</h2>
        <p>Conoce nuestras alianzas institucionales y sus actividades.</p>
      </div>
      {loading ? <p role="status" className="home-conv-notice">Cargando convenios…</p> :
        error ? <div role="alert" className="home-conv-notice"><p>{error}</p><button className="home-button" onClick={reload}>Reintentar convenios</button></div> :
        !data?.items.length ? <div className="home-conv-notice" role="status"><p>No hay convenios visibles en este momento.</p>
          {page > 1 && <button className="home-button" onClick={() => onPage(1)}>Volver al inicio de convenios</button>}</div> :
        <div className={styles.grid} data-agreements-grid>
          {agreementsData.map(agreement => <AgreementCard key={agreement.id} agreement={agreement} onActivities={setSelected} />)}
        </div>}
      {!loading && !error && data && data.pagination.pages > 1 && <nav className="home-conv-pagination" aria-label="Páginas de convenios">
        <button className="home-button home-button-outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>Anterior</button>
        <span>Página {page} de {data.pagination.pages}</span>
        <button className="home-button home-button-outline" disabled={page >= data.pagination.pages} onClick={() => onPage(page + 1)}>Siguiente</button>
      </nav>}
    </div>
    {selected !== null && <HomeConvenioDialog key={selected} id={selected} onClose={() => setSelected(null)} />}
  </section>
}
