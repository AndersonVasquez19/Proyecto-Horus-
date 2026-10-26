// Roles administrativos aprobados para Horus Group SRL. Etapa 1: definición pura, sin conexión con guards, JWT ni base de datos.
export const ADMIN_ROLES = ['GERENTE_GENERAL', 'COORDINADORA_INSTITUCIONAL', 'SECRETARIA'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

const ROLE_SET: ReadonlySet<string> = new Set(ADMIN_ROLES);

export function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === 'string' && ROLE_SET.has(value);
}
