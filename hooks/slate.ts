import type { HeresyEntry, Pulse, RiteEntry, Servitor, Telemetry } from '../types'
import { contextColor, hhmm, lawNumeral, LAWS, wrap } from './lore'
import { type Agents, elapsed, roster, ROSTER_MAX } from './servitors'
import { ART_COLS, ART_ROWS, PULSE_ROWS, type TextTone } from './themes'

// The Dataslate: the panel's rows for a pane `cols × rows`, top to bottom. Pure; the Pane render maps them onto elements.

export const LOG_MAX = 30
// Two minutes per raster cell, and a Raster is at most 512 columns: the widest pane's pulse fills edge to edge.
export const PULSE_MINUTES = 1024
const LOG_MIN = 3

export type Seg = { text: string; tone: TextTone; bold?: boolean }
export type SlateRow = { kind: 'text'; segs: Seg[] } | { kind: 'art'; rows: number } | { kind: 'pulse'; rows: number }
export type SlateData = {
  telemetry: Telemetry
  rites: readonly RiteEntry[]
  heresies: readonly HeresyEntry[]
  spirits: Readonly<Record<string, number>>
  agents: Agents
  // ms on $.clock: the roster's times and which finished rows still show.
  now: number
  law: number
  isWorking: boolean
  // The pulse raster is mirrored (split on and a servitor rite in view): the note says so.
  isPulseSplit: boolean
  // sublog false: servitor rows already in the log are hidden too; absent counts as on.
  show: { pulse: boolean; spirits: boolean; roster: boolean; sublog?: boolean }
}

export const ROSTER_HEAD = 'SERVITORS'

const TONE = { success: 'ok', warning: 'warn', error: 'error' } as const
const BLANK: SlateRow = { kind: 'text', segs: [] }
const row = (...segs: Seg[]): SlateRow => ({ kind: 'text', segs })
const seg = (text: string, tone: TextTone, bold = false): Seg => (bold ? { text, tone, bold } : { text, tone })
const len = (segs: readonly Seg[]) => segs.reduce((n, s) => n + s.text.length, 0)

export const height = (rows: readonly SlateRow[]) => rows.reduce((n, r) => n + (r.kind === 'text' ? 1 : r.rows), 0)

// ponytail: width by UTF-16 length; a label with emoji or CJK can still overrun its row. Count cells if that bites. Cuts a row to the width, ending in … when anything was cut; newlines read as spaces.
export function fit(segs: readonly Seg[], width: number): Seg[] {
  const flat = segs.map(s => ({ ...s, text: s.text.replace(/\s*\n\s*/g, ' ') }))
  if (len(flat) <= width) return flat
  const out: Seg[] = []
  let left = width - 1
  for (const s of flat) {
    if (left <= 0) break
    const text = s.text.slice(0, left)
    out.push({ ...s, text })
    left -= text.length
  }
  const last = out.at(-1)
  if (last) out[out.length - 1] = { ...last, text: `${last.text}…` }
  else out.push(seg('…', flat[0]?.tone ?? 'dim'))
  return out
}

// Items two spaces apart, wrapped onto further lines rather than clipped.
function flow(items: readonly Seg[][], width: number): Seg[][] {
  const lines: Seg[][] = []
  let line: Seg[] = []
  for (const item of items) {
    if (line.length && len(line) + 2 + len(item) > width) {
      lines.push(line)
      line = []
    }
    line = line.length ? [...line, seg('  ', 'dim'), ...item] : [...item]
  }
  if (line.length) lines.push(line)
  return lines.map(l => fit(l, width))
}

// NAME ········ note: the note is dropped when the head would not fit.
function head(name: string, note: string, width: number, tone: TextTone = 'head'): SlateRow {
  const room = width - name.length - 1
  const shown = note && room >= note.length + 2 ? note : ''
  const dots = Math.max(0, room - (shown ? shown.length + 1 : 0))
  return row(...fit([seg(name, tone, true), seg(` ${'·'.repeat(dots)}`, 'dim'), ...(shown ? [seg(` ${shown}`, 'dim')] : [])], width))
}

// Left and right parts of one row; the right part wins when the width runs out.
function spread(left: Seg[], right: Seg[], width: number): SlateRow {
  if (len(right) >= width) return row(...fit(right, width))
  const gap = width - len(left) - len(right)
  if (gap >= 1) return row(...left, seg(' '.repeat(gap), 'dim'), ...right)
  return row(...fit([...left, seg(' ', 'dim')], width - len(right)), ...right)
}

