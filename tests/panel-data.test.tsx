import type { AgentSpawnInput } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { basename, parseCommand, pushLog, resolveTheme } from '../hooks/lore'
import type { HeresyEntry, Pulse, RiteEntry, Servitor } from '../types'

const CMD = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const
const BAND = {
  component: 'AbovePrompt',
  requestId: 'band',
  props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 120, scroll: { offset: 0, bodyRows: 4 }, view: {} },
} as const
const OK = { result: { stdout: '', stderr: '', interrupted: false } }

test('parseCommand reads the theme and the panel switch', () => {
  expect(parseCommand('theme claude')).toEqual({ kind: 'theme', name: 'claude' })
  expect(parseCommand('theme vaporwave').kind).toBe('error')
  expect(parseCommand('panel off')).toEqual({ kind: 'switch', name: 'panel', on: false })
})

test('resolveTheme: session override, then config, else mars', () => {
  expect(resolveTheme({}, null)).toBe('mars')
  expect(resolveTheme({ theme: 'claude' }, null)).toBe('claude')
  expect(resolveTheme({ theme: 'claude' }, 'mars')).toBe('mars')
  expect(resolveTheme({ theme: 'vaporwave' }, null)).toBe('mars')
  expect(resolveTheme({}, 'vaporwave')).toBe('mars')
})

test('pushLog keeps the newest entries; basename keeps the file name', () => {
  expect(pushLog([1, 2, 3], 4, 3)).toEqual([2, 3, 4])
  expect(basename('/a/b/lore.ts')).toBe('lore.ts')
  expect(basename('lore.ts')).toBe('lore.ts')
})

test('the rite log keeps the newest 30 main-loop calls with their outcome', async ($, on) => {
  const seen: { last: RiteEntry[] | null } = { last: null }
  on('state.set', { plugin: 'litany', key: 'riteLog' }, (_$, e, next) => {
    seen.last = e.value
    return next(e)
  })
  on('ui.toast', () => ({ value: undefined }))
  on('audio.play', () => ({ value: undefined }))
  on('tool.call', { tool: 'Bash' }, () => OK)
  on('tool.call', { tool: 'Read' }, () => ({ result: 'File does not exist.', isError: true }))
  for (let i = 0; i < 31; i++) await $.tool.call({ tool: 'Bash', command: `echo ${i}` })
  await $.tool.call({ tool: 'Read', file_path: '/x/y/lore.ts' })
  expect(seen.last?.length).toBe(30)
  expect(seen.last?.[0]).toEqual({ tool: 'Bash', label: 'echo 2', ok: true })
  expect(seen.last?.[29]).toEqual({ tool: 'Read', label: 'lore.ts', ok: false })
})

test('every tool call counts in the pulse minute it ran and in its spirit', async ($, on) => {
  const clock = mock.clock(on, { now: 120_000 })
  const seen: { pulse: Pulse | null; spirits: Record<string, number> | null } = { pulse: null, spirits: null }
  on('state.set', { plugin: 'litany', key: 'pulse' }, (_$, e, next) => ((seen.pulse = e.value), next(e)))
  on('state.set', { plugin: 'litany', key: 'spirits' }, (_$, e, next) => ((seen.spirits = e.value), next(e)))
  on('tool.call', () => OK)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Bash', command: 'pwd' })
  await clock.advance(60_000)
  await $.tool.call({ tool: 'mcp__linear-server__get_issue', id: 'EMP-1' })
  expect(seen.pulse).toEqual({ last: 3, counts: [2, 1] })
  expect(seen.spirits).toEqual({ Bash: 2, 'linear-server': 1 })
})

test('session.start names the forge for the panel header', async ($, on) => {
  const seen: { forge?: string } = {}
  on('state.set', { plugin: 'litany', key: 'telemetry' }, (_$, e, next) => ((seen.forge = e.value.forge), next(e)))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.repo', () => ({ value: { root: '/x/my-projects', remote: null, internal: false, name: null } }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  await $.session.start({ cwd: '/x/my-projects', surface: 'terminal', isInteractive: false })
  expect(seen.forge).toBe('my-projects')
})

