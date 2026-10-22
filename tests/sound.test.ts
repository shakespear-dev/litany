import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { toWav } from '../hooks/vox/dsp'

test('a long rite ends with a chord; a short, aborted or muted one does not', async ($, on) => {
  const clock = mock.clock(on)
  const clips: string[] = []
  on('audio.play', (_$, e) => (e.clip.asset && clips.push(e.clip.asset), { value: undefined }))
  on('turn.complete', () => ({ text: '' }))
  const done = (durationMs: number, isAborted = false) =>
    $.turn.complete({ answer: '', durationMs, isAborted, turnId: 't', reason: isAborted ? 'aborted' : 'answer' })

  await done(31_000)
  await done(5_000)
  await done(40_000, true)
  await $.command.run({ command: 'litany', args: 'sound off', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  await done(60_000)
  await clock.settle()

  expect(clips).toEqual(['sounds/rite-done.wav'])
})

const ran = (exitCode: number, stdout = '') => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
const longTurn = { answer: '', durationMs: 31_000, isAborted: false, turnId: 't', reason: 'answer' } as const
// The player tests count clips alone: a spoken line would add its own writes and plays.
const VOX_OFF = { options: { vox: 'off' } }

test('on Linux the clip goes to the first player that plays it, and that player keeps the job', VOX_OFF, async ($, on) => {
  const clock = mock.clock(on)
  const runs: string[] = []
  const clips: string[] = []
  on('audio.play', (_$, e) => (e.clip.asset && clips.push(e.clip.asset), { value: undefined }))
  on('process.run', (_$, e) => {
    runs.push(e.argv[0]!)
    if (e.argv[0] === 'uname') return ran(0, 'Linux\n')
    if (e.argv[0] === 'pw-play') throw new Error('spawn pw-play ENOENT')
    return ran(e.argv[0] === 'paplay' ? 0 : 1)
  })
  on('turn.complete', () => ({ text: '' }))

  await $.turn.complete(longTurn)
  await clock.settle()
  await $.turn.complete(longTurn)
  await clock.settle()

  expect(runs).toEqual(['uname', 'pw-play', 'paplay', 'paplay'])
  expect(clips).toEqual([])
})

test('on Linux with no player that plays, the first clip tries each once and the rest stay silent', VOX_OFF, async ($, on) => {
  const clock = mock.clock(on)
  const runs: string[] = []
  on('audio.play', () => ({ value: undefined }))
  on('process.run', (_$, e) => (runs.push(e.argv[0]!), ran(e.argv[0] === 'uname' ? 0 : 1, 'Linux\n')))
  on('turn.complete', () => ({ text: '' }))

  await $.turn.complete(longTurn)
  await clock.settle()
  await $.turn.complete(longTurn)
  await clock.settle()

  expect(runs).toEqual(['uname', 'pw-play', 'paplay', 'aplay', 'ffplay'])
})

test('on macOS the engine plays the clip itself', VOX_OFF, async ($, on) => {
  const clock = mock.clock(on)
  const runs: string[] = []
  const clips: string[] = []
  on('audio.play', (_$, e) => (e.clip.asset && clips.push(e.clip.asset), { value: undefined }))
  on('process.run', (_$, e) => (runs.push(e.argv[0]!), ran(0, 'Darwin\n')))
  on('turn.complete', () => ({ text: '' }))

  await $.turn.complete(longTurn)
  await clock.settle()

  expect(runs).toEqual(['uname'])
  expect(clips).toEqual(['sounds/rite-done.wav'])
})

// Every clip the engine was asked to play, the lines left out.
function clipsOf(on: On) {
  const clips: string[] = []
  on('audio.play', (_$, e) => (e.clip.asset && clips.push(e.clip.asset), { value: undefined }))
  on('turn.complete', () => ({ text: '' }))
  return clips
}
const ended = (reason: 'answer' | 'error' | 'aborted', durationMs: number, agentId?: string) =>
  ({ answer: '', durationMs, isAborted: reason === 'aborted', turnId: 't', reason, ...(agentId ? { agentId } : {}) })

test('a long turn that ends in an error plays severed, not rite-done', async ($, on) => {
  const clock = mock.clock(on)
  const clips = clipsOf(on)
  await $.turn.complete(ended('error', 40_000))
  await clock.advance(10_000)
  expect(clips).toEqual(['sounds/severed.wav'])
})

test('a refusal of 40 s plays nothing', async ($, on) => {
  const clock = mock.clock(on)
  const clips = clipsOf(on)
  await $.turn.complete({ answer: '', durationMs: 40_000, isAborted: false, turnId: 't', reason: 'refusal', refusal: { category: null, explanation: null } })
  await clock.advance(10_000)
  expect(clips).toEqual([])
})

test('an error turn of 2 s still plays severed', async ($, on) => {
  const clock = mock.clock(on)
  const clips = clipsOf(on)
  await $.turn.complete(ended('error', 2_000))
  await clock.advance(10_000)
  expect(clips).toEqual(['sounds/severed.wav'])
})

test("a subagent's error turn plays nothing", async ($, on) => {
  const clock = mock.clock(on)
  const clips = clipsOf(on)
  await $.turn.complete(ended('error', 40_000, 'a1'))
  await $.turn.complete(ended('answer', 40_000, 'a1'))
  await clock.advance(10_000)
  expect(clips).toEqual([])
})

test("auto-compaction of the main loop plays engrams; manual or a subagent's plays nothing", async ($, on) => {
  const clock = mock.clock(on)
  const clips = clipsOf(on)
  const messages = [{ role: 'user' as const, text: 'summary', toolUses: [] }]
  on('session.compact', () => ({ messages }))
  await $.session.compact({ trigger: 'manual', messages })
  await $.session.compact({ trigger: 'auto', agentId: 'a1', messages })
  await clock.advance(10_000)
  expect(clips).toEqual([])
  await $.session.compact({ trigger: 'auto', messages })
  await clock.advance(10_000)
  expect(clips).toEqual(['sounds/engrams.wav'])
})

test('on Windows the clip goes to the system PowerShell on stdin, never uname or the engine', VOX_OFF, async ($, on) => {
  const clock = mock.clock(on)
  const runs: { argv: readonly string[]; stdin?: string }[] = []
  const clips: string[] = []
  on('audio.play', (_$, e) => (e.clip.asset && clips.push(e.clip.asset), { value: undefined }))
  on('env.get', (_$, e) => ({ value: e.name === 'OS' ? 'Windows_NT' : e.name === 'SystemRoot' ? 'D:\\WINDOWS' : undefined }))
  on('fs.read', () => ({ value: { base64: toWav(new Float32Array(2205).fill(0.5)).toBase64() } }))
  on('process.run', (_$, e) => (runs.push({ argv: e.argv, stdin: e.init?.stdin }), ran(0)))
  on('turn.complete', () => ({ text: '' }))

  await $.turn.complete(longTurn)
  await clock.settle()

  expect(clips).toEqual([])
  // By full path: a powershell.exe planted in the project never runs.
  expect(runs.map(r => r.argv[0])).toEqual(['D:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'])
  expect(runs[0]!.argv.at(-1)).toContain('SoundPlayer')
  // The clip's own bytes: a RIFF header.
  expect(new TextDecoder().decode(Uint8Array.fromBase64(runs[0]!.stdin!).subarray(0, 4))).toBe('RIFF')
})
