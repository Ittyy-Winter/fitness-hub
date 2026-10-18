import { useState } from 'react'
import { dayShort } from '../format.ts'
import type { Analysis } from '../types.ts'
import { Markdown } from './Markdown.tsx'

const SCORE_NAMES: Record<string, string> = {
  nutrition: 'Nutrition', training: 'Training', running: 'Running', recovery: 'Recovery',
}

/**
 * One of Claude's analyses. The Thai title is the heading; a byline under it says what it covers.
 * Collapsed, it shows the first section only, so the cut always falls between sections.
 */
export function AnalysisView({ analysis, byline, headingId, clamp = true }: {
  analysis: Analysis
  byline?: string
  headingId?: string
  clamp?: boolean
}) {
  const [open, setOpen] = useState(!clamp)
  const scores = Object.entries(analysis.scores ?? {})
  const [first, rest] = splitFirstSection(analysis.summary_md)
  const collapsible = clamp && rest.trim().length > 0
  const hasRecs = !!analysis.recommendations?.length
  return (
    <div className="analysis">
      {analysis.title && <h2 className="analysis-title" id={headingId} lang="th">{analysis.title}</h2>}
      {byline && <p className="analysis-byline">{byline}</p>}
      {scores.length > 0 && (
        <p className="analysis-meta mono">
          {scores.map(([k, v]) => <span key={k}>{(SCORE_NAMES[k] ?? k).toUpperCase()} {v}</span>)}
        </p>
      )}
      <div className="prose" lang="th">
        <Markdown text={open || !collapsible ? analysis.summary_md : first} />
      </div>
      {hasRecs && (open || !collapsible) && (
        <ol className="recs" lang="th">
          {analysis.recommendations!.map((r, i) => <li key={i}>{r}</li>)}
        </ol>
      )}
      {collapsible && (
        <button className="text-button" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Show less' : hasRecs ? 'Read all and the recommendations' : 'Read all'}
        </button>
      )}
    </div>
  )
}

// The text up to the second bold or # section heading, and the remainder.
function splitFirstSection(md: string): [string, string] {
  const lines = md.split('\n')
  const isHeading = (l: string) => /^\s*(#{1,4}\s|\*\*[^*]+\*\*\s*$)/.test(l)
  let seen = 0
  for (let i = 0; i < lines.length; i++) {
    if (isHeading(lines[i]!) && ++seen === 2) return [lines.slice(0, i).join('\n'), lines.slice(i).join('\n')]
  }
  return [md, '']
}

export const coverage = (analysis: Analysis, expected: string, what: string) =>
  analysis.date === expected
    ? `Claude on ${what}`
    : `Claude, ${dayShort(analysis.date)} · the newer one hasn't been written yet`
