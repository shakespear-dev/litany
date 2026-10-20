import { expect, test } from 'claude-code/testing'

import { addPulse, fit, height, LOG_MAX, minuteOf, pulseCounts, pulseWindow, slate, spiritName, splitWindow, type SlateData, type SlateRow } from '../hooks/slate'
import type { Servitor } from '../types'

const RITES = [
  ['Read', 'register.tsx'], ['Grep', ''], ['Bash', 'git status'], ['Edit', 'lore.ts'], ['Bash', 'claude plugin test'],
  ['Edit', 'lore.ts'], ['Bash', 'claude plugin test'], ['Agent', ''], ['Read', 'themes.ts'], ['Bash', 'npx tsc -p tsconfig.json'],
  ['Write', 'panel.test.tsx'], ['Bash', 'git diff --stat'], ['Read', 'SPEC.md'], ['Edit', 'SPEC.md'], ['Bash', 'git commit -m "mods: x"'], ['Read', 'README.md'],
].map(([tool, label], i) => ({ tool: tool!, label: label!, ok: i !== 10 }))

const FULL: SlateData = {
  telemetry: { contextPct: 62, fiveHourPct: 41, costUsd: 3.84, rites: 37, failed: 1, heresies: 1, forge: 'my-projects', branch: 'feature-ux' },
  rites: RITES,
  heresies: [{ at: Date.UTC(2026, 9, 15, 12, 12), command: 'rm -rf tmp/quorum' }],
  spirits: { Bash: 14, Read: 11, Edit: 7, Grep: 3, Agent: 2 },
  agents: {},
  now: 0,
  isPulseSplit: false,
  law: 8,
  isWorking: true,
  show: { pulse: true, spirits: true, roster: true },
}
const EMPTY: SlateData = { telemetry: { rites: 0, failed: 0, heresies: 0 }, rites: [], heresies: [], spirits: {}, agents: {}, now: 0, isPulseSplit: false, law: 0, isWorking: false, show: { pulse: true, spirits: true, roster: true } }

const text = (r: SlateRow) => (r.kind === 'text' ? r.segs.map(s => s.text).join('') : `<${r.kind}>`)
const lines = (rows: SlateRow[]) => rows.map(text)
const has = (rows: SlateRow[], kind: 'art' | 'pulse') => rows.some(r => r.kind === kind)
const logRows = (rows: SlateRow[]) => Number(/last (\d+)/.exec(lines(rows).find(l => l.startsWith('RITES'))!)?.[1] ?? 0)

test('the slate fills the pane exactly at every size and never runs past the width', () => {
  for (const [cols, rows] of [[32, 48], [46, 48], [64, 48], [46, 36], [46, 25], [46, 12], [20, 30]] as const)
    for (const d of [FULL, EMPTY]) {
      const s = slate(d, cols, rows)
      expect(height(s), `${cols}x${rows}`).toBe(rows)
      for (const l of lines(s)) expect(l.length <= cols - 2, `${cols}x${rows}: ${l}`).toBe(true)
    }
})

test('the rite log takes the leftover height: 9, 11 and 13 rows at 32, 46 and 64 columns', () => {
  expect(logRows(slate(FULL, 32, 48))).toBe(9)
  expect(logRows(slate(FULL, 46, 48))).toBe(11)
  expect(logRows(slate(FULL, 64, 48))).toBe(13)
})

test('short panes fold Machine spirits, then Pulse, then the hero, keeping 3 log rows', () => {
  const at = (rows: number) => {
    const s = slate(FULL, 46, rows)
    return { spirits: lines(s).some(l => l.startsWith('MACHINE SPIRITS')), pulse: has(s, 'pulse'), hero: has(s, 'art'), log: logRows(s) }
  }
  expect(at(40)).toEqual({ spirits: true, pulse: true, hero: true, log: 3 })
  expect(at(36)).toEqual({ spirits: false, pulse: true, hero: true, log: 3 })
  expect(at(32)).toEqual({ spirits: false, pulse: false, hero: true, log: 3 })
  expect(at(25)).toEqual({ spirits: false, pulse: false, hero: false, log: 8 })
})

test('a pane shorter than the fixed rows keeps its top rows and draws no raster', () => {
  const s = slate(FULL, 46, 12)
  expect(s.length).toBe(12)
  expect(s.every(r => r.kind === 'text')).toBe(true)
  expect(text(s[0]!)).toMatch(/^my-projects @ feature-ux +● WORKING$/)
})

