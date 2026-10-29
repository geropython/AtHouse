import 'dotenv/config'
import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import bcrypt from 'bcryptjs'
import express from 'express'
import helmet from 'helmet'
import nodemailer from 'nodemailer'
import pg from 'pg'

const { Pool } = pg
const app = express()
const isProduction = process.env.NODE_ENV === 'production'
const appOrigin = process.env.APP_ORIGIN ?? 'http://localhost:5173'
const sessionSecret = process.env.SESSION_SECRET
const sessionCookie = 'athouse_session'
const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000
const anonymousLifetimeMs = 20 * 60 * 1000
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL. Configurá PostgreSQL siguiendo .env.example.')
  process.exit(1)
}

if (isProduction && (
  !sessionSecret ||
  sessionSecret.length < 32 ||
  sessionSecret === 'replace-with-at-least-32-random-characters'
)) {
  console.error('En producción, configurá SESSION_SECRET con al menos 32 caracteres aleatorios y no uses el valor de ejemplo.')
  process.exit(1)
}

if (!sessionSecret) {
  console.warn('SESSION_SECRET no está configurado. Se generará uno temporal para esta ejecución local.')
}

const codeSecret = sessionSecret ?? randomBytes(32).toString('hex')

app.disable('x-powered-by')
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }))
app.use(express.json({ limit: '512kb' }))
app.use((request, response, next) => {
  const origin = request.get('origin')
  if (origin && origin !== appOrigin) {
    response.status(403).json({ error: 'Origen no permitido.' })
    return
  }
  next()
})

