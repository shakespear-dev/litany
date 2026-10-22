import type { AgentSpawnInput, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const CMD = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const
const PANEL = { command: 'litany', args: 'panel', ...CMD } as const
const PANE = {
  component: 'Pane',
  requestId: 'litany',
  props: { title: '+++ NOOSPHERE +++', isFocused: false, bodyColumns: 36, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

// The engine beneath the plugin: counts opens, closes and blits; `deny` makes every blit refused.
function engine(on: On, opts: { isPlaced?: boolean; deny?: string } = {}) {
  const calls = { opens: 0, closes: 0, blits: 0, keys: [] as string[], cells: [] as string[] }
  on('ui.open', () => {
    calls.opens++
    return opts.isPlaced === false ? { value: { isPlaced: false as const, reason: 'unasked, 80 < 144 columns' } } : { value: { isPlaced: true as const } }
  })
  on('ui.close', () => (calls.closes++, { value: undefined }))
  on('ui.blit', (_$, e) => (calls.blits++, calls.keys.push(e.key), calls.cells.push('cells' in e ? e.cells : ''), { value: opts.deny ? { deny: opts.deny } : {} }))
  return calls
}

function sessionBottoms(on: On) {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.repo', () => ({ value: null }))
}
const START = { cwd: '/x/my-projects', surface: 'terminal', isInteractive: true } as const

test('/litany panel opens the pane, animates it and closes it again', async ($, on) => {
  const clock = mock.clock(on)
  const calls = engine(on)
  await $.command.run(PANEL)
  expect(calls.opens).toBe(1)
  const ui = await $.ui.mount({ plugin: 'litany', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Raster', key: 'art' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '⚙ LAW I' })).toBeDefined()
  await clock.advance(1000)
  expect(calls.blits).toBe(4) // three boot frames, then the first idle frame
  await clock.advance(2000)
  expect(calls.blits).toBe(6) // idle: one frame a second
  await $.command.run(PANEL)
  expect(calls.closes).toBe(1)
  await clock.advance(2000)
  expect(calls.blits).toBe(6)
  await ui.unmount()
})

test('while a turn works the art moves four times a second', async ($, on) => {
  const clock = mock.clock(on)
  const calls = engine(on)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  await $.command.run(PANEL)
  const ui = await $.ui.mount({ plugin: 'litany', surface: 'terminal', ...PANE })
  await clock.advance(1000)
  const before = calls.blits
  await $.turn.start({ text: 'go', turnId: 't1' })
  await clock.advance(1000)
  expect(calls.blits - before).toBe(4)
  await ui.unmount()
})

test('an unseated pane is not drawn until the engine seats it', async ($, on) => {
  const clock = mock.clock(on)
  const calls = engine(on, { isPlaced: false })
  await $.command.run(PANEL)
  await clock.advance(2000)
  expect(calls.blits).toBe(0)
})

test('a refused blit stops drawing quietly until the pane is drawn again', async ($, on) => {
  const clock = mock.clock(on)
  const calls = engine(on, { deny: 'nothing mounted' })
  await $.command.run(PANEL)
  const ui = await $.ui.mount({ plugin: 'litany', surface: 'terminal', ...PANE })
  await clock.advance(2000)
  expect(calls.blits).toBe(1)
  await ui.unmount()
})

test('closing the pane stops the timer and keeps it closed for the session', async ($, on) => {
  const clock = mock.clock(on)
  const calls = engine(on)
  sessionBottoms(on)
  await $.command.run(PANEL)
  expect(calls.opens).toBe(1)
  const ui = await $.ui.mount({ plugin: 'litany', surface: 'terminal', ...PANE })
  await clock.advance(1000)
  // The test's $ cannot raise a person's close (ui.close is not on it); the command closes through the same state.
  await $.command.run(PANEL)
  const after = calls.blits
  await clock.advance(2000)
  expect(calls.blits).toBe(after)
  await $.session.start(START)
  expect(calls.opens).toBe(1)
  await ui.unmount()
})

test('a second session.start (a reload) reopens the open pane with one timer', async ($, on) => {
  const clock = mock.clock(on)
  const calls = engine(on)
  sessionBottoms(on)
  await $.command.run(PANEL)
  await $.session.start(START)
  await $.session.start(START)
  expect(calls.opens).toBe(3)
  const ui = await $.ui.mount({ plugin: 'litany', surface: 'terminal', ...PANE })
  await clock.advance(1000)
  const before = calls.blits
  await clock.advance(4000)
  expect(calls.blits - before).toBe(4) // idle: one frame a second, not two
  await ui.unmount()
})

test('/litany panel off closes an open pane', async ($, on) => {
  mock.clock(on)
  const calls = engine(on)
  await $.command.run(PANEL)
  await $.command.run({ command: 'litany', args: 'panel off', ...CMD })
  expect(calls.closes).toBe(1)
})

test('with the panel switched off nothing opens', { options: { panel: false } }, async ($, on) => {
  const calls = engine(on)
  sessionBottoms(on)
  await $.session.start(START)
  expect(calls.opens).toBe(0)
  const r = await $.command.run(PANEL)
  expect(r.text).toMatch(/switched off/)
  expect(calls.opens).toBe(0)
})

const sized = (bodyColumns: number, bodyRows: number) => ({ ...PANE, props: { ...PANE.props, bodyColumns, scroll: { offset: 0, bodyRows } } })

test('the pane fills its body: hero and pulse rasters span the inner width', async ($, on) => {
  mock.clock(on)
  engine(on)
  await $.command.run(PANEL)
  const ui = await $.ui.mount({ plugin: 'litany', surface: 'terminal', ...sized(46, 48) })
  expect((await ui.find({ type: 'Box' }))?.props.height).toBe(48)
  const art = await ui.find({ type: 'Raster', key: 'art' })
  expect([art?.props.columns, art?.props.rows]).toEqual([44, 11])
  const pulse = await ui.find({ type: 'Raster', key: 'pulse' })
  expect([pulse?.props.columns, pulse?.props.rows]).toEqual([44, 2])
  expect(await ui.find({ type: 'Text', text: '○ DORMANT' })).toBeDefined()
  await ui.unmount()
})

test('a resized pane draws and blits the hero at the new width', async ($, on) => {
  const clock = mock.clock(on)
  const calls = engine(on)
  await $.command.run(PANEL)
  let ui = await $.ui.mount({ plugin: 'litany', surface: 'terminal', ...sized(36, 40) })
  await ui.unmount()
  ui = await $.ui.mount({ plugin: 'litany', surface: 'terminal', ...sized(50, 40) })
  expect((await ui.find({ type: 'Raster', key: 'art' }))?.props.columns).toBe(48)
  expect((await ui.find({ type: 'Box' }))?.props.height).toBe(40)
  await clock.advance(1000)
  const last = calls.cells[calls.keys.lastIndexOf('art')]!
  expect(Uint8Array.fromBase64(last).length / (11 * 12)).toBe(48)
  await ui.unmount()
})

test('the pulse is blitted once a minute so it scrolls while idle', async ($, on) => {
  const clock = mock.clock(on)
  const calls = engine(on)
  await $.command.run(PANEL)
  const ui = await $.ui.mount({ plugin: 'litany', surface: 'terminal', ...sized(46, 48) })
  await clock.advance(59_000)
  expect(calls.keys).not.toContain('pulse')
  await clock.advance(2_000)
  expect(calls.keys.filter(k => k === 'pulse').length).toBe(1)
  await ui.unmount()
})

test('pulse off leaves the pulse out and never blits it', { options: { pulse: false } }, async ($, on) => {
  const clock = mock.clock(on)
  const calls = engine(on)
  await $.command.run(PANEL)
  const ui = await $.ui.mount({ plugin: 'litany', surface: 'terminal', ...sized(46, 48) })
  expect(await ui.find({ type: 'Raster', key: 'pulse' })).toBeUndefined()
  await clock.advance(61_000)
  expect(calls.keys).not.toContain('pulse')
  await ui.unmount()
})

test('Machine spirits appear once tools have run, and not with spirits off', async ($, on) => {
  mock.clock(on)
  engine(on)
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.command.run(PANEL)
  const ui = await $.ui.mount({ plugin: 'litany', surface: 'terminal', ...sized(46, 48) })
  expect(await ui.find({ type: 'Text', text: 'MACHINE SPIRITS' })).toBeDefined()
  await ui.unmount()
  await $.command.run({ command: 'litany', args: 'spirits off', ...CMD })
  const off = await $.ui.mount({ plugin: 'litany', surface: 'terminal', ...sized(46, 48) })
  expect(await off.find({ type: 'Text', text: 'MACHINE SPIRITS' })).toBeUndefined()
  await off.unmount()
})

test('the claude theme leaves body text in the terminal colour', { options: { theme: 'claude' } }, async ($, on) => {
  mock.clock(on)
  engine(on)
  await $.command.run(PANEL)
  const ui = await $.ui.mount({ plugin: 'litany', surface: 'terminal', ...sized(46, 48) })
  const law = await ui.find({ type: 'Text', text: '  Life is directed motion.' })
  expect(law).toBeDefined()
  expect(law?.props.color).toBeUndefined()
  await ui.unmount()
})

test('the lamp goes back to DORMANT when the turn completes', async ($, on) => {
  mock.clock(on)
  engine(on)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  await $.command.run(PANEL)
  const ui = await $.ui.mount({ plugin: 'litany', surface: 'terminal', ...sized(46, 48) })
  await $.turn.start({ text: 'go', turnId: 't1' })
  expect(await ui.find({ type: 'Text', text: '● WORKING' })).toBeDefined()
  await $.turn.complete({ answer: '', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(await ui.find({ type: 'Text', text: '○ DORMANT' })).toBeDefined()
  await ui.unmount()
})

test('a row the terminal measures wider than counted is clipped, never wrapped onto a second line', async ($, on) => {
  mock.clock(on)
  engine(on)
  await $.command.run(PANEL)
  const ui = await $.ui.mount({ plugin: 'litany', surface: 'terminal', ...sized(46, 48) })
  expect((await ui.find({ type: 'Text' }))?.props.wrap).toBe('truncate-end')
  await ui.unmount()
})

const SPAWNED = { model: 'claude-haiku-5-5', agentId: 'a1' }
// The kit fills the rest of a spawn and takes a loop's agentId on a tool call; the typings only know the full shapes.
const EXPLORE = { prompt: 'Find the pane API.', description: 'find the pane API', subagentType: 'Explore' } as AgentSpawnInput
const inLoop = <T,>(input: T, agentId: string): T => ({ ...input, agentId })
const OK = { result: { stdout: '', stderr: '', interrupted: false } }

test('a servitor at work shows in the roster and mirrors the pulse', async ($, on) => {
  mock.clock(on, { now: 120_000 })
  engine(on)
  on('agent.spawn', () => SPAWNED)
  on('tool.call', () => OK)
  await $.command.run(PANEL)
  await $.agent.spawn(EXPLORE)
  await $.tool.call(inLoop({ tool: 'Bash', command: 'ls' }, 'a1'))
  const ui = await $.ui.mount({ plugin: 'litany', surface: 'terminal', ...sized(46, 60) })
  expect(await ui.find({ type: 'Text', text: 'SERVITORS' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: / main ▲ {2}servitors ▼$/ })).toBeDefined()
  expect((await ui.find({ type: 'Raster', key: 'pulse' }))?.props.rows).toBe(2)
  await ui.unmount()
})

test('with split off the pulse stays one graph', { options: { split: false } }, async ($, on) => {
  mock.clock(on, { now: 120_000 })
  engine(on)
  on('agent.spawn', () => SPAWNED)
  on('tool.call', () => OK)
  await $.command.run(PANEL)
  await $.agent.spawn(EXPLORE)
  await $.tool.call(inLoop({ tool: 'Bash', command: 'ls' }, 'a1'))
  const ui = await $.ui.mount({ plugin: 'litany', surface: 'terminal', ...sized(46, 60) })
  expect(await ui.find({ type: 'Text', text: / rites \/ min$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: / main ▲ {2}servitors ▼$/ })).toBeUndefined()
  await ui.unmount()
})

test('a finished servitor leaves the roster a minute after its turn ended', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  engine(on)
  on('agent.spawn', () => SPAWNED)
  on('turn.complete', () => ({ text: '' }))
  await $.command.run(PANEL)
  await $.agent.spawn(EXPLORE)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 's1', agentId: 'a1', reason: 'answer' })
  const shows = async () => {
    const ui = await $.ui.mount({ plugin: 'litany', surface: 'terminal', ...sized(46, 60) })
    const found = await ui.find({ type: 'Text', text: 'SERVITORS' })
    await ui.unmount()
    return found !== undefined
  }
  expect(await shows()).toBe(true)
  await clock.advance(61_000)
  expect(await shows()).toBe(false)
})

test('the open pane redraws on the timer: a finished servitor leaves the same tree after a minute', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  engine(on)
  on('agent.spawn', () => SPAWNED)
  on('turn.complete', () => ({ text: '' }))
  await $.command.run(PANEL)
  const ui = await $.ui.mount({ plugin: 'litany', surface: 'terminal', ...sized(46, 60) })
  await $.agent.spawn(EXPLORE)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 's1', agentId: 'a1', reason: 'answer' })
  expect(await ui.find({ type: 'Text', text: 'SERVITORS' })).toBeDefined()
  await clock.advance(61_000)
  expect(await ui.find({ type: 'Text', text: 'SERVITORS' })).toBeUndefined()
  await ui.unmount()
})

test('when the servitor minutes scroll out, the open pane goes back to one graph and its note', { timeoutMs: 30_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 120_000 })
  engine(on)
  on('agent.spawn', () => SPAWNED)
  on('tool.call', () => OK)
  await $.command.run(PANEL)
  await $.agent.spawn(EXPLORE)
  await $.tool.call(inLoop({ tool: 'Bash', command: 'ls' }, 'a1'))
  const ui = await $.ui.mount({ plugin: 'litany', surface: 'terminal', ...sized(46, 60) })
  expect(await ui.find({ type: 'Text', text: / main ▲ {2}servitors ▼$/ })).toBeDefined()
  // 44 inner columns hold 88 minutes; the kit advances at most 10000 timer waits at a time.
  for (let m = 0; m < 90; m++) await clock.advance(60_000)
  expect(await ui.find({ type: 'Text', text: / main ▲ {2}servitors ▼$/ })).toBeUndefined()
  await ui.unmount()
})