test('the heresy log keeps the command and when it ran', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const seen: { last: HeresyEntry[] | null } = { last: null }
  on('state.set', { plugin: 'litany', key: 'heresyLog' }, (_$, e, next) => {
    seen.last = e.value
    return next(e)
  })
  on('ui.toast', () => ({ value: undefined }))
  on('audio.play', () => ({ value: undefined }))
  on('tool.call', { tool: 'Bash' }, () => OK)
  await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  await clock.settle()
  expect(seen.last).toEqual([{ at: 1_000_000, command: 'rm -rf build' }])
})

test('/litany theme recolours the band header and shows in the status', async $ => {
  const header = async () => {
    const ui = await $.ui.mount({ plugin: 'litany', surface: 'terminal', ...BAND })
    const color = (await ui.find({ type: 'Text', text: /^⚙ NOOSPHERE$/ }))?.props.color
    await ui.unmount()
    return color
  }
  expect(await header()).toBe('#C0392B')
  const r = await $.command.run({ command: 'litany', args: 'theme claude', ...CMD })
  expect(r.text).toMatch(/^theme\s+claude\s+\(this session\)$/m)
  expect(r.text).toMatch(/^panel\s+on$/m)
  expect(await header()).toBe('claude')
})

test('a theme outside the options falls back to mars', { options: { theme: 'vaporwave' } }, async $ => {
  const r = await $.command.run({ command: 'litany', args: '', ...CMD })
  expect(r.text).toMatch(/^theme\s+mars$/m)
})

const SPAWNED = { model: 'claude-haiku-5-5', agentId: 'a1' }
// The kit fills the rest of a spawn and takes a loop's agentId on a tool call; the typings only know the full shapes.
const EXPLORE = { prompt: 'Find the pane API.', description: 'find the pane API', subagentType: 'Explore' } as AgentSpawnInput
const inLoop = <T,>(input: T, agentId: string): T => ({ ...input, agentId })

test('a servitor is recorded at its spawn, counts its rites and ends with its turn', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const seen: { agents: Record<string, Servitor> | null } = { agents: null }
  on('state.set', { plugin: 'litany', key: 'agents' }, (_$, e, next) => ((seen.agents = e.value), next(e)))
  on('agent.spawn', () => SPAWNED)
  on('tool.call', () => OK)
  on('turn.complete', () => ({ text: '' }))
  await $.agent.spawn(EXPLORE)
  await $.tool.call(inLoop({ tool: 'Bash', command: 'ls' }, 'a1'))
  await $.tool.call(inLoop({ tool: 'Bash', command: 'pwd' }, 'a1'))
  await clock.advance(42_000)
  await $.turn.complete({ answer: 'found it', durationMs: 42_000, isAborted: false, turnId: 's1', agentId: 'a1', reason: 'answer' })
  expect(seen.agents).toEqual({ a1: { type: 'Explore', description: 'find the pane API', startedAt: 1_000, rites: 2, endedAt: 43_000, ok: true } })
})

test('a denied spawn records no servitor; an aborted turn ends one with ✗', async ($, on) => {
  mock.clock(on, { now: 0 })
  const writes: Record<string, Servitor>[] = []
  on('state.set', { plugin: 'litany', key: 'agents' }, (_$, e, next) => (writes.push(e.value), next(e)))
  on('agent.spawn', (_$, e) => (e.description === 'refused' ? { deny: 'no servitors today' } : SPAWNED))
  on('turn.complete', () => ({ text: '' }))
  await $.agent.spawn({ ...EXPLORE, description: 'refused' })
  expect(writes).toEqual([])
  await $.agent.spawn(EXPLORE)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 's1', agentId: 'a1', reason: 'aborted' })
  expect(writes.at(-1)?.a1?.ok).toBe(false)
})

test("a servitor's next turn makes it live again with a fresh clock", async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const seen: { agents: Record<string, Servitor> | null } = { agents: null }
  on('state.set', { plugin: 'litany', key: 'agents' }, (_$, e, next) => ((seen.agents = e.value), next(e)))
  on('agent.spawn', () => SPAWNED)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  await $.agent.spawn(EXPLORE)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 's1', agentId: 'a1', reason: 'answer' })
  await clock.advance(5_000)
  await $.turn.start({ text: 'one more thing', turnId: 's2', agentId: 'a1' })
  expect(seen.agents?.a1).toEqual({ type: 'Explore', description: 'find the pane API', startedAt: 5_000, rites: 0 })
})

