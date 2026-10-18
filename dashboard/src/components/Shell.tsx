import { AlertCircle, Dumbbell, Footprints, NotebookText, RefreshCw, ReceiptText, Scale } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { refreshBus, syncNow, useResource, type HubError } from '../api.ts'
import { SOURCE_NAMES, when } from '../format.ts'
import type { TodayData } from '../types.ts'

export const TABS = [
  { path: '/', label: 'Today', icon: ReceiptText },
  { path: '/training', label: 'Training', icon: Dumbbell },
  { path: '/running', label: 'Running', icon: Footprints },
  { path: '/body', label: 'Body', icon: Scale },
  { path: '/insights', label: 'Insights', icon: NotebookText },
] as const

export function TabBar({ current, go }: { current: string; go: (path: string) => void }) {
  return (
    <nav className="tabbar" aria-label="Pages">
      {TABS.map(({ path, label, icon: Icon }) => (
        <a key={path} className="tab" href={path} aria-current={current === path ? 'page' : undefined}
          onClick={(e) => { if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); go(path) } }}>
          <Icon size={22} strokeWidth={1.8} aria-hidden />
          {label}
        </a>
      ))}
    </nav>
  )
}

/** Header: when data last arrived (from sync_log) and the Sync now button. */
export function TopBar({ error }: { error: HubError | null }) {
  // The Today response carries the sync state; any page shares its cache.
  const { data } = useResource<TodayData>('/api/today')
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)

  const sync = async () => {
    setSyncing(true)
    setSyncError(null)
    try {
      const jobs = await syncNow()
      const failed = jobs.filter((j) => j.status === 'error')
      if (failed.length) setSyncError(failed.map((j) => `${SOURCE_NAMES[j.source]}: ${j.error}`).join(' · '))
      else if (jobs.some((j) => j.status !== 'ok')) setSyncError('Sync is still running. Pull again in a minute.')
    } catch (err) {
      setSyncError((err as Error).message)
    } finally {
      setSyncing(false)
      refreshBus.dispatchEvent(new Event('refresh'))
    }
  }

  const lastOk = data?.sync.map((s) => s.last_ok).filter((t): t is string => !!t).sort().at(-1)
  const failing = data?.sync.filter((s) => s.status === 'error') ?? []

  let notice: ReactNode = null
  if (error?.unreachable) {
    notice = <>{error.message} <button onClick={() => location.reload()}>Reload</button></>
  } else if (syncError) {
    notice = <>Sync failed. {syncError}</>
  } else if (failing.length) {
    notice = <>Last sync failed. {failing.map((s) => `${SOURCE_NAMES[s.source]}: ${s.error}`).join(' · ')}</>
  } else if (error) {
    notice = <>{error.message}</>
  }

  return (
    <>
      <header className="topbar">
        <span className="wordmark">Fitness Hub</span>
        <span className="sync-status" aria-live="polite">
          {syncing ? 'Syncing…' : lastOk && data ? `Synced ${when(lastOk, data.today)}` : null}
        </span>
        <button className="icon-button" onClick={sync} disabled={syncing} data-busy={syncing ? '' : undefined}
          aria-label="Sync now" title="Sync now">
          <RefreshCw size={20} aria-hidden />
        </button>
      </header>
      {notice && <p className="notice" role="status"><AlertCircle size={16} aria-hidden /><span>{notice}</span></p>}
    </>
  )
}
