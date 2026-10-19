import { WHY_CARDS } from './homeContent'

export default function HomeHighlights() {
  return <section className="home-highlights" aria-labelledby="home-highlights-title">
    <div className="container">
      <div className="home-section-head fade-up">
        <span className="home-eyebrow">Por qué elegirnos</span>
        <h2 id="home-highlights-title">Lo que nos hace diferentes</h2>
      </div>
      <div className="home-highlights-grid">
        {WHY_CARDS.map(card => <article className="home-highlight fade-up" key={card.num}>
          <span className="home-highlight-num">{card.num}</span>
          <span className="home-highlight-icon"><i className={'fas ' + card.icon} aria-hidden="true" /></span>
          <h3>{card.title}</h3><p>{card.desc}</p>
        </article>)}
      </div>
    </div>
  </section>
}
