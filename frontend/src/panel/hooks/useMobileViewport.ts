import { useSyncExternalStore } from 'react';

// Mismo punto de corte que el CSS del panel (max-width: 760px).
const query = '(max-width: 760px)';
const subscribe = (callback: () => void) => {
  const media = window.matchMedia(query);
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
};

export function useMobileViewport() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}
