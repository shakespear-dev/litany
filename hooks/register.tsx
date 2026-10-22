import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { SoundEvent, Switch } from '../types'
import type { Defaults } from './lore'
import { anyOn, type Command, SAY_MAX, applyCommand, hasWords, BAND_HEAD, bandSegments, basename, fitBand, heresyText, ignitionText, isOn, lawText, matchHeresy, parseCommand, PAUSE_MS, pickLine, pushLog, resolveTheme, resolveVolumes, resolveVox, volumeGain, volumesText, voxSetting, SEP, spinnerWord, statusText, toolPhrase, turnLine, VOICE, withUsage } from './lore'
import { ranRite, spawned, turnEnded, turnStarted } from './servitors'
import { addPulse, LOG_MAX, minuteOf, pulseWindow, ROSTER_HEAD, slate, spiritName, splitWindow } from './slate'
import { BOOT_TICKS, cellRuns, heroCells, paneSvg, pulseCells, segRuns, themeFor, type TextTone, type Theme } from './themes'
import { scaleWav } from './vox/dsp'
import { speak, type VoiceName } from './vox/voices'

const overrides = atom({ plugin: 'litany', key: 'overrides' } as const, { master: null, switches: {} })
const law = atom({ plugin: 'litany', key: 'law' } as const, 0)
const tool = atom({ plugin: 'litany', key: 'tool' } as const, null)
const telemetry = atom({ plugin: 'litany', key: 'telemetry' } as const, { rites: 0, failed: 0, heresies: 0 })
const heresyLine = atom({ plugin: 'litany', key: 'heresyLine' } as const, null)
const failedThisTurn = atom({ plugin: 'litany', key: 'failedThisTurn' } as const, false)
const ignited = atom({ plugin: 'litany', key: 'ignited' } as const, false)
const riteLog = atom({ plugin: 'litany', key: 'riteLog' } as const, [])
const heresyLog = atom({ plugin: 'litany', key: 'heresyLog' } as const, [])
const themeOverride = atom({ plugin: 'litany', key: 'themeOverride' } as const, null)
const voxOverride = atom({ plugin: 'litany', key: 'voxOverride' } as const, null)
const volumeOverride = atom({ plugin: 'litany', key: 'volumeOverride' } as const, {})
const panelOpen = atom({ plugin: 'litany', key: 'panelOpen' } as const, null)
const pulse = atom({ plugin: 'litany', key: 'pulse' } as const, { last: 0, counts: [] })
const spirits = atom({ plugin: 'litany', key: 'spirits' } as const, {})
const agents = atom({ plugin: 'litany', key: 'agents' } as const, {})
const servitorPulse = atom({ plugin: 'litany', key: 'servitorPulse' } as const, { last: 0, counts: [] })

const BAND_TONE = { success: 'ok', warning: 'warn', error: 'error' } as const

// Helpers that take $ must be top-level declarations (the engine follows $ only into those).
async function enabled($: EngineInterface, options: Defaults, name: Switch) {
  return isOn(name, options, await read($, overrides))
}

async function currentTheme($: EngineInterface, options: Defaults) {
  return themeFor(resolveTheme(options, await read($, themeOverride)))
}

// The voice that speaks now, or null while vox is off or the master is.
async function currentVoice($: EngineInterface, options: Defaults) {
  const theme = resolveTheme(options, await read($, themeOverride))
  return resolveVox(options, await read($, voxOverride), theme, (await read($, overrides)).master)
}

// The clip players a Linux desktop may have, PipeWire's first.
const PLAYERS: readonly (readonly string[])[] = [['pw-play'], ['paplay'], ['aplay', '-q'], ['ffplay', '-nodisp', '-autoexit', '-loglevel', 'quiet']]
// $.audio.play sounds through afplay on macOS alone, and elsewhere plays nothing. Undefined until the first sound; 'windows' on Windows; 'engine' on macOS and wherever uname cannot run; else the players still in the running, narrowed to the first that played.
let players: readonly (readonly string[])[] | 'engine' | 'windows' | undefined

// 'engine' on macOS; 'windows' on Windows; on Linux the player tried first (the one that played, once one has), or null when none played.
async function player($: EngineInterface): Promise<'engine' | 'windows' | readonly string[] | null> {
  // Windows is asked first: Git Bash may put a uname on its PATH.
  if (players === undefined && (await $.env.get('OS').catch(() => undefined)) === 'Windows_NT') players ??= 'windows'
  if (players === undefined) {
    const os = await $.process.run(['uname', '-s'], { timeoutMs: 2000 }).catch(() => null)
    players ??= os?.exitCode === 0 && os.stdout.trim() !== 'Darwin' ? PLAYERS : 'engine'
  }
  return typeof players === 'string' ? players : (players[0] ?? null)
}