test('below 26 columns the hero band is left out', () => {
  expect(has(slate(FULL, 25, 48), 'art')).toBe(false)
  expect(has(slate(FULL, 26, 48), 'art')).toBe(true)
})

test('switching pulse or spirits off gives their rows to the log', () => {
  const at = (show: SlateData['show']) => slate({ ...FULL, show }, 46, 48)
  expect(has(at({ pulse: false, spirits: true, roster: true }), 'pulse')).toBe(false)
  expect(logRows(at({ pulse: false, spirits: true, roster: true }))).toBe(15)
  expect(lines(at({ pulse: true, spirits: false, roster: true })).some(l => l.startsWith('MACHINE SPIRITS'))).toBe(false)
  expect(logRows(at({ pulse: true, spirits: false, roster: true }))).toBe(15)
  expect(logRows(at({ pulse: false, spirits: false, roster: true }))).toBe(16)
})

test('the header shows the forge and the lamp; the stats wrap instead of clipping', () => {
  expect(text(slate(FULL, 46, 48)[0]!)).toBe(`my-projects @ feature-ux${' '.repeat(11)}● WORKING`)
  expect(text(slate(EMPTY, 46, 48)[0]!)).toBe(`${' '.repeat(35)}○ DORMANT`)
  const narrow = lines(slate(FULL, 32, 48))
  expect(narrow).toContain('$3.84 tithe  8 turns  37 rites')
  expect(narrow).toContain('1 failed')
})

test('gauges are full-width slabs coloured by the band thresholds', () => {
  const s = slate(FULL, 46, 48)
  const i = lines(s).findIndex(l => l.startsWith('COGITATOR'))
  expect(lines(s)[i]).toBe(`COGITATOR${' '.repeat(32)}62%`)
  expect(lines(s)[i + 1]).toBe('▰'.repeat(27) + '▱'.repeat(17))
  const slab = s[i + 1]!
  expect(slab.kind === 'text' && slab.segs[0]!.tone).toBe('warn')
})

test('Machine spirits rank the tools, bar them 1 to 5 and wrap at most 3 lines', () => {
  const l = lines(slate(FULL, 46, 48))
  const i = l.findIndex(x => x.startsWith('MACHINE SPIRITS'))
  expect(l[i]).toBe(`MACHINE SPIRITS ${'·'.repeat(14)} rites by tool`)
  expect(l[i + 1]).toBe('  Bash ▮▮▮▮▮ 14  Read ▮▮▮▮ 11  Edit ▮▮▮ 7')
  expect(l[i + 2]).toBe('  Grep ▮ 3  Agent ▮ 2')
  const many = Object.fromEntries(Array.from({ length: 30 }, (_, k) => [`mcp-server-with-a-long-name-${k}`, 30 - k]))
  const m = lines(slate({ ...FULL, spirits: many }, 32, 60))
  const j = m.findIndex(x => x.startsWith('MACHINE SPIRITS'))
  expect(m.slice(j + 1).findIndex(x => x === '')).toBeLessThanOrEqual(3)
  expect(m.every(x => x.length <= 30)).toBe(true)
})

test('rite lines mark the outcome and end in … when cut; newlines read as spaces', () => {
  const long = { tool: 'Bash', label: "git commit -m \"$(cat <<'EOF'\nmods: a very long message that runs on\nEOF\n)\"", ok: true }
  const l = lines(slate({ ...FULL, rites: [...RITES, long] }, 46, 48))
  const last = l[l.findIndex(x => x.startsWith('HERESY')) - 2]!
  expect(last).toBe('  + Bash  git commit -m "$(cat <<\'EOF\' mods…')
  expect(last.length).toBe(44)
  expect(l).toContain('  ✗ Write panel.test.tsx')
})

test('heresy and the Law are pinned to the bottom; no heresy, no section', () => {
  const l = lines(slate(FULL, 46, 48))
  const tail = l.slice(-6)
  expect(tail[0]).toBe(`HERESY ${'·'.repeat(35)} 1`)
  expect(tail[1]).toMatch(/^ {2}! \d\d:12 {2}rm -rf tmp\/quorum$/)
  expect(tail.slice(2)).toEqual(['', '⚙ LAW IX', '  The alien mechanism is a perversion of the', '  true path.'])
  expect(lines(slate(EMPTY, 46, 48)).some(x => x.startsWith('HERESY'))).toBe(false)
})

