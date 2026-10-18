import { useEffect, useState } from 'react'
import { hub, useResource } from '../api.ts'
import { AnalysisView } from '../components/AnalysisView.tsx'
import { dayLong } from '../format.ts'
import type { Analysis, InsightsData } from '../types.ts'

const KINDS = [
  { value: '', label: 'All' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'workout', label: 'Workout' },
  { value: 'run', label: 'Run' },
  { value: 'meal', label: 'Meal' },
] as const

const KIND_NAMES: Record<string, string> = {
  daily: 'Daily', weekly: 'Weekly', workout: 'Workout', run: 'Run', meal: 'Meal',
}

export function Insights() {
  const [kind, setKind] = useState('')
  const first = useResource<InsightsData>(`/api/insights${kind ? `?kind=${kind}` : ''}`)
  const [older, setOlder] = useState<Analysis[]>([])
  const [more, setMore] = useState(false)
  const [open, setOpen] = useState<number | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => { setOlder([]); setMore(first.data?.more ?? false) }, [first.data])

  const list = [...(first.data?.analyses ?? []), ...older]
  const loadMore = async () => {
    const before = list.at(-1)?.date
    if (!before) return
    setLoadingMore(true)
    try {
      const page = await hub<InsightsData>(`/api/insights?${new URLSearchParams({ ...(kind && { kind }), before })}`)
      setOlder((o) => [...o, ...page.analyses])
      setMore(page.more)
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <>
      <div className="page-head"><h1 className="page-title">Insights</h1></div>
      <div className="segmented" role="group" aria-label="Kind of analysis">
        {KINDS.map((k) => (
          <button key={k.value} aria-pressed={kind === k.value} onClick={() => setKind(k.value)}>{k.label}</button>
        ))}
      </div>
      {first.data && list.length === 0 ? (
        <p className="empty">
          <strong>Nothing here yet.</strong>
          Claude saves an analysis every morning, a weekly review on Mondays, and one whenever you ask about a run or workout.
        </p>
      ) : (
        <ul className="rows" data-stale={first.loading && !first.data ? '' : undefined}>
          {list.map((a) => (
            <li key={a.id}>
              <button className="row" onClick={() => setOpen(open === a.id ? null : a.id)} aria-expanded={open === a.id}>
                <span className="row-title" lang="th" style={{ gridColumn: '1 / -1' }}>{a.title}</span>
                <span className="row-sub">{KIND_NAMES[a.kind]} · {dayLong(a.date)}</span>
              </button>
              {open === a.id && <div style={{ padding: '0 0 20px' }}><AnalysisView analysis={{ ...a, title: '' }} clamp={false} /></div>}
            </li>
          ))}
        </ul>
      )}
      {more && (
        <button className="text-button" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? 'Loading…' : 'Show older'}
        </button>
      )}
    </>
  )
}
