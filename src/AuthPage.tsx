import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { apiRequest, type AuthUser } from './lib/api'

interface AuthPageProps {
  csrfToken: string
  initialMessage?: string
  onAuthenticated: (user: AuthUser, csrfToken: string) => void
  onAuthActionComplete: () => void
  onSessionToken: (csrfToken: string) => void
}

type AuthMode = 'login' | 'register' | 'member' | 'member-code' | 'two-factor' | 'forgot' | 'reset' | 'invite'

export default function AuthPage({ csrfToken, initialMessage, onAuthenticated, onAuthActionComplete, onSessionToken }: AuthPageProps) {
  const [mode, setMode] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [nickname, setNickname] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [message, setMessage] = useState(initialMessage ?? '')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [verificationToken, setVerificationToken] = useState('')
  const [invitationToken, setInvitationToken] = useState('')
  const [transitionDirection, setTransitionDirection] = useState<'login' | 'register' | null>(null)
  const transitionTimeout = useRef<number | null>(null)
  const transitionSwapTimeout = useRef<number | null>(null)

  useEffect(() => () => {
    if (transitionTimeout.current !== null) window.clearTimeout(transitionTimeout.current)
    if (transitionSwapTimeout.current !== null) window.clearTimeout(transitionSwapTimeout.current)
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const verifyToken = params.get('verify')
    const resetToken = params.get('reset')
    const inviteToken = params.get('invitation')
    if (verifyToken) {
      setVerificationToken(verifyToken)
      setIsSubmitting(true)
      apiRequest<{ message: string; user: AuthUser; csrfToken: string }>('/auth/verify-email', {
        method: 'POST',
        body: { token: verifyToken },
        csrfToken,
      }).then((result) => {
        setMessage(result.message)
        onAuthenticated(result.user, result.csrfToken)
      }).catch((requestError: unknown) => {
        setError(getErrorMessage(requestError))
        setMode('login')
      }).finally(() => setIsSubmitting(false))
      window.history.replaceState({}, '', window.location.pathname)
    } else if (resetToken) {
      setVerificationToken(resetToken)
      setMode('reset')
      window.history.replaceState({}, '', window.location.pathname)
    } else if (inviteToken) {
      setInvitationToken(inviteToken)
      setMode('invite')
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [csrfToken, onAuthActionComplete])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')
    setIsSubmitting(true)
    try {
      if (mode === 'register') {
        if (password !== confirmation) throw new Error('Las contraseñas no coinciden.')
        const result = await apiRequest<{ message: string }>('/auth/register', {
          method: 'POST',
          body: { email, password },
          csrfToken,
        })
        setMessage(result.message)
      } else if (mode === 'login') {
        const result = await apiRequest<{ user?: AuthUser; csrfToken: string; requiresTwoFactor?: boolean }>('/auth/login', {
          method: 'POST',
          body: { email, password },
          csrfToken,
        })
        onSessionToken(result.csrfToken)
        if (result.requiresTwoFactor) {
          setMode('two-factor')
          setMessage('Te enviamos un código de acceso a tu correo.')
        } else if (result.user) {
          onAuthenticated(result.user, result.csrfToken)
        }
      } else if (mode === 'member') {
        await apiRequest('/auth/member/code', { method: 'POST', body: { nickname }, csrfToken })
        setMode('member-code')
        setMessage('Si el nickname está asociado a un miembro, recibirá un código por correo.')
      } else if (mode === 'member-code') {
        const result = await apiRequest<{ user: AuthUser; csrfToken: string }>('/auth/member/login', {
          method: 'POST',
          body: { nickname, code },
          csrfToken,
        })
        onAuthenticated(result.user, result.csrfToken)
      } else if (mode === 'two-factor') {
        const result = await apiRequest<{ user: AuthUser; csrfToken: string }>('/auth/verify-two-factor', {
          method: 'POST',
          body: { code },
          csrfToken,
        })
        onAuthenticated(result.user, result.csrfToken)
      } else if (mode === 'forgot') {
        const result = await apiRequest<{ message: string }>('/auth/forgot-password', {
          method: 'POST',
          body: { email },
          csrfToken,
        })
        setMessage(result.message)
      } else if (mode === 'reset') {
        if (password !== confirmation) throw new Error('Las contraseñas no coinciden.')
        const result = await apiRequest<{ message: string; csrfToken: string }>('/auth/reset-password', {
          method: 'POST',
          body: { token: verificationToken, password },
          csrfToken,
        })
        onSessionToken(result.csrfToken)
        setMessage(result.message)
        setMode('login')
        onAuthActionComplete()
      } else if (mode === 'invite') {
        const result = await apiRequest<{ message: string }>('/invitations/accept', {
          method: 'POST',
          body: { token: invitationToken, nickname },
          csrfToken,
        })
        setMessage(result.message)
        setMode('member')
      }
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setIsSubmitting(false)
    }
  }

  const isRegister = mode === 'register'
  const isTransitioning = transitionDirection !== null
  const showBrandPanel = mode === 'login' || mode === 'register' || mode === 'member' || mode === 'member-code'
  const heading = {
    login: 'Ingresar',
    register: 'Crear cuenta',
    member: 'Acceso de miembro',
    'member-code': 'Ingresá tu código',
    'two-factor': 'Verificación adicional',
    forgot: 'Recuperar contraseña',
    reset: 'Elegir contraseña',
    invite: 'Sumarte al hogar',
  }[mode]

  return (
    <main className="auth-page">
      <section
        className={`auth-card${isRegister ? ' is-register' : ''}${showBrandPanel ? '' : ' is-compact'}${isTransitioning ? ` is-transitioning is-transitioning-to-${transitionDirection}` : ''}`}
        aria-label="Acceso a AtHouse"
        aria-busy={isTransitioning}
      >
        <nav className="auth-mode-switch" aria-label="Tipo de acceso">
          <button
            type="button"
            className={`auth-mode-tab${!isRegister ? ' is-active' : ''}`}
            aria-pressed={!isRegister}
            aria-disabled={isTransitioning || isSubmitting}
            onClick={() => selectAuthTab('login')}
          >
            Login
          </button>
          <button
            type="button"
            className={`auth-mode-tab${isRegister ? ' is-active' : ''}`}
            aria-pressed={isRegister}
            aria-disabled={isTransitioning || isSubmitting}
            onClick={() => selectAuthTab('register')}
          >
            Create Account
          </button>
        </nav>

        {showBrandPanel && (
          <aside className="auth-art">
            <div className="auth-art-content">
              <span className="auth-logo-mark" aria-hidden="true">⌂</span>
              <p className="eyebrow"><span className="eyebrow-line" /> ATHOUSE</p>
              <h1>{isRegister ? 'Un hogar,' : 'Tu hogar,'}<br /><span>{isRegister ? 'mejor organizado.' : 'en orden.'}</span></h1>
              <p>Un espacio para organizar y compartir lo importante de cada día.</p>
              <div className="cleaning-icons" aria-hidden="true">
                <CleaningIcon kind="broom" />
                <CleaningIcon kind="mop" />
                <CleaningIcon kind="sparkle" />
              </div>
            </div>
          </aside>
        )}

        {isTransitioning && (
          <div className="auth-transition-surface" aria-hidden="true">
            <span className="auth-transition-bubble bubble-house"><CleaningIcon kind="house" /></span>
            <span className="auth-transition-bubble bubble-broom"><CleaningIcon kind="broom" /></span>
            <span className="auth-transition-bubble bubble-mop"><CleaningIcon kind="mop" /></span>
            <span className="auth-transition-bubble bubble-sparkle"><CleaningIcon kind="sparkle" /></span>
          </div>
        )}

        <div className="auth-form-panel">
          <div className="auth-form-inner" aria-hidden={isTransitioning}>
            <p className="eyebrow"><span className="eyebrow-line" /> {mode === 'invite' ? 'INVITACIÓN' : 'TU ESPACIO'}</p>
            <h2>{heading}<span className="brand-period">.</span></h2>
            <p className="auth-subtitle">
              {mode === 'register' ? 'Creá tu cuenta de administrador.' :
                mode === 'member' || mode === 'member-code' ? 'Ingresá al hogar al que te invitaron.' :
                  mode === 'two-factor' ? 'Protegemos tu cuenta con un código temporal.' :
                    mode === 'invite' ? 'Elegí un nickname. El acceso al hogar se realiza con un código enviado a tu correo.' :
                      mode === 'forgot' ? 'Te enviaremos instrucciones si encontramos tu cuenta.' :
                        mode === 'reset' ? 'Usá al menos 8 caracteres, una mayúscula y un número.' :
                          'Ingresá para continuar con AtHouse.'}
            </p>

            {message && <p className="auth-message" role="status">{message}</p>}
            {error && <p className="auth-error" role="alert">{error}</p>}

            <form className="auth-form" onSubmit={submit}>
              <fieldset className="auth-fields" disabled={isTransitioning || isSubmitting}>
              {(mode === 'login' || mode === 'register' || mode === 'forgot') && (
                <label>
                  Correo electrónico
                  <input autoComplete="email" autoFocus={!isTransitioning} type="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nombre@correo.com" />
                </label>
              )}

              {(mode === 'login' || mode === 'register' || mode === 'reset') && (
                <>
                  <PasswordField
                    label={mode === 'reset' ? 'Nueva contraseña' : 'Contraseña'}
                    value={password}
                    show={showPassword}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    onChange={setPassword}
                    onToggle={() => setShowPassword((current) => !current)}
                  />
                  {mode === 'register' || mode === 'reset' ? (
                    <>
                      <p className="password-hint">Mínimo 8 caracteres, una mayúscula y un número.</p>
                      <PasswordField
                        label="Confirmar contraseña"
                        value={confirmation}
                        show={showPassword}
                        autoComplete="new-password"
                        onChange={setConfirmation}
                        onToggle={() => setShowPassword((current) => !current)}
                      />
                    </>
                  ) : null}
                </>
              )}

              {(mode === 'member' || mode === 'member-code' || mode === 'invite') && (
                <label>
                  Nickname
                  <input autoComplete="username" autoFocus required minLength={3} maxLength={30} pattern="[A-Za-z0-9._-]{3,30}" value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="Tu nickname" />
                </label>
              )}

              {(mode === 'member-code' || mode === 'two-factor') && (
                <label>
                  Código de seis dígitos
                  <input autoFocus required inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" />
                </label>
              )}

              <button className="primary-button auth-submit" type="submit">
                {isSubmitting ? 'Un momento…' : submitLabel(mode)}
              </button>
              </fieldset>
            </form>

            <div className="auth-links">
              {mode === 'login' && (
                <>
                  <button type="button" className="auth-link" disabled={isTransitioning || isSubmitting} onClick={() => switchMode('forgot')}>¿Olvidaste tu contraseña?</button>
                  <button type="button" className="auth-link auth-link-emphasis" disabled={isTransitioning || isSubmitting} onClick={() => switchMode('member')}>Ingresar como miembro</button>
                </>
              )}
              {mode === 'member' && <p>¿Ya tenés un código? <button type="button" className="auth-link auth-link-emphasis" disabled={isTransitioning || isSubmitting} onClick={() => switchMode('member-code')}>Ingresarlo</button></p>}
              {mode !== 'login' && mode !== 'register' && mode !== 'member' && (
                <button type="button" className="auth-link auth-link-emphasis" disabled={isTransitioning || isSubmitting} onClick={() => switchMode('login')}>Volver al inicio de sesión</button>
              )}
            </div>
            <p className="auth-secure-note"><span aria-hidden="true">⌑</span> Tus credenciales se protegen en el servidor.</p>
          </div>
        </div>
      </section>
    </main>
  )

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode)
    setError('')
    setMessage('')
    setPassword('')
    setConfirmation('')
    setCode('')
  }

  function selectAuthTab(nextTab: 'login' | 'register') {
    if (isTransitioning || isSubmitting) return
    if (nextTab === 'login' && mode !== 'register' && mode !== 'login') {
      switchMode('login')
      return
    }
    if (nextTab === mode) return

    setError('')
    setMessage('')
    setPassword('')
    setConfirmation('')
    setCode('')
    setTransitionDirection(nextTab)
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 640
    transitionSwapTimeout.current = window.setTimeout(() => {
      setMode(nextTab)
      transitionSwapTimeout.current = null
    }, duration / 2)
    transitionTimeout.current = window.setTimeout(() => {
      setTransitionDirection(null)
      transitionTimeout.current = null
    }, duration)
  }
}

