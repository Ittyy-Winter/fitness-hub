import { useEffect, useState, type ReactNode } from 'react'
import { useResource, type Resource } from './api.ts'
import { TABS, TabBar, TopBar } from './components/Shell.tsx'
import { Body } from './pages/Body.tsx'
import { Insights } from './pages/Insights.tsx'
import { Running } from './pages/Running.tsx'
import { Today } from './pages/Today.tsx'
import { Training } from './pages/Training.tsx'
import type { BodyData, RunningData, TodayData, TrainingData } from './types.ts'

const known = (path: string) => (TABS.some((t) => t.path === path) ? path : '/')

function usePath(): [string, (p: string) => void] {
  const [path, setPath] = useState(() => known(location.pathname))
  useEffect(() => {
    const onPop = () => setPath(known(location.pathname))
    addEventListener('popstate', onPop)
    return () => removeEventListener('popstate', onPop)
  }, [])
  const go = (p: string) => {
    if (p !== path) history.pushState(null, '', p)
    setPath(p)
    scrollTo({ top: 0 })
  }
  return [path, go]
}

// A page renders from its cached copy while the fresh one loads; with neither yet, it waits.
function Page<T>({ resource, render }: { resource: Resource<T>; render: (d: T) => ReactNode }) {
  if (!resource.data) {
    return resource.error
      ? <p className="empty"><strong>Couldn't load this page.</strong>{resource.error.message}</p>
      : <p className="section-note" role="status">Loading…</p>
  }
  return <>{render(resource.data)}</>
}

function Screen({ path, onError }: { path: string; onError: (e: Resource<unknown>['error']) => void }) {
  const resource = useResource<unknown>(path === '/insights' ? '' : `/api${path === '/' ? '/today' : path}`)
  useEffect(() => onError(resource.error), [resource.error, onError])
  const stale = resource.loading && !!resource.data
  const body = (() => {
    switch (path) {
      case '/training': return <Page resource={resource as Resource<TrainingData>} render={(d) => <Training data={d} />} />
      case '/running': return <Page resource={resource as Resource<RunningData>} render={(d) => <Running data={d} />} />
      case '/body': return <Page resource={resource as Resource<BodyData>} render={(d) => <Body data={d} />} />
      case '/insights': return <Insights />
      default: return <Page resource={resource as Resource<TodayData>} render={(d) => <Today data={d} />} />
    }
  })()
  return <main data-stale={stale ? '' : undefined} aria-busy={resource.loading}>{body}</main>
}

export function App() {
  const [path, go] = usePath()
  const [error, setError] = useState<Resource<unknown>['error']>(null)
  return (
    <div className="app">
      <TopBar error={error} />
      <Screen key={path} path={path} onError={setError} />
      <TabBar current={path} go={go} />
    </div>
  )
}
