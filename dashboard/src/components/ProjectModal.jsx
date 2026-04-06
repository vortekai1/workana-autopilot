import { X, ExternalLink, Star, ShieldCheck, Clock, DollarSign, FileText } from 'lucide-react'
import { useProjectProposal } from '../hooks/useProjects'
import { formatCurrency, formatDate, getStatusBadge, getOutcomeInfo } from '../utils/formatters'

export default function ProjectModal({ project, onClose }) {
  const { proposal, loading } = useProjectProposal(project.id)
  const badge = getStatusBadge(project.status)
  const outcome = getOutcomeInfo(project.outcome)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between rounded-t-2xl">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white truncate pr-4">
            {project.title || 'Sin titulo'}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Status + Scores */}
          <div className="flex flex-wrap gap-3 items-center">
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${badge.color}`}>
              {badge.label}
            </span>
            {project.outcome && (
              <span className={`text-xs font-medium ${outcome.color}`}>
                {outcome.label}
              </span>
            )}
            {project.relevance_score != null && (
              <span className="text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">
                Relevancia: {project.relevance_score}/100
              </span>
            )}
            {project.pre_score > 0 && (
              <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                Pre-Score: {project.pre_score}/100
              </span>
            )}
          </div>

          {/* Meta info */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
              <Clock className="w-4 h-4" />
              {formatDate(project.created_at)}
            </div>
            <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
              <DollarSign className="w-4 h-4" />
              {project.budget_text || 'Sin presupuesto'}
            </div>
            {project.client_name && (
              <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                {project.client_verified && <ShieldCheck className="w-4 h-4 text-blue-500" />}
                {project.client_name}
                {project.client_rating > 0 && (
                  <span className="flex items-center gap-0.5">
                    <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                    {Number(project.client_rating).toFixed(1)}
                  </span>
                )}
              </div>
            )}
            {project.category && (
              <div className="text-gray-600 dark:text-gray-400">
                {project.category}
              </div>
            )}
          </div>

          {/* Link */}
          {project.workana_url && (
            <a
              href={project.workana_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Ver en Workana
            </a>
          )}

          {/* Description */}
          {project.description && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">
                Descripcion del Proyecto
              </h4>
              <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto">
                {project.description}
              </p>
            </div>
          )}

          {/* Skills */}
          {project.skills && project.skills.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">
                Skills
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {(Array.isArray(project.skills) ? project.skills : []).map((skill, i) => (
                  <span
                    key={i}
                    className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Red Flags */}
          {project.red_flags && project.red_flags.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-red-500 uppercase mb-2">
                Red Flags
              </h4>
              <ul className="text-sm text-red-600 dark:text-red-400 list-disc list-inside">
                {project.red_flags.map((flag, i) => (
                  <li key={i}>{flag}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Proposal */}
          {loading ? (
            <div className="h-20 bg-gray-100 dark:bg-gray-700 rounded-lg animate-pulse" />
          ) : proposal ? (
            <div className="border border-indigo-200 dark:border-indigo-800 rounded-xl p-4 bg-indigo-50/50 dark:bg-indigo-900/20">
              <div className="flex items-center gap-2 mb-3">
                <FileText className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <h4 className="text-xs font-semibold text-indigo-800 dark:text-indigo-300 uppercase">
                  Propuesta Generada
                </h4>
              </div>

              <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed mb-3">
                {proposal.proposal_text}
              </p>

              <div className="flex flex-wrap gap-3 text-xs text-gray-600 dark:text-gray-400">
                {proposal.budget_suggested && (
                  <span>Presupuesto: <strong>{formatCurrency(proposal.budget_suggested)}</strong></span>
                )}
                {proposal.delivery_days && (
                  <span>Plazo: <strong>{proposal.delivery_days} dias</strong></span>
                )}
              </div>

              {proposal.questions_text && (
                <div className="mt-3 pt-3 border-t border-indigo-200 dark:border-indigo-800">
                  <p className="text-xs font-medium text-indigo-700 dark:text-indigo-300 mb-1">Preguntas:</p>
                  <p className="text-sm text-gray-700 dark:text-gray-300">{proposal.questions_text}</p>
                </div>
              )}

              {proposal.internal_notes && (
                <div className="mt-3 pt-3 border-t border-indigo-200 dark:border-indigo-800">
                  <p className="text-xs font-medium text-indigo-700 dark:text-indigo-300 mb-2">Notas IA:</p>
                  <div className="grid grid-cols-1 gap-1.5 text-xs text-gray-600 dark:text-gray-400">
                    {Object.entries(proposal.internal_notes).map(([key, val]) => (
                      <div key={key}>
                        <span className="font-medium">{key.replace(/_/g, ' ')}:</span> {val}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