test('an empty session pads the log with blank rows and shows no count', () => {
  const l = lines(slate(EMPTY, 46, 48))
  expect(l).toContain(`RITES ${'·'.repeat(38)}`)
  expect(l.at(-1)).toBe('  Life is directed motion.')
})

test('fit cuts to the width with … and keeps short rows whole', () => {
  expect(fit([{ text: 'abc', tone: 'body' }], 5).map(s => s.text)).toEqual(['abc'])
  expect(fit([{ text: 'abc', tone: 'body' }, { text: 'defg', tone: 'dim' }], 5).map(s => s.text)).toEqual(['abc', 'd…'])
  expect(fit([{ text: 'abcdef', tone: 'body' }], 1).map(s => s.text)).toEqual(['…'])
})

test('the pulse counts rites per minute, keeps 1024 minutes, and windows the newest', () => {
  let p = addPulse({ last: 0, counts: [] }, 5)
  expect(p).toEqual({ last: 5, counts: [1] })
  p = addPulse(p, 5)
  p = addPulse(p, 7)
  expect(p).toEqual({ last: 7, counts: [2, 0, 1] })
  expect(addPulse(p, 6)).toEqual({ last: 7, counts: [2, 0, 2] })
  expect(addPulse(p, 5000).counts.length).toBe(1024)
  expect(pulseWindow(p, 8, 4)).toEqual([1, 0, 0.5, 0])
  expect(pulseWindow(p, 100, 4)).toEqual([0, 0, 0, 0])
  expect(pulseWindow({ last: 0, counts: [] }, 3, 2)).toEqual([0, 0])
  expect(minuteOf(120_000)).toBe(2)
})

test('spirits count MCP tools under their server; the log keeps 30', () => {
  expect(spiritName('mcp__linear-server__get_issue')).toBe('linear-server')
  expect(spiritName('Bash')).toBe('Bash')
  expect(LOG_MAX).toBe(30)
})

test('even a sliver of a pane keeps every row inside its width', () => {
  for (let cols = 3; cols <= 12; cols++)
    for (const d of [FULL, EMPTY]) for (const l of lines(slate(d, cols, 60).filter(r => r.kind === 'text'))) expect(l.length <= cols - 2, `${cols}: ${l}`).toBe(true)
})

test('the pulse keeps enough minutes to fill the widest raster', () => {
  // 512 raster columns hold 1024 minutes; a wide pane's left edge must not stay empty forever.
  let p = addPulse({ last: 0, counts: [] }, 0)
  p = addPulse(p, 1023)
  expect(pulseWindow(p, 1023, 1024)[0]).toBe(1)
})

test('the split window puts main and servitor rites on one scale', () => {
  const all = { last: 5, counts: [4, 2, 0] }
  const theirs = { last: 4, counts: [1, 2] }
  expect(pulseCounts(all, 5, 3)).toEqual([4, 2, 0])
  expect(pulseCounts(theirs, 5, 3)).toEqual([1, 2, 0])
  expect(splitWindow(all, theirs, 5, 3)).toEqual({ main: [1, 0, 0], servitors: [1 / 3, 2 / 3, 0] })
  // Scrolled past the servitors' minutes: nothing of theirs is in view.
  expect(splitWindow(all, theirs, 10, 3).servitors).toEqual([0, 0, 0])
})

const SERVS: Record<string, Servitor> = {
  a: { type: 'Explore', description: 'find the pane API', startedAt: 58_000, rites: 14 },
  b: { type: 'general-purpose', description: 'write slate\ntests', startedAt: 30_000, rites: 6 },
  c: { type: 'workflow', description: 'review:bugs', startedAt: 85_000, rites: 9 },
  d: { type: 'Plan', description: 'design the roster', startedAt: 0, endedAt: 90_000, ok: true, rites: 23 },
}
const WITH: SlateData = { ...FULL, agents: SERVS, now: 100_000 }

test('the roster lists live servitors, then the finished, with type, task, rites and time', () => {
  const l = lines(slate(WITH, 46, 60))
  const i = l.findIndex(x => x.startsWith('SERVITORS'))
  expect(l[i]).toBe(`SERVITORS ${'·'.repeat(27)} 3 live`)
  expect(l.slice(i + 1, i + 5)).toEqual([
    '  ● general… write slate tes…  6 rites  1:10',
    '  ● Explore  find the pane A… 14 rites  0:42',
    '  ● workflow review:bugs       9 rites  0:15',
    '  ✓ Plan     design the rost… 23 rites  1:30',
  ])
  const done = slate(WITH, 46, 60)[i + 4]!
  expect(done.kind === 'text' && done.segs.filter(s => s.text.trim() && s.text !== '✓').every(s => s.tone === 'dim')).toBe(true)
})

