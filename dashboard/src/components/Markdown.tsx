import { Fragment, type ReactNode } from 'react'

// Claude's summaries use a small Markdown subset: paragraphs, "- " bullets, **bold**, and
// the odd "#" heading. Rendered as React nodes, never as HTML, so the text can't inject markup.

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4
      ? <strong key={i}>{part.slice(2, -2)}</strong>
      : <Fragment key={i}>{part}</Fragment>)
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let list: string[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) blocks.push(<p key={blocks.length}>{inline(para.join(' '))}</p>)
    if (list.length) blocks.push(<ul key={blocks.length}>{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>)
    para = []
    list = []
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) { flush(); continue }
    const bullet = /^[-*•]\s+(.*)$/.exec(line)
    // A line that is only bold text is a section heading in Claude's summaries.
    const heading = /^#{1,4}\s+(.*)$/.exec(line) ?? /^\*\*([^*]+)\*\*$/.exec(line)
    if (bullet) {
      if (para.length) { const l = list; list = []; flush(); list = l }
      list.push(bullet[1]!)
    } else if (heading) {
      flush()
      blocks.push(<h4 key={blocks.length}>{inline(heading[1]!)}</h4>)
    } else {
      if (list.length) flush()
      para.push(line)
    }
  }
  flush()
  return <>{blocks}</>
}
