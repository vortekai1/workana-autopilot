import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export function useProjects({ status, category, page = 1, pageSize = 20 } = {}) {
  const [projects, setProjects] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  const fetchProjects = useCallback(async () => {
    setLoading(true)
    try {
      let query = supabase
        .from('workana_projects')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range((page - 1) * pageSize, page * pageSize - 1)

      if (status && status !== 'all') {
        query = query.eq('status', status)
      }
      if (category && category !== 'all') {
        query = query.eq('category', category)
      }

      const { data, count, error } = await query

      if (error) throw error
      setProjects(data || [])
      setTotal(count || 0)
    } catch (err) {
      console.error('Error fetching projects:', err)
    } finally {
      setLoading(false)
    }
  }, [status, category, page, pageSize])

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  return { projects, total, loading, refetch: fetchProjects }
}

export function useProjectProposal(projectId) {
  const [proposal, setProposal] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!projectId) return

    setLoading(true)
    supabase
      .from('workana_proposals')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        setProposal(data?.[0] || null)
        setLoading(false)
      })
  }, [projectId])

  return { proposal, loading }
}
