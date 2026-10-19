import type { ReactNode } from 'react'

// Centered section heading with the gold rule used across the public site.
export default function SectionHead({ id, eyebrow, title, children, dark = false }: {
  id: string; eyebrow: string; title: string; children?: ReactNode; dark?: boolean;
}) {
  return <div className={'horus-section-head fade-up' + (dark ? ' is-dark' : '')}>
    <span className="horus-pill">{eyebrow}</span>
    <h2 id={id}>{title}</h2>
    {children && <p>{children}</p>}
  </div>
}
