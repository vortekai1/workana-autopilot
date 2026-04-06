import { AlertTriangle, Clock, RotateCcw } from 'lucide-react'
import { useRetryQueue } from '../hooks/useRetryQueue'
import { formatDate, timeAgo } from '../utils/formatters'

export default function RetryQueue() {
  const { items, loading } = useRetryQueue()

  if (!loading && items.length === 0) return null

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
        <RotateCcw className="w-4 h-4 text-amber-500" />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
          Cola de Reintentos
        </h3>
        <span className="text-xs text-gray-500">({items.length})</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-gray-200 dark:border-gray-700">
              <th className="text-left px-4 py-2.5 font-medium">Proyecto</th>
              <th className="text-center px-2 py-2.5 font-medium">Intentos</th>
              <th className="text-center px-2 py-2.5 font-medium">Proximo</th>
              <th className="text-center px-2 py-2.5 font-medium">Estado</th>
              <th className="text-left px-4 py-2.5 font-medium">Error</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-3">
                  <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-4 py-2.5">
                    <a
                      href={item.project_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline truncate block max-w-xs"
                    >
                      {item.project_url?.split('/job/')[1] || item.project_url}
                    </a>
                  </td>
                  <td className="text-center px-2 py-2.5">
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                      {item.attempt_count}/{item.max_attempts}
                    </span>
                  </td>
                  <td className="text-center px-2 py-2.5">
                    <span className="flex items-center justify-center gap-1 text-xs text-gray-500">
                      <Clock className="w-3 h-3" />
                      {timeAgo(item.next_retry_at)}
                    </span>
                  </td>
                  <td className="text-center px-2 py-2.5">
                    <StatusBadge status={item.status} />
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="text-xs text-red-500 dark:text-red-400 truncate block max-w-xs">
                      {item.error_message || '-'}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StatusBadge({ status }) {
  const config = {
    pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    processing: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    failed: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    completed: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  }

  return (
    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${config[status] || config.pending}`}>
      {status}
    </span>
  )
}
