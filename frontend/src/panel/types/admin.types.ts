// Identidad de la sesión (los campos de siempre). El rol, los permisos y el modo de acceso viven aparte, en `SessionAccess`.
export interface AdminUser {
  id: number;
  nombre: string;
  email: string;
}

// Roles, modos y datos de acceso informados por el backend (ver context/sessionAccess.ts). Solo informativos: no autorizan nada.
export type { AdminRole, AccessMode, SessionAccess } from '../context/sessionAccess';

export interface AdminItem {
  id: number;
  titulo: string;
  descripcion: string;
  categoria: string;
  estado: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AdminMessage {
  id: number;
  nombre: string;
  email: string;
  telefono: string;
  asunto: string;
  mensaje: string;
  estado: 'nuevo' | 'en_proceso' | 'atendido' | 'archivado';
  createdAt?: string;
}

export interface LoginForm {
  email: string;
  password: string;
}

export interface RegisterForm {
  nombre: string;
  email: string;
  password: string;
}
