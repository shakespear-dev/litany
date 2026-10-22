import type { SessionUsage } from 'claude-code'

import { expect, test } from 'claude-code/testing'

import { bandSegments, contextColor, fitBand } from '../hooks/lore'

const FULL = { contextPct: 42, costUsd: 1.84, fiveHourPct: 23, branch: 'main', rites: 17, failed: 2, heresies: 0 }

test('bandSegments renders each reading and leaves out the missing ones', () => {
  expect(bandSegments(FULL).map(s => s.text)).toEqual([
    'cogitator 42%',
    'rites 17 · 2 failed',
    'forge main',
    'tithe $1.84',
    '5h 23%',
    'heresy 0',
  ])
  expect(bandSegments({ rites: 0, failed: 0, heresies: 0 }).map(s => s.text)).toEqual(['rites 0', 'heresy 0'])
})

test('colours turn amber at 60% and red at 85%', () => {
  expect(contextColor(59)).toBe('success')
  expect(contextColor(60)).toBe('warning')
  expect(contextColor(84.9)).toBe('warning')
  expect(contextColor(85)).toBe('error')
  expect(bandSegments({ ...FULL, heresies: 1 }).at(-1)?.color).toBe('error')
})

test('fitBand drops segments from the right until the line fits', () => {
  const segs = bandSegments(FULL)
  expect(fitBand(segs, 160)).toHaveLength(6)
  expect(fitBand(segs, 96)).toHaveLength(6)
  expect(fitBand(segs, 95)).toHaveLength(5)
  expect(fitBand(segs, 80)).toHaveLength(4)
  expect(fitBand(segs, 60)).toHaveLength(2)
  expect(fitBand(segs, 10)).toHaveLength(0)
})

const BAND = {
  component: 'AbovePrompt',
  requestId: 'band',
  props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 120, scroll: { offset: 0, bodyRows: 4 }, view: {} },
} as const

test('band shows real measurements and steps aside when switched off', async ($, on) => {
  on('session.measure', () => ({ changed: [] }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>stock band</Text>
  })
  await $.session.measure({
    context: { window: 200_000, tokens: 84_000, percent: 42 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 23 }],
    cost: { usd: 1.84 },
    changed: [],
  })

  let ui = await $.ui.mount({ plugin: 'litany', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /cogitator 42%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /tithe \$1\.84/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /5h 23%/ })).toBeDefined()
  await ui.unmount()

  await $.command.run({ command: 'litany', args: 'band off', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  ui = await $.ui.mount({ plugin: 'litany', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: 'stock band' })).toBeDefined()
  await ui.unmount()
})

test('the band draws in the desktop app too', async ($, on) => {
  on('session.measure', () => ({ changed: [] }))
  await $.session.measure({ context: { window: 200_000, tokens: 84_000, percent: 42 }, rateLimits: [], cost: { usd: 1.84 }, changed: [] })
  const ui = await $.ui.mount({ plugin: 'litany', surface: 'desktop', ...BAND })
  expect(await ui.find({ type: 'Text', text: /cogitator 42%/ })).toBeDefined()
  await ui.unmount()
})

test('a long turn refreshes the band after each tool call, before the turn ends and the engine measures', async ($, on) => {
  let usage = { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [], cost: { usd: 0 } } as SessionUsage
  on('session.usage', () => ({ value: usage }))
  on('session.measure', () => ({ changed: [] }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  // What a session start measures: no response yet, so no fill and nothing spent.
  await $.session.measure({ context: { window: 1_000_000 }, rateLimits: [], cost: { usd: 0 }, changed: ['cost'] })

  let ui = await $.ui.mount({ plugin: 'litany', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /cogitator/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /tithe \$0\.00/ })).toBeDefined()
  await ui.unmount()

  usage = { ...usage, context: { window: 1_000_000, tokens: 250_000, percent: 25 }, rateLimits: [{ kind: 'five_hour', percentUsed: 7 }], cost: { usd: 1.5 } }
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  ui = await $.ui.mount({ plugin: 'litany', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /cogitator 25%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /tithe \$1\.50/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /5h 7%/ })).toBeDefined()
  await ui.unmount()
})
