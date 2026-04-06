import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export function useRetryQueue() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase
        .from('workana_retry_queue')
        .select('*')
        .in('status', ['pending', 'processing', 'failed'])
        .order('created_at', { ascending: false })
        .limit(20)

      setItems(data || [])
      setLoading(false)
    }
    fetch()
    const interval = setInterval(fetch, 30000)
    return () => clearInterval(interval)
  }, [])

  return { items, loading }
}

export function useLogs() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all') // 'all', 'success', 'error'

  useEffect(() => {
    async function fetch() {
      let query = supabase
        .from('workana_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50)

      if (filter === 'success') query = query.eq('success', true)
      if (filter === 'error') query = query.eq('success', false)

      const { data } = await query
      setLogs(data || [])
      setLoading(false)
    }
    fetch()
  }, [filter])

  return { logs, loading, filter, setFilter }
}
