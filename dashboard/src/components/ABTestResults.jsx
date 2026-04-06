import { FlaskConical } from 'lucide-react'
import { useABResults } from '../hooks/useStats'

export default function ABTestResults() {
  const data = useABResults()

  if (data.length === 0) return null

  const variantLabels = { A: 'Técnica-Directa', B: 'Empática-Consultiva' }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4">
      <div className="flex items-center gap-2 mb-4">
        <FlaskConical className="w-4 h-4 text-purple-500" />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
          A/B Test: Estilo de Propuesta
        </h3>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {data.map(variant => (
          <div
            key={variant.proposal_variant}
            className="p-3 rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/30"
          >
            <div className="flex items-center gap-2 mb-2">
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                variant.proposal_variant === 'A'
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200'
                  : 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-200'
              }`}>
                {variant.proposal_variant}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {variantLabels[variant.proposal_variant] || variant.proposal_variant}
              </span>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between">
                <span className="text-xs text-gray-500">Enviadas</span>
                <span className="text-xs font-medium text-gray-900 dark:text-white">{variant.total}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-gray-500">Win Rate</span>
                <span className={`text-xs font-bold ${
                  (variant.win_rate || 0) >= 10 ? 'text-emerald-600' : 'text-gray-900 dark:text-white'
                }`}>
                  {variant.win_rate || 0}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-gray-500">Respuesta</span>
                <span className="text-xs font-medium text-gray-900 dark:text-white">{variant.response_rate || 0}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-gray-500">Budget medio</span>
                <span className="text-xs font-medium text-gray-900 dark:text-white">{variant.avg_budget || 0}€</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