test('servitor calls join the rite log tagged with their type; an unrecorded id is a fork', async ($, on) => {
  const seen: { last: RiteEntry[] | null } = { last: null }
  on('state.set', { plugin: 'litany', key: 'riteLog' }, (_$, e, next) => ((seen.last = e.value), next(e)))
  on('agent.spawn', () => SPAWNED)
  on('tool.call', () => OK)
  await $.agent.spawn(EXPLORE)
  await $.tool.call(inLoop({ tool: 'Bash', command: 'ls' }, 'a1'))
  await $.tool.call(inLoop({ tool: 'Bash', command: 'pwd' }, 'compact-1'))
  await $.tool.call({ tool: 'Bash', command: 'echo main' })
  expect(seen.last).toEqual([
    { tool: 'Bash', label: 'ls', ok: true, agent: 'Explore' },
    { tool: 'Bash', label: 'pwd', ok: true, agent: 'fork' },
    { tool: 'Bash', label: 'echo main', ok: true },
  ])
})

test("with sublog off the rite log keeps the main loop's calls only", { options: { sublog: false } }, async ($, on) => {
  const seen: { last: RiteEntry[] | null } = { last: null }
  on('state.set', { plugin: 'litany', key: 'riteLog' }, (_$, e, next) => ((seen.last = e.value), next(e)))
  on('agent.spawn', () => SPAWNED)
  on('tool.call', () => OK)
  await $.agent.spawn(EXPLORE)
  await $.tool.call(inLoop({ tool: 'Bash', command: 'ls' }, 'a1'))
  await $.tool.call({ tool: 'Bash', command: 'echo main' })
  expect(seen.last).toEqual([{ tool: 'Bash', label: 'echo main', ok: true }])
})

test("a servitor's rites count in the pulse and in the servitors' own pulse", async ($, on) => {
  mock.clock(on, { now: 120_000 })
  const seen: { all: Pulse | null; theirs: Pulse | null } = { all: null, theirs: null }
  on('state.set', { plugin: 'litany', key: 'pulse' }, (_$, e, next) => ((seen.all = e.value), next(e)))
  on('state.set', { plugin: 'litany', key: 'servitorPulse' }, (_$, e, next) => ((seen.theirs = e.value), next(e)))
  on('agent.spawn', () => SPAWNED)
  on('tool.call', () => OK)
  await $.agent.spawn(EXPLORE)
  await $.tool.call(inLoop({ tool: 'Bash', command: 'ls' }, 'a1'))
  await $.tool.call({ tool: 'Bash', command: 'echo main' })
  expect(seen.all).toEqual({ last: 2, counts: [2] })
  expect(seen.theirs).toEqual({ last: 2, counts: [1] })
})

test('a teammate in a pane of its own (its id is its address) is not recorded; one with a loop here is', async ($, on) => {
  mock.clock(on, { now: 0 })
  const writes: Record<string, Servitor>[] = []
  on('state.set', { plugin: 'litany', key: 'agents' }, (_$, e, next) => (writes.push(e.value), next(e)))
  on('agent.spawn', (_$, e) =>
    e.description === 'pane' ? { model: 'm', agentId: 'scout@crew', teammateId: 'scout@crew' } : { model: 'm', agentId: 't-1', teammateId: 'lead@crew' },
  )
  await $.agent.spawn({ ...EXPLORE, description: 'pane' })
  expect(writes).toEqual([])
  await $.agent.spawn({ ...EXPLORE, description: 'in process' })
  expect(Object.keys(writes.at(-1) ?? {})).toEqual(['t-1'])
})

test("an engine fork's calls stay out of the servitors' pulse", async ($, on) => {
  mock.clock(on, { now: 120_000 })
  const seen: { theirs: Pulse | null } = { theirs: null }
  on('state.set', { plugin: 'litany', key: 'servitorPulse' }, (_$, e, next) => ((seen.theirs = e.value), next(e)))
  on('tool.call', () => OK)
  await $.tool.call(inLoop({ tool: 'Bash', command: 'pwd' }, 'compact-1'))
  expect(seen.theirs).toBe(null)
})
