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
    onKeyDown={event => {
      if (event.key !== 'Tab' || event.defaultPrevented) return;
      // El diálogo nativo puede llevar el foco a la interfaz del navegador en sus extremos.
      // Cerrar el ciclo conserva la navegación dentro del formulario, también con diálogos anidados.
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]')]
        .filter(control => control.tabIndex >= 0 && !control.matches(':disabled') && control.getClientRects().length > 0);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first && last) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last && first) { event.preventDefault(); first.focus(); }
    }}
    onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <header><div><p className="hp-kicker">HORUS / ADMINISTRACIÓN</p><h2 id={titleId}>{title}</h2></div>
      <button type="button" className="hp-icon-btn" aria-label="Cerrar ventana" onClick={onClose} disabled={busy}><PanelIcon name="close" /></button></header>
    {children}
    {footer && <footer className="hp-dialog-footer">{footer}</footer>}
  </dialog>;
}
