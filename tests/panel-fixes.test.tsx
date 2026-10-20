import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { slate } from '../hooks/slate'

// Regressions from the final review of the panel branch.

const CMD = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const
const run = (args: string) => ({ command: 'litany', args, ...CMD }) as const
const PANE = {
  component: 'Pane',
  requestId: 'litany',
  props: { title: '+++ NOOSPHERE +++', isFocused: false, bodyColumns: 36, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const BAND = {
  component: 'AbovePrompt',
  requestId: 'band',
  props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 120, scroll: { offset: 0, bodyRows: 4 }, view: {} },
} as const
const START = { cwd: '/x/my-projects', surface: 'terminal', isInteractive: true } as const

function engine(on: On, isPlaced = true) {
  const calls = { opens: 0, closes: 0, blits: 0 }
  on('ui.open', () => {
    calls.opens++
    return isPlaced ? { value: { isPlaced: true as const } } : { value: { isPlaced: false as const, reason: 'unasked, 120 < 144 columns' } }
  })
  on('ui.close', () => (calls.closes++, { value: undefined }))
  on('ui.blit', () => (calls.blits++, { value: {} }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.repo', () => ({ value: null }))
  return calls
}

// What the terminal reports while it draws the band: its size and whether it docks panes.
async function terminal($: Engine, isFullscreen: boolean, columns = 160) {
  const ui = await $.ui.mount({ plugin: 'litany', surface: 'terminal', ...BAND, viewport: { columns, rows: 50, isFullscreen } })
  await ui.unmount()
}

test('the panel docks by itself only in a fullscreen terminal, on the first turn', async ($, on) => {
  mock.clock(on)
  const calls = engine(on)
  await $.session.start(START)
  expect(calls.opens).toBe(0)
  await terminal($, false)
  await $.turn.start({ text: 'go', turnId: 't1' })
  expect(calls.opens).toBe(0)
  await terminal($, true)
  await $.turn.start({ text: 'go', turnId: 't2' })
  expect(calls.opens).toBe(1)
  await $.turn.start({ text: 'go', turnId: 't3' })
  expect(calls.opens).toBe(1)
})

test('on a narrow window /litany panel shows the waiting pane instead of closing it', async ($, on) => {
  mock.clock(on)
  const calls = engine(on, false)
  await terminal($, true, 120)
  await $.turn.start({ text: 'go', turnId: 't1' })
  expect(calls.opens).toBe(1)
  await $.command.run(run('panel'))
  expect(calls.closes).toBe(0)
  expect(calls.opens).toBe(2)
})

test('a reload with panel switched off in config closes the open pane', { options: { panel: false } }, async ($, on) => {
  mock.clock(on)
  const calls = engine(on)
  // The pane was open before /config turned panel off: $.state outlives the reload.
  let isFaked = true
  on('state.get', { plugin: 'litany', key: 'panelOpen' }, (_$, e, next) => (isFaked ? { value: { value: true, version: 0 } } : next(e)))
  on('state.set', { plugin: 'litany', key: 'panelOpen' }, (_$, e, next) => {
    isFaked = false
    return next(e)
  })
  on('ui.render', { component: 'Pane' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>stock</Text>
  })
  await $.session.start(START)
  expect(calls.closes).toBe(1)
  const ui = await $.ui.mount({ plugin: 'litany', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Raster', key: 'art' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'stock' })).toBeDefined()
  await ui.unmount()
})

test('/litany panel on, the advice the mod gives, brings the panel back', async ($, on) => {
  mock.clock(on)
  const calls = engine(on)
  await $.command.run(run('panel'))
  await $.command.run(run('panel off'))
  expect(calls.closes).toBe(1)
  const off = await $.command.run(run('panel'))
  expect(off.text).toMatch(/\/litany panel on/)
  await $.command.run(run('panel on'))
  expect(calls.opens).toBe(2)
})

test('a multi-line command stays on one row of the rite and heresy logs', () => {
  const heredoc = "git commit -m \"$(cat <<'EOF'\nmods: a thing\nEOF\n)\""
  const rows = slate(
    { telemetry: { rites: 1, failed: 0, heresies: 1 }, rites: [{ tool: 'Bash', label: heredoc, ok: true }], heresies: [{ at: 0, command: 'rm -rf a\nrm -rf b' }], spirits: {}, agents: {}, now: 0, isPulseSplit: false, law: 0, isWorking: false, show: { pulse: false, spirits: false, roster: false } },
    80,
    40,
  )
  const lines = rows.map(r => (r.kind === 'text' ? r.segs.map(s => s.text).join('') : ''))
  expect(lines.some(l => l.includes('\n'))).toBe(false)
  expect(lines.find(l => l.startsWith('  + Bash  '))).toMatch(/cat <<'EOF' mods: a thing EOF \)"$/)
  expect(lines.find(l => l.startsWith('  ! '))).toMatch(/rm -rf a rm -rf b$/)
})

test('the first drawing after an open already shows the boot litany', async ($, on) => {
  mock.clock(on)
  let first: string | undefined
  on('ui.open', async () => {
    // The engine draws the pane before $.ui.open resolves.
    const ui = await $.ui.mount({ plugin: 'litany', surface: 'terminal', ...PANE })
    first = (await ui.find({ type: 'Raster', key: 'art' }))?.props.cells as string
    await ui.unmount()
    return { value: { isPlaced: true as const } }
  })
  on('ui.blit', () => ({ value: {} }))
  await $.command.run(run('panel'))
  const words = new Uint32Array(Uint8Array.fromBase64(first!).buffer)
  const cols = words.length / 3 / 11
  const row3 = Array.from({ length: cols }, (_, c) => String.fromCharCode(words[(3 * cols + c) * 3]!)).join('')
  expect(row3.trim()).toMatch(/^\+\+\+ NOOS/)
})
