import { toast } from 'sonner';
import { createNotifier, type NotifyEngine } from './notifyCore';

// Único punto de contacto con Sonner. Los componentes usan `notify` (nunca `toast` directamente), así la política vive en notifyCore.ts.
const engine: NotifyEngine = {
  show: (kind, message, { id, description, duration }) => toast[kind](message, { id, description, duration }),
  dismiss: id => toast.dismiss(id),
};
export const notify = createNotifier(engine);
