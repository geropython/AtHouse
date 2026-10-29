import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import AdminPage from './AdminPage'
import AuthPage from './AuthPage'
import CalendarPage from './CalendarPage'
import EventsPage from './EventsPage'
import HouseholdSetupPage from './HouseholdSetupPage'
import { apiRequest, type AuthUser, type SessionResponse } from './lib/api'
import type { CalendarAssignment, HomeEvent, Priority, ShoppingItem, ShoppingItemInput } from './types'

type Page = 'shopping' | 'calendar' | 'events' | 'admin' | 'sethouse'

const navigation: { id: Page; label: string; icon: string }[] = [
  { id: 'shopping', label: 'Compras', icon: 'bag' },
  { id: 'calendar', label: 'Calendario', icon: 'calendar' },
  { id: 'events', label: 'Eventos', icon: 'event' },
  { id: 'admin', label: 'Adm House', icon: 'house' },
  { id: 'sethouse', label: 'SetHouse', icon: 'sparkles' },
]

const priorityLabels: Record<Priority, string> = {
  alta: 'Alta',
  media: 'Media',
  baja: 'Baja',
}

const pesoFormatter = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 2,
})

const dollarFormatter = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
})

async function loadBlueDollarSellRate(signal: AbortSignal): Promise<number> {
  const response = await fetch('https://dolarapi.com/v1/dolares/blue', { signal })
  if (!response.ok) {
    throw new Error(`La consulta de la cotización respondió ${response.status}.`)
  }

  const data: unknown = await response.json()
  if (
    !data ||
    typeof data !== 'object' ||
    !('venta' in data) ||
    typeof data.venta !== 'number' ||
    !Number.isFinite(data.venta) ||
    data.venta <= 0
  ) {
    throw new Error('La respuesta de la cotización no tiene un valor de venta válido.')
  }

  return data.venta
}

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  }

  if (name === 'bag') {
    return <svg {...common}><path d="M5 8h14l1 12H4L5 8Z" /><path d="M9 9V6a3 3 0 0 1 6 0v3" /></svg>
  }
  if (name === 'house') {
    return <svg {...common}><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9M9 20v-6h6v6" /></svg>
  }
  if (name === 'sparkles') {
    return <svg {...common}><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="m19 14 .9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14Z" /></svg>
  }
  if (name === 'calendar') {
    return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></svg>
  }
  if (name === 'event') {
    return <svg {...common}><path d="M4 5h16v16H4zM8 3v4M16 3v4M4 10h16" /><path d="m9 15 2 2 4-4" /></svg>
  }
  if (name === 'plus') {
    return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>
  }
  if (name === 'edit') {
    return <svg {...common}><path d="m15 5 4 4M4 20l4.3-.9L19 8.4 15.6 5 4.9 15.7 4 20Z" /></svg>
  }
  if (name === 'check') {
    return <svg {...common}><path d="m5 12 4 4L19 6" /></svg>
  }
  if (name === 'arrow') {
    return <svg {...common}><path d="M7 17 17 7M7 7h10v10" /></svg>
  }
  return null
}

