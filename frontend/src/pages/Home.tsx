import { useEffect, useState } from 'react'
import { useInstitutionalResource as usePublicResource } from '../institutional/useInstitutionalResource'
import type { ConvenioList } from '../types/convenios'
import HomeWelcome from '../components/home/HomeWelcome'
import HomeHero from '../components/home/HomeHero'
import HomeServices from '../components/home/HomeServices'
import HomeConvenios from '../components/home/HomeConvenios'
import HomeLocation from '../components/home/HomeLocation'
import '../styles/home-redesign.css'
import '../styles/home-motion.css'
import '../styles/home-hero.css'

export default function Home() {
  const [page, setPage] = useState(1)
  const convenios = usePublicResource<ConvenioList>('convenios?page=' + page + '&limit=4')
  useEffect(() => { document.title = 'Horus Group SRL — Tecnología y Educación en Cajamarca' }, [])

  return <div className="home-page">
    <HomeWelcome>{ready => <HomeHero ready={ready} conveniosTotal={!convenios.loading && !convenios.error ? convenios.data?.pagination.total ?? null : null} />}</HomeWelcome>
    <HomeServices />
    <HomeConvenios key={page} resource={convenios} page={page} onPage={setPage} />
    <HomeLocation />
  </div>
}
