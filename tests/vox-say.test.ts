import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { parseCommand, SAY_MAX, sayText } from '../hooks/lore'

const run = (args: string) => ({ command: 'litany', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }) as const

// macOS beneath: each play recorded, a line taking `lineMs` on the clock.
function macos(on: On, clock: ReturnType<typeof mock.clock>, lineMs = 0) {
  const plays: { asset?: string; base64?: string; gain?: number }[] = []
  on('audio.play', async (_$, e) => {
    plays.push({ asset: e.clip.asset, base64: e.clip.base64, gain: e.gain })
    if (lineMs > 0) await clock.sleep(lineMs)
    return { value: undefined }
  })
  return plays
}

test('sayText strips quotes, collapses spaces, drops non-ASCII, rejects empty', () => {
  expect(sayText('  "The   Emperor\tprotects."  ')).toEqual({ text: 'The Emperor protects.', isCut: false })
  expect(sayText("'hi there'")).toEqual({ text: 'hi there', isCut: false })
  expect(sayText('café ☃ ok')).toEqual({ text: 'caf ok', isCut: false })
  expect(sayText('   ')).toBeNull()
  expect(sayText('☃☃')).toBeNull()
})

test('sayText cuts at the last word before 200 and flags it', () => {
  const words = Array.from({ length: 60 }, () => 'abcd').join(' ')
  const cut = sayText(words)!
  expect(cut.isCut).toBe(true)
  expect(cut.text.length).toBeLessThanOrEqual(SAY_MAX)
  expect(cut.text.endsWith('abcd')).toBe(true)
  expect(sayText('x'.repeat(300))).toEqual({ text: 'x'.repeat(SAY_MAX), isCut: true })
})

test("parseCommand keeps the text's case and finds an optional voice", () => {
  expect(parseCommand('say forge The Emperor Protects.')).toEqual({ kind: 'say', voice: 'forge', text: 'The Emperor Protects.', isCut: false })
  expect(parseCommand('SAY The forge awaits')).toEqual({ kind: 'say', voice: null, text: 'The forge awaits', isCut: false })
  expect(parseCommand('say').kind).toBe('error')
  expect(parseCommand('say forge').kind).toBe('error')
})

test('say speaks once with no clip', async ($, on) => {
  const clock = mock.clock(on)
  const plays = macos(on, clock)

  const r = await $.command.run(run('say forge The Emperor protects.'))
  await clock.settle()

  expect(r.text).toBe('+++ forge speaks +++\nThe Emperor protects.')
  expect(plays).toHaveLength(1)
  expect(plays[0]!.base64).toBeDefined()
  expect(plays[0]!.asset).toBeUndefined()
})

test("say speaks even with vox off, in the theme's voice", { options: { vox: 'off', theme: 'cogitator' } }, async ($, on) => {
  const clock = mock.clock(on)
  const plays = macos(on, clock)

  const r = await $.command.run(run('say hello'))
  await clock.settle()

  expect(r.text).toBe('+++ cogitator speaks +++\nhello')
  expect(plays).toHaveLength(1)
})

test('say with no voice uses the resolved vox voice', { options: { vox: 'claude' } }, async ($, on) => {
  const clock = mock.clock(on)
  macos(on, clock)

  const r = await $.command.run(run('say hello'))
  await clock.settle()

  expect(r.text!.split('\n')[0]).toBe('+++ claude speaks +++')
})

test('say under /litany off renders nothing and says why', async ($, on) => {
  const clock = mock.clock(on)
  const plays = macos(on, clock)

  await $.command.run(run('off'))
  const r = await $.command.run(run('say hello'))
  await clock.settle()

  expect(r.text).toBe('+++ The Mechanicus is silenced (/litany on to wake it) +++')
  expect(plays).toEqual([])
})

test('say at vox volume 0 renders nothing and says why', async ($, on) => {
  const clock = mock.clock(on)
  const plays = macos(on, clock)

  await $.command.run(run('volume vox 0'))
  const r = await $.command.run(run('say hello'))
  await $.command.run(run('volume vox 10'))
  await $.command.run(run('volume master 0'))
  const m = await $.command.run(run('say hello'))
  await clock.settle()

  expect(r.text).toBe('+++ Silent: vox volume is 0 +++')
  expect(m.text).toBe('+++ Silent: master volume is 0 +++')
  expect(plays).toEqual([])
})

test('say while a line speaks says the vox is busy', async ($, on) => {
  const clock = mock.clock(on)
  const plays = macos(on, clock, 3_000)

  await $.command.run(run('say hello'))
  await clock.advance(1_000)
  const busy = await $.command.run(run('say again'))
  await clock.advance(10_000)
  const after = await $.command.run(run('say once more'))
  await clock.settle()

  expect(busy.text).toBe('+++ The vox is busy; try again in a moment +++')
  expect(after.text!.startsWith('+++ ')).toBe(true)
  expect(after.text!).not.toContain('busy')
  expect(plays).toHaveLength(2)
})

test('a long text is cut and the reply says so', async ($, on) => {
  const clock = mock.clock(on)
  macos(on, clock)

  const r = await $.command.run(run(`say ${'word '.repeat(80)}`))
  await clock.settle()

  const lines = r.text!.split('\n')
  expect(lines).toHaveLength(3)
  expect(lines[1]!.length).toBeLessThanOrEqual(SAY_MAX)
  expect(lines[2]).toBe('(cut to 200 characters)')
})

test('sayText collapses a run of punctuation to its first mark', () => {
  expect(sayText('Wait...!!! Who goes there?!?')).toEqual({ text: 'Wait. Who goes there?', isCut: false })
  expect(sayText('Halt,, ;now:: go!!')).toEqual({ text: 'Halt, ;now: go!', isCut: false })
})

test('say with no word to speak renders nothing, says so and keeps the vox free', async ($, on) => {
  const clock = mock.clock(on)
  const plays = macos(on, clock)

  const r = await $.command.run(run('say ...?!'))
  const q = await $.command.run(run("say forge ' -- '"))
  const after = await $.command.run(run('say hello'))
  await clock.settle()

  expect(r.text).toBe('+++ Nothing to say +++')
  expect(q.text).toBe('+++ Nothing to say +++')
  expect(after.text).toBe('+++ mars speaks +++\nhello')
  expect(plays).toHaveLength(1)
})

test('say speaks digits', async ($, on) => {
  const clock = mock.clock(on)
  const plays = macos(on, clock)

  const r = await $.command.run(run('say 40'))
  await clock.settle()

  expect(r.text).toBe('+++ mars speaks +++\n40')
  expect(plays).toHaveLength(1)
})
