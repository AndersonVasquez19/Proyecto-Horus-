import { useId } from 'react';

export default function RobotMascot({ portrait = false }: { portrait?: boolean }) {
  const id = useId();
  return <svg className={'hc-robot' + (portrait ? ' hc-robot-portrait' : '')} viewBox={portrait ? '12 0 96 86' : '0 0 120 140'} fill="none" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={id + '-shell'} x1="29" y1="27" x2="90" y2="106" gradientUnits="userSpaceOnUse"><stop stopColor="#fffef8" /><stop offset=".55" stopColor="#f3ead6" /><stop offset="1" stopColor="#cfb986" /></linearGradient>
      <linearGradient id={id + '-visor'} x1="38" y1="34" x2="79" y2="75" gradientUnits="userSpaceOnUse"><stop stopColor="#235968" /><stop offset="1" stopColor="#102c3e" /></linearGradient>
      <linearGradient id={id + '-gold'} x1="42" y1="88" x2="79" y2="118" gradientUnits="userSpaceOnUse"><stop stopColor="#f6da92" /><stop offset="1" stopColor="#c79742" /></linearGradient>
    </defs>
    {!portrait && <ellipse className="hc-robot-shadow" cx="60" cy="132" rx="29" ry="5" fill="#102c3e" opacity=".16" />}
    <g className="hc-robot-character">
      {!portrait && <>
        <path d="M38 112v12c0 4 5 6 10 6s10-2 10-6v-11M63 113v11c0 4 5 6 10 6s10-2 10-6v-12" fill={`url(#${id}-shell)`} stroke="#b8a883" strokeWidth="1.5" />
        <path d="M38 124c6 3 13 3 20 0M63 124c6 3 13 3 20 0" stroke="#b8a883" strokeWidth="1.5" />
        <g className="hc-robot-wave"><path d="M88 93c12 0 17-12 16-24" stroke="#c9b78f" strokeWidth="12" strokeLinecap="round" /><path d="M88 91c10 0 14-11 13-21" stroke="#fff6df" strokeWidth="7" strokeLinecap="round" /><rect x="95" y="54" width="17" height="23" rx="8" transform="rotate(12 103 65)" fill={`url(#${id}-shell)`} stroke="#b8a883" strokeWidth="1.5" /><path d="m100 58 1 7m5-7-1 7" stroke="#c0ae87" strokeWidth="1.5" strokeLinecap="round" /></g>
        <path d="M31 90c-7 3-10 10-10 18" stroke="#c9b78f" strokeWidth="12" strokeLinecap="round" /><path d="M31 88c-7 3-10 10-10 18" stroke="#fff6df" strokeWidth="7" strokeLinecap="round" />
        <rect x="16" y="103" width="14" height="17" rx="7" fill={`url(#${id}-shell)`} stroke="#b8a883" strokeWidth="1.5" />
        <rect x="32" y="81" width="57" height="38" rx="17" fill={`url(#${id}-shell)`} stroke="#b8a883" strokeWidth="1.5" />
        <path d="M44 86h32" stroke="#fffef8" strokeWidth="3" strokeLinecap="round" />
        <rect x="45" y="89" width="31" height="23" rx="9" fill={`url(#${id}-gold)`} />
        <path d="M55 95v11m11-11v11m-11-5h11" stroke="#244852" strokeWidth="3" strokeLinecap="round" />
        <circle cx="80" cy="98" r="2" fill="#498c7e" />
      </>}
      <path d="M60 24V13" stroke="#c6ae75" strokeWidth="4" strokeLinecap="round" />
      <circle cx="60" cy="10" r="6" fill="#f0ca78" stroke="#ffefc7" strokeWidth="2" />
      <rect x="16" y="42" width="13" height="24" rx="6" fill="#d4b677" stroke="#f3dfae" strokeWidth="1.5" />
      <rect x="91" y="42" width="13" height="24" rx="6" fill="#d4b677" stroke="#f3dfae" strokeWidth="1.5" />
      <rect x="24" y="23" width="72" height="62" rx="25" fill={`url(#${id}-shell)`} stroke="#c3b08a" strokeWidth="1.5" />
      <path d="M36 33c7-7 17-7 25-7" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity=".9" />
      <rect x="31" y="34" width="58" height="40" rx="17" fill={`url(#${id}-visor)`} stroke="#173946" strokeWidth="1.5" />
      <path d="M39 40c10-5 27-4 39 0" stroke="#51808a" strokeWidth="2" strokeLinecap="round" opacity=".5" />
      <g className="hc-robot-eyes" fill="#a8f3df"><rect x="43" y="46" width="8" height="12" rx="4" /><rect x="69" y="46" width="8" height="12" rx="4" /></g>
      <path d="M54 63c4 4 8 4 12 0" stroke="#a8f3df" strokeWidth="2.5" strokeLinecap="round" />
      <ellipse cx="39" cy="61" rx="4" ry="2" fill="#edc580" opacity=".55" /><ellipse cx="81" cy="61" rx="4" ry="2" fill="#edc580" opacity=".55" />
      <path d="M53 79h14" stroke="#b4a078" strokeWidth="2" strokeLinecap="round" />
    </g>
  </svg>;
}
