import { useEffect, useId, useRef, type ReactNode } from 'react';
import PanelIcon from './PanelIcon';
export default function PanelDialog({ title, children, onClose, busy = false, className = '', footer, lockScroll = false }: {
  title: string; children: ReactNode; onClose: () => void; busy?: boolean;
  className?: string; footer?: ReactNode; lockScroll?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId(); // id propio de cada diálogo: dos diálogos superpuestos no comparten el nombre accesible
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const dialog = ref.current;
    const overflow = document.body.style.overflow, rootOverflow = document.documentElement.style.overflow;
    if (lockScroll) { document.body.style.overflow = 'hidden'; document.documentElement.style.overflow = 'hidden'; }
    dialog?.showModal();
    dialog?.querySelector<HTMLElement>('[data-autofocus]')?.focus(); // la acción segura recibe el foco inicial cuando el diálogo la marca
    return () => {
      dialog?.close();
      if (lockScroll) { document.body.style.overflow = overflow; document.documentElement.style.overflow = rootOverflow; }
      previous?.focus();
    };
  }, [lockScroll]);
  return <dialog ref={ref} className={'hp-dialog' + (className ? ' ' + className : '')} aria-labelledby={titleId} closedby={busy ? 'none' : undefined}
    onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <header><div><p className="hp-kicker">HORUS / ADMINISTRACIÓN</p><h2 id={titleId}>{title}</h2></div>
      <button type="button" className="hp-icon-btn" aria-label="Cerrar ventana" onClick={onClose} disabled={busy}><PanelIcon name="close" /></button></header>
    {children}
    {footer && <footer className="hp-dialog-footer">{footer}</footer>}
  </dialog>;
}
