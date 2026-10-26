import type { AdminItem, AdminMessage } from '../types';
import { PanelApiError, panelRequest } from './panelApi';

import { API_BASE as PUBLIC_API_BASE } from '../../apiBase';
const API_BASE = PUBLIC_API_BASE + '/admin';

const getAuthHeaders = (token?: string): HeadersInit => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
};

export async function loginAdmin(payload: { email: string; password: string }, signal?: AbortSignal) {
  const response = await fetch(`${API_BASE}/login`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
    signal,
  });
  // `user` y `acceso` llegan sin validar: el contexto de sesión los interpreta con parseSession (contexto/sessionAccess.ts).
  const data = await response.json().catch(() => null) as { ok?: boolean; token?: string; user?: unknown; acceso?: unknown } | null;
  // El texto del servidor no se propaga: la pantalla elige el mensaje según el código HTTP.
  if (!response.ok || !data || data.ok === false) throw new PanelApiError('Inicio de sesión rechazado.', response.ok ? 500 : response.status);
  if (!data.token) throw new PanelApiError('Respuesta de inicio de sesión incompleta.', 500);
  return data as { ok: boolean; token: string; user?: unknown; acceso?: unknown };
}

// Registro público (sin sesión). La cuenta nace sin rol en el backend; el cliente solo envía estos campos. Como en el login, el texto del
// servidor no se propaga: la pantalla elige el mensaje según el código HTTP (authError('register', …)).
export async function signupAccount(payload: { nombre: string; email: string; password: string; website?: string }, signal?: AbortSignal) {
  const response = await fetch(`${API_BASE}/signup`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
    signal,
  });
  const data = await response.json().catch(() => null) as { ok?: boolean } | null;
  if (!response.ok || !data || data.ok !== true) throw new PanelApiError('Registro rechazado.', response.status);
  return data as { ok: true };
}

export async function getCurrentAdmin(token: string, signal?: AbortSignal) {
  return panelRequest<{ ok: boolean; user?: unknown; acceso?: unknown; mensaje?: string }>('me', token, 'GET', undefined, signal);
}

export async function getAdminItems(token: string) {
  const response = await fetch(`${API_BASE}/items`, {
    method: 'GET',
    headers: getAuthHeaders(token),
  });
  return response.json() as Promise<{ ok: boolean; items?: AdminItem[]; mensaje?: string }>;
}

export async function createAdminItem(token: string, payload: Partial<AdminItem>) {
  const response = await fetch(`${API_BASE}/items`, {
    method: 'POST',
    headers: getAuthHeaders(token),
    body: JSON.stringify(payload),
  });
  return response.json() as Promise<{ ok: boolean; item?: AdminItem; mensaje?: string }>;
}

export async function updateAdminItem(token: string, id: number, payload: Partial<AdminItem>) {
  const response = await fetch(`${API_BASE}/items/${id}`, {
    method: 'PUT',
    headers: getAuthHeaders(token),
    body: JSON.stringify(payload),
  });
  return response.json() as Promise<{ ok: boolean; item?: AdminItem; mensaje?: string }>;
}

export async function deleteAdminItem(token: string, id: number) {
  const response = await fetch(`${API_BASE}/items/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(token),
  });
  return response.json() as Promise<{ ok: boolean; mensaje?: string }>;
}

export async function getAdminMessages(token: string) {
  const response = await fetch(`${API_BASE}/messages`, {
    headers: getAuthHeaders(token),
  });
  return response.json() as Promise<{ ok: boolean; messages?: AdminMessage[]; mensaje?: string }>;
}

export async function createAdminMessage(token: string, payload: Omit<AdminMessage, 'id' | 'estado' | 'createdAt'>) {
  const response = await fetch(`${API_BASE}/messages`, {
    method: 'POST',
    headers: getAuthHeaders(token),
    body: JSON.stringify(payload),
  });
  return response.json() as Promise<{ ok: boolean; message?: AdminMessage; mensaje?: string }>;
}

export async function updateAdminMessage(token: string, id: number, estado: Exclude<AdminMessage['estado'], 'archivado'>) {
  const response = await fetch(`${API_BASE}/messages/${id}`, {
    method: 'PUT',
    headers: getAuthHeaders(token),
    body: JSON.stringify({ estado }),
  });
  return response.json() as Promise<{ ok: boolean; message?: AdminMessage; mensaje?: string }>;
}

export async function deleteAdminMessage(token: string, id: number) {
  const response = await fetch(`${API_BASE}/messages/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(token),
  });
  return response.json() as Promise<{ ok: boolean; mensaje?: string }>;
}