function gauge(label: string, pct: number, width: number): SlateRow[] {
  const tone = TONE[contextColor(pct)]
  const n = Math.max(0, Math.min(width, Math.round((pct / 100) * width)))
  return [spread([seg(label, 'head', true)], [seg(`${Math.round(pct)}%`, tone)], width), row(seg('▰'.repeat(n), tone), seg('▱'.repeat(width - n), 'dim'))]
}

export const spiritName = (tool: string) => /^mcp__(.+?)__/.exec(tool)?.[1] ?? tool

function spiritLines(spirits: Readonly<Record<string, number>>, width: number): Seg[][] {
  const tally = Object.entries(spirits).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const top = tally[0]?.[1] ?? 0
  const items = tally.map(([name, n]) => [seg(name, 'body'), seg(` ${'▮'.repeat(Math.max(1, Math.round((5 * n) / top)))}`, 'head'), seg(` ${n}`, 'dim')])
  return flow(items, width).slice(0, 3)
}

// A servitor's call sits under a ↳ with its type on the right; the type goes before the label is cut.
function riteRow(r: RiteEntry, width: number): SlateRow {
  const mark = [seg(r.ok ? '+' : '✗', r.ok ? 'ok' : 'error'), seg(` ${r.tool.padEnd(6)}`, r.ok ? 'body' : 'error'), seg(r.label, r.ok ? 'dim' : 'error')]
  if (r.agent === undefined) return row(...fit([seg('  ', 'dim'), ...mark], width))
  const left = fit([seg('  ', 'dim'), seg('↳ ', 'warn'), ...mark], width)
  return len(left) + 1 + r.agent.length <= width ? spread(left, [seg(r.agent, 'warn')], width) : row(...left)
}

// ● type task ··· NN rites  m:ss; a finished row is dim but for its ✓ or ✗.
function rosterRow(s: Servitor, now: number, width: number): SlateRow {
  const isLive = s.endedAt === undefined
  const tone = (t: TextTone): TextTone => (isLive ? t : 'dim')
  const lamp = isLive ? seg('●', 'warn') : s.ok ? seg('✓', 'ok') : seg('✗', 'error')
  const type = s.type.length > 8 ? `${s.type.slice(0, 7)}…` : s.type
  const left = [seg('  ', 'dim'), lamp, seg(` ${type.padEnd(9)}`, tone('body'))]
  const right = [seg(String(s.rites).padStart(2), tone('body')), seg(' rites  ', 'dim'), seg(elapsed((s.endedAt ?? now) - s.startedAt), tone('body'))]
  const room = width - len(left) - len(right) - 1
  if (room < 1) return spread(left, right, width)
  return spread([...left, ...fit([seg(s.description, 'dim')], room)], right, width)
}

const heresyRow = (h: HeresyEntry, width: number) => row(...fit([seg(`  ! ${hhmm(h.at)}  ${h.command}`, 'error')], width))

