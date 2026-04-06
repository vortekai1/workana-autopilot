import { CheckCircle2, XCircle, Clock, Filter } from 'lucide-react'
import { useLogs } from '../hooks/useRetryQueue'
import { timeAgo } from '../utils/formatters'

export default function LogsTimeline() {
  const { logs, loading, filter, setFilter } = useLogs()

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-gray-500" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            Logs Recientes
          </h3>
        </div>
        <div className="flex gap-1">
          {['all', 'success', 'error'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${
                filter === f
                  ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200'
                  : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              {f === 'all' ? 'Todos' : f === 'success' ? 'OK' : 'Error'}
            </button>
          ))}
        </div>
      </div>

      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
            ))}
          </div>
        ) : logs.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">
            No hay logs
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
            {logs.map((log) => (
              <div key={log.id} className="px-4 py-3 flex items-start gap-3 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                {log.success ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-gray-800 dark:text-gray-200">
                    {log.action || 'action'}
                  </p>
                  {log.details && (
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate mt-0.5">
                      {typeof log.details === 'string'
                        ? log.details
                        : JSON.stringify(log.details).substring(0, 120)}
                    </p>
                  )}
                </div>
                <span className="text-[11px] text-gray-400 whitespace-nowrap flex-shrink-0">
                  {timeAgo(log.created_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
