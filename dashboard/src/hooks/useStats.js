import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { getStartOfDay, getStartOfWeek, getStartOfMonth, getDaysAgo } from '../utils/formatters'

export function useStats() {
  const [stats, setStats] = useState({
    proposalsToday: 0,
    proposalsWeek: 0,
    weeklyTarget: 55,
    wonProjects: 0,
    projectedRevenue: 0,
    retryPending: 0,
    responseRate: 0,
    conversionStats: [],
    loading: true,
  })

  useEffect(() => {
    fetchStats()
    const interval = setInterval(fetchStats, 60000) // refresh every minute
    return () => clearInterval(interval)
  }, [])

  async function fetchStats() {
    try {
      const [
        todayRes,
        weekRes,
        wonRes,
        revenueRes,
        retryRes,
        convRes,
      ] = await Promise.all([
        supabase
          .from('workana_proposals')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', getStartOfDay()),
        supabase
          .from('workana_proposals')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', getStartOfWeek()),
        supabase
          .from('workana_projects')
          .select('id', { count: 'exact', head: true })
          .eq('outcome', 'won'),
        supabase
          .from('workana_proposals')
          .select('budget_suggested')
          .gte('created_at', getStartOfMonth())
          .not('budget_suggested', 'is', null),
        supabase
          .from('workana_retry_queue')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending'),
        supabase
          .from('workana_conversion_stats')
          .select('*'),
      ])

      const revenue = (revenueRes.data || []).reduce(
        (sum, r) => sum + (Number(r.budget_suggested) || 0), 0
      )

      // Win rate calculation
      const { data: outcomeData } = await supabase
        .from('workana_projects')
        .select('outcome')
        .in('status', ['sent', 'applied', 'won', 'lost'])
        .not('outcome', 'is', null)
      const outcomeTotal = (outcomeData || []).length
      const wins = (outcomeData || []).filter(p => p.outcome === 'won').length
      const winRate = outcomeTotal > 0 ? Math.round((wins / outcomeTotal) * 100) : 0

      // Avg response time
      const { data: rtData } = await supabase
        .from('workana_projects')
        .select('response_time_hours')
        .not('response_time_hours', 'is', null)
        .order('created_at', { ascending: false })
        .limit(50)
      const avgResponseTime = (rtData || []).length > 0
        ? Math.round((rtData || []).reduce((s, r) => s + r.response_time_hours, 0) / rtData.length)
        : null

      const conv = convRes.data || []
      const totalSent = conv.reduce((s, c) => s + (c.total_sent || 0), 0)
      const totalResponded = conv.reduce((s, c) => s + (c.responded || 0), 0)
      const responseRate = totalSent > 0 ? Math.round((totalResponded / totalSent) * 100) : 0

      setStats({
        proposalsToday: todayRes.count || 0,
        proposalsWeek: weekRes.count || 0,
        weeklyTarget: 55,
        wonProjects: wonRes.count || 0,
        projectedRevenue: revenue,
        retryPending: retryRes.count || 0,
        responseRate,
        winRate,
        avgResponseTime,
        conversionStats: conv,
        loading: false,
      })
    } catch (err) {
      console.error('Error fetching stats:', err)
      setStats(prev => ({ ...prev, loading: false }))
    }
  }

  return stats
}

export function useProposalsPerDay() {
  const [data, setData] = useState([])

  useEffect(() => {
    async function fetch() {
      const { data: proposals } = await supabase
        .from('workana_proposals')
        .select('created_at')
        .gte('created_at', getDaysAgo(30))
        .order('created_at', { ascending: true })

      if (!proposals) return

      const byDay = {}
      proposals.forEach(p => {
        const day = p.created_at.substring(0, 10)
        byDay[day] = (byDay[day] || 0) + 1
      })

      // Fill gaps
      const result = []
      const start = new Date(getDaysAgo(30))
      for (let i = 0; i < 30; i++) {
        const d = new Date(start)
        d.setDate(d.getDate() + i)
        const key = d.toISOString().substring(0, 10)
        result.push({ date: key, count: byDay[key] || 0 })
      }

      setData(result)
    }
    fetch()
  }, [])

  return data
}

export function useProjectsByStatus() {
  const [data, setData] = useState([])

  useEffect(() => {
    async function fetch() {
      const { data: projects } = await supabase
        .from('workana_projects')
        .select('status')

      if (!projects) return

      const counts = {}
      projects.forEach(p => {
        counts[p.status] = (counts[p.status] || 0) + 1
      })

      const labels = {
        new: 'Nuevos',
        proposal_generated: 'Con Propuesta',
        sent: 'Enviados',
        skipped: 'Descartados',
        applied: 'Aplicados',
        won: 'Ganados',
        lost: 'Perdidos',
      }

      const colors = {
        new: '#3b82f6',
        proposal_generated: '#f59e0b',
        sent: '#10b981',
        skipped: '#6b7280',
        applied: '#6366f1',
        won: '#059669',
        lost: '#ef4444',
      }

      setData(
        Object.entries(counts).map(([status, count]) => ({
          name: labels[status] || status,
          value: count,
          fill: colors[status] || '#9ca3af',
        }))
      )
    }
    fetch()
  }, [])

  return data
}

