import { useMemo, useState } from 'react'
import {
  eventCoversDate,
  formatDate,
  getActiveCalendarEvents,
  getCalendarWeeks,
  isExpired,
  toDateKey,
} from './lib/calendar'
import type { CalendarAssignment, HomeEvent, ShoppingItem } from './types'

const monthNames = Array.from({ length: 12 }, (_, month) =>
  new Intl.DateTimeFormat('es-AR', { month: 'long' }).format(new Date(2024, month, 1, 12)),
)
const weekdays = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

interface CalendarPageProps {
  items: ShoppingItem[]
  assignments: CalendarAssignment[]
  events: HomeEvent[]
  dataError: string
  onSetTaskDate: (itemId: string, date: string | null) => void
  onSetEventScheduled: (eventId: string, scheduled: boolean) => void
  onEditEvent: (event: HomeEvent) => void
  onGoShopping: () => void
}

export default function CalendarPage({
  items,
  assignments,
  events,
  dataError,
  onSetTaskDate,
  onSetEventScheduled,
  onEditEvent,
  onGoShopping,
}: CalendarPageProps) {
  const today = toDateKey(new Date())
  const [selectedDate, setSelectedDate] = useState(today)
  const [visibleMonth, setVisibleMonth] = useState(new Date().getMonth())
  const [visibleYear, setVisibleYear] = useState(new Date().getFullYear())
  const [showExpired, setShowExpired] = useState(false)
  const [taskToAssign, setTaskToAssign] = useState('')
  const [eventToAssign, setEventToAssign] = useState('')
  const weeks = useMemo(() => getCalendarWeeks(visibleYear, visibleMonth), [visibleYear, visibleMonth])
  const calendarEvents = (showExpired
    ? events.filter((event) => event.isScheduled)
    : getActiveCalendarEvents(events))
  const scheduledAssignments = (showExpired
    ? assignments
    : assignments.filter((assignment) => !isExpired(assignment.expiresAt, today)))
    .filter((assignment) => items.some((item) => item.id === assignment.itemId))
  const unassignedTasks = items.filter((item) =>
    !item.completed && !assignments.some((assignment) => assignment.itemId === item.id),
  )
  const unassignedEvents = events.filter((event) =>
    !event.isScheduled &&
    eventCoversDate(event, selectedDate) &&
    (showExpired || !isExpired(event.expiresAt, today)),
  )
  const selectedTasks = scheduledAssignments.filter((assignment) => assignment.date === selectedDate)
  const selectedEvents = calendarEvents.filter((event) => eventCoversDate(event, selectedDate))
  const selectedItemCount = selectedTasks.length + selectedEvents.length
  const yearOptions = Array.from({ length: 41 }, (_, index) => visibleYear - 20 + index)

  function changeMonth(offset: number) {
    const nextMonth = new Date(visibleYear, visibleMonth + offset, 1, 12)
    setVisibleMonth(nextMonth.getMonth())
    setVisibleYear(nextMonth.getFullYear())
  }

  function selectDate(date: string) {
    setSelectedDate(date)
    setTaskToAssign('')
    setEventToAssign('')
    const [year, month] = date.split('-').map(Number)
    setVisibleYear(year)
    setVisibleMonth(month - 1)
  }

  function assignSelectedTask() {
    if (!taskToAssign) return
    onSetTaskDate(taskToAssign, selectedDate)
    setTaskToAssign('')
  }

  return (
    <section className="page-content calendar-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow"><span className="eyebrow-line" /> PLANIFICACIÓN DEL HOGAR</p>
          <h1>Calendario<span>.</span></h1>
          <p className="page-description">Organizá las compras y los eventos de tu casa.</p>
        </div>
        <button className="secondary-button calendar-today-button" type="button" onClick={() => selectDate(today)}>
          Volver a hoy
        </button>
      </div>

      {dataError && <p className="storage-warning" role="alert">{dataError}</p>}

      <section className="calendar-panel" aria-label="Calendario mensual">
        <div className="calendar-toolbar">
          <button className="calendar-nav-button" type="button" onClick={() => changeMonth(-1)} aria-label="Mes anterior">‹</button>
          <div className="calendar-selectors">
            <label>
              <span className="visually-hidden">Mes</span>
              <select
                value={visibleMonth}
                onChange={(event) => setVisibleMonth(Number(event.target.value))}
                aria-label="Seleccionar mes"
              >
                {monthNames.map((name, month) => <option key={name} value={month}>{name}</option>)}
              </select>
            </label>
            <label>
              <span className="visually-hidden">Año</span>
              <select
                value={visibleYear}
                onChange={(event) => setVisibleYear(Number(event.target.value))}
                aria-label="Seleccionar año"
              >
                {yearOptions.map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
            </label>
          </div>
          <button className="calendar-nav-button" type="button" onClick={() => changeMonth(1)} aria-label="Mes siguiente">›</button>
        </div>

        <div className="calendar-weekdays" aria-hidden="true">
          {weekdays.map((day) => <span key={day}>{day}</span>)}
        </div>
        <div className="calendar-month">
          {weeks.map((week) => {
            return (
              <div
                className="calendar-week"
                key={week[0]}
              >
                {week.map((date) => {
                  const dateTasks = scheduledAssignments.filter((assignment) => assignment.date === date)
                  const dateEvents = calendarEvents.filter((event) => eventCoversDate(event, date))
                  const startingEvents = dateEvents.filter((event) => event.startDate === date)
                  const [year, month, day] = date.split('-').map(Number)
                  const isCurrentMonth = year === visibleYear && month === visibleMonth + 1
                  const isSelected = date === selectedDate
                  const weekday = new Date(year, month - 1, day, 12).getDay()
                  const isWeekend = weekday === 0 || weekday === 6
                  const hasCompletedEvent = dateEvents.some((event) => event.status === 'completed')
                  const hasExpiredEvent = dateEvents.some((event) => isExpired(event.expiresAt, today))
                  return (
                    <button
                      className={`calendar-day${isCurrentMonth ? '' : ' is-outside'}${isWeekend ? ' is-weekend' : ''}${isSelected ? ' is-selected' : ''}${date === today ? ' is-today' : ''}${dateEvents.length ? ' has-event' : ''}${hasCompletedEvent ? ' has-completed-event' : ''}${hasExpiredEvent ? ' has-expired-event' : ''}`}
                      key={date}
                      type="button"
                      onClick={() => selectDate(date)}
                      aria-pressed={isSelected}
                      aria-label={`${formatDate(date)}${dateTasks.length + dateEvents.length ? `, ${dateTasks.length + dateEvents.length} elementos programados` : ''}`}
                    >
                      <span className="calendar-day-number">{day}</span>
                      {dateTasks.length > 0 && (
                        <span className="calendar-day-count">{dateTasks.length}</span>
                      )}
                      {startingEvents.length > 0 && (
                        <span className="calendar-day-events">
                          {startingEvents.map((event) => <span key={event.id}>{event.title}</span>)}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>

        <label className="expired-toggle">
          <input type="checkbox" checked={showExpired} onChange={(event) => setShowExpired(event.target.checked)} />
          Mostrar también los vencidos
        </label>
      </section>

      <section className="calendar-details" aria-labelledby="selected-date-heading">
        <div className="calendar-details-heading">
          <div>
            <p className="eyebrow"><span className="eyebrow-line" /> DETALLE DEL DÍA</p>
            <h2 id="selected-date-heading">{formatDate(selectedDate)}</h2>
          </div>
          <span className="calendar-item-count">
            {selectedItemCount} {selectedItemCount === 1 ? 'elemento' : 'elementos'}
          </span>
        </div>

        {selectedTasks.length === 0 && selectedEvents.length === 0 && (
          <p className="calendar-empty">No hay tareas ni eventos para esta fecha.</p>
        )}

        {selectedTasks.map((assignment) => {
          const item = items.find((candidate) => candidate.id === assignment.itemId)
          if (!item) return null
          const expired = isExpired(assignment.expiresAt, today)
          return (
            <div className={`calendar-entry${expired ? ' is-expired' : ''}`} key={assignment.itemId}>
              <span className={`calendar-entry-mark${item.completed ? ' is-completed' : ''}`} />
              <div className="calendar-entry-copy">
                <strong>{item.product}</strong>
                <span>{item.completed ? 'Compra completada' : 'Compra pendiente'} · vence {formatDate(assignment.expiresAt)}</span>
              </div>
              <label className="assignment-date-control">
                <span className="visually-hidden">Cambiar fecha de {item.product}</span>
                <input
                  type="date"
                  value={assignment.date}
                  onChange={(event) => {
                    if (event.target.value) {
                      onSetTaskDate(item.id, event.target.value)
                      selectDate(event.target.value)
                    } else {
                      onSetTaskDate(item.id, null)
                    }
                  }}
                  aria-label={`Cambiar fecha de ${item.product}`}
                />
              </label>
              <button className="entry-remove-button" type="button" onClick={() => onSetTaskDate(item.id, null)}>
                Quitar
              </button>
            </div>
          )
        })}

        {selectedEvents.map((event) => {
          const expired = isExpired(event.expiresAt, today)
          return (
            <div className={`calendar-entry${expired ? ' is-expired' : ''}`} key={event.id}>
              <span className={`calendar-entry-mark event-mark${event.status === 'completed' ? ' is-completed' : ''}`} />
              <div className="calendar-entry-copy">
                <strong>{event.title}</strong>
                <span>
                  {event.status === 'completed' ? 'Completado' : 'Evento'} · {formatDate(event.startDate)} al {formatDate(event.endDate)}
                  {expired ? ' · vencido' : ''}
                </span>
              </div>
              <button className="entry-edit-button" type="button" onClick={() => onEditEvent(event)}>Editar</button>
              <button className="entry-remove-button" type="button" onClick={() => onSetEventScheduled(event.id, false)}>
                Quitar
              </button>
            </div>
          )
        })}

        <div className="calendar-add-row">
          {unassignedTasks.length > 0 ? (
            <div className="calendar-assignment-controls">
              <label>
                <span className="visually-hidden">Elegir compra pendiente</span>
                <select value={taskToAssign} onChange={(event) => setTaskToAssign(event.target.value)}>
                  <option value="">Elegir una compra pendiente…</option>
                  {unassignedTasks.map((item) => <option key={item.id} value={item.id}>{item.product}</option>)}
                </select>
              </label>
              <button className="primary-button" type="button" disabled={!taskToAssign} onClick={assignSelectedTask}>Asignar al día</button>
            </div>
          ) : (
            <button className="text-button" type="button" onClick={onGoShopping}>Crear una compra para programar <span aria-hidden="true">↗</span></button>
          )}
          {unassignedEvents.length > 0 && (
            <div className="calendar-assignment-controls">
              <label>
                <span className="visually-hidden">Elegir evento sin programar</span>
                <select value={eventToAssign} onChange={(changeEvent) => setEventToAssign(changeEvent.target.value)}>
                  <option value="">Elegir evento de esta fecha…</option>
                  {unassignedEvents.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}
                </select>
              </label>
              <button
                className="primary-button"
                type="button"
                disabled={!eventToAssign}
                onClick={() => {
                  if (eventToAssign) onSetEventScheduled(eventToAssign, true)
                  setEventToAssign('')
                }}
              >
                Programar evento
              </button>
            </div>
          )}
        </div>
        <p className="calendar-help">Los vencimientos se calculan dos días después de la fecha programada. Quitar una asignación no elimina la compra ni el evento.</p>
      </section>
      <footer className="page-footer"><span>HECHO PARA SENTIRSE EN CASA</span><span>Una cosa a la vez <span className="footer-heart">♥</span></span></footer>
    </section>
  )
}
