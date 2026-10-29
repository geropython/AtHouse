export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function apiRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
    body?: unknown
    csrfToken?: string
  } = {},
): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' })
  if (options.body !== undefined) headers.set('Content-Type', 'application/json')
  if (options.csrfToken) headers.set('X-CSRF-Token', options.csrfToken)

  const response = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: 'same-origin',
  })

  if (response.status === 204) return undefined as T
  const result: unknown = await response.json()
  if (!response.ok) {
    const message = result && typeof result === 'object' && 'error' in result && typeof result.error === 'string'
      ? result.error
      : 'No se pudo completar la solicitud.'
    throw new ApiError(message, response.status)
  }
  return result as T
}

export interface AuthUser {
  id: string
  email: string
  emailVerified: boolean
  role: 'admin' | 'member' | null
  nickname: string | null
  household: { id: string; name: string } | null
  emailOtpEnabled: boolean
}

export interface SessionResponse {
  user: AuthUser | null
  csrfToken: string
}

export interface HouseholdResponse {
  household: { id: string; name: string }
  members: Array<{
    id: string
    email: string
    emailVerified: boolean
    nickname: string | null
    role: 'admin' | 'member'
    joinedAt: string
  }>
  invitations: Array<{
    id: string
    email: string
    expires_at: string
    created_at: string
  }>
  emailOtpEnabled: boolean
}

export interface HouseholdSummary {
  members: Array<{
    id: string
    displayName: string
    role: 'admin' | 'member'
  }>
  pendingInvitations: number
}
