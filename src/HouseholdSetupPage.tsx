import { useState, type FormEvent } from 'react'
import { apiRequest, type AuthUser } from './lib/api'
import { loadCalendarAssignments, loadHomeEvents, loadShoppingItems } from './lib/storage'
import type { CalendarAssignment, HomeEvent, ShoppingItem } from './types'

interface HouseholdSetupPageProps {
  user: AuthUser
  csrfToken: string
  onCreated: (user: AuthUser) => void
  onLogout: () => void
}

export default function HouseholdSetupPage({ user, csrfToken, onCreated, onLogout }: HouseholdSetupPageProps) {
  const [name, setName] = useState('')
  const [importLocalData, setImportLocalData] = useState(false)
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [items] = useState<ShoppingItem[]>(loadShoppingItems)
  const [assignments] = useState<CalendarAssignment[]>(loadCalendarAssignments)
  const [events] = useState<HomeEvent[]>(loadHomeEvents)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)
    try {
      const result = await apiRequest<{
        household: { id: string; name: string; role: 'admin' }
        imported: { items: number; assignments: number; events: number }
      }>('/households', {
        method: 'POST',
        csrfToken,
        body: {
          name,
          ...(importLocalData ? { legacyData: { items, assignments, events } } : {}),
        },
      })
      onCreated({ ...user, household: result.household, role: result.household.role })
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo crear el hogar.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="account-page">
      <section className="account-panel">
        <p className="eyebrow"><span className="eyebrow-line" /> BIENVENIDA/O A ATHOUSE</p>
        <h1>Creá tu hogar<span className="brand-period">.</span></h1>
        <p className="page-description">Tu cuenta ya está lista. Elegí un nombre para tu espacio.</p>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <form className="event-form household-setup-form" onSubmit={submit}>
          <label>
            Nombre del hogar
            <input autoFocus required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej. Casa de los Pérez" />
          </label>
          {(items.length > 0 || events.length > 0) && (
            <label className="import-local-option">
              <input type="checkbox" checked={importLocalData} onChange={(event) => setImportLocalData(event.target.checked)} />
              <span>
                Importar los datos guardados en este navegador
                <small>{items.length} compras, {assignments.length} asignaciones y {events.length} eventos. Solo se compartirán con este hogar.</small>
              </span>
            </label>
          )}
          <div className="dialog-actions">
            <button className="secondary-button" type="button" onClick={onLogout}>Cerrar sesión</button>
            <button className="primary-button" type="submit" disabled={isSubmitting}>{isSubmitting ? 'Creando hogar…' : 'Crear mi hogar'}</button>
          </div>
        </form>
        <p className="calendar-help">El hogar y sus datos quedarán aislados de los demás hogares. El administrador será quien cree el hogar.</p>
      </section>
    </main>
  )
}
