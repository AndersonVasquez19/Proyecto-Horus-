// «Roles y usuarios» (sin React ni red: lo cargan también las pruebas de Node). Interpreta GET /api/admin/users, filtra la lista y elige
// los mensajes de PUT /api/admin/users/:id/rol. Es solo interfaz: quién puede ver o cambiar roles lo decide el backend (AccessGuard y las
// reglas de account-rules.ts); aquí no hay matriz de permisos ni cuentas fijas.
export const ACCOUNT_ROLES = ['GERENTE_GENERAL', 'COORDINADORA_INSTITUCIONAL', 'SECRETARIA'] as const
export type AccountRole = (typeof ACCOUNT_ROLES)[number]
export interface Account { id: number; nombre: string; email: string; activo: boolean; rol: AccountRole | null }

export const ROLE_LABELS: Readonly<Record<AccountRole, string>> = Object.freeze({
  GERENTE_GENERAL: 'Gerente general',
  COORDINADORA_INSTITUCIONAL: 'Coordinadora institucional',
  SECRETARIA: 'Secretaria',
})
// Descripción breve para elegir el rol en el diálogo (orientativa: los permisos reales los calcula el backend).
export const ROLE_HINTS: Readonly<Record<AccountRole, string>> = Object.freeze({
  GERENTE_GENERAL: 'Acceso completo al panel, incluida la gestión de cuentas y roles.',
  COORDINADORA_INSTITUCIONAL: 'Contenido institucional, atención, cotizaciones y módulos académicos.',
  SECRETARIA: 'Atención de mensajes y tareas básicas de registro.',
})
export const roleLabel = (rol: AccountRole | null) => (rol ? ROLE_LABELS[rol] : 'Sin rol')
const isRole = (value: unknown): value is AccountRole => typeof value === 'string' && (ACCOUNT_ROLES as readonly string[]).includes(value)

// Una respuesta con otra forma se trata como error de carga, nunca como «no hay cuentas». Un rol desconocido se muestra como «sin rol».
export function parseAccounts(value: unknown): Account[] | null {
  const users = (value as { users?: unknown } | null)?.users
  if (!Array.isArray(users)) return null
  const accounts: Account[] = []
  for (const item of users) {
    const row = item as Record<string, unknown> | null
    if (!row || typeof row !== 'object' || !Number.isSafeInteger(row.id) || typeof row.nombre !== 'string' || typeof row.email !== 'string' || typeof row.activo !== 'boolean') return null
    accounts.push({ id: row.id as number, nombre: row.nombre, email: row.email, activo: row.activo, rol: isRole(row.rol) ? row.rol : null })
  }
  return accounts
}

export type AccountStatus = 'pendiente' | 'activa' | 'inactiva'
// Pendiente de autorización: cuenta activa sin rol (por ejemplo, creada desde el registro público). Una desactivada no está pendiente.
export const accountStatus = (account: Account): AccountStatus => (!account.activo ? 'inactiva' : account.rol ? 'activa' : 'pendiente')

export type RoleFilter = 'todos' | 'pendientes' | AccountRole
export type StatusFilter = 'todas' | 'activas' | 'inactivas'
const fold = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()

export function filterAccounts(accounts: readonly Account[], { search = '', rol = 'todos', estado = 'todas' }: { search?: string; rol?: RoleFilter; estado?: StatusFilter }): Account[] {
  const wanted = fold(search)
  return accounts.filter(account => (!wanted || fold(account.nombre).includes(wanted) || fold(account.email).includes(wanted))
    && (rol === 'todos' || (rol === 'pendientes' ? accountStatus(account) === 'pendiente' : account.rol === rol))
    && (estado === 'todas' || (estado === 'activas' ? account.activo : !account.activo)))
}

export function accountSummary(accounts: readonly Account[]) {
  return {
    total: accounts.length,
    pendientes: accounts.filter(account => accountStatus(account) === 'pendiente').length,
    gerentes: accounts.filter(account => account.activo && account.rol === 'GERENTE_GENERAL').length,
  }
}

// ¿Se ofrece «Cambiar rol» para esta fila? Nunca para la propia cuenta ni para una desactivada (el backend también lo rechaza).
export const canChangeRole = (account: Account, ownId: number | undefined, allowed: boolean) => allowed && account.activo && account.id !== ownId

// Cuerpo del PUT: el rol nuevo y el que mostraba la lista (el backend responde 409 si la cuenta cambió entretanto).
export const rolePayload = (account: Account, rol: AccountRole | null) => ({ rol, rol_actual: account.rol })

// Aviso que acompaña la confirmación según el cambio elegido.
export function roleChangeWarning(account: Account, rol: AccountRole | null): string {
  if (rol === 'GERENTE_GENERAL') return 'Tendrá acceso completo al panel, incluida la gestión de cuentas y roles.'
  if (rol === null) return 'La cuenta quedará como cuenta básica: podrá iniciar sesión, pero no usar las funciones administrativas.'
  if (account.rol === 'GERENTE_GENERAL') return 'Dejará de tener acceso completo y no podrá gestionar cuentas ni roles.'
  return 'Sus permisos cambiarán según el rol elegido.'
}

// Mensaje de un cambio de rol fallido. El texto del servidor solo se usa en los rechazos deliberados (409/404), que el backend redacta
// para la persona; un 500, una red caída o un timeout nunca muestran detalles y advierten de que el resultado es incierto.
export const ROLE_UNCERTAIN = 'No pudimos confirmar si el cambio se guardó. Actualiza la lista para ver el rol vigente antes de repetirlo.'
export function roleErrorMessage(error: unknown, timedOut = false): { message: string; uncertain: boolean } {
  const status = (error as { status?: unknown } | null)?.status
  const detail = error instanceof Error && !(error instanceof TypeError) ? error.message : ''
  if (timedOut || typeof status !== 'number' || status >= 500 || (status >= 200 && status < 300)) return { message: ROLE_UNCERTAIN, uncertain: true }
  if (status === 403) return { message: 'Tu cuenta no tiene permiso para cambiar roles. Si lo necesitas, consúltalo con la gerencia.', uncertain: false }
  if ((status === 409 || status === 404) && detail) return { message: detail, uncertain: false }
  if (status === 400) return { message: 'El cambio no es válido. Actualiza la lista y vuelve a intentarlo.', uncertain: false }
  if (status === 429) return { message: 'Demasiados intentos. Espera unos minutos e inténtalo nuevamente.', uncertain: false }
  return { message: 'No se pudo completar el cambio. Actualiza la lista y vuelve a intentarlo.', uncertain: false }
}