test('off the terminal the pane is one Svg of the same rows, animated by redraws instead of blits', async ($, on) => {
  const clock = mock.clock(on)
  const calls = engine(on)
  let redraws = 0
  on('ui.invalidate', () => (redraws++, { value: undefined }))
  await $.command.run(PANEL)
  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: 'litany', surface, ...sized(46, 48) })
    const svg = await ui.find({ type: 'Svg' })
    expect(svg?.props.source).toMatch(/^<svg [^>]*width="460" height="960"/)
    expect(svg?.props.source).toContain('>LAW</text>')
    expect(svg?.props.source).toContain('>DORMANT</text>')
    await ui.unmount()
  }
  const ui = await $.ui.mount({ plugin: 'litany', surface: 'desktop', ...sized(46, 48) })
  redraws = 0
  await clock.advance(3000)
  expect(calls.blits).toBe(0)
  expect(redraws).toBeGreaterThanOrEqual(3)
  await ui.unmount()
})

test('a pane left open opens again when the desktop attaches', async ($, on) => {
  mock.clock(on)
  const calls = engine(on)
  on('session.attach', (_$, e) => ({ clientId: e.clientId }))
  await $.command.run(PANEL)
  await $.command.run({ ...PANEL, args: 'panel off' })
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  expect(calls.opens).toBe(1)
  await $.command.run({ ...PANEL, args: 'panel on' })
  const opens = calls.opens
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  expect(calls.opens).toBe(opens) // already open with its timer running
})

