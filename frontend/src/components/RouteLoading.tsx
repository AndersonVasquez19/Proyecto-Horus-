import '../styles/route-loading.css'

// Shared loading screen for lazy routes and session checks, so the page never flashes white.
export default function RouteLoading({ label }: { label: string }) {
  return <main className="route-loading" role="status" aria-live="polite">
    <span className="route-loading__spinner" aria-hidden="true" />
    <p>{label}</p>
  </main>
}