export function useCategoryDistribution() {
  const [data, setData] = useState([])

  useEffect(() => {
    async function fetch() {
      const { data: projects } = await supabase
        .from('workana_projects')
        .select('category, status')
        .in('status', ['sent', 'applied', 'won', 'lost'])

      if (!projects) return

      const cats = {}
      projects.forEach(p => {
        const cat = p.category || 'Sin categoría'
        if (!cats[cat]) cats[cat] = { sent: 0, won: 0 }
        cats[cat].sent++
        if (p.status === 'won') cats[cat].won++
      })

      setData(
        Object.entries(cats)
          .map(([name, v]) => ({ name: name.substring(0, 20), ...v }))
          .sort((a, b) => b.sent - a.sent)
          .slice(0, 8)
      )
    }
    fetch()
  }, [])

  return data
}

export function useWinRateTrend() {
  const [data, setData] = useState([])

  useEffect(() => {
    async function fetch() {
      const { data: projects } = await supabase
        .from('workana_projects')
        .select('outcome, created_at')
        .in('status', ['sent', 'applied', 'won', 'lost'])
        .not('outcome', 'is', null)
        .gte('created_at', getDaysAgo(90))
        .order('created_at', { ascending: true })

      if (!projects || projects.length === 0) return

      // Group by week
      const byWeek = {}
      projects.forEach(p => {
        const d = new Date(p.created_at)
        const weekStart = new Date(d)
        weekStart.setDate(d.getDate() - d.getDay() + 1)
        const key = weekStart.toISOString().substring(0, 10)
        if (!byWeek[key]) byWeek[key] = { total: 0, won: 0 }
        byWeek[key].total++
        if (p.outcome === 'won') byWeek[key].won++
      })

      setData(
        Object.entries(byWeek)
          .map(([week, v]) => ({
            week,
            winRate: v.total > 0 ? Math.round((v.won / v.total) * 100) : 0,
            total: v.total,
            won: v.won,
          }))
          .sort((a, b) => a.week.localeCompare(b.week))
      )
    }
    fetch()
  }, [])

  return data
}

export function useABResults() {
  const [data, setData] = useState([])

  useEffect(() => {
    async function fetch() {
      const { data: results } = await supabase
        .from('workana_ab_results')
        .select('*')

      if (results) setData(results)
    }
    fetch()
  }, [])

  return data
}

export function useAlerts() {
  const [alerts, setAlerts] = useState([])

  useEffect(() => {
    async function check() {
      const items = []

      // Alert: 0 proposals today but it's a work day after 10am
      const now = new Date()
      const hour = now.getHours()
      const day = now.getDay()
      if (day >= 1 && day <= 6 && hour >= 10) {
        const { count } = await supabase
          .from('workana_proposals')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', getStartOfDay())
        if (count === 0) {
          items.push({ type: 'warning', message: '0 propuestas hoy — verifica que el workflow está activo' })
        }
      }

      // Alert: retry queue growing
      const { count: retryCount } = await supabase
        .from('workana_retry_queue')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
      if (retryCount > 5) {
        items.push({ type: 'error', message: `${retryCount} items en retry queue — posible problema de envío` })
      }

      // Alert: low win rate (last 2 weeks)
      const { data: recent } = await supabase
        .from('workana_projects')
        .select('outcome')
        .in('status', ['sent', 'applied', 'won', 'lost'])
        .not('outcome', 'is', null)
        .gte('created_at', getDaysAgo(14))
      if (recent && recent.length >= 10) {
        const wins = recent.filter(p => p.outcome === 'won').length
        const rate = Math.round((wins / recent.length) * 100)
        if (rate < 3) {
          items.push({ type: 'warning', message: `Win rate muy bajo últimas 2 semanas: ${rate}%` })
        }
      }

      setAlerts(items)
    }
    check()
    const interval = setInterval(check, 300000) // every 5 min
    return () => clearInterval(interval)
  }, [])

  return alerts
}

export function useScoresByCategory() {
  const [data, setData] = useState([])

  useEffect(() => {
    async function fetch() {
      const { data: projects } = await supabase
        .from('workana_projects')
        .select('category, pre_score, relevance_score')
        .not('relevance_score', 'is', null)

      if (!projects || projects.length === 0) return

      const cats = {}
      projects.forEach(p => {
        const cat = p.category || 'Sin categoría'
        if (!cats[cat]) cats[cat] = { preScores: [], relScores: [] }
        if (p.pre_score) cats[cat].preScores.push(p.pre_score)
        if (p.relevance_score) cats[cat].relScores.push(p.relevance_score)
      })

      setData(
        Object.entries(cats)
          .map(([name, v]) => ({
            name: name.substring(0, 20),
            preScore: v.preScores.length > 0
              ? Math.round(v.preScores.reduce((a, b) => a + b, 0) / v.preScores.length)
              : 0,
            relevance: v.relScores.length > 0
              ? Math.round(v.relScores.reduce((a, b) => a + b, 0) / v.relScores.length)
              : 0,
          }))
          .sort((a, b) => b.relevance - a.relevance)
          .slice(0, 8)
      )
    }
    fetch()
  }, [])

  return data
}
