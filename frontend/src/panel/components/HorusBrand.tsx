import logo from '../../assets/images/logo-horus.png';

export default function HorusBrand({ light = false }: { light?: boolean }) {
  return (
    <span className={'horus-brand' + (light ? ' horus-brand--light' : '')}>
      <span className="horus-brand__symbol"><img src={logo} alt="" width={588} height={425} /></span>
      <span className="horus-brand__wordmark">
        <strong>HORUS<span>GROUP</span></strong>
        <small>Tecnología & formación</small>
      </span>
    </span>
  );
}
