import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { PAUSE_MS } from '../hooks/lore'
import { toWav } from '../hooks/vox/dsp'
import { SR } from '../hooks/vox/synth'

type Clock = ReturnType<typeof mock.clock>
type Play = { asset?: string; isLine: boolean; gain?: number; base64?: string; at: number; endedAt?: number }

const longTurn = { answer: '', durationMs: 31_000, isAborted: false, turnId: 't', reason: 'answer' } as const
const errorTurn = { answer: '', durationMs: 2_000, isAborted: false, turnId: 't', reason: 'error' } as const
const run = (args: string) => ({ command: 'litany', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }) as const
const ran = (exitCode = 0, stdout = '') => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

// The engine beneath on macOS: each play recorded, a clip or a line taking `clipMs` / `lineMs` on the clock.
function macos(on: On, clock: Clock, opts: { clipMs?: number; lineMs?: number } = {}) {
  const plays: Play[] = []
  on('audio.play', async (_$, e) => {
    const p: Play = { asset: e.clip.asset, isLine: e.clip.base64 !== undefined, gain: e.gain, base64: e.clip.base64, at: clock.now() }
    plays.push(p)
    const ms = (p.isLine ? opts.lineMs : opts.clipMs) ?? 0
    if (ms > 0) await clock.sleep(ms)
    p.endedAt = clock.now()
    return { value: undefined }
  })
  on('turn.complete', () => ({ text: '' }))
  return plays
}

type Run = { argv: readonly string[]; stdin?: string }
// Linux beneath: uname says so, uid 1000, mktemp makes `<base>/litany-vox.abcd1234` (or prints `made`), `answer` decides each child's fate.
function linux(on: On, answer: (argv: readonly string[]) => 'ok' | 'fail' | 'hang' = () => 'ok', found = '', made?: string) {
  const runs: Run[] = []
  on('process.run', (_$, e) => {
    if (e.argv[0] === 'uname') return ran(0, 'Linux\n')
    runs.push({ argv: e.argv, stdin: e.init?.stdin })
    const fate = answer(e.argv)
    if (fate === 'hang') return new Promise<never>(() => {})
    if (fate === 'fail') return ran(1)
    const out = e.argv[0] === 'mktemp' ? `${made ?? e.argv[2]!.replace('XXXXXXXX', 'abcd1234')}\n` : e.argv[0] === 'id' ? '1000\n' : e.argv[0] === 'find' ? found : ''
    return ran(0, out)
  })
  on('audio.play', () => ({ value: undefined }))
  on('turn.complete', () => ({ text: '' }))
  return runs
}

const db = (v: number) => 20 * Math.log10(v + 1e-9)
const samplesOf = (base64: string) => {
  const bytes = Uint8Array.fromBase64(base64), v = new DataView(bytes.buffer)
  const x = new Float32Array((bytes.length - 44) >> 1)
  for (let i = 0; i < x.length; i++) x[i] = v.getInt16(44 + i * 2, true) / 32767
  return x
}
// The loudness the levelling aims at: RMS of the 20 ms windows over 5 % of the loudest.
function voicedDb(x: Float32Array): number {
  const win = Math.round(SR * 0.02), rms: number[] = []
  for (let i = 0; i + win <= x.length; i += win) {
    let e = 0
    for (let j = i; j < i + win; j++) e += x[j]! * x[j]!
    rms.push(Math.sqrt(e / win))
  }
  const top = Math.max(...rms), voiced = rms.filter(r => r > top * 0.05)
  return db(Math.sqrt(voiced.reduce((p, r) => p + r * r, 0) / voiced.length))
}

test('both on: the clip, 350 ms, then the line', async ($, on) => {
  const clock = mock.clock(on)
  const plays = macos(on, clock, { clipMs: 800 })

  await $.turn.complete(longTurn)
  await clock.advance(10_000)

  expect(plays.map(p => p.asset ?? 'line')).toEqual(['sounds/rite-done.wav', 'line'])
  expect(plays[1]!.at).toBeGreaterThanOrEqual(plays[0]!.endedAt! + PAUSE_MS)
})

test('sound off: the line alone', { options: { sound: false } }, async ($, on) => {
  const clock = mock.clock(on)
  const plays = macos(on, clock)

  await $.turn.complete(longTurn)
  await clock.settle()

  expect(plays.map(p => ({ isLine: p.isLine, at: p.at }))).toEqual([{ isLine: true, at: 0 }])
})

