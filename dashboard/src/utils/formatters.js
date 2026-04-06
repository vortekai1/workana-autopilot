export function formatCurrency(amount) {
  if (!amount && amount !== 0) return '-'
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

export function formatDate(dateStr) {
  if (!dateStr) return '-'
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(dateStr))
}

export function formatDateShort(dateStr) {
  if (!dateStr) return '-'
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: 'short',
  }).format(new Date(dateStr))
}

export function timeAgo(dateStr) {
  if (!dateStr) return '-'
  const now = new Date()
  const date = new Date(dateStr)
  const diffMs = now - date
  const diffMin = Math.floor(diffMs / 60000)
  const diffH = Math.floor(diffMin / 60)
  const diffD = Math.floor(diffH / 24)

  if (diffMin < 60) return `hace ${diffMin}min`
  if (diffH < 24) return `hace ${diffH}h`
  if (diffD < 7) return `hace ${diffD}d`
  return formatDate(dateStr)
}

export function getStartOfDay() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

export function getStartOfWeek() {
  const d = new Date()
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) // Monday
  d.setDate(diff)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

export function getStartOfMonth() {
  const d = new Date()
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

export function getDaysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

const STATUS_CONFIG = {
  new: { label: 'Nuevo', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
  proposal_generated: { label: 'Propuesta', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' },
  sent: { label: 'Enviado', color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
  skipped: { label: 'Descartado', color: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200' },
  applied: { label: 'Aplicado', color: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200' },
  won: { label: 'Ganado', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200' },
  lost: { label: 'Perdido', color: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' },
}

export function getStatusBadge(status) {
  return STATUS_CONFIG[status] || { label: status, color: 'bg-gray-100 text-gray-800' }
}

const OUTCOME_CONFIG = {
  won: { label: 'Ganado', color: 'text-emerald-600' },
  lost: { label: 'Perdido', color: 'text-red-600' },
  no_response: { label: 'Sin respuesta', color: 'text-gray-500' },
  in_progress: { label: 'En curso', color: 'text-blue-600' },
}

export function getOutcomeInfo(outcome) {
  return OUTCOME_CONFIG[outcome] || { label: '-', color: 'text-gray-400' }
}
