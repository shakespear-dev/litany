import { expect, test } from 'claude-code/testing'

import { anyOn, applyCommand, isOn, lawText, parseCommand } from '../hooks/lore'

const NONE = { master: null, switches: {} }

test('switch resolution: master, then session override, then config default', () => {
  expect(isOn('sound', {}, NONE)).toBe(true)
  expect(isOn('sound', { sound: false }, NONE)).toBe(false)
  expect(isOn('sound', { sound: false }, { master: null, switches: { sound: true } })).toBe(true)
  expect(isOn('sound', { sound: true }, { master: false, switches: { sound: true } })).toBe(false)
})

test('parseCommand reads status, master and per-switch forms', () => {
  expect(parseCommand('')).toEqual({ kind: 'status' })
  expect(parseCommand('  OFF ')).toEqual({ kind: 'all', on: false })
  expect(parseCommand('sound off')).toEqual({ kind: 'switch', name: 'sound', on: false })
  expect(parseCommand('volume off').kind).toBe('error')
  expect(parseCommand('sound loud').kind).toBe('error')
  expect(parseCommand('sound off now').kind).toBe('error')
})

test('a switch command after a master keeps the others where the master put them', () => {
  const off = applyCommand(NONE, { kind: 'all', on: false })
  const bandOn = applyCommand(off, { kind: 'switch', name: 'band', on: true })
  expect(isOn('band', {}, bandOn)).toBe(true)
  expect(isOn('sound', {}, bandOn)).toBe(false)
  expect(applyCommand(bandOn, { kind: 'all', on: true })).toEqual({ master: true, switches: {} })
})

test('lawText numbers the laws in Roman and wraps around', () => {
  expect(lawText(0)).toBe('Law I: Life is directed motion.')
  expect(lawText(14)).toBe('Law XV: Flesh is fallible, but ritual honours the machine spirit.')
  expect(lawText(16)).toBe(lawText(0))
})

test('/litany sound off mutes only sound, for this session', async $ => {
  const r = await $.command.run({ command: 'litany', args: 'sound off', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  expect(r.text).toMatch(/^sound\s+off\s+\(this session\)$/m)
  expect(r.text).toMatch(/^band\s+on$/m)
  expect(r.text).toMatch(/Law [IVX]+: /)
})

test('/litany with a typo answers with usage and changes nothing', async $ => {
  const r = await $.command.run({ command: 'litany', args: 'sound loud', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  expect(r.text).toMatch(/^Usage: /)
  const s = await $.command.run({ command: 'litany', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  expect(s.text).toMatch(/^sound\s+on$/m)
})

test('pulse and spirits are switches like the others', () => {
  expect(parseCommand('pulse off')).toEqual({ kind: 'switch', name: 'pulse', on: false })
  expect(parseCommand('spirits on')).toEqual({ kind: 'switch', name: 'spirits', on: true })
  expect(isOn('pulse', { pulse: false }, NONE)).toBe(false)
  expect(isOn('spirits', {}, NONE)).toBe(true)
  expect(isOn('spirits', {}, { master: false, switches: {} })).toBe(false)
})

test('/litany lists pulse and spirits with the other switches', async $ => {
  const r = await $.command.run({ command: 'litany', args: 'spirits off', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  expect(r.text).toMatch(/^pulse\s+on$/m)
  expect(r.text).toMatch(/^spirits\s+off\s+\(this session\)$/m)
})

test('with the eight layers off the mod is silent: pulse and spirits are panel sections, not layers', () => {
  const allOff = { spinner: false, turnline: false, hint: false, band: false, voice: false, rites: false, sound: false, panel: false }
  expect(anyOn(allOff, NONE, null)).toBe(false)
  expect(anyOn({ ...allOff, panel: true }, NONE, null)).toBe(true)
})

test('roster, sublog and split are switches like the others', () => {
  expect(parseCommand('roster off')).toEqual({ kind: 'switch', name: 'roster', on: false })
  expect(parseCommand('sublog off')).toEqual({ kind: 'switch', name: 'sublog', on: false })
  expect(parseCommand('split on')).toEqual({ kind: 'switch', name: 'split', on: true })
  expect(isOn('roster', {}, NONE)).toBe(true)
  expect(isOn('split', { split: false }, NONE)).toBe(false)
})

test('/litany lists roster, sublog and split', async $ => {
  const r = await $.command.run({ command: 'litany', args: 'sublog off', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  expect(r.text).toMatch(/^roster\s+on$/m)
  expect(r.text).toMatch(/^sublog\s+off\s+\(this session\)$/m)
  expect(r.text).toMatch(/^split\s+on$/m)
})

const run = ($: any, args: string) => $.command.run({ command: 'litany', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })

test('/litany prints vox and the volumes', async $ => {
  const r = await run($, '')
  expect(r.text).toMatch(/^vox {7}default \(mars\)$/m)
  expect(r.text).toMatch(/^volume {4}master 10 {2}beeps 10 {2}vox 10$/m)
  const v = await run($, 'vox forge')
  expect(v.text).toMatch(/^vox {7}forge {2}\(this session\)$/m)
  const l = await run($, 'volume beeps 3')
  expect(l.text).toMatch(/^volume {4}master 10 {2}beeps 3 {2}vox 10 {2}\(this session\)$/m)
  const o = await run($, 'vox off')
  expect(o.text).toMatch(/^vox {7}off {2}\(this session\)$/m)
})

test('the footer stays while vox speaks with every layer off', () => {
  const allOff = { spinner: false, turnline: false, hint: false, band: false, voice: false, rites: false, sound: false, panel: false }
  expect(anyOn(allOff, NONE, 'mars')).toBe(true)
  expect(anyOn(allOff, NONE, null)).toBe(false)
})

test('/litany volume prints the three and what they come to', async $ => {
  expect((await run($, 'volume')).text).toBe('+++ Litany volume +++\nmaster    10\nbeeps     10    clips at 100 %\nvox       10    lines at 100 %')
  await run($, 'volume master 5')
  await run($, 'volume vox 5')
  expect((await run($, 'volume')).text).toBe(
    '+++ Litany volume +++\nmaster    5  (this session)\nbeeps     10    clips at 50 %\nvox       5     lines at 25 %  (this session)',
  )
})

test('vox reads silent while the master is off', async $ => {
  await run($, 'off')
  expect((await run($, '')).text).toMatch(/^vox {7}default \(silent\)$/m)
})

test('vox reads silent whenever nothing would speak: master volume 0 or vox volume 0', async $ => {
  await run($, 'volume vox 0')
  expect((await run($, '')).text).toMatch(/^vox {7}default \(silent\)$/m)
  await run($, 'vox forge')
  expect((await run($, '')).text).toMatch(/^vox {7}forge \(silent\) {2}\(this session\)$/m)
  await run($, 'volume vox 10')
  expect((await run($, '')).text).toMatch(/^vox {7}forge {2}\(this session\)$/m)
  await run($, 'volume master 0')
  expect((await run($, '')).text).toMatch(/^vox {7}forge \(silent\) {2}\(this session\)$/m)
  await run($, 'volume master 10')
  await run($, 'off')
  expect((await run($, '')).text).toMatch(/^vox {7}forge \(silent\) {2}\(this session\)$/m)
})