test('vox off: the clip alone and no render', { options: { vox: 'off' } }, async ($, on) => {
  const clock = mock.clock(on)
  const plays = macos(on, clock)

  await $.turn.complete(longTurn)
  await clock.advance(10_000)

  expect(plays.map(p => p.asset ?? 'line')).toEqual(['sounds/rite-done.wav'])
})

test('a second event keeps its clip and drops its line', async ($, on) => {
  const clock = mock.clock(on)
  const plays = macos(on, clock, { lineMs: 3_000 })

  await $.turn.complete(longTurn)
  await clock.advance(1_000)
  // The first line speaks until 3,350 ms: the severed clip plays, its line does not.
  await $.turn.complete(errorTurn)
  await clock.advance(10_000)
  // Once the line has played the vox is free again.
  await $.turn.complete(errorTurn)
  await clock.advance(10_000)

  expect(plays.map(p => p.asset ?? 'line')).toEqual(['sounds/rite-done.wav', 'line', 'sounds/severed.wav', 'sounds/severed.wav', 'line'])
})

test('two events in one burst speak one line between them', async ($, on) => {
  const clock = mock.clock(on)
  const plays = macos(on, clock)

  await Promise.all([$.turn.complete(longTurn), $.turn.complete(errorTurn)])
  await clock.advance(10_000)

  expect(plays.filter(p => p.isLine)).toHaveLength(1)
  expect(plays.map(p => p.asset).filter(Boolean).sort()).toEqual(['sounds/rite-done.wav', 'sounds/severed.wav'])
})

test('a hung line player frees the vox after its length + 2 s', { options: { sound: false } }, async ($, on) => {
  const clock = mock.clock(on)
  const runs = linux(on, argv => (argv[0] === 'pw-play' ? 'hang' : 'ok'))
  const writes = () => runs.filter(r => r.argv[0] === 'sh')

  await $.turn.complete(longTurn)
  await clock.settle()
  expect(writes()).toHaveLength(1)
  const lengthMs = Math.round((samplesOf(writes()[0]!.stdin!).length * 1000) / SR)

  await clock.advance(lengthMs + 1_500)
  await $.turn.complete(longTurn)
  await clock.settle()
  expect(writes()).toHaveLength(1)

  await clock.advance(600)
  await $.turn.complete(longTurn)
  await clock.settle()
  expect(writes()).toHaveLength(2)
})

test('volumes reach the engine', { options: { volumeMaster: '5' } }, async ($, on) => {
  const clock = mock.clock(on)
  const plays = macos(on, clock)

  await $.turn.complete(longTurn)
  await clock.advance(10_000)
  expect(plays[0]).toMatchObject({ asset: 'sounds/rite-done.wav', gain: 0.25 })

  await $.command.run(run('volume master 10'))
  await $.command.run(run('volume vox 5'))
  await $.turn.complete(longTurn)
  await clock.advance(10_000)

  const [clip, line] = plays.slice(2)
  expect(clip).toMatchObject({ asset: 'sounds/rite-done.wav', gain: 1 })
  expect(line?.isLine).toBe(true)
  // Every line is levelled to −18 dB first, so the vox's 0.25 lands at −30 dB whatever the take.
  const loud = voicedDb(samplesOf(line!.base64!))
  expect(Math.abs(loud - (-18 + 20 * Math.log10(0.25)))).toBeLessThan(1.5)
})

test('volume 0 renders and plays nothing', { options: { volumeMaster: '0' } }, async ($, on) => {
  const clock = mock.clock(on)
  const plays = macos(on, clock)

  await $.turn.complete(longTurn)
  await $.turn.complete(errorTurn)
  await clock.advance(10_000)

  expect(plays).toEqual([])
})