function App() {
  const [items, setItems] = useState<ShoppingItem[]>([])
  const [assignments, setAssignments] = useState<CalendarAssignment[]>([])
  const [events, setEvents] = useState<HomeEvent[]>([])
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [csrfToken, setCsrfToken] = useState('')
  const [isAuthLoading, setIsAuthLoading] = useState(true)
  const [isDataLoading, setIsDataLoading] = useState(false)
  const [authError, setAuthError] = useState('')
  const [authRetry, setAuthRetry] = useState(0)
  const [isAuthActionPending, setIsAuthActionPending] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return params.has('verify') || params.has('reset') || params.has('invitation')
  })
  const [activePage, setActivePage] = useState<Page>('shopping')
  const [editingItem, setEditingItem] = useState<ShoppingItem | null>(null)
  const [eventToEdit, setEventToEdit] = useState<HomeEvent | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [dataError, setDataError] = useState('')
  const [blueDollarRate, setBlueDollarRate] = useState<number | null>(null)
  const [exchangeRateError, setExchangeRateError] = useState(false)
  const [exchangeRateRetry, setExchangeRateRetry] = useState(0)
  const sessionRequest = useRef<Promise<SessionResponse> | null>(null)
  const handleSessionExpired = useCallback(() => {
    setAuthUser(null)
    setCsrfToken('')
    sessionRequest.current = null
    setAuthRetry((attempt) => attempt + 1)
  }, [])
  const handleAuthActionComplete = useCallback(() => {
    setIsAuthActionPending(false)
    setAuthUser(null)
    setAuthError('')
    sessionRequest.current = null
    setAuthRetry((attempt) => attempt + 1)
  }, [])

  useEffect(() => {
    let active = true
    setIsAuthLoading(true)
    sessionRequest.current ??= apiRequest<SessionResponse>('/auth/session')
    sessionRequest.current
      .then((session) => {
        if (!active) return
        setCsrfToken(session.csrfToken)
        setAuthUser(session.user)
        setAuthError('')
      })
      .catch((error: unknown) => {
        sessionRequest.current = null
        if (!active) return
        console.error('No se pudo consultar la sesión de AtHouse.', error)
        setAuthError(error instanceof Error ? error.message : 'No se pudo conectar con el servidor de AtHouse.')
      })
      .finally(() => {
        if (active) setIsAuthLoading(false)
      })
    return () => { active = false }
  }, [authRetry])

  useEffect(() => {
    if (!authUser?.household) {
      setItems([])
      setAssignments([])
      setEvents([])
      setIsDataLoading(false)
      return
    }

    let active = true
    setIsDataLoading(true)
    apiRequest<{ items: ShoppingItem[]; assignments: CalendarAssignment[]; events: HomeEvent[] }>('/data')
      .then((data) => {
        if (!active) return
        setItems(data.items)
        setAssignments(data.assignments)
        setEvents(data.events)
        setDataError('')
      })
      .catch((error: unknown) => {
        if (!active) return
        console.error('No se pudieron cargar los datos del hogar.', error)
        setDataError(error instanceof Error ? error.message : 'No se pudieron cargar los datos del hogar.')
        if (isUnauthorized(error)) handleSessionExpired()
      })
      .finally(() => {
        if (active) setIsDataLoading(false)
      })
    return () => { active = false }
  }, [authUser?.household?.id, authUser?.id, handleSessionExpired])

  async function refreshHouseholdData() {
    const data = await apiRequest<{ items: ShoppingItem[]; assignments: CalendarAssignment[]; events: HomeEvent[] }>('/data')
    setItems(data.items)
    setAssignments(data.assignments)
    setEvents(data.events)
    setDataError('')
  }

  function handleRequestError(error: unknown) {
    console.error('No se pudo guardar el cambio en el servidor.', error)
    setDataError(error instanceof Error ? error.message : 'No se pudo guardar el cambio.')
    if (isUnauthorized(error)) handleSessionExpired()
  }

  useEffect(() => {
    const controller = new AbortController()

    loadBlueDollarSellRate(controller.signal)
      .then((rate) => {
        setBlueDollarRate(rate)
        setExchangeRateError(false)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        console.error('No se pudo consultar la cotización del dólar blue.', error)
        setExchangeRateError(true)
      })

    return () => controller.abort()
  }, [exchangeRateRetry])

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => b.createdAt - a.createdAt),
    [items],
  )
  const pendingItems = sortedItems.filter((item) => !item.completed)
  const completedItems = sortedItems.filter((item) => item.completed)

  function openNewItemForm() {
    setEditingItem(null)
    setIsFormOpen(true)
  }

  async function saveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const itemData: ShoppingItemInput = {
      product: String(formData.get('product')).trim(),
      brand: String(formData.get('brand')).trim(),
      price: Number(formData.get('price')),
      priority: formData.get('priority') as Priority,
    }

    try {
      await apiRequest(editingItem ? `/shopping/${editingItem.id}` : '/shopping', {
        method: editingItem ? 'PATCH' : 'POST',
        body: itemData,
        csrfToken,
      })
      await refreshHouseholdData()
      setIsFormOpen(false)
      setEditingItem(null)
    } catch (error) {
      handleRequestError(error)
    }
  }

  async function toggleCompleted(id: string) {
    const item = items.find((candidate) => candidate.id === id)
    if (!item) return
    try {
      await apiRequest(`/shopping/${id}`, {
        method: 'PATCH',
        body: { completed: !item.completed },
        csrfToken,
      })
      await refreshHouseholdData()
    } catch (error) {
      handleRequestError(error)
    }
  }

  function startEditing(item: ShoppingItem) {
    setEditingItem(item)
    setIsFormOpen(true)
  }

  async function setTaskCalendarDate(itemId: string, date: string | null) {
    try {
      await apiRequest(date ? '/assignments' : `/assignments/${itemId}`, {
        method: date ? 'POST' : 'DELETE',
        ...(date ? { body: { itemId, date } } : {}),
        csrfToken,
      })
      await refreshHouseholdData()
    } catch (error) {
      handleRequestError(error)
    }
  }

  async function setEventScheduled(eventId: string, scheduled: boolean) {
    const event = events.find((candidate) => candidate.id === eventId)
    if (!event) return
    if (
      !scheduled &&
      event.startDate !== event.endDate &&
      !window.confirm(`¿Quitar "${event.title}" del calendario? El evento y sus fechas se conservarán.`)
    ) return
    try {
      await apiRequest(`/events/${eventId}/schedule`, {
        method: 'PATCH',
        body: { isScheduled: scheduled },
        csrfToken,
      })
      await refreshHouseholdData()
    } catch (error) {
      handleRequestError(error)
    }
  }

  async function saveHomeEvent(
    details: Omit<HomeEvent, 'id' | 'createdAt' | 'isScheduled'>,
    existing: HomeEvent | null,
  ) {
    const eventDetails = { ...details, isScheduled: existing?.isScheduled ?? false }
    try {
      await apiRequest(existing ? `/events/${existing.id}` : '/events', {
        method: existing ? 'PATCH' : 'POST',
        body: eventDetails,
        csrfToken,
      })
      await refreshHouseholdData()
    } catch (error) {
      handleRequestError(error)
      throw error
    }
  }

  async function setEventStatus(eventId: string, status: HomeEvent['status']) {
    try {
      await apiRequest(`/events/${eventId}/status`, { method: 'PATCH', body: { status }, csrfToken })
      await refreshHouseholdData()
    } catch (error) {
      handleRequestError(error)
    }
  }

  function finishAuthentication(user: AuthUser, token: string) {
    setIsAuthActionPending(false)
    setAuthUser(user)
    setCsrfToken(token)
    setAuthError('')
    setActivePage('shopping')
  }

  async function signOut() {
    try {
      await apiRequest('/auth/logout', { method: 'POST', csrfToken })
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'No se pudo cerrar la sesión.')
      return
    }

    setAuthUser(null)
    setItems([])
    setAssignments([])
    setEvents([])
    setCsrfToken('')
    setActivePage('shopping')
    try {
      const session = await apiRequest<SessionResponse>('/auth/session')
      sessionRequest.current = Promise.resolve(session)
      setCsrfToken(session.csrfToken)
      setAuthError('')
    } catch (error) {
      sessionRequest.current = null
      console.error('No se pudo iniciar una nueva sesión anónima después de cerrar sesión.', error)
      setAuthError(error instanceof Error ? error.message : 'No se pudo conectar con el servidor de AtHouse.')
    }
  }

  async function finishHouseholdSetup(user: AuthUser) {
    setAuthUser(user)
    setActivePage('shopping')
    setIsDataLoading(true)
    try {
      await refreshHouseholdData()
    } catch (error) {
      handleRequestError(error)
    } finally {
      setIsDataLoading(false)
    }
  }

  function editEventFromCalendar(event: HomeEvent) {
    setEventToEdit(event)
    setActivePage('events')
  }

  return (
    isAuthLoading ? (
      <main className="account-page"><p className="page-description">Conectando con AtHouse…</p></main>
    ) : !authUser || isAuthActionPending ? (
      <>
        {authError && <p className="backend-error" role="alert">{authError}<button type="button" onClick={() => setAuthRetry((attempt) => attempt + 1)}>Reintentar</button></p>}
        <AuthPage
          csrfToken={csrfToken}
          onAuthenticated={finishAuthentication}
          onAuthActionComplete={handleAuthActionComplete}
          onSessionToken={setCsrfToken}
        />
      </>
    ) : !authUser.household ? (
      <HouseholdSetupPage
        user={authUser}
        csrfToken={csrfToken}
        onCreated={(user) => void finishHouseholdSetup(user)}
        onLogout={() => void signOut()}
      />
    ) : isDataLoading ? (
      <main className="account-page"><p className="page-description">Cargando los datos de {authUser.household.name}…</p></main>
    ) : dataError && !items.length && !events.length ? (
      <main className="account-page"><p className="auth-error" role="alert">{dataError}</p><button className="secondary-button" type="button" onClick={() => void refreshHouseholdData()}>Reintentar</button></main>
    ) : (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" onClick={(event) => {
          event.preventDefault()
          setActivePage('shopping')
        }} aria-label="AtHouse, inicio">
          <span className="brand-mark"><Icon name="house" size={19} /></span>
          <span>AtHouse<span className="brand-period">.</span></span>
        </a>

        <nav className="main-nav" aria-label="Secciones de la casa">
          {navigation.filter((item) => item.id !== 'admin' || authUser.role === 'admin').map((item) => (
            <button
              className={`nav-item nav-${item.id}${activePage === item.id ? ' is-active' : ''}`}
              key={item.id}
              type="button"
              onClick={() => setActivePage(item.id)}
              aria-current={activePage === item.id ? 'page' : undefined}
            >
              <Icon name={item.icon} size={17} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="topbar-account">
          <div className="topbar-note"><span className="status-dot" /> {authUser.household.name}</div>
          <button className="sign-out-button" type="button" onClick={() => void signOut()}>Cerrar sesión</button>
        </div>
      </header>

      {activePage === 'shopping' ? (
        <section className="page-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow"><span className="eyebrow-line" /> LISTA DEL HOGAR</p>
              <h1>Cosas a <span>comprar.</span></h1>
              <p className="page-description">Todo lo que hace falta, en un solo lugar.</p>
            </div>
            <button className="primary-button" type="button" onClick={openNewItemForm}>
              <Icon name="plus" size={18} />
              <span>Agregar producto</span>
            </button>
          </div>

          {dataError && (
            <p className="storage-warning" role="alert">
              {dataError}
            </p>
          )}
          <p className={`currency-rate-status${exchangeRateError ? ' has-error' : ''}`} role={exchangeRateError ? 'alert' : 'status'}>
            {exchangeRateError ? (
              <>
                No se pudo consultar el dólar blue.{' '}
                <button type="button" onClick={() => setExchangeRateRetry((attempt) => attempt + 1)}>Reintentar</button>
              </>
            ) : blueDollarRate ? (
              <>Dólar blue (venta): {pesoFormatter.format(blueDollarRate)} por US$ 1</>
            ) : (
              'Consultando cotización del dólar blue…'
            )}
          </p>

          <section className="list-section" aria-labelledby="pending-title">
            <div className="section-heading">
              <div className="section-title-group">
                <span className="section-marker pending-marker" />
                <h2 id="pending-title">Por comprar</h2>
                <span className="count-badge">{pendingItems.length}</span>
              </div>
              <span className="section-caption">Lo que todavía falta</span>
            </div>
            <div className="task-grid pending-grid">
              {pendingItems.length ? pendingItems.map((item) => (
                <ShoppingCard
                  item={item}
                  key={item.id}
                  onToggle={toggleCompleted}
                  onEdit={startEditing}
                  blueDollarRate={blueDollarRate}
                />
              )) : (
                <EmptyState
                  title="No hay pendientes"
                  description="Agregá algo que necesites para tu casa."
                  action={<button className="text-button" type="button" onClick={openNewItemForm}>Agregar el primer producto <Icon name="arrow" size={15} /></button>}
                />
              )}
            </div>
          </section>

          <section className="list-section completed-section" aria-labelledby="completed-title">
            <div className="section-heading">
              <div className="section-title-group">
                <span className="section-marker completed-marker" />
                <h2 id="completed-title">Completadas</h2>
                <span className="count-badge">{completedItems.length}</span>
              </div>
              <span className="section-caption">Pequeños logros de todos los días</span>
            </div>
            <div className="task-grid completed-grid">
              {completedItems.length ? completedItems.map((item) => (
                <ShoppingCard
                  item={item}
                  key={item.id}
                  onToggle={toggleCompleted}
                  onEdit={startEditing}
                  blueDollarRate={blueDollarRate}
                />
              )) : (
                <EmptyState title="Todavía no hay nada acá" description="Cuando tildes una compra, la vas a encontrar en esta lista." />
              )}
            </div>
          </section>
          <footer className="page-footer"><span>HECHO PARA SENTIRSE EN CASA</span><span>Una cosa a la vez <span className="footer-heart">♥</span></span></footer>
        </section>
      ) : activePage === 'calendar' ? (
        <CalendarPage
          items={items}
          assignments={assignments}
          events={events}
          dataError={dataError}
          onSetTaskDate={setTaskCalendarDate}
          onSetEventScheduled={setEventScheduled}
          onEditEvent={editEventFromCalendar}
          onGoShopping={() => setActivePage('shopping')}
        />
      ) : activePage === 'events' ? (
        <EventsPage
          events={events}
          eventToEdit={eventToEdit}
          dataError={dataError}
          onSave={saveHomeEvent}
          onSetScheduled={setEventScheduled}
          onSetStatus={setEventStatus}
          onClearEditor={() => setEventToEdit(null)}
          onGoHome={() => setActivePage('shopping')}
        />
      ) : activePage === 'admin' && authUser.role === 'admin' ? (
        <AdminPage csrfToken={csrfToken} onSessionExpired={handleSessionExpired} />
      ) : (
        <section className="placeholder-page">
          <div className="placeholder-icon"><Icon name={activePage === 'admin' ? 'house' : 'sparkles'} size={25} /></div>
          <p className="eyebrow"><span className="eyebrow-line" /> PRÓXIMAMENTE</p>
          <h1>{navigation.find((item) => item.id === activePage)?.label}<span className="brand-period">.</span></h1>
          <p>Este espacio está listo para lo que viene.</p>
          <button className="text-button" type="button" onClick={() => setActivePage('shopping')}>Volver a Cosas a comprar <Icon name="arrow" size={15} /></button>
        </section>
      )}

      {isFormOpen && (
        <ItemDialog
          item={editingItem}
          onClose={() => {
            setIsFormOpen(false)
            setEditingItem(null)
          }}
          onSave={saveItem}
        />
      )}
    </main>
    )
  )
}