function PasswordField({
  label,
  value,
  show,
  autoComplete,
  onChange,
  onToggle,
}: {
  label: string
  value: string
  show: boolean
  autoComplete: string
  onChange: (value: string) => void
  onToggle: () => void
}) {
  return (
    <label className="password-field">
      {label}
      <span className="password-input-wrap">
        <input
          autoComplete={autoComplete}
          required
          minLength={8}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="••••••••"
        />
        <button type="button" className="password-toggle" onClick={onToggle} aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}>
          {show ? 'Ocultar' : 'Mostrar'}
        </button>
      </span>
    </label>
  )
}

function CleaningIcon({ kind }: { kind: 'house' | 'broom' | 'mop' | 'sparkle' }) {
  const paths: Record<typeof kind, ReactNode> = {
    house: <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9M9 20v-6h6v6" /></>,
    broom: <><path d="M12 3 6 15" /><path d="m4 14 8 4M3 16l8 5m-6-4-2 4m8-3-1 4" /><path d="m15 4 5 2-1 2-5-2z" /></>,
    mop: <><path d="m14 3-3 13" /><path d="m7 14 7 2-1 3-7-2z" /><path d="m7 17-3 3m5-2-1 4m4-3 1 4m1-7 3 3" /></>,
    sparkle: <><path d="m12 3 2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6Z" /><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" /></>,
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind]}</svg>
}

function submitLabel(mode: AuthMode): string {
  return {
    login: 'Iniciar sesión',
    register: 'Crear cuenta',
    member: 'Enviar código de acceso',
    'member-code': 'Ingresar al hogar',
    'two-factor': 'Verificar e ingresar',
    forgot: 'Enviar instrucciones',
    reset: 'Guardar contraseña',
    invite: 'Aceptar invitación',
  }[mode]
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Ocurrió un error inesperado. Intentá nuevamente.'
}