test('a Linux clip below full volume is scaled once and played from a temp file', { options: { vox: 'off', volumeBeeps: '5' } }, async ($, on) => {
  const clock = mock.clock(on)
  const runs = linux(on)
  const reads: string[] = []
  on('fs.read', (_$, e) => {
    reads.push(e.path)
    const isOurs = e.path.endsWith('sounds/rite-done.wav')
    return { value: { base64: isOurs ? toWav(new Float32Array(2205).fill(0.5)).toBase64() : 'bm90IGEgd2F2ZSBmaWxl' } }
  })

  await $.turn.complete(longTurn)
  await clock.advance(10_000)
  await $.turn.complete(longTurn)
  await clock.advance(10_000)
  // A clip whose header scaleWav rejects plays nothing (never louder than asked), and is read again next time.
  await $.turn.complete(errorTurn)
  await clock.advance(10_000)
  await $.turn.complete(errorTurn)
  await clock.advance(10_000)

  expect(reads.map(p => p.split('/').pop())).toEqual(['rite-done.wav', 'severed.wav', 'severed.wav'])
  const writes = runs.filter(r => r.argv[0] === 'sh')
  const [one, two] = ['/tmp/litany-vox.abcd1234/line-1.wav', '/tmp/litany-vox.abcd1234/line-2.wav']
  expect(writes.map(r => r.argv)).toEqual([0, 1].map(i => ['sh', '-c', 'set -C; base64 -d > "$1"', 'sh', [one, two][i]]))
  // beeps 5 at master 10 is 0.25 in amplitude: 16,383 becomes 4,096.
  expect(new DataView(Uint8Array.fromBase64(writes[0]!.stdin!).buffer).getInt16(44, true)).toBe(4096)
  const plays = runs.filter(r => r.argv[0] === 'pw-play').map(r => r.argv[1]!)
  expect(plays).toEqual([one, two])
  expect(runs.filter(r => r.argv[0] === 'rm').map(r => r.argv)).toEqual([['rm', '-f', one], ['rm', '-f', two]])
  // One private folder for the session's files.
  expect(runs.filter(r => r.argv[0] === 'mktemp').map(r => r.argv)).toEqual([['mktemp', '-d', '/tmp/litany-vox.XXXXXXXX']])
})

test('a Linux clip below full volume whose temp write fails plays nothing', { options: { vox: 'off', volumeBeeps: '5' } }, async ($, on) => {
  const clock = mock.clock(on)
  const runs = linux(on, argv => (argv[0] === 'sh' ? 'fail' : 'ok'))
  on('fs.read', () => ({ value: { base64: toWav(new Float32Array(2205).fill(0.5)).toBase64() } }))
  on('fs.exists', () => ({ value: true }))

  await $.turn.complete(longTurn)
  await clock.advance(10_000)

  expect(runs.filter(r => r.argv[0] === 'sh')).toHaveLength(1)
  expect(runs.filter(r => r.argv[0] === 'pw-play')).toEqual([])
})

const PLAYER_NAMES = ['pw-play', 'paplay', 'aplay', 'ffplay']
type TimedRun = { argv: readonly string[]; timeoutMs?: number }
// Linux beneath where a player plays for the file's length on the clock (a line's from the bytes written, a clip's from `clipMs`), and one that outlasts its timeoutMs is killed there and the call rejects.
function linuxTimed(on: On, clock: Clock, clipMs: (path: string) => number = () => 1_000) {
  const runs: TimedRun[] = []
  const lengths = new Map<string, number>()
  on('process.run', async (_$, e) => {
    if (e.argv[0] === 'uname') return ran(0, 'Linux\n')
    runs.push({ argv: e.argv, timeoutMs: e.init?.timeoutMs })
    if (e.argv[0] === 'mktemp') return ran(0, `${e.argv[2]!.replace('XXXXXXXX', 'abcd1234')}\n`)
    if (e.argv[0] === 'sh') lengths.set(e.argv[4]!, Math.round((samplesOf(e.init!.stdin!).length * 1000) / SR))
    if (PLAYER_NAMES.includes(e.argv[0]!)) {
      const path = e.argv.at(-1)!
      const ms = lengths.get(path) ?? clipMs(path)
      const limit = e.init?.timeoutMs ?? 30_000
      await clock.sleep(Math.min(ms, limit))
      if (ms > limit) return { deny: `killed after ${limit} ms` }
    }
    return ran()
  })
  on('fs.exists', () => ({ value: true }))
  on('turn.complete', () => ({ text: '' }))
  return { runs, lengths }
}

