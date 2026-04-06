import {
  Send, Target, MessageCircle, Trophy, DollarSign, RotateCcw, TrendingUp, Clock,
} from 'lucide-react'
import { formatCurrency } from '../utils/formatters'

export default function KPICards({ stats }) {
  const cards = [
    {
      title: 'Propuestas Hoy',
      value: stats.proposalsToday,
      icon: Send,
      color: 'text-blue-600 bg-blue-100 dark:text-blue-400 dark:bg-blue-900/50',
    },
    {
      title: 'Cuota Semanal',
      value: `${stats.proposalsWeek} / ${stats.weeklyTarget}`,
      icon: Target,
      color: 'text-indigo-600 bg-indigo-100 dark:text-indigo-400 dark:bg-indigo-900/50',
      progress: Math.min(100, Math.round((stats.proposalsWeek / stats.weeklyTarget) * 100)),
    },
    {
      title: 'Tasa Respuesta',
      value: `${stats.responseRate}%`,
      icon: MessageCircle,
      color: 'text-amber-600 bg-amber-100 dark:text-amber-400 dark:bg-amber-900/50',
    },
    {
      title: 'Proyectos Ganados',
      value: stats.wonProjects,
      icon: Trophy,
      color: 'text-emerald-600 bg-emerald-100 dark:text-emerald-400 dark:bg-emerald-900/50',
    },
    {
      title: 'Ingresos Proyectados',
      value: formatCurrency(stats.projectedRevenue),
      icon: DollarSign,
      color: 'text-green-600 bg-green-100 dark:text-green-400 dark:bg-green-900/50',
      subtitle: 'este mes',
    },
    {
      title: 'Win Rate',
      value: `${stats.winRate || 0}%`,
      icon: TrendingUp,
      color: 'text-emerald-600 bg-emerald-100 dark:text-emerald-400 dark:bg-emerald-900/50',
    },
    {
      title: 'Resp. Media',
      value: stats.avgResponseTime ? `${stats.avgResponseTime}h` : '—',
      icon: Clock,
      color: 'text-cyan-600 bg-cyan-100 dark:text-cyan-400 dark:bg-cyan-900/50',
    },
    {
      title: 'Retry Queue',
      value: stats.retryPending,
      icon: RotateCcw,
      color: stats.retryPending > 0
        ? 'text-red-600 bg-red-100 dark:text-red-400 dark:bg-red-900/50'
        : 'text-gray-600 bg-gray-100 dark:text-gray-400 dark:bg-gray-800',
    },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
      {cards.map((card) => (
        <div
          key={card.title}
          className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700 shadow-sm"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              {card.title}
            </span>
            <div className={`p-1.5 rounded-lg ${card.color}`}>
              <card.icon className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">
            {stats.loading ? (
              <div className="h-8 w-16 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
            ) : (
              card.value
            )}
          </div>
          {card.subtitle && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{card.subtitle}</p>
          )}
          {card.progress !== undefined && !stats.loading && (
            <div className="mt-2 w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
              <div
                className="bg-indigo-600 h-1.5 rounded-full transition-all duration-500"
                style={{ width: `${card.progress}%` }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