test('a reload in a desktop session reopens the pane; a -p run with no surface does not', async ($, on) => {
  mock.clock(on)
  const calls = engine(on)
  sessionBottoms(on)
  let surfaces: readonly ('desktop' | 'terminal')[] = []
  on('session.surfaces', () => ({ value: surfaces }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  await $.command.run(PANEL)
  expect(calls.opens).toBe(1)
  await $.session.start({ cwd: '/x', surface: null, isInteractive: false })
  expect(calls.opens).toBe(1)
  surfaces = ['desktop']
  await $.session.start({ cwd: '/x', surface: null, isInteractive: false })
  expect(calls.opens).toBe(2)
})

test('with the terminal and the desktop both drawing the pane, frames are redraws whichever drew last', async ($, on) => {
  const clock = mock.clock(on)
  const calls = engine(on)
  let redraws = 0
  on('ui.invalidate', () => (redraws++, { value: undefined }))
  await $.command.run(PANEL)
  const desktop = await $.ui.mount({ plugin: 'litany', surface: 'desktop', ...sized(46, 48) })
  const terminal = await $.ui.mount({ plugin: 'litany', surface: 'terminal', ...sized(46, 48) })
  redraws = 0
  await clock.advance(3000)
  expect(calls.blits).toBe(0)
  expect(redraws).toBeGreaterThanOrEqual(3)
  await terminal.unmount()
  await desktop.unmount()
})

test('a module that starts with the pane left open reopens it when the desktop attaches', async ($, on) => {
  mock.clock(on)
  const calls = engine(on)
  // What a reload leaves: panelOpen kept in $.state, the module's timer gone.
  on('state.get', { plugin: 'litany', key: 'panelOpen' }, () => ({ value: { value: true, version: 0 } }))
  on('session.attach', (_$, e) => ({ clientId: e.clientId }))
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  expect(calls.opens).toBe(1)
})