test('a Linux line longer than 10 s plays once, to its end, and later clips still play', { options: { vox: 'off' } }, async ($, on) => {
  const clock = mock.clock(on)
  const { runs, lengths } = linuxTimed(on, clock)
  const text = 'The Omnissiah protects the faithful servant of the forge, and the machine spirit is appeased. '.repeat(3)

  await $.command.run(run(`say ${text}`))
  await clock.advance(60_000)
  await $.turn.complete(errorTurn)
  await clock.advance(10_000)

  const [lengthMs] = [...lengths.values()]
  expect(lengthMs).toBeGreaterThan(10_000)
  const played = runs.filter(r => PLAYER_NAMES.includes(r.argv[0]!))
  expect(played.map(r => [r.argv[0], r.argv.at(-1)!.split('/').pop()])).toEqual([['pw-play', 'line-1.wav'], ['pw-play', 'severed.wav']])
  // The line's player may run its length and 3 s more; a clip's keeps 10 s.
  expect(played[0]!.timeoutMs).toBeGreaterThanOrEqual(lengthMs! + 2_900)
  expect(played[1]!.timeoutMs).toBe(10_000)
})

test('a Linux player killed by its timeout ends that file and is not blamed', { options: { vox: 'off' } }, async ($, on) => {
  const clock = mock.clock(on)
  const { runs } = linuxTimed(on, clock, path => (path.endsWith('/rite-done.wav') ? 60_000 : 1_000))

  await $.turn.complete(longTurn)
  await clock.advance(60_000)
  await $.turn.complete(errorTurn)
  await clock.advance(10_000)

  const played = runs.filter(r => PLAYER_NAMES.includes(r.argv[0]!))
  expect(played.map(r => [r.argv[0], r.argv.at(-1)!.split('/').pop()])).toEqual([['pw-play', 'rite-done.wav'], ['pw-play', 'severed.wav']])
})

test('a hung clip player frees the line after 10 s', async ($, on) => {
  const clock = mock.clock(on)
  const plays = macos(on, clock, { clipMs: 60_000 })

  await $.turn.complete(longTurn)
  await clock.advance(11_000)

  expect(plays.map(p => p.asset ?? 'line')).toEqual(['sounds/rite-done.wav', 'line'])
  expect(plays[1]!.at).toBe(10_000 + PAUSE_MS)
})

test('Linux writes the line with sh and base64 -d into a private folder, plays it, removes it', { options: { sound: false } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, { XDG_RUNTIME_DIR: '/run/user/1000', TMPDIR: '/var/tmp/s' })
  const runs = linux(on)

  await $.turn.complete(longTurn)
  await clock.advance(10_000)

  const path = '/run/user/1000/litany-vox.abcd1234/line-1.wav'
  expect(runs.map(r => r.argv)).toEqual([
    ['mktemp', '-d', '/run/user/1000/litany-vox.XXXXXXXX'],
    ['sh', '-c', 'set -C; base64 -d > "$1"', 'sh', path],
    ['pw-play', path],
    ['rm', '-f', path],
  ])
  expect(String.fromCharCode(...Uint8Array.fromBase64(runs[1]!.stdin!).subarray(0, 4))).toBe('RIFF')
})

test('the write goes through set -C into the private folder, never a path directly in TMPDIR', { options: { sound: false } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, { TMPDIR: '/var/tmp/s/' })
  const runs = linux(on)

  await $.turn.complete(longTurn)
  await clock.advance(10_000)
  await $.turn.complete(errorTurn)
  await clock.advance(10_000)

  expect(runs.filter(r => r.argv[0] === 'mktemp').map(r => r.argv)).toEqual([['mktemp', '-d', '/var/tmp/s/litany-vox.XXXXXXXX']])
  const writes = runs.filter(r => r.argv[0] === 'sh')
  expect(writes).toHaveLength(2)
  for (const w of writes) {
    expect(w.argv.slice(0, 4)).toEqual(['sh', '-c', 'set -C; base64 -d > "$1"', 'sh'])
    expect(w.argv[4]!.slice(0, w.argv[4]!.lastIndexOf('/'))).toBe('/var/tmp/s/litany-vox.abcd1234')
  }
})

