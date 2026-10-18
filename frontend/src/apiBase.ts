// Public build-time setting. Never put credentials in a VITE_* variable.
export const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/+$/, '');

// Proveedor del contenido público: 'nestjs' (predeterminado) o 'laravel' (validado en vite.config.js).
export const CONTENT_PROVIDER: string = import.meta.env.VITE_CONTENT_PROVIDER || 'nestjs';
export const CONTENT_API_BASE: string = (import.meta.env.VITE_CONTENT_API_BASE_URL || '').replace(/\/+$/, '');
