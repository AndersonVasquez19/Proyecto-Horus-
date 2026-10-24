import { lazy, Suspense } from 'react'
import PageBoundary from './components/PageBoundary'
import { RouterProvider, createBrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import RouteLoading from './components/RouteLoading'
import MainLayout from './layouts/MainLayout'
import Home            from './pages/Home'
import QuienesSomos    from './pages/QuienesSomos'
import Galeria         from './pages/Galeria'
import './styles/catalogo-publico.css'
import Contactos       from './pages/Contactos'

import CableadoEstructurado  from './pages/tecnologias/CableadoEstructurado'
import CamarasSeguridad      from './pages/tecnologias/CamarasSeguridad'
import SoporteMantenimiento  from './pages/tecnologias/SoporteMantenimiento'

import Asesoramiento   from './pages/educacion/Asesoramiento'
import Capacitaciones  from './pages/educacion/Capacitaciones'
import Cursos          from './pages/educacion/Cursos'
import Preinscripcion  from './pages/Preinscripcion'

import PoliticasCookies    from './pages/politicas/PoliticasCookies'
import PoliticasDevolucion from './pages/politicas/PoliticasDevolucion'
import PoliticasPrivacidad from './pages/politicas/PoliticasPrivacidad'
import PreguntasFrecuentes from './pages/politicas/PreguntasFrecuentes'
import LibroReclamaciones  from './pages/politicas/LibroReclamaciones'

import { AdminAuthProvider } from './panel/context/AdminAuthContext'
import AdminRoute from './panel/components/AdminRoute'
import AdminLogin from './panel/pages/AdminLogin'
const AdminDashboard = lazy(() => import('./panel/pages/AdminDashboard'))
const AdminMessages = lazy(() => import('./panel/pages/AdminMessages'))

import NewsletterUnsubscribe from './pages/NewsletterUnsubscribe'
const AdminRecovery = lazy(() => import('./panel/pages/AdminRecovery'))
const AdminRegister = lazy(() => import('./panel/pages/AdminRegister'))
import CatalogoDetail from './pages/CatalogoDetail'
import CursoDetail from './pages/educacion/CursoDetail'
import NotFound from './pages/NotFound'

function RouteFallback() {
  const { pathname } = useLocation()
  return <RouteLoading label={pathname.startsWith('/admin') ? 'Cargando panel…' : 'Cargando página…'} />
}

// Router de datos (en lugar de BrowserRouter) solo para poder usar useBlocker en el panel: avisar de cambios sin guardar
// también al usar Atrás/Adelante. Las rutas siguen declaradas abajo con <Routes>, bajo una ruta comodín.
function AppRoutes() {
  return (
      <>
        <PageBoundary><Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route element={<MainLayout />}>
            <Route path="/educacion/cursos/:id" element={<CursoDetail />} />
            <Route path="/educacion/capacitaciones/:id" element={<CursoDetail />} />
            <Route path="/tecnologias/servicios/:id" element={<CatalogoDetail kind="servicios" />} />
            <Route path="/tecnologias/servicios" element={<Navigate to="/tecnologias/cableado-estructurado" replace />} />
            <Route path="/"                        element={<Home />} />
            <Route path="/quienes-somos"           element={<QuienesSomos />} />
            <Route path="/galeria"                 element={<Galeria />} />
            <Route path="/newsletter/baja" element={<NewsletterUnsubscribe />} />
            <Route path="/market/*"                element={<Navigate to="/" replace />} />
            <Route path="/contactos"               element={<Contactos />} />

            <Route path="/tecnologias/cableado-estructurado"  element={<CableadoEstructurado />} />
            <Route path="/tecnologias/camaras-seguridad"      element={<CamarasSeguridad />} />
            <Route path="/tecnologias/soporte-mantenimiento"  element={<SoporteMantenimiento />} />

            <Route path="/educacion/asesoramiento"  element={<Asesoramiento />} />
            <Route path="/educacion/capacitaciones" element={<Capacitaciones />} />
            <Route path="/educacion/cursos"         element={<Cursos />} />
            <Route path="/preinscripcion"           element={<Preinscripcion />} />

            <Route path="/politicas/cookies"           element={<PoliticasCookies />} />
            <Route path="/politicas/devolucion"        element={<PoliticasDevolucion />} />
            <Route path="/politicas/privacidad"        element={<PoliticasPrivacidad />} />
            <Route path="/preguntas-frecuentes"        element={<PreguntasFrecuentes />} />
            <Route path="/libro-reclamaciones"         element={<LibroReclamaciones />} />
            <Route path="*"                            element={<NotFound />} />
          </Route>

          <Route path="/admin/forgot-password" element={<AdminRecovery />} />
          <Route path="/admin/reset-password" element={<AdminRecovery reset />} />
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/admin/register" element={<AdminRegister />} />

          <Route element={<AdminRoute />}>
            <Route path="/admin/dashboard" element={<AdminDashboard />} />
            <Route path="/admin/messages" element={<AdminMessages />} />
          </Route>

        </Routes>
        </Suspense></PageBoundary>
      </>
  )
}

const router = createBrowserRouter([{ path: "*", element: <AppRoutes /> }])

export default function App() {
  return (
    <AdminAuthProvider>
      <RouterProvider router={router} />
    </AdminAuthProvider>
  )
}