test('Linux with nothing to write or play stays silent', { options: { sound: false } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, {})
  const runs = linux(on, argv => (argv[0] === 'mktemp' ? 'ok' : 'fail'))

  // The line alone: its write fails, so no player is asked to play it.
  const first = await $.turn.complete(longTurn)
  await clock.advance(10_000)
  expect(runs.map(r => r.argv[0] === 'sh' ? r.argv[4] : r.argv.join(' '))).toEqual([
    'mktemp -d /tmp/litany-vox.XXXXXXXX',
    '/tmp/litany-vox.abcd1234/line-1.wav',
  ])

  // The clip tries every player once; with none that plays, the line is not even written.
  await $.command.run(run('sound on'))
  const second = await $.turn.complete(errorTurn)
  await clock.advance(10_000)
  await $.turn.complete(errorTurn)
  await clock.advance(10_000)

  expect(first).toEqual({ text: '' })
  expect(second).toEqual({ text: '' })
  expect(runs.slice(2).map(r => r.argv[0])).toEqual(['pw-play', 'paplay', 'aplay', 'ffplay'])
})

test('with no folder to be had, mktemp is tried again on the next line and nothing is written', { options: { sound: false } }, async ($, on) => {
  const clock = mock.clock(on)
  const runs = linux(on, argv => (argv[0] === 'mktemp' ? 'fail' : 'ok'))

  await $.turn.complete(longTurn)
  await clock.advance(10_000)
  await $.turn.complete(longTurn)
  await clock.advance(10_000)

  expect(runs.map(r => r.argv[0])).toEqual(['mktemp', 'mktemp'])
})

test('a relative TMPDIR or XDG_RUNTIME_DIR is ignored for /tmp', { options: { sound: false } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, { XDG_RUNTIME_DIR: 'run/user/1000', TMPDIR: 'tmp/s' })
  const runs = linux(on)

  await $.turn.complete(longTurn)
  await clock.advance(10_000)

  expect(runs.filter(r => r.argv[0] === 'mktemp').map(r => r.argv)).toEqual([['mktemp', '-d', '/tmp/litany-vox.XXXXXXXX']])
  expect(runs.filter(r => r.argv[0] === 'sh').map(r => r.argv[4])).toEqual(['/tmp/litany-vox.abcd1234/line-1.wav'])
})

test('a folder that cannot be checked after a failed write is made again on the next line', { options: { sound: false } }, async ($, on) => {
  const clock = mock.clock(on)
  const runs = linux(on, argv => (argv[0] === 'sh' ? 'fail' : 'ok'))
  on('fs.exists', () => ({ deny: 'no answer' }))

  await $.turn.complete(longTurn)
  await clock.advance(10_000)
  await $.turn.complete(longTurn)
  await clock.advance(10_000)

  expect(runs.map(r => r.argv[0])).toEqual(['mktemp', 'sh', 'mktemp', 'sh'])
})

function sessionBottoms(on: On) {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.repo', () => ({ value: null }))
}
const findArgv = (base: string) => ['find', '-H', base, '-mindepth', '1', '-maxdepth', '1', '-type', 'd', '-name', 'litany-vox.*', '-uid', '1000', '-mmin', '+1440']

test("session.start sweeps our day-old folders and session.end removes this session's own", { options: { sound: false } }, async ($, on) => {
  const clock = mock.clock(on)
  sessionBottoms(on)
  mock.env(on, { XDG_RUNTIME_DIR: '/run/user/1000' })
  // find answers what it matched; only exact names directly in the folder searched are removed.
  const found = ['/tmp/litany-vox.old11111', '/tmp/litany-vox.old11111/x', '/tmp/elsewhere/litany-vox.zz', '/etc/passwd', ''].join('\n')
  const runs = linux(on, () => 'ok', found)
  const of = (cmd: string) => runs.filter(r => r.argv[0] === cmd).map(r => r.argv)

  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(of('id')).toEqual([['id', '-u']])
  expect(of('find')).toEqual([findArgv('/run/user/1000'), findArgv('/tmp')])
  expect(of('rm')).toEqual([['rm', '-rf', '--', '/tmp/litany-vox.old11111']])

  await $.turn.complete(longTurn)
  await clock.advance(10_000)
  await $.session.end({ reason: 'other', sessionId: 'S1', resume: { id: 'S1' } })
  expect(of('rm').slice(1)).toEqual([
    ['rm', '-f', '/run/user/1000/litany-vox.abcd1234/line-1.wav'],
    ['rm', '-rf', '--', '/run/user/1000/litany-vox.abcd1234'],
  ])
})

