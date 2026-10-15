import { createContext, useContext } from 'react';
import type { AdminUser, SessionAccess } from '../types';
interface AdminAuthContextValue {
 user: AdminUser | null; token: string | null; isAuthenticated: boolean; checking: boolean;
 // Rol, permisos y modo de acceso que el BACKEND informó para la cuenta validada (login o /admin/me); solo en memoria.
 // null mientras la sesión no está validada (cargando, sin sesión o con error): nunca se muestran funciones antes de conocerlos.
 // Es información para adaptar la interfaz, no una autorización: el backend es quien decide (hoy `mode` es «heredado» y no aplica permisos).
 access: SessionAccess | null;
 sessionError: string; retrySession: () => void;
 // Por qué terminó la última sesión: 'expired' = el servidor la invalidó; 'logout' = cierre voluntario (aquí o en otra pestaña).
 endReason: 'expired' | 'logout' | null;
 // `response`: cuerpo de la respuesta del login. Solo se confía en él si trae el contrato completo de roles; en cualquier otro caso
 // (backend antiguo, respuesta incompleta o mal formada) la sesión se valida antes con /admin/me.
 login: (value: string, response?: unknown) => void; logout: () => void;
}
export const AdminAuthContext = createContext<AdminAuthContextValue | undefined>(undefined);
export function useAdminAuth() {
 const value = useContext(AdminAuthContext);
 if (!value) throw new Error('useAdminAuth debe usarse dentro de AdminAuthProvider');
 return value;
}
