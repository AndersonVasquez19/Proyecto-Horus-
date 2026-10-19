import { Component, type ReactNode } from 'react'

export default class PageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) return <main role="alert" style={{ padding: '2rem' }}><h1>No pudimos abrir esta página</h1><p>Recarga la página para volver a intentarlo.</p><button type="button" onClick={() => window.location.reload()}>Recargar página</button></main>
    return this.props.children
  }
}
