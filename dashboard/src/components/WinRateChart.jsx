import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { TrendingUp } from 'lucide-react'
import { useWinRateTrend } from '../hooks/useStats'

export default function WinRateChart() {
  const data = useWinRateTrend()

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp className="w-4 h-4 text-emerald-500" />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
          Win Rate por Semana
        </h3>
      </div>

      {data.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-gray-400 text-sm">
          Sin datos de conversión aún
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.2} />
            <XAxis
              dataKey="week"
              tick={{ fontSize: 11, fill: '#9ca3af' }}
              tickFormatter={v => v.substring(5)}
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#9ca3af' }}
              unit="%"
              domain={[0, 'auto']}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: '#9ca3af' }}
              formatter={(v, name) => [`${v}%`, name === 'winRate' ? 'Win Rate' : name]}
              labelFormatter={l => `Semana: ${l}`}
            />
            <ReferenceLine y={10} stroke="#f59e0b" strokeDasharray="5 5" label={{ value: 'Meta 10%', fill: '#f59e0b', fontSize: 10 }} />
            <Line
              type="monotone"
              dataKey="winRate"
              stroke="#10b981"
              strokeWidth={2}
              dot={{ fill: '#10b981', r: 4 }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