function ShoppingCard({
  item,
  onToggle,
  onEdit,
  blueDollarRate,
}: {
  item: ShoppingItem
  onToggle: (id: string) => void
  onEdit: (item: ShoppingItem) => void
  blueDollarRate: number | null
}) {
  const [currency, setCurrency] = useState<'ARS' | 'USD'>('ARS')
  const createdDate = new Intl.DateTimeFormat('es-AR', {
    day: 'numeric',
    month: 'short',
  }).format(item.createdAt)
  const displayedPrice = currency === 'USD' && blueDollarRate !== null
    ? dollarFormatter.format(item.price / blueDollarRate)
    : pesoFormatter.format(item.price)

  return (
    <article className={`shopping-card priority-${item.priority}${item.completed ? ' is-completed' : ''}`}>
      <div className="card-topline">
        <button
          className={`completion-check${item.completed ? ' checked' : ''}`}
          type="button"
          onClick={() => onToggle(item.id)}
          aria-label={item.completed ? `Marcar ${item.product} como pendiente` : `Marcar ${item.product} como completada`}
          aria-pressed={item.completed}
        >
          {item.completed && <Icon name="check" size={15} />}
        </button>
        <span className={`priority-label priority-label-${item.priority}`}>
          <span className="priority-dot" /> {priorityLabels[item.priority]}
        </span>
        <button className="edit-button" type="button" onClick={() => onEdit(item)} aria-label={`Editar ${item.product}`}>
          <Icon name="edit" size={16} />
        </button>
      </div>
      <div className="card-copy">
        <h3>{item.product}</h3>
        <p>{item.brand || 'Sin marca'}</p>
      </div>
      <div className="card-bottomline">
        <div className="card-price">
          <strong>{displayedPrice}</strong>
          <button
            className="currency-toggle"
            type="button"
            disabled={blueDollarRate === null}
            onClick={() => setCurrency((current) => current === 'ARS' ? 'USD' : 'ARS')}
            aria-label={`Mostrar precio de ${item.product} en ${currency === 'ARS' ? 'dólares blue' : 'pesos'}`}
            title={blueDollarRate === null ? 'Esperando la cotización del dólar blue' : 'Cambiar moneda'}
          >
            {currency === 'ARS' ? 'US$' : 'ARS'}
          </button>
        </div>
        <time dateTime={new Date(item.createdAt).toISOString()}>{createdDate}</time>
      </div>
    </article>
  )
}

