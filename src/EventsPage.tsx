import { useEffect, useState, type FormEvent } from 'react'
import { addDays, formatDate, getEventOwnerClass, isExpired, toDateKey } from './lib/calendar'
import type { HomeEvent } from './types'

interface EventsPageProps {
  events: HomeEvent[]
  eventToEdit: HomeEvent | null
  dataError: string
  onSave: (details: Omit<HomeEvent, 'id' | 'createdAt' | 'isScheduled'>, existing: HomeEvent | null) => Promise<void>
  onSetScheduled: (eventId: string, scheduled: boolean) => void
  onSetStatus: (eventId: string, status: HomeEvent['status']) => void
  onClearEditor: () => void
  onGoHome: () => void
}

export default function EventsPage({
  events,
  eventToEdit,
  dataError,
  onSave,
  onSetScheduled,
  onSetStatus,
  onClearEditor,
  onGoHome,
}: EventsPageProps) {
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [localEditingEvent, setLocalEditingEvent] = useState<HomeEvent | null>(null)
  const activeEvent = eventToEdit ?? localEditingEvent

  useEffect(() => {
    if (eventToEdit) setIsFormOpen(true)
  }, [eventToEdit])

  function closeForm() {
    setIsFormOpen(false)
    setLocalEditingEvent(null)
    onClearEditor()
  }

  function createEvent() {
    setLocalEditingEvent(null)
    setIsFormOpen(true)
    onClearEditor()
  }

  function editEvent(event: HomeEvent) {
    setLocalEditingEvent(event)
    setIsFormOpen(true)
    onClearEditor()
  }

  const orderedEvents = [...events].sort((a, b) => b.createdAt - a.createdAt)
  const currentEvents = orderedEvents.filter((event) => !isExpired(event.expiresAt))
  const archivedEvents = orderedEvents.filter((event) => isExpired(event.expiresAt))

  return (
    <section className="page-content events-page">
      <nav className="breadcrumbs" aria-label="Ruta de navegación">
        <button type="button" onClick={onGoHome}>AtHouse</button>
        <span aria-hidden="true">›</span>
        {isFormOpen ? (
          <>
            <button type="button" onClick={closeForm}>Eventos</button>
            <span aria-hidden="true">›</span>
            <span>{activeEvent ? 'Editar evento' : 'Crear evento'}</span>
          </>
        ) : <span>Eventos</span>}
      </nav>

      {dataError && <p className="storage-warning" role="alert">{dataError}</p>}

      {isFormOpen ? (
        <EventForm
          key={activeEvent?.id ?? 'new-event'}
          event={activeEvent}
          onCancel={closeForm}
          onSave={async (details) => {
            await onSave(details, activeEvent)
            closeForm()
          }}
        />
      ) : (
        <>
          <div className="page-heading">
            <div>
              <p className="eyebrow"><span className="eyebrow-line" /> ORGANIZACIÓN DEL HOGAR</p>
              <h1>Eventos<span>.</span></h1>
              <p className="page-description">Creá tus eventos y decidí cuándo sumarlos al calendario.</p>
            </div>
            <button className="primary-button" type="button" onClick={createEvent}>＋ Crear evento</button>
          </div>

          <section className="event-list-section" aria-labelledby="active-events-title">
            <div className="section-heading">
              <div className="section-title-group">
                <span className="section-marker pending-marker" />
                <h2 id="active-events-title">Eventos vigentes</h2>
                <span className="count-badge">{currentEvents.length}</span>
              </div>
            </div>
            <div className="event-list">
              {currentEvents.length ? currentEvents.map((event) => (
                <EventCard
                  event={event}
                  key={event.id}
                  onEdit={() => editEvent(event)}
                  onSetScheduled={onSetScheduled}
                  onSetStatus={onSetStatus}
                />
              )) : <div className="event-empty-state">Todavía no hay eventos vigentes. Creá uno para empezar a planificar.</div>}
            </div>
          </section>

          {archivedEvents.length > 0 && (
            <section className="event-list-section archived-events" aria-labelledby="archived-events-title">
              <div className="section-heading">
                <div className="section-title-group">
                  <span className="section-marker completed-marker" />
                  <h2 id="archived-events-title">Vencidos · historial</h2>
                  <span className="count-badge">{archivedEvents.length}</span>
                </div>
              </div>
              <div className="event-list">
                {archivedEvents.map((event) => (
                  <EventCard
                    event={event}
                    key={event.id}
                    onEdit={() => editEvent(event)}
                    onSetScheduled={onSetScheduled}
                    onSetStatus={onSetStatus}
                  />
                ))}
              </div>
            </section>
          )}
          <footer className="page-footer"><span>HECHO PARA SENTIRSE EN CASA</span><span>Una cosa a la vez <span className="footer-heart">♥</span></span></footer>
        </>
      )}
    </section>
  )
}