test('the roster shows 5 rows and counts the rest; nothing to list or roster off, no section', () => {
  const many = Object.fromEntries(Array.from({ length: 7 }, (_, k) => [`s${k}`, { type: 'Explore', description: `task ${k}`, startedAt: k, rites: 1 }]))
  const l = lines(slate({ ...FULL, agents: many, now: 10_000 }, 46, 70))
  const i = l.findIndex(x => x.startsWith('SERVITORS'))
  expect(l[i]).toMatch(/ 7 live · \+2$/)
  expect(l[i + 6]).toBe('')
  expect(lines(slate(FULL, 46, 60)).some(x => x.startsWith('SERVITORS'))).toBe(false)
  expect(lines(slate({ ...WITH, show: { ...WITH.show, roster: false } }, 46, 60)).some(x => x.startsWith('SERVITORS'))).toBe(false)
  // Finished a minute ago: gone.
  expect(lines(slate({ ...WITH, agents: { d: SERVS.d! }, now: 150_000 }, 46, 60)).some(x => x.startsWith('SERVITORS'))).toBe(false)
})

test('servitor rows in the log are indented under ↳ and tagged; the tag goes before the label is cut', () => {
  const rites = [
    { tool: 'Grep', label: 'agentId', ok: true, agent: 'Explore' },
    { tool: 'Bash', label: 'claude plugin test --with-a-very-long-flag', ok: false, agent: 'general-purpose' },
    { tool: 'Bash', label: 'git diff --stat', ok: true },
  ]
  const l = lines(slate({ ...FULL, rites }, 46, 48))
  expect(l).toContain(`  ↳ + Grep  agentId${' '.repeat(18)}Explore`)
  expect(l).toContain('  ↳ ✗ Bash  claude plugin test --with-a-ver…')
  expect(l).toContain('  + Bash  git diff --stat')
  const row = slate({ ...FULL, rites }, 46, 48).find(r => r.kind === 'text' && r.segs.some(s => s.text === 'Explore'))!
  expect(row.kind === 'text' && row.segs.find(s => s.text === 'Explore')!.tone).toBe('warn')
})

test('short panes fold spirits, then servitors, then pulse, then the hero', () => {
  const at = (rows: number) => {
    const s = slate(WITH, 46, rows)
    const l = lines(s)
    return { spirits: l.some(x => x.startsWith('MACHINE SPIRITS')), roster: l.some(x => x.startsWith('SERVITORS')), pulse: has(s, 'pulse'), hero: has(s, 'art'), log: logRows(s) }
  }
  expect(at(46)).toEqual({ spirits: true, roster: true, pulse: true, hero: true, log: 3 })
  expect(at(42)).toEqual({ spirits: false, roster: true, pulse: true, hero: true, log: 3 })
  expect(at(36)).toEqual({ spirits: false, roster: false, pulse: true, hero: true, log: 3 })
  expect(at(32)).toEqual({ spirits: false, roster: false, pulse: false, hero: true, log: 3 })
})

test('the pulse note says which graph is drawn', () => {
  expect(lines(slate(FULL, 46, 48))).toContain(`PULSE ${'·'.repeat(26)} rites / min`)
  expect(lines(slate({ ...FULL, isPulseSplit: true }, 46, 48))).toContain(`PULSE ${'·'.repeat(18)} main ▲  servitors ▼`)
})

test('servitors keep every row inside the width, down to a narrow pane', () => {
  for (const cols of [20, 32, 46])
    for (const l of lines(slate({ ...WITH, rites: [{ tool: 'Bash', label: 'x'.repeat(80), ok: true, agent: 'general-purpose' }] }, cols, 60).filter(r => r.kind === 'text')))
      expect(l.length <= cols - 2, `${cols}: ${l}`).toBe(true)
})

test('sublog off hides servitor rows already in the log', () => {
  const rites = [{ tool: 'Grep', label: 'agentId', ok: true, agent: 'Explore' }, { tool: 'Bash', label: 'git diff --stat', ok: true }]
  const l = lines(slate({ ...FULL, rites, show: { ...FULL.show, sublog: false } }, 46, 48))
  expect(l.some(x => x.includes('↳'))).toBe(false)
  expect(l).toContain('  + Bash  git diff --stat')
  expect(l.find(x => x.startsWith('RITES'))).toMatch(/last 1$/)
})