function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon"><Icon name="bag" size={19} /></div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  )
}

function ItemDialog({
  item,
  onClose,
  onSave,
}: {
  item: ShoppingItem | null
  onClose: () => void
  onSave: (event: FormEvent<HTMLFormElement>) => void
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="item-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <div className="dialog-heading">
          <div>
            <p className="eyebrow"><span className="eyebrow-line" /> LISTA DEL HOGAR</p>
            <h2 id="dialog-title">{item ? 'Editar producto' : 'Sumar a la lista'}</h2>
          </div>
          <button className="dialog-close" type="button" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        <form className="item-form" onSubmit={onSave}>
          <label>
            Producto
            <input autoFocus required maxLength={80} name="product" placeholder="Ej. Yerba mate" defaultValue={item?.product ?? ''} />
          </label>
          <label>
            Marca <span className="optional-label">· opcional</span>
            <input maxLength={60} name="brand" placeholder="Ej. La Merced" defaultValue={item?.brand ?? ''} />
          </label>
          <div className="form-row">
            <label>
              Precio
              <div className="price-input">
                <span>$</span>
                <input required min="0" step="0.01" type="number" name="price" placeholder="0" defaultValue={item?.price ?? ''} />
              </div>
            </label>
            <label>
              Prioridad
              <select name="priority" defaultValue={item?.priority ?? 'media'}>
                <option value="alta">Alta</option>
                <option value="media">Media</option>
                <option value="baja">Baja</option>
              </select>
            </label>
          </div>
          <div className="dialog-actions">
            <button className="secondary-button" type="button" onClick={onClose}>Cancelar</button>
            <button className="primary-button" type="submit">{item ? 'Guardar cambios' : 'Agregar a la lista'}</button>
          </div>
        </form>
      </section>
    </div>
  )
}

export default App

function isUnauthorized(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === 401
}
