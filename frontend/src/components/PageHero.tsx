import type { ReactNode } from 'react'

// Compact hero for interior pages: eyebrow, title, gold rule, description and optional actions.
export default function PageHero({ eyebrow, title, id = 'page-hero-title', children, actions }: {
  eyebrow: string; title: string; id?: string; children?: ReactNode; actions?: ReactNode;
}) {
  return <section className="horus-hero" aria-labelledby={id}>
    <div className="container horus-hero-inner">
      <span className="horus-hero-eyebrow">{eyebrow}</span>
      <h1 id={id}>{title}</h1>
      {children && <p>{children}</p>}
      {actions && <div className="horus-hero-actions">{actions}</div>}
    </div>
  </section>
}