// Windows: the WAV's bytes reach PowerShell's SoundPlayer on stdin, so no file is written. ponytail: PowerShell starts in a few hundred ms, so a clip lags that much.
const PLAY_STDIN = '[System.Media.SoundPlayer]::new([IO.MemoryStream]::new([Convert]::FromBase64String([Console]::In.ReadToEnd()))).PlaySync()'

// By its full path: Windows looks for a bare name in the working directory first, the project's, where a planted powershell.exe would run.
async function powershell($: EngineInterface) {
  const root = await $.env.get('SystemRoot').catch(() => undefined)
  return `${root !== undefined && /^[A-Za-z]:\\[^"<>|?*]*$/.test(root) ? root.replace(/\\+$/, '') : 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
}

async function playWindows($: EngineInterface, wav: Uint8Array, timeoutMs = 10_000) {
  await $.process.run([await powershell($), '-NoProfile', '-NonInteractive', '-Command', PLAY_STDIN], { stdin: wav.toBase64(), timeoutMs }).catch(() => {})
}

// A player that fails sooner than this never started playing; one that ran longer was playing when it ended.
const PROMPT_MS = 2_000

// Linux: the first player that plays the file keeps the job; a chosen one that fails once is kept. A run killed at `timeoutMs` (or ended later by a signal) ends this file: no other player replays it, and none is blamed.
async function playWavFile($: EngineInterface, path: string, timeoutMs = 10_000) {
  if ((await player($)) === null || typeof players === 'string' || players === undefined) return
  for (const argv of players) {
    const startedAt = await $.clock.now().catch(() => 0)
    const r = await $.process.run([...argv, path], { timeoutMs }).catch(() => null)
    if (r?.exitCode === 0) return void (players = [argv])
    if ((await $.clock.now().catch(() => 0)) - startedAt >= PROMPT_MS) return
  }
  // No player played (none installed, no sound server): the session stays silent.
  if (players === PLAYERS) players = []
}

// A folder from the environment counts only when absolute; anything else reads as unset.
const trimDir = (dir: string | undefined) => (dir?.startsWith('/') ? dir.replace(/\/+$/, '') : '')

// The folders a session's line folder may live in: the per-user runtime folder when there is one, and the temp folder.
async function voxBases($: EngineInterface) {
  const runtime = trimDir(await $.env.get('XDG_RUNTIME_DIR').catch(() => undefined))
  const temp = trimDir(await $.env.get('TMPDIR').catch(() => undefined)) || '/tmp'
  return { runtime, temp }
}

// This session's private line folder (mktemp makes it 0700), so no other user can plant a name we write to. A reload forgets it and makes another; the day-old sweep takes the old one.
let voxDir: Promise<string | null> | undefined
// Names the files inside it, counting on across folders.
let tempCount = 0

// Only a folder named as asked, directly in the base, is ours to write to and remove.
async function makeVoxDir($: EngineInterface): Promise<string | null> {
  const { runtime, temp } = await voxBases($)
  const base = runtime || temp
  const r = await $.process.run(['mktemp', '-d', `${base}/litany-vox.XXXXXXXX`], { timeoutMs: 10_000 }).catch(() => null)
  const dir = r?.exitCode === 0 ? r.stdout.trim() : ''
  return dir.startsWith(`${base}/`) && /^litany-vox\.[A-Za-z0-9]{8}$/.test(dir.slice(base.length + 1)) ? dir : null
}

// Linux: $.fs.write writes only text, so the bytes reach the private folder as base64 on sh's stdin. noclobber (set -C): a path that already exists is never followed or truncated.
async function writeTemp($: EngineInterface, bytes: Uint8Array): Promise<string | null> {
  try {
    const pending = (voxDir ??= makeVoxDir($))
    const dir = await pending
    // A folder given up on is made again by the next line, unless a /clear or another line has already moved on.
    const forget = () => {
      if (voxDir === pending) voxDir = undefined
    }
    if (dir === null) {
      forget()
      return null
    }
    const path = `${dir}/line-${++tempCount}.wav`
    const r = await $.process.run(['sh', '-c', 'set -C; base64 -d > "$1"', 'sh', path], { stdin: bytes.toBase64(), timeoutMs: 10_000 })
    if (r.exitCode === 0) return path
    // The folder may be gone (swept by another session after a day idle), or no one can say: the next line makes a new one.
    if (!(await $.fs.exists(dir).catch(() => false))) forget()
    return null
  } catch {
    return null
  }
}

// Linux: a WAV the mod made, played from a temp file that goes once the player exits.
async function playBytes($: EngineInterface, wav: Uint8Array, timeoutMs?: number) {
  const path = await writeTemp($, wav)
  if (path === null) return
  try {
    await playWavFile($, path, timeoutMs)
  } finally {
    await $.process.run(['rm', '-f', path], { timeoutMs: 10_000 }).catch(() => {})
  }
}

// A clip's bytes at a gain (below full volume on Linux, any on Windows), by clip and gain: each costs one read a session. A failure is not kept.
const scaledClips = new Map<string, Promise<Uint8Array | null>>()

async function readScaled($: EngineInterface, file: string, gain: number) {
  const { base64 } = await $.fs.read(file, { as: 'bytes' })
  return scaleWav(Uint8Array.fromBase64(base64), gain)
}

async function playClipAt($: EngineInterface, clip: SoundEvent, gain: number) {
  const asset = `sounds/${clip}.wav`
  const p = await player($)
  if (p === 'engine') return $.audio.play({ asset }, { gain })
  if (p === null) return
  const file = `${$.plugin.root}/${asset}`
  if (p !== 'windows' && gain === 1) return playWavFile($, file)
  const key = `${clip}@${gain}`
  const scaled = scaledClips.get(key) ?? readScaled($, file, gain).catch(() => null)
  scaledClips.set(key, scaled)
  const wav = await scaled
  // A read or a header that fails plays nothing, never louder than asked, and is tried again next time. A failed write in playBytes is silence too.
  if (wav === null) {
    if (scaledClips.get(key) === scaled) scaledClips.delete(key)
    return
  }
  return p === 'windows' ? playWindows($, wav) : playBytes($, wav)
}

// What `played` does within `ms`: a hung player frees whoever waits on it.
async function within($: EngineInterface, played: Promise<unknown>, ms: number) {
  const stop = new AbortController()
  try {
    await Promise.race([played.catch(() => {}), $.clock.sleep(ms, { signal: stop.signal }).catch(() => {})])
  } finally {
    stop.abort()
  }
}

// Renders a line and plays it. Resolves once it has played or its length + 2 s have passed, so a hung player frees the vox.
async function sayLine($: EngineInterface, voice: VoiceName, text: string, gain: number) {
  const p = await player($)
  if (p === null) return
  const { wav, durationMs } = speak(voice, text, Math.floor(Math.random() * 2 ** 32), gain)
  // A Linux or Windows player may run the line's length and 3 s more before it is killed.
  const played = p === 'engine' ? $.audio.play({ base64: wav.toBase64(), mime: 'audio/wav' }) : p === 'windows' ? playWindows($, wav, durationMs + 3_000) : playBytes($, wav, durationMs + 3_000)
  await within($, played, durationMs + 2_000)
}

// One line at a time: a module flag, so a reload frees it. The last line per event keeps a pool from repeating.
let isSpeaking = false
const lastLine: Partial<Record<SoundEvent, string>> = {}

// /litany say: claim the vox, then speak detached so the reply returns at once. Returns the reply text.
async function say($: EngineInterface, options: Defaults, cmd: Extract<Command, { kind: 'say' }>): Promise<string> {
  // Taken before the first await, like sound(); a busy vox is left as it is.
  if (isSpeaking) return '+++ The vox is busy; try again in a moment +++'
  isSpeaking = true
  let isStarted = false
  try {
    if (!hasWords(cmd.text)) return '+++ Nothing to say +++'
    if ((await read($, overrides)).master === false) return '+++ The Mechanicus is silenced (/litany on to wake it) +++'
    const volumes = resolveVolumes(options, await read($, volumeOverride))
    const gain = volumeGain(volumes.master, volumes.vox)
    if (gain === 0) return `+++ Silent: ${volumes.master === 0 ? 'master' : 'vox'} volume is 0 +++`
    // Asked for by hand, so it speaks even with vox off: then the theme's voice.
    const voice = cmd.voice ?? (await currentVoice($, options)) ?? resolveTheme(options, await read($, themeOverride))
    isStarted = true
    void (async () => {
      try {
        await sayLine($, voice, cmd.text, gain)
      } catch {
        // A failed render or play is silence.
      } finally {
        isSpeaking = false
      }
    })()
    return [`+++ ${voice} speaks +++`, cmd.text, ...(cmd.isCut ? [`(cut to ${SAY_MAX} characters)`] : [])].join('\n')
  } finally {
    if (!isStarted) isSpeaking = false
  }
}

// Every event's one entry: its clip, then past the pause its line. Never rejects: the tool call and the turn never notice.
async function sound($: EngineInterface, options: Defaults, event: SoundEvent) {
  // Taken before the first await, so of two events in one burst only the first may speak.
  const isClaimed = !isSpeaking
  isSpeaking = true
  try {
    const volumes = resolveVolumes(options, await read($, volumeOverride))
    const clipGain = isOn('sound', options, await read($, overrides)) ? volumeGain(volumes.master, volumes.beeps) : 0
    const voice = isClaimed ? await currentVoice($, options) : null
    const lineGain = voice === null ? 0 : volumeGain(volumes.master, volumes.vox)
    if (voice === null || lineGain === 0) {
      if (clipGain > 0) void playClipAt($, event, clipGain).catch(() => {})
      return
    }
    if (clipGain > 0) {
      await within($, playClipAt($, event, clipGain), 10_000)
      await $.clock.sleep(PAUSE_MS)
    }
    const text = pickLine(event, lastLine[event], Math.random())
    lastLine[event] = text
    await sayLine($, voice, text, lineGain)
  } catch {
    // A render, write or play that fails is silence.
  } finally {
    if (isClaimed) isSpeaking = false
  }
}

// Linux only: line folders a killed session left, ours by uid and a day old, directly in the runtime or temp folder.
async function sweepVoxDirs($: EngineInterface) {
  if (typeof (await player($)) === 'string') return
  const id = await $.process.run(['id', '-u'], { timeoutMs: 2000 })
  const uid = id.exitCode === 0 ? id.stdout.trim() : ''
  if (!/^\d+$/.test(uid)) return
  const { runtime, temp } = await voxBases($)
  for (const base of new Set([runtime, temp].filter(Boolean))) {
    const argv = ['find', '-H', base, '-mindepth', '1', '-maxdepth', '1', '-type', 'd', '-name', 'litany-vox.*', '-uid', uid, '-mmin', '+1440']
    const found = await $.process.run(argv, { timeoutMs: 10_000 }).catch(() => null)
    if (found?.exitCode !== 0) continue
    // Only exact matches: a name of ours, directly in `base`.
    const doomed = found.stdout.split('\n').filter(p => /^litany-vox\.[^/]+$/.test(p.slice(base.length + 1)) && p.startsWith(`${base}/`))
    if (doomed.length > 0) await $.process.run(['rm', '-rf', '--', ...doomed], { timeoutMs: 10_000 }).catch(() => {})
  }
}

// The folder this module made, removed by its exact path; the next line after a /clear makes a new one.
async function removeVoxDir($: EngineInterface) {
  const made = voxDir
  voxDir = undefined
  const dir = made === undefined ? null : await made
  if (dir !== null) await $.process.run(['rm', '-rf', '--', dir], { timeoutMs: 10_000 })
}

// Sanction and servitor sound once per wait; a tool call resolving, or a turn starting or ending, re-arms them.
const WAIT_SOUNDS: ReadonlyMap<string, SoundEvent> = new Map([
  ['permission_prompt', 'sanction'],
  ['elicitation_dialog', 'sanction'],
  ['elicitation_url_dialog', 'sanction'],
  ['agent_needs_input', 'servitor'],
])
let isWaitAnnounced = false

// session.measure fires when a main-thread turn ends; a long turn's rites read the figures in between.
async function refreshUsage($: EngineInterface) {
  const u = await $.session.usage().catch(() => null)
  if (u) await update($, telemetry, t => withUsage(t, u))
}

async function warn($: EngineInterface, options: Defaults, command: string) {
  const heresy = matchHeresy(command)
  if (!heresy || !(await enabled($, options, 'rites'))) return
  const text = heresyText(heresy)
  $.ui.toast(text)
  await update($, heresyLine, () => text)
  await update($, telemetry, t => ({ ...t, heresies: t.heresies + 1 }))
  const at = await $.clock.now().catch(() => 0)
  await update($, heresyLog, l => pushLog(l, { at, command }, 3))
  void sound($, options, 'heresy')
}

async function failed($: EngineInterface, options: Defaults) {
  await update($, telemetry, t => ({ ...t, failed: t.failed + 1 }))
  if (!(await enabled($, options, 'rites')) || (await read($, failedThisTurn))) return
  await update($, failedThisTurn, () => true)
  $.ui.toast('The Machine Spirit is displeased.')
  void sound($, options, 'displeased')
}

// Detached HEAD, no repo, or a git that fails: the forge segment is simply left out.
async function refreshBranch($: EngineInterface) {
  const r = await $.process.run(['git', 'branch', '--show-current'], { timeoutMs: 2000 }).catch(() => null)
  const branch = r?.exitCode === 0 ? r.stdout.trim() || undefined : undefined
  await update($, telemetry, t => ({ ...t, branch }))
}

// The pulse at the drawn width: mirrored while `split` is on and a servitor rite is in view.
async function pulseArt($: EngineInterface, options: Defaults, theme: Theme) {
  const all = await read($, pulse)
  const now = Math.max(all.last, nowMinute)
  if (await enabled($, options, 'split')) {
    const w = splitWindow(all, await read($, servitorPulse), now, inner * 2)
    if (w.servitors.some(v => v > 0)) return { cells: pulseCells(theme, w.main, inner, w.servitors), isSplit: true }
  }
  return { cells: pulseCells(theme, pulseWindow(all, now, inner * 2), inner), isSplit: false }
}

const PANE = 'litany'
// Module-level on purpose: a reload drops the timer with them, and session.start opens the pane again.
let timer: Timer | null = null
let tick = 0
let openedAt = -BOOT_TICKS
let isDrawn = false
let isWorking = false
// Set from the surface's viewport while it draws: a pane opened unasked is a sidebar only where this is true.
let isDockable = false
// Whether a surface with no Raster (desktop, VS Code, a phone) has drawn the open pane: its Svg takes no blits, so every frame is a redraw, the terminal's alongside it. ponytail: kept until the pane closes, a detached surface included.
let isSvgPane = false
// The newest minute this module has seen: a tool call or the timer's minute tick. The pulse scrolls to it.
let nowMinute = 0
// What the last drawing laid out: the timer blits only rasters the pane shows, at the width it drew them.
let inner = 0
let isHeroShown = false
let isPulseShown = false
let isRosterShown = false
// Whether the last pulse drawn was mirrored: when the servitors' minutes scroll out, the head note must follow.
let isPulseSplit = false

// ponytail: the timer runs while the pane is open; an unseated or idle tick returns before any $ call.
async function tickPanel($: EngineInterface, options: Defaults) {
  tick++
  const sinceOpen = tick - openedAt
  // A minute is 240 frames at 250 ms; the pulse scrolls on it.
  const isMinute = isPulseShown && tick % 240 === 0
  const isHeroFrame = isHeroShown && (isWorking || sinceOpen < BOOT_TICKS || tick % 4 === 0)
  // The roster's times move once a second, and a finished row leaves on time.
  const isRosterTick = isRosterShown && tick % 4 === 0
  if (!isDrawn || (!isHeroFrame && !isMinute && !isRosterTick)) return
  if (isMinute) nowMinute = Math.max(nowMinute, minuteOf(await $.clock.now().catch(() => 0)))
  // An Svg cannot be blitted, so every frame redraws the whole pane (4 a second at most, under a remote surface's 10); the terminal's redraw shows the same frame.
  if (isRosterTick || isSvgPane) $.ui.invalidate('ui.render')
  if (isSvgPane) return
  const theme = await currentTheme($, options)
  if (isHeroFrame) {
    const r = await $.ui.blit({ requestId: PANE, key: 'art', cells: heroCells(theme, inner, tick, isWorking, sinceOpen) })
    if (r.deny !== undefined) return void (isDrawn = false)
  }
  if (isMinute) {
    const art = await pulseArt($, options, theme)
    // The graph changed kind: redraw the pane so the head note matches.
    if (art.isSplit !== isPulseSplit) return void $.ui.invalidate('ui.render')
    const r = await $.ui.blit({ requestId: PANE, key: 'pulse', cells: art.cells })
    if (r.deny !== undefined) isDrawn = false
  }
}

async function openPanel($: EngineInterface, options: Defaults) {
  // Before the open: the engine may draw the pane before $.ui.open resolves, and that drawing is the first boot frame.
  openedAt = tick
  const opened = await $.ui.open({ id: PANE, title: '+++ NOOSPHERE +++' }).catch(() => null)
  if (!opened) return
  await update($, panelOpen, () => true)
  timer ??= $.clock.every(250, () => void tickPanel($, options).catch(() => {}))
}

function stopPanel() {
  timer?.cancel()
  timer = null
  isDrawn = false
  isSvgPane = false
}

async function closePanel($: EngineInterface) {
  stopPanel()
  await update($, panelOpen, () => false)
  await $.ui.close({ id: PANE }).catch(() => {})
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'litany',
      description: 'Show or toggle the Litany skin for this session',
      argumentHint: '[on|off] | <switch> on|off | theme <name> | vox <voice|default|off> | volume [<which> <0-10>] | panel | say [voice] <text>',
    })
    const started = await next(e)
    await refreshBranch($)
    const repo = await $.session.repo().catch(() => null)
    const forge = repo ? (repo.name ?? basename(repo.root)) : undefined
    await update($, telemetry, t => ({ ...t, forge }))
    // $.state outlives a hot reload, so the litany is said once per session. Terminal sessions only: a -p or SDK host's stream would carry the notice as a transcript row.
    if (e.isInteractive && e.surface === 'terminal' && anyOn(options, await read($, overrides), await currentVoice($, options)) && !(await read($, ignited))) {
      await update($, ignited, () => true)
      const text = ignitionText(forge, (await read($, telemetry)).branch)
      await $.session.append({ message: { type: 'system', content: [{ type: 'text', text }] } }).catch(() => {})
    }
    // Line folders a killed session left behind: by a person's session only, and never holding up the start.
    if (e.isInteractive) void sweepVoxDirs($).catch(() => {})
    // A reload: reopen a pane that was open (its timer died with the old module), or close it if panel went off in /config. Wherever a surface is attached (a desktop session starts non-interactive); one that attaches later reopens it through session.attach, and a -p run never does.
    if ((await read($, panelOpen)) === true) {
      if (!(await enabled($, options, 'panel'))) await closePanel($)
      else if (e.isInteractive || (await $.session.surfaces().catch(() => [])).length > 0) await openPanel($, options)
    }
    return started
  })

  // The desktop app (or a phone) joining: a pane left open in this session opens there again.
  on('session.attach', async ($, e, next) => {
    const attached = await next(e)
    if (timer === null && (await read($, panelOpen)) === true && (await enabled($, options, 'panel'))) await openPanel($, options)
    return attached
  })

  on('command.run', { command: 'litany' }, async ($, e) => {
    const cmd = parseCommand(e.args)
    if (cmd.kind === 'error') return { text: cmd.text }
    if (cmd.kind === 'say') return { text: await say($, options, cmd) }
    if (cmd.kind === 'volumes') {
      const session = await read($, volumeOverride)
      return { text: volumesText({ now: resolveVolumes(options, session), session }) }
    }
    if (cmd.kind === 'panel') {
      if (!(await enabled($, options, 'panel'))) return { text: 'The panel is switched off. Turn it on with /litany panel on.' }
      // Toggle on what the person sees: an open pane the engine holds unseated (narrow window) is shown, not closed.
      if ((await read($, panelOpen)) === true && isDrawn) await closePanel($)
      else await openPanel($, options)
    } else if (cmd.kind === 'theme') await update($, themeOverride, () => cmd.name)
    else if (cmd.kind === 'vox') await update($, voxOverride, () => cmd.setting)
    else if (cmd.kind === 'volume') await update($, volumeOverride, v => ({ ...v, [cmd.which]: cmd.level }))
    else await update($, overrides, o => applyCommand(o, cmd))
    if (cmd.kind === 'switch' && cmd.name === 'panel' && cmd.on) await openPanel($, options)
    if (!(await enabled($, options, 'panel')) && (await read($, panelOpen)) === true) await closePanel($)
    const override = await read($, themeOverride)
    const theme = { name: resolveTheme(options, override), isSession: override !== null }
    const o = await read($, overrides)
    const voxSession = await read($, voxOverride)
    const vox = { setting: voxSetting(options, voxSession), voice: await currentVoice($, options), isSession: voxSession !== null }
    const session = await read($, volumeOverride)
    return { text: statusText(options, o, await read($, law), theme, vox, { now: resolveVolumes(options, session), session }) }
  })

  // Warn-only: every path ends in next(e); the permission mode stays the only gate. ponytail: one active tool, the main loop's; a subagent's spinner falls back to the mode phrase.
  on('tool.call', async ($, e, next) => {
    const { rites } = await read($, telemetry)
    await update($, telemetry, t => ({ ...t, rites: t.rites + 1 }))
    nowMinute = Math.max(nowMinute, minuteOf(await $.clock.now().catch(() => 0)))
    const minute = nowMinute
    const spirit = spiritName(e.tool)
    const id = e.agentId
    // A servitor's call is tagged with its type; an id no spawn recorded is one of the engine's own forks, no servitor.
    const known = id === undefined ? undefined : (await read($, agents))[id]
    const agent = id === undefined ? undefined : (known?.type ?? 'fork')
    await update($, pulse, p => addPulse(p, minute))
    if (known) await update($, servitorPulse, p => addPulse(p, minute))
    await update($, spirits, s => ({ ...s, [spirit]: (s[spirit] ?? 0) + 1 }))
    if (id !== undefined) await update($, agents, a => ranRite(a, id))
    else await update($, tool, () => ({ name: e.tool, phrase: toolPhrase(e.tool, rites) }))
    if (e.tool === 'Bash') await warn($, options, e.command)
    const label = e.tool === 'Bash' ? e.command : e.tool === 'Read' || e.tool === 'Edit' || e.tool === 'Write' ? basename(e.file_path) : ''
    const ran = await next(e)
    isWaitAnnounced = false
    await refreshUsage($)
    if (e.tool === 'Bash' && /\bgit\b/.test(e.command)) void refreshBranch($).catch(() => {})
    if (ran.deny === undefined && ran.isError === true) await failed($, options)
    if (id === undefined) await update($, tool, () => null)
    if (agent === undefined || (await enabled($, options, 'sublog'))) {
      const entry = { tool: e.tool, label, ok: ran.deny === undefined && ran.isError !== true }
      await update($, riteLog, l => pushLog(l, agent === undefined ? entry : { ...entry, agent }, LOG_MAX))
    }
    return ran
  }).catch(($, e, next) => next(e))

  // A servitor is recorded once the engine started it: a denied spawn answers no id.
  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    const id = r.agentId
    // A teammate in a terminal pane of its own runs no loop here (its id is its address): no event of it ever ends it.
    const isElsewhere = r.teammateId !== undefined && id === r.teammateId
    if (id !== undefined && !isElsewhere) {
      const at = await $.clock.now().catch(() => 0)
      await update($, agents, a => spawned(a, id, e, at))
    }
    return r
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    isWaitAnnounced = false
    const id = e.agentId
    if (id !== undefined) {
      const at = await $.clock.now().catch(() => 0)
      await update($, agents, a => turnStarted(a, id, at))
    }
    if (!e.agentId) {
      isWorking = true
      // ponytail: auto-dock waits for the first turn, when the terminal has said whether it is fullscreen.
      if (isDockable && (await read($, panelOpen)) === null && (await enabled($, options, 'panel'))) await openPanel($, options)
      await update($, law, n => n + 1)
      await update($, heresyLine, () => null)
      await update($, failedThisTurn, () => false)
    }
    return next(e)
  })

  // Render hooks skin the terminal only; the desktop's spinner words carry real information.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.message !== null || !(await enabled($, options, 'spinner'))) return next(e)
    const word = spinnerWord(e.props.mode, await read($, tool), await read($, law))
    return next({ ...e, props: { ...e.props, word } })
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || !(await enabled($, options, 'turnline'))) return next(e)
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{turnLine(e.props.durationMs)}</Text>
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || !(await enabled($, options, 'hint'))) return next(e)
    return next({ ...e, props: { ...e.props, tail: `  ${lawText(await read($, law))}` } })
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || !anyOn(options, await read($, overrides), await currentVoice($, options))) return next(e)
    return next({ ...e, props: { ...e.props, modes: [...e.props.modes, '⚙ litany'] } })
  })

  on('session.measure', async ($, e, next) => {
    await update($, telemetry, t => withUsage(t, e))
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.viewport?.isFullscreen !== undefined) isDockable = e.viewport.isFullscreen
    if (e.props.hasSurvey || !(await enabled($, options, 'band'))) return next(e)
    const segments = fitBand(bandSegments(await read($, telemetry)), e.props.bodyColumns)
    const theme = await currentTheme($, options)
    const line = await read($, heresyLine)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Text>
          <Text color={theme.text.head} bold>{BAND_HEAD}</Text>
          {segments.map(s => (
            <Text key={s.text} {...(s.color ? { color: theme.text[BAND_TONE[s.color]] } : { dimColor: true })}>{SEP + s.text}</Text>
          ))}
        </Text>
        {line && e.props.maxRows > 1 && <Text color={theme.text.error}>{line.slice(0, e.props.bodyColumns)}</Text>}
      </Box>
    )
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    // Chat a person reads, at a terminal or in the desktop app (an SDK host itself): other -p output, SDK hosts and teammates may be parsed by something else.
    const isHosted = e.surfaces.includes('desktop') || (e.surfaces.includes('terminal') && !e.traits.some(t => t === 'print' || t === 'sdk-preset'))
    const isChat = isHosted && !e.traits.some(t => t === 'bare' || t === 'teammate')
    if (!isChat || !(await enabled($, options, 'voice'))) return composed
    return { sections: [...composed.sections, { id: 'litany-voice', text: VOICE, scope: 'session' }] }
  })

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId
    if (id !== undefined) {
      const at = await $.clock.now().catch(() => 0)
      await update($, agents, a => turnEnded(a, id, at, e.reason === 'answer'))
    }
    isWaitAnnounced = false
    // An answer alone is a rite done: a long turn that died is severed, a refusal or an abort says nothing.
    if (!e.agentId && e.reason === 'answer' && e.durationMs >= 30_000) void sound($, options, 'rite-done')
    if (!e.agentId && e.reason === 'error') void sound($, options, 'severed')
    if (!e.agentId) {
      isWorking = false
      // isWorking is not state, so nothing else redraws the pane's lamp.
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  // Claude waits on the person: a permission prompt that has waited, an MCP form or URL, a servitor's question.
  on('classic.Notification', async ($, e, next) => {
    const event = WAIT_SOUNDS.get(e.notification_type)
    if (event !== undefined && !isWaitAnnounced) {
      isWaitAnnounced = true
      void sound($, options, event)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // The engine's own compaction of the main conversation; one the person typed, or a subagent's, stays quiet.
  on('session.compact', async ($, e, next) => {
    const compacted = await next(e)
    if (e.trigger === 'auto' && e.agentId === undefined) void sound($, options, 'engrams')
    return compacted
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    await removeVoxDir($).catch(() => {})
    return next(e)
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    stopPanel()
    await update($, panelOpen, () => false)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (!(await enabled($, options, 'panel'))) return next(e)
    isDrawn = true
    if (e.surface !== 'terminal') isSvgPane = true
    const theme = await currentTheme($, options)
    const cols = e.props.bodyColumns
    const rows = e.props.scroll.bodyRows
    inner = Math.max(1, cols - 2)
    const art = await pulseArt($, options, theme)
    isPulseSplit = art.isSplit
    const layout = slate(
      {
        telemetry: await read($, telemetry),
        rites: await read($, riteLog),
        heresies: await read($, heresyLog),
        spirits: await read($, spirits),
        agents: await read($, agents),
        now: await $.clock.now().catch(() => 0),
        law: await read($, law),
        isWorking,
        isPulseSplit: art.isSplit,
        show: {
          pulse: await enabled($, options, 'pulse'),
          spirits: await enabled($, options, 'spirits'),
          roster: await enabled($, options, 'roster'),
          sublog: await enabled($, options, 'sublog'),
        },
      },
      cols,
      rows,
    )
    isHeroShown = layout.some(r => r.kind === 'art')
    isPulseShown = layout.some(r => r.kind === 'pulse')
    isRosterShown = layout.some(r => r.kind === 'text' && r.segs[0]?.text === ROSTER_HEAD)
    if (e.surface !== 'terminal') {
      // The same rows as the terminal's, as one terminal-looking Svg.
      const lines = layout.flatMap(r =>
        r.kind === 'art' ? cellRuns(heroCells(theme, inner, tick, isWorking, tick - openedAt), inner, r.rows) : r.kind === 'pulse' ? cellRuns(art.cells, inner, r.rows) : [segRuns(theme, r.segs)],
      )
      const { Svg } = $.ui.resolve(e)
      return <Svg source={paneSvg(lines, cols, rows)} alt="NOOSPHERE: the Litany telemetry panel" />
    }
    const color = (tone: TextTone) => (theme.text[tone] ? { color: theme.text[tone] } : {})
    const { Box, Text, Raster } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" height={rows} paddingX={1}>
        {layout.map((r, i) =>
          r.kind === 'art' ? (
            <Raster key="art" columns={inner} rows={r.rows} cells={heroCells(theme, inner, tick, isWorking, tick - openedAt)} />
          ) : r.kind === 'pulse' ? (
            <Raster key="pulse" columns={inner} rows={r.rows} cells={art.cells} />
          ) : (
            <Text key={String(i)} wrap="truncate-end">
              {r.segs.length
                ? r.segs.map((s, j) => (
                    <Text key={String(j)} bold={s.bold === true} {...color(s.tone)}>
                      {s.text}
                    </Text>
                  ))
                : ' '}
            </Text>
          ),
        )}
      </Box>
    )
  })
}
