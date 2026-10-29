import type { CalendarAssignment, HomeEvent } from '../types'

export function toDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function addDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(year, month - 1, day + days, 12)
  return toDateKey(date)
}

export function getCalendarWeeks(year: number, month: number): string[][] {
  const firstDay = new Date(year, month, 1, 12)
  const mondayOffset = (firstDay.getDay() + 6) % 7
  const firstCalendarDay = new Date(year, month, 1 - mondayOffset, 12)

  return Array.from({ length: 6 }, (_, weekIndex) =>
    Array.from({ length: 7 }, (_, dayIndex) =>
      toDateKey(new Date(
        firstCalendarDay.getFullYear(),
        firstCalendarDay.getMonth(),
        firstCalendarDay.getDate() + weekIndex * 7 + dayIndex,
        12,
      )),
    ),
  ).filter((week) => week.some((date) => date.slice(0, 7) === `${year}-${String(month + 1).padStart(2, '0')}`))
}

export function isExpired(expiresAt: string, today = toDateKey(new Date())): boolean {
  return expiresAt < today
}

export function eventCoversDate(event: HomeEvent, date: string): boolean {
  return event.startDate <= date && date <= event.endDate
}

export function getEventOwnerClass(memberNumber?: HomeEvent['creatorMemberNumber']): string {
  return `event-owner-${memberNumber && memberNumber >= 1 && memberNumber <= 5 ? memberNumber : 1}`
}

export function getActiveCalendarEvents(events: HomeEvent[], today = toDateKey(new Date())): HomeEvent[] {
  return events.filter((event) => event.isScheduled && !isExpired(event.expiresAt, today))
}

export function getActiveAssignments(assignments: CalendarAssignment[], today = toDateKey(new Date())): CalendarAssignment[] {
  return assignments.filter((assignment) => !isExpired(assignment.expiresAt, today))
}

export function formatDate(dateKey: string, options: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
}): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Intl.DateTimeFormat('es-AR', options).format(new Date(year, month - 1, day, 12))
}
