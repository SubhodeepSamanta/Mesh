import { useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-md border border-[var(--border-light)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--txt-primary)] shadow-lg">
      <p className="mb-1 text-[var(--txt-secondary)]">{label}</p>
      <p style={{ color: 'var(--accent)' }}>
        Throughput: {Number(payload[0].value) < 0.01 ? '<0.01' : Number(payload[0].value).toFixed(2)} MB/s
      </p>
    </div>
  )
}

export default function SpeedChart({ data = [], peerCount = 1 }) {
  const total = useMemo(() => {
    if (data.length === 0) return 0
    const last = data[data.length - 1]
    return last.mbps || 0
  }, [data])

  const chartData = useMemo(() => {
    return data.map((d, i) => {
      const label =
        i % 10 === 0 || i === data.length - 1
          ? new Date(d.t).toLocaleTimeString('en-US', { minute: '2-digit', second: '2-digit' })
          : ''
      return { t: label, total: d.mbps || 0 }
    })
  }, [data])

  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium uppercase tracking-widest text-[var(--txt-secondary)]">
            Throughput
          </span>
          <span className="text-xl font-bold text-[var(--accent)]">
            0.0{' '}
            <span className="text-sm font-normal text-[var(--txt-secondary)]">MB/s</span>
          </span>
        </div>
        <div className="flex h-48 items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <svg className="h-8 w-8 text-[var(--txt-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4.5h18M3 9h18M3 13.5h18M3 18h18" />
            </svg>
            <p className="text-sm text-[var(--txt-secondary)]">Waiting for data...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium uppercase tracking-widest text-[var(--txt-secondary)]">
          Throughput
        </span>
        <span className="text-xl font-bold text-[var(--accent)]">
          {total < 0.01 ? '<0.01' : total.toFixed(2)}{' '}
          <span className="text-sm font-normal text-[var(--txt-secondary)]">MB/s</span>
        </span>
      </div>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap={1}>
            <XAxis
              dataKey="t"
              tick={{ fill: '#6b7280', fontSize: 10 }}
              axisLine={{ stroke: '#2a2a2a' }}
              tickLine={false}
              interval={0}
            />
            <YAxis
              tick={{ fill: '#6b7280', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={32}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: '#1a1a1a' }} />
            <Bar
              dataKey="total"
              fill="var(--accent)"
              radius={[1, 1, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