function EventCard({
  event,
  onEdit,
  onSetScheduled,
  onSetStatus,
}: {
  event: HomeEvent
  onEdit: () => void
  onSetScheduled: (eventId: string, scheduled: boolean) => void
  onSetStatus: (eventId: string, status: HomeEvent['status']) => void
}) {
  const expired = isExpired(event.expiresAt)
  return (
    <article className={`event-card ${getEventOwnerClass(event.creatorMemberNumber)}${expired ? ' is-expired' : ''}${event.status === 'completed' ? ' is-completed' : ''}`}>
      <div className="event-card-heading">
        <span className={`event-entry-mark ${getEventOwnerClass(event.creatorMemberNumber)}${event.status === 'completed' ? ' is-completed' : ''}`} />
        <div className="event-card-title">
          <h3>{event.title}</h3>
          <span className={`event-status${event.isScheduled ? ' is-scheduled' : ''}`}>
            {event.isScheduled ? 'Programado' : 'Sin programar'}
          </span>
        </div>
        <button className="entry-edit-button" type="button" onClick={onEdit}>Editar</button>
      </div>
      {event.description && <p className="event-card-description">{event.description}</p>}
      <p className="event-card-dates">
        {formatDate(event.startDate)} – {formatDate(event.endDate)}
        <span>Vence {formatDate(event.expiresAt)}</span>
      </p>
      <div className="event-card-actions">
        <button
          className={event.isScheduled ? 'secondary-button' : 'primary-button'}
          type="button"
          onClick={() => onSetScheduled(event.id, !event.isScheduled)}
        >
          {event.isScheduled ? 'Quitar del calendario' : 'Programar en calendario'}
        </button>
        <button
          className="text-button"
          type="button"
          onClick={() => onSetStatus(event.id, event.status === 'completed' ? 'pending' : 'completed')}
        >
          {event.status === 'completed' ? 'Marcar pendiente' : 'Marcar completado'}
        </button>
      </div>
    </article>
  )
}

function EventForm({
  event,
  onCancel,
  onSave,
}: {
  event: HomeEvent | null
  onCancel: () => void
  onSave: (details: Omit<HomeEvent, 'id' | 'createdAt' | 'isScheduled'>) => Promise<void>
}) {
  const today = toDateKey(new Date())
  const [title, setTitle] = useState(event?.title ?? '')
  const [description, setDescription] = useState(event?.description ?? '')
  const [startDate, setStartDate] = useState(event?.startDate ?? today)
  const [endDate, setEndDate] = useState(event?.endDate ?? today)
  const [expiresAt, setExpiresAt] = useState(event?.expiresAt ?? addDays(today, 2))
  const [status, setStatus] = useState<HomeEvent['status']>(event?.status ?? 'pending')
  const [expirationWasCustomized, setExpirationWasCustomized] = useState(
    event ? event.expiresAt !== addDays(event.endDate, 2) : false,
  )
  const [formError, setFormError] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  function handleEndDateChange(value: string) {
    setEndDate(value)
    if (!value) return
    setExpiresAt((current) => {
      if (!expirationWasCustomized || current < value) return addDays(value, 2)
      return current
    })
  }

  async function handleSubmit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault()
    setFormError('')
    if (endDate < startDate || expiresAt < endDate) return
    const datesChanged = event?.startDate !== startDate || event?.endDate !== endDate
    const spansMultipleDates = event && (event.startDate !== event.endDate || startDate !== endDate)
    if (
      event?.isScheduled &&
      datesChanged &&
      spansMultipleDates &&
      !window.confirm('Este evento está programado. ¿Querés actualizar también todas las fechas que ocupa en el calendario?')
    ) return

    setIsSaving(true)
    try {
      await onSave({
        title: title.trim(),
        description: description.trim(),
        startDate,
        endDate,
        expiresAt,
        status,
      })
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'No se pudo guardar el evento.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <>
      <div className="page-heading event-form-page-heading">
        <div>
          <p className="eyebrow"><span className="eyebrow-line" /> EVENTO</p>
          <h1>{event ? 'Editar evento' : 'Crear evento'}<span>.</span></h1>
          <p className="page-description">La creación no lo agrega al calendario automáticamente.</p>
        </div>
      </div>
      <form className="event-form" onSubmit={handleSubmit}>
        {formError && <p className="auth-error" role="alert">{formError}</p>}
        <label>
          Título
          <input autoFocus required maxLength={100} value={title} onChange={(inputEvent) => setTitle(inputEvent.target.value)} placeholder="Ej. Vacaciones" />
        </label>
        <label>
          Descripción <span className="optional-label">· opcional</span>
          <textarea maxLength={500} rows={3} value={description} onChange={(inputEvent) => setDescription(inputEvent.target.value)} placeholder="Agregá detalles para tenerlos a mano" />
        </label>
        <div className="event-date-row">
          <label>
            Fecha de inicio
            <input required type="date" value={startDate} onChange={(inputEvent) => {
              const nextStartDate = inputEvent.target.value
              setStartDate(nextStartDate)
              if (nextStartDate && endDate < nextStartDate) handleEndDateChange(nextStartDate)
            }} />
          </label>
          <label>
            Fecha de finalización
            <input required type="date" min={startDate} value={endDate} onChange={(inputEvent) => handleEndDateChange(inputEvent.target.value)} />
          </label>
        </div>
        <div className="event-date-row event-date-row-secondary">
          <label>
            Vencimiento
            <input required type="date" min={endDate} value={expiresAt} onChange={(inputEvent) => {
              setExpiresAt(inputEvent.target.value)
              setExpirationWasCustomized(true)
            }} />
            <span className="form-hint">Por defecto, dos días después del final.</span>
          </label>
          <label>
            Estado
            <select value={status} onChange={(inputEvent) => {
              setStatus(inputEvent.target.value === 'completed' ? 'completed' : 'pending')
            }}>
              <option value="pending">Pendiente</option>
              <option value="completed">Completado</option>
            </select>
          </label>
        </div>
        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>Cancelar</button>
          <button className="primary-button" type="submit" disabled={isSaving}>{isSaving ? 'Guardando…' : event ? 'Guardar cambios' : 'Crear evento'}</button>
        </div>
      </form>
    </>
  )
}
