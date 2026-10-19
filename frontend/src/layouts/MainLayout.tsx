import Chatbot from '../components/chatbot/Chatbot'
import { Outlet, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import CompanySettingsProvider from '../components/CompanySettingsProvider'
import useFadeUp from '../hooks/useFadeUp'

export default function MainLayout() {
  const { pathname } = useLocation()
  useFadeUp()

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return (
    <CompanySettingsProvider>
      <div className={pathname === '/' ? 'site-layout home-layout' : 'site-layout'}>
        <Navbar />
        <main>
          <Outlet />
        </main>
        <Footer />
      </div>
      <Chatbot />
    </CompanySettingsProvider>
  )
}