const hash = (value) => createHash('sha256').update(value).digest('hex')
const hashCode = (value) => createHmac('sha256', codeSecret).update(value).digest('hex')
const newToken = (bytes = 32) => randomBytes(bytes).toString('base64url')
const normalizedEmail = (value) => value.trim().toLowerCase()
const normalizedNickname = (value) => value.trim().toLowerCase()
const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
const isDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
const plusDays = (date, days) => {
  const value = new Date(`${date}T12:00:00`)
  value.setDate(value.getDate() + days)
  return value.toISOString().slice(0, 10)
}
const parseCookies = (header = '') => Object.fromEntries(
  header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const separator = part.indexOf('=')
    return [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))]
  }),
)
const setSessionCookie = (response, token, lifetimeMs) => {
  const attributes = [
    `${sessionCookie}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(lifetimeMs / 1000)}`,
  ]
  if (isProduction) attributes.push('Secure')
  response.setHeader('Set-Cookie', attributes.join('; '))
}
const clearSessionCookie = (response) => {
  const attributes = [`${sessionCookie}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0']
  if (isProduction) attributes.push('Secure')
  response.setHeader('Set-Cookie', attributes.join('; '))
}
const validPassword = (password) =>
  typeof password === 'string' && password.length >= 8 && /[A-Z]/.test(password) && /\d/.test(password)
const sendError = (response, status, message) => response.status(status).json({ error: message })
const asyncRoute = (handler) => (request, response, next) =>
  Promise.resolve(handler(request, response, next)).catch(next)

let mailTransport
function getMailTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM } = process.env
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASSWORD || !SMTP_FROM) return null
  mailTransport ??= nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
  })
  return mailTransport
}

async function sendEmail({ to, subject, text }) {
  const transport = getMailTransport()
  if (!transport) {
    const error = new Error('El correo transaccional todavía no está configurado.')
    error.status = 503
    throw error
  }
  await transport.sendMail({ from: process.env.SMTP_FROM, to, subject, text })
}

async function getSession(request) {
  const cookie = parseCookies(request.headers.cookie)[sessionCookie]
  if (!cookie) return null
  const result = await pool.query(
    `SELECT id_hash, user_id, pending_user_id, csrf_hash
     FROM sessions WHERE id_hash = $1 AND expires_at > now()`,
    [hash(cookie)],
  )
  return result.rows[0] ?? null
}

async function createSession(response, { userId = null, pendingUserId = null } = {}) {
  const rawSession = newToken()
  const csrfToken = newToken()
  const lifetime = userId || pendingUserId ? sessionLifetimeMs : anonymousLifetimeMs
  await pool.query(
    `INSERT INTO sessions (id_hash, user_id, pending_user_id, csrf_hash, expires_at)
     VALUES ($1, $2, $3, $4, now() + ($5 * interval '1 millisecond'))`,
    [hash(rawSession), userId, pendingUserId, hash(csrfToken), lifetime],
  )
  setSessionCookie(response, rawSession, lifetime)
  return csrfToken
}

async function requireSession(request, response, next) {
  try {
    request.authSession = await getSession(request)
    if (!request.authSession) {
      sendError(response, 401, 'La sesión expiró. Volvé a iniciar sesión.')
      return
    }
    next()
  } catch (error) {
    next(error)
  }
}

function requireCsrf(request, response, next) {
  const supplied = request.get('x-csrf-token') ?? ''
  const expected = request.authSession?.csrf_hash ?? ''
  const suppliedHash = hash(supplied)
  const matches = expected.length === suppliedHash.length &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(suppliedHash))
  if (!matches) {
    sendError(response, 403, 'La solicitud venció. Actualizá la página e intentá de nuevo.')
    return
  }
  next()
}

function requireAuth(request, response, next) {
  if (!request.authSession?.user_id) {
    sendError(response, 401, 'Iniciá sesión para continuar.')
    return
  }
  next()
}

async function requireHousehold(request, response, next) {
  try {
    const result = await pool.query(
      `SELECT m.household_id, m.role, m.nickname, h.name AS household_name
       FROM household_memberships m
       JOIN households h ON h.id = m.household_id
       WHERE m.user_id = $1`,
      [request.authSession.user_id],
    )
    if (!result.rows[0]) {
      sendError(response, 403, 'Tu cuenta todavía no pertenece a un hogar.')
      return
    }
    request.membership = result.rows[0]
    next()
  } catch (error) {
    next(error)
  }
}

function requireAdmin(request, response, next) {
  if (request.membership.role !== 'admin') {
    sendError(response, 403, 'Esta acción está disponible solo para el administrador del hogar.')
    return
  }
  next()
}

async function checkRateLimit(request, action, identifier, maxAttempts = 6, windowSeconds = 900) {
  const keys = [hashCode(`ip:${request.ip}`), hashCode(`identifier:${identifier}`)]
  for (const key of keys) {
    const result = await pool.query(
      `INSERT INTO auth_rate_limits (action, key_hash, attempts, window_started_at)
       VALUES ($1, $2, 1, now())
       ON CONFLICT (action, key_hash) DO UPDATE SET
         attempts = CASE
           WHEN auth_rate_limits.window_started_at <= now() - make_interval(secs => $3::double precision) THEN 1
           ELSE auth_rate_limits.attempts + 1
         END,
         window_started_at = CASE
           WHEN auth_rate_limits.window_started_at <= now() - make_interval(secs => $3::double precision) THEN now()
           ELSE auth_rate_limits.window_started_at
         END
       RETURNING attempts`,
      [action, key, windowSeconds],
    )
    if (result.rows[0].attempts > maxAttempts) return false
  }
  return true
}

async function getCurrentUser(userId) {
  const result = await pool.query(
    `SELECT u.id, u.email, u.email_verified_at, m.role, m.nickname,
            h.id AS household_id, h.name AS household_name,
            COALESCE(a.email_otp_enabled, false) AS email_otp_enabled
     FROM users u
     LEFT JOIN household_memberships m ON m.user_id = u.id
     LEFT JOIN households h ON h.id = m.household_id
     LEFT JOIN user_authentication_methods a ON a.user_id = u.id
     WHERE u.id = $1`,
    [userId],
  )
  const user = result.rows[0]
  if (!user) return null
  return {
    id: user.id,
    email: user.email,
    emailVerified: Boolean(user.email_verified_at),
    role: user.role,
    nickname: user.nickname,
    household: user.household_id ? { id: user.household_id, name: user.household_name } : null,
    emailOtpEnabled: user.email_otp_enabled,
  }
}

async function issueCode(userId, purpose) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  await pool.query(
    `UPDATE temporary_access_codes SET consumed_at = now()
     WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`,
    [userId, purpose],
  )
  await pool.query(
    `INSERT INTO temporary_access_codes (id, user_id, purpose, code_hash, expires_at)
     VALUES ($1, $2, $3, $4, now() + interval '5 minutes')`,
    [randomUUID(), userId, purpose, hashCode(`${userId}:${purpose}:${code}`)],
  )
  return code
}

async function consumeCode(userId, purpose, code) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(
      `SELECT id, code_hash, attempts
       FROM temporary_access_codes
       WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [userId, purpose],
    )
    const activeCode = result.rows[0]
    if (!activeCode || activeCode.attempts >= 5) {
      await client.query('COMMIT')
      return false
    }
    const candidateHash = hashCode(`${userId}:${purpose}:${code}`)
    const valid = candidateHash.length === activeCode.code_hash.length &&
      timingSafeEqual(Buffer.from(candidateHash), Buffer.from(activeCode.code_hash))
    if (valid) {
      await client.query('UPDATE temporary_access_codes SET consumed_at = now() WHERE id = $1', [activeCode.id])
    } else {
      await client.query('UPDATE temporary_access_codes SET attempts = attempts + 1 WHERE id = $1', [activeCode.id])
    }
    await client.query('COMMIT')
    return valid
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

function validateEvent(body) {
  return typeof body?.title === 'string' &&
    body.title.trim().length > 0 && body.title.trim().length <= 100 &&
    typeof body.description === 'string' &&
    isDate(body.startDate) && isDate(body.endDate) && isDate(body.expiresAt) &&
    body.endDate >= body.startDate && body.expiresAt >= body.endDate &&
    (body.status === 'pending' || body.status === 'completed') &&
    typeof body.isScheduled === 'boolean'
}

app.get('/api/health', asyncRoute(async (_request, response) => {
  await pool.query('SELECT 1')
  response.json({ status: 'ok' })
}))

app.get('/api/auth/session', asyncRoute(async (request, response) => {
  let session = await getSession(request)
  let csrfToken
  if (!session) {
    csrfToken = await createSession(response)
    session = await getSession({ headers: { cookie: response.getHeader('Set-Cookie').split(';')[0] } })
  } else {
    csrfToken = null
  }
  const user = session?.user_id ? await getCurrentUser(session.user_id) : null
  if (session?.user_id && !user) {
    await pool.query('DELETE FROM sessions WHERE id_hash = $1', [session.id_hash])
    clearSessionCookie(response)
    response.json({ user: null, csrfToken: await createSession(response) })
    return
  }
  if (session && !csrfToken) {
    const raw = parseCookies(request.headers.cookie)[sessionCookie]
    const value = request.get('x-csrf-token')
    csrfToken = value && hash(value) === session.csrf_hash ? value : null
    if (!csrfToken) {
      csrfToken = newToken()
      await pool.query('UPDATE sessions SET csrf_hash = $1 WHERE id_hash = $2', [hash(csrfToken), session.id_hash])
    }
    if (!raw) csrfToken = await createSession(response, { userId: user?.id })
  }
  response.json({ user, csrfToken })
}))

app.post('/api/auth/register', requireSession, requireCsrf, asyncRoute(async (request, response) => {
  const email = typeof request.body?.email === 'string' ? normalizedEmail(request.body.email) : ''
  const password = request.body?.password
  if (!isEmail(email)) return sendError(response, 400, 'Ingresá un correo electrónico válido.')
  if (!validPassword(password)) return sendError(response, 400, 'La contraseña debe tener al menos 8 caracteres, una mayúscula y un número.')
  if (!getMailTransport()) return sendError(response, 503, 'El registro requiere configurar SMTP en .env; no se creó ninguna cuenta.')
  if (!await checkRateLimit(request, 'register', email, 4, 3600)) return sendError(response, 429, 'Esperá antes de volver a intentarlo.')

  const userId = randomUUID()
  const token = newToken()
  const passwordHash = await bcrypt.hash(password, 12)
  const inserted = await pool.query(
    `INSERT INTO users (id, email, password_hash)
     VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id`,
    [userId, email, passwordHash],
  )
  if (!inserted.rowCount) {
    response.status(202).json({ message: 'Si el correo está disponible, recibirá un enlace de verificación.' })
    return
  }
  await pool.query(
    `INSERT INTO email_verification_tokens (id, user_id, token_hash, purpose, expires_at)
     VALUES ($1, $2, $3, 'verify_email', now() + interval '30 minutes')`,
    [randomUUID(), userId, hash(token)],
  )
  try {
    await sendEmail({
      to: email,
      subject: 'Verificá tu correo de AtHouse',
      text: `Para verificar tu correo, abrí este enlace dentro de los próximos 30 minutos:\n\n${appOrigin}/?verify=${encodeURIComponent(token)}`,
    })
  } catch (error) {
    await pool.query('DELETE FROM users WHERE id = $1 AND email_verified_at IS NULL', [userId])
    throw error
  }
  response.status(202).json({ message: 'Te enviamos un enlace. Al abrirlo, se verificará tu correo y se iniciará la sesión.' })
}))

app.post('/api/auth/verify-email', requireSession, requireCsrf, asyncRoute(async (request, response) => {
  const token = request.body?.token
  if (typeof token !== 'string' || token.length < 32) return sendError(response, 400, 'El enlace no es válido o venció.')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(
      `SELECT id, user_id FROM email_verification_tokens
       WHERE token_hash = $1 AND purpose = 'verify_email'
         AND consumed_at IS NULL AND expires_at > now()
       FOR UPDATE`,
      [hash(token)],
    )
    if (!result.rows[0]) {
      await client.query('ROLLBACK')
      return sendError(response, 400, 'El enlace no es válido o venció.')
    }
    const verification = result.rows[0]
    if (request.authSession.pending_user_id) {
      await client.query('ROLLBACK')
      return sendError(response, 409, 'Completá la verificación de acceso pendiente y después volvé a abrir el enlace.')
    }
    await client.query('UPDATE users SET email_verified_at = now() WHERE id = $1', [verification.user_id])
    await client.query('UPDATE email_verification_tokens SET consumed_at = now() WHERE id = $1', [verification.id])
    await client.query('COMMIT')
    await pool.query('DELETE FROM sessions WHERE id_hash = $1', [request.authSession.id_hash])
    const csrfToken = await createSession(response, { userId: verification.user_id })
    response.json({
      message: 'Correo verificado. Ya iniciaste sesión.',
      user: await getCurrentUser(verification.user_id),
      csrfToken,
    })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

app.post('/api/auth/forgot-password', requireSession, requireCsrf, asyncRoute(async (request, response) => {
  const email = typeof request.body?.email === 'string' ? normalizedEmail(request.body.email) : ''
  if (!isEmail(email)) return sendError(response, 400, 'Ingresá un correo electrónico válido.')
  if (!getMailTransport()) return sendError(response, 503, 'La recuperación requiere configurar SMTP; no se envió ningún correo.')
  if (!await checkRateLimit(request, 'password_reset', email, 3, 3600)) return sendError(response, 429, 'Esperá antes de volver a solicitar un enlace.')
  const userResult = await pool.query('SELECT id FROM users WHERE lower(email) = $1 AND email_verified_at IS NOT NULL', [email])
  if (userResult.rows[0]) {
    const userId = userResult.rows[0].id
    const token = newToken()
    await pool.query(
      `UPDATE email_verification_tokens SET consumed_at = now()
       WHERE user_id = $1 AND purpose = 'password_reset' AND consumed_at IS NULL`,
      [userId],
    )
    await pool.query(
      `INSERT INTO email_verification_tokens (id, user_id, token_hash, purpose, expires_at)
       VALUES ($1, $2, $3, 'password_reset', now() + interval '30 minutes')`,
      [randomUUID(), userId, hash(token)],
    )
    try {
      await sendEmail({
        to: email,
        subject: 'Restablecé tu contraseña de AtHouse',
        text: `Para elegir una contraseña nueva, abrí este enlace dentro de los próximos 30 minutos:\n\n${appOrigin}/?reset=${encodeURIComponent(token)}`,
      })
    } catch (error) {
      await pool.query(
        `UPDATE email_verification_tokens SET consumed_at = now()
         WHERE token_hash = $1 AND purpose = 'password_reset'`,
        [hash(token)],
      )
      throw error
    }
  }
  response.status(202).json({ message: 'Si el correo está registrado, recibirá instrucciones para recuperar la cuenta.' })
}))

app.post('/api/auth/reset-password', requireSession, requireCsrf, asyncRoute(async (request, response) => {
  const token = request.body?.token
  const password = request.body?.password
  if (typeof token !== 'string' || token.length < 32) return sendError(response, 400, 'El enlace no es válido o venció.')
  if (!validPassword(password)) return sendError(response, 400, 'La contraseña debe tener al menos 8 caracteres, una mayúscula y un número.')
  const passwordHash = await bcrypt.hash(password, 12)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(
      `SELECT id, user_id FROM email_verification_tokens
       WHERE token_hash = $1 AND purpose = 'password_reset'
         AND consumed_at IS NULL AND expires_at > now()
       FOR UPDATE`,
      [hash(token)],
    )
    if (!result.rows[0]) {
      await client.query('ROLLBACK')
      return sendError(response, 400, 'El enlace no es válido o venció.')
    }
    const { id, user_id: userId } = result.rows[0]
    await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId])
    await client.query('UPDATE email_verification_tokens SET consumed_at = now() WHERE id = $1', [id])
    await client.query(
      `UPDATE email_verification_tokens SET consumed_at = now()
       WHERE user_id = $1 AND purpose = 'password_reset' AND consumed_at IS NULL`,
      [userId],
    )
    await client.query('DELETE FROM sessions WHERE user_id = $1 OR pending_user_id = $1', [userId])
    await client.query('COMMIT')
    const csrfToken = await createSession(response)
    response.json({ message: 'Contraseña actualizada. Ya podés iniciar sesión.', csrfToken })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

app.post('/api/auth/login', requireSession, requireCsrf, asyncRoute(async (request, response) => {
  const email = typeof request.body?.email === 'string' ? normalizedEmail(request.body.email) : ''
  const password = request.body?.password
  if (!isEmail(email) || typeof password !== 'string' || !await checkRateLimit(request, 'login', email)) {
    return sendError(response, 429, 'No se pudo iniciar sesión. Revisá tus datos e intentá más tarde.')
  }
  const result = await pool.query('SELECT id, password_hash, email_verified_at FROM users WHERE lower(email) = $1', [email])
  const user = result.rows[0]
  const valid = user?.password_hash && await bcrypt.compare(password, user.password_hash)
  if (!valid || !user.email_verified_at) {
    return sendError(response, 401, 'Correo o contraseña incorrectos, o correo sin verificar.')
  }
  await Promise.all([
    pool.query('DELETE FROM auth_rate_limits WHERE action = $1 AND key_hash = $2', ['login', hashCode(`ip:${request.ip}`)]),
    pool.query('DELETE FROM auth_rate_limits WHERE action = $1 AND key_hash = $2', ['login', hashCode(`identifier:${email}`)]),
  ])

  const authMethod = await pool.query('SELECT email_otp_enabled FROM user_authentication_methods WHERE user_id = $1', [user.id])
  const otpEnabled = authMethod.rows[0]?.email_otp_enabled === true
  if (otpEnabled) {
    if (!getMailTransport()) return sendError(response, 503, 'La autenticación adicional está activada, pero SMTP no está configurado.')
    const code = await issueCode(user.id, 'admin_2fa')
    await sendEmail({ to: email, subject: 'Código de acceso de AtHouse', text: `Tu código de acceso es ${code}. Vence en 5 minutos.` })
    await pool.query('DELETE FROM sessions WHERE id_hash = $1', [request.authSession.id_hash])
    const csrfToken = await createSession(response, { pendingUserId: user.id })
    response.json({ requiresTwoFactor: true, csrfToken })
    return
  }

  await pool.query('DELETE FROM sessions WHERE id_hash = $1', [request.authSession.id_hash])
  const csrfToken = await createSession(response, { userId: user.id })
  response.json({ user: await getCurrentUser(user.id), csrfToken })
}))

app.post('/api/auth/member/code', requireSession, requireCsrf, asyncRoute(async (request, response) => {
  const nickname = typeof request.body?.nickname === 'string' ? normalizedNickname(request.body.nickname) : ''
  if (!/^[a-z0-9._-]{3,30}$/.test(nickname)) return sendError(response, 400, 'Ingresá un nickname válido.')
  if (!getMailTransport()) return sendError(response, 503, 'El acceso de miembros requiere configurar SMTP; no se envió ningún código.')
  if (!await checkRateLimit(request, 'member_code', nickname, 3, 900)) return sendError(response, 429, 'Esperá antes de solicitar otro código.')
  const result = await pool.query(
    `SELECT u.id, u.email FROM users u JOIN household_memberships m ON m.user_id = u.id
     WHERE lower(m.nickname) = $1 AND m.role = 'member'`,
    [nickname],
  )
  if (result.rows[0]) {
    const { id, email } = result.rows[0]
    const code = await issueCode(id, 'member_login')
    await sendEmail({ to: email, subject: 'Tu código de acceso a AtHouse', text: `Tu código de acceso es ${code}. Vence en 5 minutos.` })
  }
  response.status(202).json({ message: 'Si el nickname está asociado a un miembro, recibirá un código por correo.' })
}))

app.post('/api/auth/member/login', requireSession, requireCsrf, asyncRoute(async (request, response) => {
  const nickname = typeof request.body?.nickname === 'string' ? normalizedNickname(request.body.nickname) : ''
  const code = request.body?.code
  if (!/^[a-z0-9._-]{3,30}$/.test(nickname) || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    return sendError(response, 400, 'El nickname o el código no son válidos.')
  }
  if (!await checkRateLimit(request, 'member_login', nickname, 5, 900)) return sendError(response, 429, 'Esperá antes de volver a intentarlo.')
  const result = await pool.query(
    `SELECT u.id FROM users u JOIN household_memberships m ON m.user_id = u.id
     WHERE lower(m.nickname) = $1 AND m.role = 'member'`,
    [nickname],
  )
  if (!result.rows[0] || !await consumeCode(result.rows[0].id, 'member_login', code)) {
    return sendError(response, 401, 'Nickname o código incorrectos o vencidos.')
  }
  await pool.query('DELETE FROM sessions WHERE id_hash = $1', [request.authSession.id_hash])
  const csrfToken = await createSession(response, { userId: result.rows[0].id })
  response.json({ user: await getCurrentUser(result.rows[0].id), csrfToken })
}))

app.post('/api/auth/verify-two-factor', requireSession, requireCsrf, asyncRoute(async (request, response) => {
  const userId = request.authSession.pending_user_id
  const code = request.body?.code
  if (!userId || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    return sendError(response, 400, 'El código no es válido.')
  }
  if (!await checkRateLimit(request, 'admin_2fa', userId, 5, 900) || !await consumeCode(userId, 'admin_2fa', code)) {
    return sendError(response, 401, 'El código no es válido o venció.')
  }
  await pool.query('DELETE FROM sessions WHERE id_hash = $1', [request.authSession.id_hash])
  const csrfToken = await createSession(response, { userId })
  response.json({ user: await getCurrentUser(userId), csrfToken })
}))

app.post('/api/auth/logout', requireSession, requireCsrf, asyncRoute(async (request, response) => {
  await pool.query('DELETE FROM sessions WHERE id_hash = $1', [request.authSession.id_hash])
  clearSessionCookie(response)
  response.status(204).end()
}))

app.post('/api/households', requireSession, requireCsrf, requireAuth, asyncRoute(async (request, response) => {
  const name = typeof request.body?.name === 'string' ? request.body.name.trim() : ''
  if (name.length < 1 || name.length > 80) return sendError(response, 400, 'El nombre del hogar debe tener entre 1 y 80 caracteres.')
  const legacyData = request.body?.legacyData
  const items = legacyData?.items ?? []
  const assignments = legacyData?.assignments ?? []
  const events = legacyData?.events ?? []
  const validUuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  if (!Array.isArray(items) || items.length > 500 ||
      !items.every((item) => validUuid(item?.id) && typeof item.product === 'string' && item.product.trim().length > 0 && item.product.length <= 80 &&
        typeof item.brand === 'string' && item.brand.length <= 60 && typeof item.price === 'number' && Number.isFinite(item.price) && item.price >= 0 &&
        ['alta', 'media', 'baja'].includes(item.priority) && typeof item.completed === 'boolean' && Number.isFinite(item.createdAt)) ||
      !Array.isArray(assignments) || assignments.length > 500 ||
      !assignments.every((assignment) => validUuid(assignment?.itemId) && isDate(assignment.date) && isDate(assignment.expiresAt) && assignment.expiresAt >= assignment.date) ||
      !Array.isArray(events) || events.length > 500 ||
      !events.every((event) => validUuid(event?.id) && validateEvent(event) && Number.isFinite(event.createdAt))) {
    return sendError(response, 400, 'Los datos locales seleccionados para importar no son válidos.')
  }
  const itemIds = new Set(items.map((item) => item.id))
  if (assignments.some((assignment) => !itemIds.has(assignment.itemId))) {
    return sendError(response, 400, 'Hay asignaciones locales que no corresponden a una compra.')
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const existing = await client.query('SELECT 1 FROM household_memberships WHERE user_id = $1', [request.authSession.user_id])
    if (existing.rowCount) {
      await client.query('ROLLBACK')
      return sendError(response, 409, 'Tu cuenta ya pertenece a un hogar.')
    }
    const householdId = randomUUID()
    await client.query('INSERT INTO households (id, name, owner_user_id) VALUES ($1, $2, $3)', [householdId, name, request.authSession.user_id])
    await client.query(
      `INSERT INTO household_memberships (id, household_id, user_id, role)
       VALUES ($1, $2, $3, 'admin')`,
      [randomUUID(), householdId, request.authSession.user_id],
    )
    for (const item of items) {
      await client.query(
        `INSERT INTO shopping_items (id, household_id, product, brand, price, priority, completed, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8 / 1000.0))`,
        [item.id, householdId, item.product.trim(), item.brand.trim(), item.price, item.priority, item.completed, item.createdAt],
      )
    }
    for (const assignment of assignments) {
      await client.query(
        `INSERT INTO calendar_assignments (item_id, household_id, scheduled_date, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [assignment.itemId, householdId, assignment.date, assignment.expiresAt],
      )
    }
    for (const event of events) {
      await client.query(
        `INSERT INTO home_events (id, household_id, created_by_user_id, title, description, start_date, end_date, expires_at, status, is_scheduled, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, to_timestamp($11 / 1000.0))`,
        [event.id, householdId, request.authSession.user_id, event.title.trim(), event.description.trim().slice(0, 500), event.startDate, event.endDate, event.expiresAt, event.status, event.isScheduled, event.createdAt],
      )
    }
    await client.query('COMMIT')
    response.status(201).json({
      household: { id: householdId, name, role: 'admin' },
      imported: { items: items.length, assignments: assignments.length, events: events.length },
    })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

app.get('/api/household', requireSession, requireAuth, requireHousehold, requireAdmin, asyncRoute(async (request, response) => {
  const [members, invitations, security] = await Promise.all([
    pool.query(
      `SELECT u.id, u.email, u.email_verified_at, m.nickname, m.role, m.joined_at
       FROM household_memberships m JOIN users u ON u.id = m.user_id
       WHERE m.household_id = $1 ORDER BY m.joined_at`,
      [request.membership.household_id],
    ),
    pool.query(
      `SELECT id, email, expires_at, created_at FROM household_invitations
       WHERE household_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC`,
      [request.membership.household_id],
    ),
    pool.query('SELECT email_otp_enabled FROM user_authentication_methods WHERE user_id = $1', [request.authSession.user_id]),
  ])
  response.json({
    household: { id: request.membership.household_id, name: request.membership.household_name },
    members: members.rows.map((member) => ({
      id: member.id,
      email: member.email,
      emailVerified: Boolean(member.email_verified_at),
      nickname: member.nickname,
      role: member.role,
      joinedAt: member.joined_at,
    })),
    invitations: invitations.rows,
    emailOtpEnabled: security.rows[0]?.email_otp_enabled === true,
  })
}))

app.get('/api/household/summary', requireSession, requireAuth, requireHousehold, asyncRoute(async (request, response) => {
  const [members, pending] = await Promise.all([
    pool.query(
      `SELECT m.user_id AS id,
              COALESCE(m.nickname, split_part(u.email, '@', 1)) AS "displayName",
              m.role
       FROM household_memberships m
       JOIN users u ON u.id = m.user_id
       WHERE m.household_id = $1
       ORDER BY CASE WHEN m.role = 'admin' THEN 0 ELSE 1 END, m.joined_at`,
      [request.membership.household_id],
    ),
    request.membership.role === 'admin'
      ? pool.query(
        `SELECT count(*)::integer AS count FROM household_invitations
         WHERE household_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()`,
        [request.membership.household_id],
      )
      : Promise.resolve({ rows: [{ count: 0 }] }),
  ])
  response.json({
    members: members.rows,
    pendingInvitations: pending.rows[0].count,
  })
}))

app.patch('/api/household', requireSession, requireCsrf, requireAuth, requireHousehold, requireAdmin, asyncRoute(async (request, response) => {
  const name = typeof request.body?.name === 'string' ? request.body.name.trim() : ''
  if (name.length < 1 || name.length > 80) return sendError(response, 400, 'El nombre debe tener entre 1 y 80 caracteres.')
  await pool.query('UPDATE households SET name = $1 WHERE id = $2', [name, request.membership.household_id])
  response.json({ household: { id: request.membership.household_id, name } })
}))

app.post('/api/household/invitations', requireSession, requireCsrf, requireAuth, requireHousehold, requireAdmin, asyncRoute(async (request, response) => {
  const email = typeof request.body?.email === 'string' ? normalizedEmail(request.body.email) : ''
  if (!isEmail(email)) return sendError(response, 400, 'Ingresá un correo electrónico válido.')
  if (!getMailTransport()) return sendError(response, 503, 'Para invitar miembros, configurá SMTP. No se creó ninguna invitación.')
  if (!await checkRateLimit(request, 'invitation', email, 5, 3600)) return sendError(response, 429, 'Se alcanzó el límite de invitaciones. Esperá antes de volver a intentar.')

  const token = newToken()
  const invitationId = randomUUID()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT id FROM households WHERE id = $1 FOR UPDATE', [request.membership.household_id])
    const capacity = await client.query(
      `SELECT
         (SELECT count(*) FROM household_memberships WHERE household_id = $1) +
         (SELECT count(*) FROM household_invitations
          WHERE household_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()) AS occupied`,
      [request.membership.household_id],
    )
    if (Number(capacity.rows[0].occupied) >= 5) {
      await client.query('ROLLBACK')
      return sendError(response, 409, 'El hogar ya tiene 5 lugares ocupados entre miembros e invitaciones pendientes.')
    }
    await client.query(
      `INSERT INTO household_invitations (id, household_id, email, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '7 days')`,
      [invitationId, request.membership.household_id, email, hash(token)],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
  try {
    await sendEmail({
      to: email,
      subject: `Invitación a ${request.membership.household_name} en AtHouse`,
      text: `Te invitaron a unirte a ${request.membership.household_name}. Aceptá la invitación dentro de 7 días:\n\n${appOrigin}/?invitation=${encodeURIComponent(token)}`,
    })
  } catch (error) {
    await pool.query('UPDATE household_invitations SET revoked_at = now() WHERE id = $1', [invitationId])
    throw error
  }
  response.status(201).json({ message: 'Invitación enviada.' })
}))

app.post('/api/invitations/accept', requireSession, requireCsrf, asyncRoute(async (request, response) => {
  const token = request.body?.token
  const nickname = typeof request.body?.nickname === 'string' ? normalizedNickname(request.body.nickname) : ''
  if (typeof token !== 'string' || token.length < 32) return sendError(response, 400, 'La invitación no es válida o venció.')
  if (!/^[a-z0-9._-]{3,30}$/.test(nickname)) return sendError(response, 400, 'El nickname debe tener entre 3 y 30 caracteres (letras, números, punto, guion o guion bajo).')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const inviteResult = await client.query(
      `SELECT i.id, i.email, i.household_id FROM household_invitations i
       WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
       FOR UPDATE`,
      [hash(token)],
    )
    const invitation = inviteResult.rows[0]
    if (!invitation) {
      await client.query('ROLLBACK')
      return sendError(response, 400, 'La invitación no es válida o venció.')
    }
    await client.query('SELECT id FROM households WHERE id = $1 FOR UPDATE', [invitation.household_id])
    const membershipCount = await client.query(
      'SELECT count(*)::integer AS count FROM household_memberships WHERE household_id = $1',
      [invitation.household_id],
    )
    if (membershipCount.rows[0].count >= 5) {
      await client.query('ROLLBACK')
      return sendError(response, 409, 'El hogar ya alcanzó el máximo de 5 personas.')
    }
    const existing = await client.query(
      'SELECT id FROM users WHERE lower(email) = $1 FOR UPDATE',
      [invitation.email],
    )
    let userId = existing.rows[0]?.id
    if (userId) {
      const membership = await client.query(
        'SELECT 1 FROM household_memberships WHERE user_id = $1',
        [userId],
      )
      if (membership.rowCount) {
        await client.query('ROLLBACK')
        return sendError(response, 409, 'Esta cuenta ya pertenece a un hogar. Por ahora, cada cuenta puede pertenecer a un solo hogar.')
      }
      await client.query(
        'UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1',
        [userId],
      )
    } else {
      userId = randomUUID()
      await client.query(
        'INSERT INTO users (id, email, email_verified_at) VALUES ($1, $2, now())',
        [userId, invitation.email],
      )
    }
    if (!userId) {
      await client.query('ROLLBACK')
      return sendError(response, 409, 'No se pudo asociar la invitación con una cuenta.')
    }
    await client.query(
      `INSERT INTO household_memberships (id, household_id, user_id, role, nickname)
       VALUES ($1, $2, $3, 'member', $4)`,
      [randomUUID(), invitation.household_id, userId, nickname],
    )
    await client.query('UPDATE household_invitations SET accepted_at = now() WHERE id = $1', [invitation.id])
    await client.query('COMMIT')
    response.status(201).json({ message: 'Te uniste al hogar. Solicitá un código de acceso para iniciar sesión.' })
  } catch (error) {
    await client.query('ROLLBACK')
    if (error.code === '23505' && error.constraint === 'membership_nickname_unique') {
      return sendError(response, 409, 'Ese nickname ya está en uso.')
    }
    if (error.code === '23505' && error.constraint === 'users_email_unique') {
      return sendError(response, 409, 'La cuenta ya existe. Volvé a aceptar la invitación para asociarla.')
    }
    throw error
  } finally {
    client.release()
  }
}))

app.delete('/api/household/members/:userId', requireSession, requireCsrf, requireAuth, requireHousehold, requireAdmin, asyncRoute(async (request, response) => {
  if (request.params.userId === request.authSession.user_id) return sendError(response, 400, 'El administrador no puede eliminarse a sí mismo.')
  const result = await pool.query(
    `DELETE FROM household_memberships
     WHERE user_id = $1 AND household_id = $2 AND role = 'member'
     RETURNING user_id`,
    [request.params.userId, request.membership.household_id],
  )
  if (!result.rowCount) return sendError(response, 404, 'No se encontró ese miembro.')
  await pool.query('DELETE FROM temporary_access_codes WHERE user_id = $1', [request.params.userId])
  await pool.query('DELETE FROM sessions WHERE user_id = $1 OR pending_user_id = $1', [request.params.userId])
  response.status(204).end()
}))

app.delete('/api/household/invitations/:invitationId', requireSession, requireCsrf, requireAuth, requireHousehold, requireAdmin, asyncRoute(async (request, response) => {
  const result = await pool.query(
    `UPDATE household_invitations SET revoked_at = now()
     WHERE id = $1 AND household_id = $2 AND accepted_at IS NULL AND revoked_at IS NULL
     RETURNING id`,
    [request.params.invitationId, request.membership.household_id],
  )
  if (!result.rowCount) return sendError(response, 404, 'No se encontró una invitación pendiente.')
  response.status(204).end()
}))

app.patch('/api/security/email-otp', requireSession, requireCsrf, requireAuth, asyncRoute(async (request, response) => {
  const enabled = request.body?.enabled
  if (typeof enabled !== 'boolean') return sendError(response, 400, 'La configuración no es válida.')
  const user = await pool.query('SELECT email_verified_at FROM users WHERE id = $1', [request.authSession.user_id])
  if (enabled && !user.rows[0]?.email_verified_at) return sendError(response, 403, 'Verificá tu correo antes de activar la autenticación adicional.')
  if (enabled && !getMailTransport()) return sendError(response, 503, 'Configurá SMTP para usar códigos de doble factor por correo.')
  await pool.query(
    `INSERT INTO user_authentication_methods (user_id, email_otp_enabled)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET email_otp_enabled = EXCLUDED.email_otp_enabled, updated_at = now()`,
    [request.authSession.user_id, enabled],
  )
  response.json({ emailOtpEnabled: enabled })
}))

app.get('/api/data', requireSession, requireAuth, requireHousehold, asyncRoute(async (request, response) => {
  const householdId = request.membership.household_id
  const [items, assignments, events] = await Promise.all([
    pool.query('SELECT id, product, brand, price, priority, completed, extract(epoch from created_at) * 1000 AS "createdAt" FROM shopping_items WHERE household_id = $1 ORDER BY created_at DESC', [householdId]),
    pool.query('SELECT item_id AS "itemId", scheduled_date::text AS date, expires_at::text AS "expiresAt" FROM calendar_assignments WHERE household_id = $1', [householdId]),
    pool.query(
      `WITH household_members AS (
         SELECT user_id,
                row_number() OVER (
                  ORDER BY CASE WHEN role = 'admin' THEN 0 ELSE 1 END, joined_at
                )::integer AS member_number
         FROM household_memberships
         WHERE household_id = $1
       )
       SELECT e.id, e.title, e.description,
              e.start_date::text AS "startDate", e.end_date::text AS "endDate",
              e.expires_at::text AS "expiresAt", e.status,
              e.is_scheduled AS "isScheduled",
              COALESCE(m.member_number, 1)::integer AS "creatorMemberNumber",
              extract(epoch from e.created_at) * 1000 AS "createdAt"
       FROM home_events e
       LEFT JOIN household_members m ON m.user_id = e.created_by_user_id
       WHERE e.household_id = $1
       ORDER BY e.created_at DESC`,
      [householdId],
    ),
  ])
  response.json({ items: items.rows.map((item) => ({ ...item, price: Number(item.price), createdAt: Number(item.createdAt) })), assignments: assignments.rows, events: events.rows.map((event) => ({ ...event, createdAt: Number(event.createdAt) })) })
}))

app.post('/api/shopping', requireSession, requireCsrf, requireAuth, requireHousehold, asyncRoute(async (request, response) => {
  const { product, brand = '', price, priority = 'media' } = request.body ?? {}
  if (typeof product !== 'string' || !product.trim() || product.trim().length > 80) return sendError(response, 400, 'El nombre del producto es obligatorio y no puede superar 80 caracteres.')
  if (typeof brand !== 'string' || brand.length > 60) return sendError(response, 400, 'La marca no puede superar 60 caracteres.')
  if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) return sendError(response, 400, 'Ingresá un precio válido.')
  if (!['alta', 'media', 'baja'].includes(priority)) return sendError(response, 400, 'La prioridad no es válida.')
  const id = randomUUID()
  const result = await pool.query(
    `INSERT INTO shopping_items (id, household_id, product, brand, price, priority)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, product, brand, price, priority, completed, extract(epoch from created_at) * 1000 AS "createdAt"`,
    [id, request.membership.household_id, product.trim(), brand.trim(), price, priority],
  )
  response.status(201).json({ item: { ...result.rows[0], price: Number(result.rows[0].price), createdAt: Number(result.rows[0].createdAt) } })
}))

app.patch('/api/shopping/:itemId', requireSession, requireCsrf, requireAuth, requireHousehold, asyncRoute(async (request, response) => {
  const { product, brand, price, priority, completed } = request.body ?? {}
  if (product !== undefined && (typeof product !== 'string' || !product.trim() || product.trim().length > 80)) return sendError(response, 400, 'El nombre del producto no es válido.')
  if (brand !== undefined && (typeof brand !== 'string' || brand.length > 60)) return sendError(response, 400, 'La marca no es válida.')
  if (price !== undefined && (typeof price !== 'number' || !Number.isFinite(price) || price < 0)) return sendError(response, 400, 'El precio no es válido.')
  if (priority !== undefined && !['alta', 'media', 'baja'].includes(priority)) return sendError(response, 400, 'La prioridad no es válida.')
  if (completed !== undefined && typeof completed !== 'boolean') return sendError(response, 400, 'El estado no es válido.')
  const result = await pool.query(
    `UPDATE shopping_items SET
       product = COALESCE($1, product), brand = COALESCE($2, brand),
       price = COALESCE($3, price), priority = COALESCE($4, priority),
       completed = COALESCE($5, completed)
     WHERE id = $6 AND household_id = $7
     RETURNING id`,
    [product?.trim() ?? null, brand?.trim() ?? null, price ?? null, priority ?? null, completed ?? null, request.params.itemId, request.membership.household_id],
  )
  if (!result.rowCount) return sendError(response, 404, 'No se encontró ese producto.')
  response.status(204).end()
}))

app.post('/api/assignments', requireSession, requireCsrf, requireAuth, requireHousehold, asyncRoute(async (request, response) => {
  const { itemId, date } = request.body ?? {}
  if (typeof itemId !== 'string' || !isDate(date)) return sendError(response, 400, 'La compra o fecha no es válida.')
  const result = await pool.query(
    `INSERT INTO calendar_assignments (item_id, household_id, scheduled_date, expires_at)
     SELECT id, household_id, $3::date, $4::date
     FROM shopping_items WHERE id = $1 AND household_id = $2
     ON CONFLICT (item_id) DO UPDATE SET
       scheduled_date = EXCLUDED.scheduled_date,
       expires_at = EXCLUDED.expires_at
     RETURNING item_id`,
    [itemId, request.membership.household_id, date, plusDays(date, 2)],
  )
  if (!result.rowCount) return sendError(response, 404, 'No se encontró esa compra en este hogar.')
  response.status(204).end()
}))

app.delete('/api/assignments/:itemId', requireSession, requireCsrf, requireAuth, requireHousehold, asyncRoute(async (request, response) => {
  await pool.query('DELETE FROM calendar_assignments WHERE item_id = $1 AND household_id = $2', [request.params.itemId, request.membership.household_id])
  response.status(204).end()
}))

app.post('/api/events', requireSession, requireCsrf, requireAuth, requireHousehold, asyncRoute(async (request, response) => {
  if (!validateEvent(request.body)) return sendError(response, 400, 'Revisá el título, estado y fechas del evento.')
  const { title, description, startDate, endDate, expiresAt, status, isScheduled } = request.body
  const result = await pool.query(
    `INSERT INTO home_events (id, household_id, created_by_user_id, title, description, start_date, end_date, expires_at, status, is_scheduled)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, title, description, start_date::text AS "startDate", end_date::text AS "endDate", expires_at::text AS "expiresAt", status, is_scheduled AS "isScheduled", extract(epoch from created_at) * 1000 AS "createdAt"`,
    [randomUUID(), request.membership.household_id, request.authSession.user_id, title.trim(), description.trim().slice(0, 500), startDate, endDate, expiresAt, status, isScheduled],
  )
  response.status(201).json({ event: { ...result.rows[0], createdAt: Number(result.rows[0].createdAt) } })
}))

app.patch('/api/events/:eventId', requireSession, requireCsrf, requireAuth, requireHousehold, asyncRoute(async (request, response) => {
  if (!validateEvent(request.body)) return sendError(response, 400, 'Revisá el título, estado y fechas del evento.')
  const { title, description, startDate, endDate, expiresAt, status, isScheduled } = request.body
  const result = await pool.query(
    `UPDATE home_events SET title = $1, description = $2, start_date = $3, end_date = $4,
       expires_at = $5, status = $6, is_scheduled = $7
     WHERE id = $8 AND household_id = $9 RETURNING id`,
    [title.trim(), description.trim().slice(0, 500), startDate, endDate, expiresAt, status, isScheduled, request.params.eventId, request.membership.household_id],
  )
  if (!result.rowCount) return sendError(response, 404, 'No se encontró ese evento.')
  response.status(204).end()
}))

app.patch('/api/events/:eventId/schedule', requireSession, requireCsrf, requireAuth, requireHousehold, asyncRoute(async (request, response) => {
  if (typeof request.body?.isScheduled !== 'boolean') return sendError(response, 400, 'El estado de programación no es válido.')
  const result = await pool.query(
    'UPDATE home_events SET is_scheduled = $1 WHERE id = $2 AND household_id = $3 RETURNING id',
    [request.body.isScheduled, request.params.eventId, request.membership.household_id],
  )
  if (!result.rowCount) return sendError(response, 404, 'No se encontró ese evento.')
  response.status(204).end()
}))

app.patch('/api/events/:eventId/status', requireSession, requireCsrf, requireAuth, requireHousehold, asyncRoute(async (request, response) => {
  const { status } = request.body ?? {}
  if (status !== 'pending' && status !== 'completed') return sendError(response, 400, 'El estado del evento no es válido.')
  const result = await pool.query(
    'UPDATE home_events SET status = $1 WHERE id = $2 AND household_id = $3 RETURNING id',
    [status, request.params.eventId, request.membership.household_id],
  )
  if (!result.rowCount) return sendError(response, 404, 'No se encontró ese evento.')
  response.status(204).end()
}))

app.use((error, _request, response, _next) => {
  console.error('Error en la API de AtHouse.', error)
  if (response.headersSent) return
  response.status(error.status ?? 500).json({
    error: error.status ? error.message : 'Ocurrió un error interno. Intentá nuevamente.',
  })
})

const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3001)
const server = app.listen(port, '0.0.0.0', () => {
  console.info(`API de AtHouse lista en http://127.0.0.1:${port}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(async () => {
    await pool.end()
    process.exit(0)
  }))
}
