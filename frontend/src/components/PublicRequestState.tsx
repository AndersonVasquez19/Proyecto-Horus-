export default function PublicRequestState({ loading, error, reload }: { loading: boolean; error: string; reload: () => void }) {
  if (loading) return <p role="status" className="public-catalog-notice">Cargando información…</p>
  if (error) return <div role="alert" className="public-catalog-notice"><p>{error}</p><button type="button" onClick={reload}>Reintentar</button></div>
  return null
}
