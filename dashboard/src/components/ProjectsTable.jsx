import { useState } from 'react'
import { ExternalLink, ChevronLeft, ChevronRight, Star, ShieldCheck } from 'lucide-react'
import { useProjects } from '../hooks/useProjects'
import { formatDate, formatCurrency, getStatusBadge, getOutcomeInfo } from '../utils/formatters'
import ProjectModal from './ProjectModal'

export default function ProjectsTable() {
  const [status, setStatus] = useState('all')
  const [category, setCategory] = useState('all')
  const [page, setPage] = useState(1)
  const [selectedProject, setSelectedProject] = useState(null)

  const { projects, total, loading } = useProjects({ status, category, page, pageSize: 15 })
  const totalPages = Math.ceil(total / 15)

  return (
    <>
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
              Proyectos Recientes
              <span className="ml-2 text-xs font-normal text-gray-500">({total})</span>
            </h3>
            <div className="flex gap-2">
              <select
                value={status}
                onChange={(e) => { setStatus(e.target.value); setPage(1) }}
                className="text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 px-2.5 py-1.5"
              >
                <option value="all">Todos los estados</option>
                <option value="new">Nuevo</option>
                <option value="proposal_generated">Con Propuesta</option>
                <option value="sent">Enviado</option>
                <option value="skipped">Descartado</option>
                <option value="applied">Aplicado</option>
                <option value="won">Ganado</option>
                <option value="lost">Perdido</option>
              </select>
              <select
                value={category}
                onChange={(e) => { setCategory(e.target.value); setPage(1) }}
                className="text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 px-2.5 py-1.5"
              >
                <option value="all">Todas las categorias</option>
                <option value="it-programming">IT & Programacion</option>
                <option value="design-multimedia">Diseno & Multimedia</option>
                <option value="writing-translation">Escritura & Traduccion</option>
                <option value="admin-support">Admin & Soporte</option>
              </select>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-gray-200 dark:border-gray-700">
                <th className="text-left px-4 py-3 font-medium">Proyecto</th>
                <th className="text-center px-2 py-3 font-medium hidden md:table-cell">Score</th>
                <th className="text-center px-2 py-3 font-medium">Estado</th>
                <th className="text-right px-2 py-3 font-medium hidden sm:table-cell">Presupuesto</th>
                <th className="text-center px-2 py-3 font-medium hidden lg:table-cell">Cliente</th>
                <th className="text-right px-4 py-3 font-medium hidden md:table-cell">Fecha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={6} className="px-4 py-3">
                      <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                    </td>
                  </tr>
                ))
              ) : projects.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                    No se encontraron proyectos
                  </td>
                </tr>
              ) : (
                projects.map((p) => {
                  const badge = getStatusBadge(p.status)
                  const outcome = getOutcomeInfo(p.outcome)
                  return (
                    <tr
                      key={p.id}
                      onClick={() => setSelectedProject(p)}
                      className="hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 max-w-xs lg:max-w-md">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                              {p.title || 'Sin titulo'}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                              {p.category || '-'}
                            </p>
                          </div>
                          {p.workana_url && (
                            <a
                              href={p.workana_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-gray-400 hover:text-indigo-500 flex-shrink-0"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </div>
                      </td>
                      <td className="text-center px-2 py-3 hidden md:table-cell">
                        <div className="flex flex-col items-center gap-0.5">
                          {p.relevance_score != null ? (
                            <span className={`text-xs font-bold ${
                              p.relevance_score >= 80 ? 'text-emerald-600' :
                              p.relevance_score >= 60 ? 'text-amber-600' : 'text-gray-500'
                            }`}>
                              {p.relevance_score}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">-</span>
                          )}
                          {p.pre_score > 0 && (
                            <span className="text-[10px] text-gray-400">
                              pre:{p.pre_score}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="text-center px-2 py-3">
                        <span className={`inline-flex text-[11px] font-medium px-2 py-0.5 rounded-full ${badge.color}`}>
                          {badge.label}
                        </span>
                        {p.outcome && (
                          <p className={`text-[10px] mt-0.5 ${outcome.color}`}>
                            {outcome.label}
                          </p>
                        )}
                      </td>
                      <td className="text-right px-2 py-3 hidden sm:table-cell">
                        <span className="text-xs text-gray-700 dark:text-gray-300">
                          {p.budget_text || '-'}
                        </span>
                      </td>
                      <td className="text-center px-2 py-3 hidden lg:table-cell">
                        <div className="flex items-center justify-center gap-1">
                          {p.client_verified && (
                            <ShieldCheck className="w-3.5 h-3.5 text-blue-500" />
                          )}
                          {p.client_rating > 0 && (
                            <span className="flex items-center gap-0.5 text-xs text-gray-600 dark:text-gray-400">
                              <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                              {Number(p.client_rating).toFixed(1)}
                            </span>
                          )}
                          {!p.client_verified && !p.client_rating && (
                            <span className="text-xs text-gray-400">-</span>
                          )}
                        </div>
                      </td>
                      <td className="text-right px-4 py-3 hidden md:table-cell">
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {formatDate(p.created_at)}
                        </span>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700">
            <span className="text-xs text-gray-500">
              Pagina {page} de {totalPages}
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
                className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {selectedProject && (
        <ProjectModal
          project={selectedProject}
          onClose={() => setSelectedProject(null)}
        />
      )}
    </>
  )
}