test('a headless session.start sweeps nothing', async ($, on) => {
  const clock = mock.clock(on)
  sessionBottoms(on)
  const runs = linux(on, () => 'ok', '/tmp/litany-vox.old11111')

  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: false })
  await clock.settle()

  expect(runs.map(r => r.argv[0]).filter(c => c !== 'git')).toEqual([])
})

test('session.start does not wait for the sweep', async ($, on) => {
  const clock = mock.clock(on)
  sessionBottoms(on)
  const runs = linux(on, argv => (argv[0] === 'id' ? 'hang' : 'ok'))
  let isStarted = false

  void $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true }).then(() => (isStarted = true))
  await clock.settle()

  expect(runs.map(r => r.argv[0])).toContain('id')
  expect(isStarted).toBe(true)
})

for (const printed of ['/', '/home/x', '/tmp/litany-vox.abcd1234/..', '/tmp/litany-vox.abc']) {
  test(`a mktemp that prints ${printed} is refused: nothing is written there or removed`, { options: { sound: false } }, async ($, on) => {
    const clock = mock.clock(on)
    sessionBottoms(on)
    const runs = linux(on, () => 'ok', '', printed)

    await $.turn.complete(longTurn)
    await clock.advance(10_000)
    await $.session.end({ reason: 'other', sessionId: 'S1', resume: { id: 'S1' } })

    expect(runs.map(r => r.argv[0])).toEqual(['mktemp'])
  })
}

test('session.end with no folder made removes nothing', async ($, on) => {
  sessionBottoms(on)
  const runs = linux(on)
  await $.session.end({ reason: 'other', sessionId: 'S1', resume: { id: 'S1' } })
  expect(runs).toEqual([])
})

test('on macOS session.start and session.end leave the temp folders alone', async ($, on) => {
  sessionBottoms(on)
  const runs: string[] = []
  on('process.run', (_$, e) => (runs.push(e.argv[0]!), ran(e.argv[0] === 'uname' ? 0 : 1, 'Darwin\n')))

  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: false })
  await $.session.end({ reason: 'other', sessionId: 'S1', resume: { id: 'S1' } })

  expect(runs.filter(c => c !== 'uname' && c !== 'git')).toEqual([])
})

const notify = (notification_type: string) => ({ message: 'm', notification_type })

test('sanction sounds once per wait', { options: { vox: 'off' } }, async ($, on) => {
  const clock = mock.clock(on)
  const plays = macos(on, clock)
  on('classic.Notification', () => ({}))
  on('tool.call', { tool: 'Read' }, () => ({ result: 'x' }))

  await $.classic.Notification(notify('permission_prompt'))
  await $.classic.Notification(notify('permission_prompt'))
  await $.classic.Notification(notify('agent_needs_input'))
  await clock.settle()
  expect(plays.map(p => p.asset)).toEqual(['sounds/sanction.wav'])

  await $.tool.call({ tool: 'Read', file_path: '/x' })
  await $.classic.Notification(notify('permission_prompt'))
  await clock.settle()
  expect(plays.map(p => p.asset)).toEqual(['sounds/sanction.wav', 'sounds/sanction.wav'])
})

test('elicitation dialogs sound sanction; agent_needs_input sounds servitor; idle_prompt and agent_completed are silent', { options: { vox: 'off' } }, async ($, on) => {
  const clock = mock.clock(on)
  const plays = macos(on, clock)
  on('classic.Notification', () => ({}))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))

  for (const kind of ['elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input', 'idle_prompt', 'agent_completed']) {
    await $.classic.Notification(notify(kind))
    await $.turn.start({ text: 'go', turnId: kind })
  }
  // A turn ending re-arms the wait too.
  await $.classic.Notification(notify('permission_prompt'))
  await $.turn.complete(errorTurn)
  await $.classic.Notification(notify('permission_prompt'))
  await clock.settle()

  expect(plays.map(p => p.asset)).toEqual([
    'sounds/sanction.wav',
    'sounds/sanction.wav',
    'sounds/servitor.wav',
    'sounds/sanction.wav',
    'sounds/severed.wav',
    'sounds/sanction.wav',
  ])
})
