import type { Servitor } from '../types'

// The servitors: every agent other than the main loop, kept by agent id. Pure; register.tsx feeds it from the events.

export const KEEP_FINISHED = 30
export const LINGER_MS = 60_000
export const ROSTER_MAX = 5

export type Agents = Readonly<Record<string, Servitor>>
type Spawn = { subagentType: string; description: string; prompt: string; workflow?: unknown }

const firstWords = (text: string) => text.replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ')

// Live agents stay; finished ones beyond the newest KEEP_FINISHED go.
function trim(agents: Record<string, Servitor>): Record<string, Servitor> {
  const done = Object.entries(agents).filter(([, s]) => s.endedAt !== undefined)
  if (done.length <= KEEP_FINISHED) return agents
  const drop = new Set(done.sort((a, b) => b[1].endedAt! - a[1].endedAt!).slice(KEEP_FINISHED).map(([id]) => id))
  return Object.fromEntries(Object.entries(agents).filter(([id]) => !drop.has(id)))
}

// A new agent, or a resumed one going live again. The engine ignores a workflow agent's description, so its prompt stands in.
export function spawned(agents: Agents, id: string, e: Spawn, at: number): Record<string, Servitor> {
  const isWorkflow = e.workflow !== undefined
  const prev = agents[id]
  const type = prev?.type ?? (isWorkflow ? 'workflow' : e.subagentType || 'agent')
  const description = prev?.description || (isWorkflow ? '' : e.description) || firstWords(e.prompt)
  return trim({ ...agents, [id]: { type, description, startedAt: at, rites: prev?.rites ?? 0 } })
}

export function ranRite(agents: Agents, id: string): Agents {
  const s = agents[id]
  return s ? { ...agents, [id]: { ...s, rites: s.rites + 1 } } : agents
}

// A resumed subagent or a teammate that woke: live again, its clock restarted.
export function turnStarted(agents: Agents, id: string, at: number): Agents {
  const s = agents[id]
  if (!s) return agents
  const { type, description, rites } = s
  return { ...agents, [id]: { type, description, rites, startedAt: at } }
}

export function turnEnded(agents: Agents, id: string, at: number, ok: boolean): Agents {
  const s = agents[id]
  return s ? trim({ ...agents, [id]: { ...s, endedAt: at, ok } }) : agents
}

// What the roster lists at `now`: live agents oldest first, then those finished within LINGER_MS, newest first.
export function roster(agents: Agents, now: number): Servitor[] {
  const all = Object.values(agents)
  const live = all.filter(s => s.endedAt === undefined).sort((a, b) => a.startedAt - b.startedAt)
  const done = all.filter(s => s.endedAt !== undefined && now - s.endedAt < LINGER_MS).sort((a, b) => b.endedAt! - a.endedAt!)
  return [...live, ...done]
}

export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}
