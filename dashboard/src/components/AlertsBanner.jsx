import { AlertTriangle, XCircle, Info } from 'lucide-react'
import { useAlerts } from '../hooks/useStats'

export default function AlertsBanner() {
  const alerts = useAlerts()

  if (alerts.length === 0) return null

  const icons = {
    error: <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />,
    warning: <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />,
    info: <Info className="w-4 h-4 text-blue-500 flex-shrink-0" />,
  }

  const bgColors = {
    error: 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800',
    warning: 'bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800',
    info: 'bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800',
  }

  return (
    <div className="space-y-2">
      {alerts.map((alert, i) => (
        <div
          key={i}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${bgColors[alert.type]}`}
        >
          {icons[alert.type]}
          <span className="text-sm text-gray-800 dark:text-gray-200">
            {alert.message}
          </span>
        </div>
      ))}
    </div>
  )
}
