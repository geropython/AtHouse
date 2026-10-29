import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { apiRequest, type HouseholdResponse } from './lib/api'

interface AdminPageProps {
  csrfToken: string
  focusInvitation: boolean
  onInvitationFocused: () => void
  onHouseholdSummaryChanged: () => void
  onSessionExpired: () => void
}

export default function AdminPage({
  csrfToken,
  focusInvitation,
  onInvitationFocused,
  onHouseholdSummaryChanged,
  onSessionExpired,
}: AdminPageProps) {
  const [data, setData] = useState<HouseholdResponse | null>(null)
  const [householdName, setHouseholdName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyAction, setBusyAction] = useState('')
  const inviteEmailRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    try {
      const result = await apiRequest<HouseholdResponse>('/household')
      setData(result)
      setHouseholdName(result.household.name)
    } catch (requestError) {
      if (isSessionExpired(requestError)) onSessionExpired()
      else setError(getErrorMessage(requestError))
    }
  }, [onSessionExpired])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!focusInvitation || !data) return
    inviteEmailRef.current?.focus()
    inviteEmailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    onInvitationFocused()
  }, [focusInvitation, data, onInvitationFocused])

  async function submitHousehold(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setNotice('')
    setBusyAction('household')
    try {
      const result = await apiRequest<{ household: { id: string; name: string } }>('/household', {
        method: 'PATCH',
        csrfToken,
        body: { name: householdName },
      })
      setNotice(`El hogar ahora se llama «${result.household.name}».`)
      await refresh()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setBusyAction('')
    }
  }

  async function submitInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setNotice('')
    setBusyAction('invitation')
    try {
      const result = await apiRequest<{ message: string }>('/household/invitations', {
        method: 'POST',
        csrfToken,
        body: { email: inviteEmail },
      })
      setNotice(result.message)
      setInviteEmail('')
      await refresh()
      onHouseholdSummaryChanged()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
      await refresh()
      onHouseholdSummaryChanged()
    } finally {
      setBusyAction('')
    }
  }

  async function removeMember(id: string, nickname: string | null) {
    if (!window.confirm(`¿Quitar a ${nickname ?? 'este miembro'} del hogar? Se revocará su acceso, pero no se borrará el historial.`)) return
    setError('')
    setBusyAction(id)
    try {
      await apiRequest(`/household/members/${encodeURIComponent(id)}`, { method: 'DELETE', csrfToken })
      setNotice('El acceso del miembro fue revocado.')
      await refresh()
      onHouseholdSummaryChanged()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setBusyAction('')
    }
  }

  async function revokeInvitation(id: string) {
    if (!window.confirm('¿Revocar esta invitación? El enlace dejará de funcionar.')) return
    setError('')
    setBusyAction(id)
    try {
      await apiRequest(`/household/invitations/${encodeURIComponent(id)}`, { method: 'DELETE', csrfToken })
      setNotice('La invitación fue revocada.')
      await refresh()
      onHouseholdSummaryChanged()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setBusyAction('')
    }
  }

  async function toggleEmailOtp() {
    if (!data) return
    const enabled = !data.emailOtpEnabled
    if (enabled && !window.confirm('Al iniciar sesión se enviará un código de seis dígitos a tu correo. ¿Activar la verificación adicional?')) return
    setError('')
    setNotice('')
    setBusyAction('security')
    try {
      await apiRequest('/security/email-otp', { method: 'PATCH', csrfToken, body: { enabled } })
      setNotice(enabled ? 'La verificación por correo está activada.' : 'La verificación por correo está desactivada.')
      await refresh()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setBusyAction('')
    }
  }

  if (!data) {
    return (
      <section className="page-content admin-page">
        <p className="eyebrow"><span className="eyebrow-line" /> ADMINISTRACIÓN DEL HOGAR</p>
        <h1>Adm House<span>.</span></h1>
        {error
          ? <p className="auth-error" role="alert">{error}</p>
          : <p className="page-description">Cargando la información del hogar…</p>}
        {error && <button className="secondary-button" type="button" onClick={() => void refresh()}>Reintentar</button>}
      </section>
    )
  }

  const occupiedPlaces = data.members.length + data.invitations.length
  const hasAvailablePlaces = occupiedPlaces < 5

  return (
    <section className="page-content admin-page">
      <nav className="breadcrumbs" aria-label="Ruta de navegación">
        <span>AtHouse</span><span aria-hidden="true">›</span><span>Adm House</span><span aria-hidden="true">›</span><span>{data.household.name}</span>
      </nav>
      <div className="page-heading">
        <div>
          <p className="eyebrow"><span className="eyebrow-line" /> ADMINISTRACIÓN DEL HOGAR</p>
          <h1>Mi hogar<span>.</span></h1>
          <p className="page-description">Administrá el nombre, las invitaciones, los miembros y la seguridad.</p>
        </div>
      </div>

      {error && <p className="auth-error" role="alert">{error}</p>}
      {notice && <p className="auth-message" role="status">{notice}</p>}

      <section className="admin-section" aria-labelledby="house-name-title">
        <div className="admin-section-heading">
          <div><p className="eyebrow">TU ESPACIO</p><h2 id="house-name-title">Nombre del hogar</h2></div>
        </div>
        <form className="admin-inline-form" onSubmit={submitHousehold}>
          <label className="visually-hidden" htmlFor="household-name">Nombre del hogar</label>
          <input id="household-name" required maxLength={80} value={householdName} onChange={(event) => setHouseholdName(event.target.value)} />
          <button className="primary-button" type="submit" disabled={busyAction === 'household'}>{busyAction === 'household' ? 'Guardando…' : 'Guardar nombre'}</button>
        </form>
      </section>

      <section className="admin-section" aria-labelledby="members-title">
        <div className="admin-section-heading">
          <div><p className="eyebrow">ACCESO COMPARTIDO</p><h2 id="members-title">Miembros</h2></div>
          <span className="count-badge">{data.members.length}</span>
        </div>
        <div className="admin-member-list">
          {data.members.map((member) => (
            <article className="admin-member-row" key={member.id}>
              <span className="member-avatar" aria-hidden="true">{(member.nickname ?? member.email).slice(0, 1).toUpperCase()}</span>
              <div className="admin-member-copy">
                <strong>{member.nickname ?? member.email}</strong>
                <span>{member.role === 'admin' ? 'Administrador' : 'Miembro'} · {member.email}</span>
              </div>
              <span className={`member-state${member.emailVerified ? ' is-verified' : ''}`}>{member.emailVerified ? 'Verificado' : 'Sin verificar'}</span>
              {member.role === 'member' && (
                <button className="entry-remove-button" type="button" disabled={busyAction === member.id} onClick={() => void removeMember(member.id, member.nickname)}>
                  Quitar
                </button>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="admin-section" aria-labelledby="invite-title">
        <div className="admin-section-heading">
          <div><p className="eyebrow">SUMAR AL HOGAR</p><h2 id="invite-title">Invitar miembro</h2></div>
          <span className="admin-capacity-count">{occupiedPlaces}/5 lugares</span>
        </div>
        <form className="admin-inline-form" onSubmit={submitInvitation}>
          <label className="visually-hidden" htmlFor="invite-email">Correo de la persona</label>
          <input ref={inviteEmailRef} id="invite-email" type="email" autoComplete="email" required maxLength={254} value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="persona@correo.com" disabled={!hasAvailablePlaces} />
          <button className="primary-button" type="submit" disabled={busyAction === 'invitation' || !hasAvailablePlaces}>{busyAction === 'invitation' ? 'Enviando…' : 'Enviar invitación'}</button>
        </form>
        {!hasAvailablePlaces && <p className="admin-hint">El hogar ya tiene 5 lugares ocupados entre miembros e invitaciones pendientes.</p>}
        {data.invitations.length > 0 && (
          <div className="admin-member-list pending-invitations">
            {data.invitations.map((invitation) => (
              <article className="admin-member-row" key={invitation.id}>
                <span className="member-avatar invitation-avatar" aria-hidden="true">✉</span>
                <div className="admin-member-copy">
                  <strong>{invitation.email}</strong>
                  <span>Invitación pendiente · vence {formatDate(invitation.expires_at)}</span>
                </div>
                <button className="entry-remove-button" type="button" disabled={busyAction === invitation.id} onClick={() => void revokeInvitation(invitation.id)}>Revocar</button>
              </article>
            ))}
          </div>
        )}
        {!data.invitations.length && <p className="admin-hint">Las invitaciones se envían por correo y vencen a los 7 días. Requiere configurar SMTP.</p>}
      </section>

      <section className="admin-section" aria-labelledby="security-title">
        <div className="admin-section-heading">
          <div><p className="eyebrow">PROTECCIÓN DE LA CUENTA</p><h2 id="security-title">Seguridad</h2></div>
        </div>
        <div className="security-setting">
          <div><strong>Verificación adicional por correo</strong><span>Solicita un código de seis dígitos después de tu contraseña.</span></div>
          <button className={data.emailOtpEnabled ? 'secondary-button' : 'primary-button'} type="button" disabled={busyAction === 'security'} onClick={() => void toggleEmailOtp()}>
            {data.emailOtpEnabled ? 'Desactivar' : 'Activar'}
          </button>
        </div>
        <p className="admin-hint">Los códigos vencen en 5 minutos y no se reutilizan. Requiere un servicio SMTP configurado.</p>
      </section>
      <footer className="page-footer"><span>HECHO PARA SENTIRSE EN CASA</span><span>Una cosa a la vez <span className="footer-heart">♥</span></span></footer>
    </section>
  )
}

function isSessionExpired(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === 401
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'No se pudo completar la solicitud.'
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value))
}
