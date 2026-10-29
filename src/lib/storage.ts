import type { CalendarAssignment, HomeEvent, ShoppingItem } from '../types'

const SHOPPING_STORAGE_KEY = 'app-casa.shopping-items'
const ASSIGNMENTS_STORAGE_KEY = 'app-casa.calendar-assignments'
const EVENTS_STORAGE_KEY = 'app-casa.events'

export function loadShoppingItems(): ShoppingItem[] {
  try {
    const savedItems = localStorage.getItem(SHOPPING_STORAGE_KEY)
    if (!savedItems) return []

    const parsed: unknown = JSON.parse(savedItems)
    if (!Array.isArray(parsed)) {
      throw new Error('El formato guardado no es una lista.')
    }

    return parsed.filter(isShoppingItem)
  } catch (error) {
    console.error('No se pudieron cargar las compras guardadas.', error)
    return []
  }
}

export function saveShoppingItems(items: ShoppingItem[]): void {
  localStorage.setItem(SHOPPING_STORAGE_KEY, JSON.stringify(items))
}

export function loadCalendarAssignments(): CalendarAssignment[] {
  return loadList(ASSIGNMENTS_STORAGE_KEY, isCalendarAssignment)
}

export function saveCalendarAssignments(assignments: CalendarAssignment[]): void {
  localStorage.setItem(ASSIGNMENTS_STORAGE_KEY, JSON.stringify(assignments))
}

export function loadHomeEvents(): HomeEvent[] {
  return loadList(EVENTS_STORAGE_KEY, isHomeEvent)
}

export function saveHomeEvents(events: HomeEvent[]): void {
  localStorage.setItem(EVENTS_STORAGE_KEY, JSON.stringify(events))
}

function loadList<T>(key: string, isValid: (value: unknown) => value is T): T[] {
  try {
    const saved = localStorage.getItem(key)
    if (!saved) return []

    const parsed: unknown = JSON.parse(saved)
    if (!Array.isArray(parsed)) {
      throw new Error('El formato guardado no es una lista.')
    }

    return parsed.filter(isValid)
  } catch (error) {
    console.error(`No se pudieron cargar los datos guardados (${key}).`, error)
    return []
  }
}

function isShoppingItem(value: unknown): value is ShoppingItem {
  if (!value || typeof value !== 'object') return false

  const item = value as Record<string, unknown>
  return (
    typeof item.id === 'string' &&
    typeof item.product === 'string' &&
    typeof item.brand === 'string' &&
    typeof item.price === 'number' &&
    Number.isFinite(item.price) &&
    item.price >= 0 &&
    (item.priority === 'alta' || item.priority === 'media' || item.priority === 'baja') &&
    typeof item.completed === 'boolean' &&
    typeof item.createdAt === 'number' &&
    Number.isFinite(item.createdAt)
  )
}

function isCalendarAssignment(value: unknown): value is CalendarAssignment {
  if (!value || typeof value !== 'object') return false
  const assignment = value as Record<string, unknown>
  return (
    typeof assignment.itemId === 'string' &&
    isDateKey(assignment.date) &&
    isDateKey(assignment.expiresAt)
  )
}

function isHomeEvent(value: unknown): value is HomeEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Record<string, unknown>
  return (
    typeof event.id === 'string' &&
    typeof event.title === 'string' &&
    typeof event.description === 'string' &&
    isDateKey(event.startDate) &&
    isDateKey(event.endDate) &&
    event.endDate >= event.startDate &&
    isDateKey(event.expiresAt) &&
    event.expiresAt >= event.endDate &&
    (event.status === 'pending' || event.status === 'completed') &&
    typeof event.isScheduled === 'boolean' &&
    typeof event.createdAt === 'number' &&
    Number.isFinite(event.createdAt)
  )
}

function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day, 12)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}