export function slate(d: SlateData, cols: number, rows: number): SlateRow[] {
  const w = Math.max(1, cols - 2)
  const t = d.telemetry
  const forge = t.forge && t.branch ? `${t.forge} @ ${t.branch}` : (t.forge ?? t.branch ?? '')
  const lamp = d.isWorking ? seg('● WORKING', 'warn') : seg('○ DORMANT', 'dim')
  const header = spread(forge ? [seg(forge, 'head', true)] : [], [lamp], w)
  const gauges = [...(t.contextPct !== undefined ? gauge('COGITATOR', t.contextPct, w) : []), ...(t.fiveHourPct !== undefined ? gauge('5H WINDOW', t.fiveHourPct, w) : [])]
  const items: Seg[][] = []
  if (t.costUsd !== undefined) items.push([seg(`$${t.costUsd.toFixed(2)}`, 'body'), seg(' tithe', 'dim')])
  items.push([seg(String(d.law), 'body'), seg(' turns', 'dim')])
  items.push([seg(String(t.rites), 'body'), seg(' rites', 'dim')])
  if (t.failed) items.push([seg(String(t.failed), 'error'), seg(' failed', 'dim')])
  const stats = flow(items, w).map(l => row(...l))
  const top = (hero: boolean): SlateRow[] => [header, BLANK, ...(hero ? [{ kind: 'art', rows: ART_ROWS } as const, BLANK] : []), row(seg('─'.repeat(w), 'head')), ...gauges, ...stats, BLANK]
  const pulse: SlateRow[] = [head('PULSE', d.isPulseSplit ? 'main ▲  servitors ▼' : 'rites / min', w), { kind: 'pulse', rows: PULSE_ROWS }, BLANK]
  const tally = spiritLines(d.spirits, w - 2)
  const spirits: SlateRow[] = tally.length ? [head('MACHINE SPIRITS', 'rites by tool', w), ...tally.map(l => row(...fit([seg('  ', 'dim'), ...l], w))), BLANK] : []
  const listed = d.show.roster ? roster(d.agents, d.now) : []
  const live = listed.filter(s => s.endedAt === undefined).length
  const more = listed.length - ROSTER_MAX
  const servitors: SlateRow[] = listed.length
    ? [head(ROSTER_HEAD, `${live} live${more > 0 ? ` · +${more}` : ''}`, w), ...listed.slice(0, ROSTER_MAX).map(s => rosterRow(s, d.now, w)), BLANK]
    : []
  const heresy: SlateRow[] = d.heresies.length ? [head('HERESY', String(t.heresies), w, 'error'), ...d.heresies.map(h => heresyRow(h, w)), BLANK] : []
  const law = [row(...fit([seg(`⚙ LAW ${lawNumeral(d.law)}`, 'head', true)], w)), ...wrap(LAWS[d.law % 16]!, w - 2).map(l => row(...fit([seg(`  ${l}`, 'body')], w)))]
  const bottom = [...heresy, ...law]

  // Folding: spirits first, then servitors, then pulse, then the hero, while the log would get fewer than LOG_MIN rows.
  let hasHero = w >= ART_COLS
  let hasPulse = d.show.pulse
  let hasSpirits = d.show.spirits
  let hasRoster = servitors.length > 0
  // The log's own head and the blank row under it are the 2.
  const fixed = () =>
    height(top(hasHero)) + (hasPulse ? height(pulse) : 0) + (hasSpirits ? height(spirits) : 0) + (hasRoster ? height(servitors) : 0) + height(bottom) + 2
  if (fixed() + LOG_MIN > rows) hasSpirits = false
  if (fixed() + LOG_MIN > rows) hasRoster = false
  if (fixed() + LOG_MIN > rows) hasPulse = false
  if (fixed() + LOG_MIN > rows) hasHero = false
  const logRows = Math.max(0, rows - fixed())
  const rites = d.show.sublog === false ? d.rites.filter(r => r.agent === undefined) : d.rites
  const shown = logRows ? rites.slice(-logRows) : []
  const log: SlateRow[] = [
    head('RITES', shown.length ? `last ${shown.length}` : '', w),
    ...shown.map(r => riteRow(r, w)),
    ...Array.from({ length: logRows - shown.length }, () => BLANK),
    BLANK,
  ]
  // A pane too small for the fixed rows keeps what fits from the top (the rasters have folded by then).
  const out: SlateRow[] = []
  let used = 0
  for (const r of [...top(hasHero), ...(hasPulse ? pulse : []), ...(hasSpirits ? spirits : []), ...(hasRoster ? servitors : []), ...log, ...bottom]) {
    const h = r.kind === 'text' ? 1 : r.rows
    if (used + h > rows) break
    out.push(r)
    used += h
  }
  return out
}

export const minuteOf = (ms: number) => Math.floor(ms / 60_000)

// One rite at `minute`; a clock that steps back counts in the newest minute.
export function addPulse(p: Pulse, minute: number): Pulse {
  if (!p.counts.length) return { last: minute, counts: [1] }
  if (minute <= p.last) return { last: p.last, counts: [...p.counts.slice(0, -1), p.counts.at(-1)! + 1] }
  const gap = Math.min(minute - p.last - 1, PULSE_MINUTES)
  return { last: minute, counts: [...p.counts, ...Array<number>(gap).fill(0), 1].slice(-PULSE_MINUTES) }
}

// The rites of the n minutes ending at `now`, oldest first.
export function pulseCounts(p: Pulse, now: number, n: number): number[] {
  const at = (m: number) => (m > p.last || m <= p.last - p.counts.length ? 0 : p.counts[p.counts.length - 1 - (p.last - m)]!)
  return Array.from({ length: n }, (_, i) => at(now - n + 1 + i))
}

const scaled = (counts: readonly number[], max: number) => counts.map(c => (max ? c / max : 0))

// The n minutes ending at `now`, oldest first, scaled to the busiest of them.
export function pulseWindow(p: Pulse, now: number, n: number): number[] {
  const counts = pulseCounts(p, now, n)
  return scaled(counts, Math.max(0, ...counts))
}

// The main loop's and the servitors' rites in the window, on one scale so the two halves compare.
export function splitWindow(all: Pulse, servitors: Pulse, now: number, n: number): { main: number[]; servitors: number[] } {
  const theirs = pulseCounts(servitors, now, n)
  const main = pulseCounts(all, now, n).map((c, i) => Math.max(0, c - theirs[i]!))
  const max = Math.max(0, ...main, ...theirs)
  return { main: scaled(main, max), servitors: scaled(theirs, max) }
}
