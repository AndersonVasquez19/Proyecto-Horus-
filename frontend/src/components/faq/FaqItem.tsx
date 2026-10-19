import type { FaqPublica } from '../../types/public'
import { categoryLabel, paragraphs } from './faqText'

// One question as a native <details>: it keeps the browser's keyboard support (Enter / Space) and its own expanded
// state. The category badge is decorative (aria-hidden) so it never becomes part of the question's accessible name.
export default function FaqItem({ item, showBadge }: { item: FaqPublica; showBadge: boolean }) {
  return <details className="faq-item fade-up">
    <summary>
      <span className="faq-summary-text">
        {showBadge && item.categoria && <span className="faq-badge" aria-hidden="true">{categoryLabel(item.categoria)}</span>}
        <span className="faq-question">{item.pregunta}</span>
      </span>
      <span className="faq-chevron" aria-hidden="true"><i className="fas fa-chevron-down" /></span>
    </summary>
    <div className="faq-answer">
      {paragraphs(item.respuesta).map((text, index) => <p key={index}>{text}</p>)}
    </div>
  </details>
}
