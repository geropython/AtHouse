export type Priority = 'alta' | 'media' | 'baja'

export interface ShoppingItem {
  id: string
  product: string
  brand: string
  price: number
  priority: Priority
  completed: boolean
  createdAt: number
}

export type ShoppingItemInput = Omit<ShoppingItem, 'id' | 'completed' | 'createdAt'>

export interface CalendarAssignment {
  itemId: string
  date: string
  expiresAt: string
}

export type HomeEventStatus = 'pending' | 'completed'

export interface HomeEvent {
  id: string
  title: string
  description: string
  startDate: string
  endDate: string
  expiresAt: string
  status: HomeEventStatus
  isScheduled: boolean
  createdAt: number
  creatorMemberNumber?: 1 | 2 | 3 | 4 | 5
}
