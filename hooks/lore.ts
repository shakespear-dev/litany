import type { SessionUsage } from 'claude-code'

import type { ActiveTool, Overrides, SoundEvent, Switch, Telemetry, Volumes, VoxSetting } from '../types'
import { isThemeName, THEME_NAMES, type ThemeName } from './themes'
import { tokenize } from './vox/lexicon'
import { VOX_LINES } from './vox/lines'
import { VOICE_NAMES, type VoiceName } from './vox/voices'

export const SWITCHES: readonly Switch[] = ['spinner', 'turnline', 'hint', 'band', 'voice', 'rites', 'sound', 'panel', 'pulse', 'spirits', 'roster', 'sublog', 'split']

// `register`'s options: the userConfig values, defaults filled in.
export type Defaults = Readonly<Record<string, unknown>>

export function isOn(name: Switch, defaults: Defaults, o: Overrides): boolean {
  if (o.master !== null) return o.master
  return o.switches[name] ?? defaults[name] !== false
}

// Sections of the panel, not layers: with the eight layers off the mod is silent.
export const PANEL_ONLY: readonly Switch[] = ['pulse', 'spirits', 'roster', 'sublog', 'split']
// A speaking voice keeps the footer too, so vox alone still shows the mod is awake.
export const anyOn = (defaults: Defaults, o: Overrides, vox: VoiceName | null) =>
  vox !== null || SWITCHES.some(s => !PANEL_ONLY.includes(s) && isOn(s, defaults, o))

// Pause between a clip and its spoken line.
export const PAUSE_MS = 350

const VOX_SETTINGS: readonly VoxSetting[] = ['default', ...VOICE_NAMES, 'off']
const isVoxSetting = (v: unknown): v is VoxSetting => VOX_SETTINGS.includes(v as VoxSetting)
const VOLUME_KEYS: readonly (keyof Volumes)[] = ['master', 'beeps', 'vox']

// Session override, then the config picker; anything else reads as default.
export const voxSetting = (defaults: Defaults, override: VoxSetting | null): VoxSetting => override ?? (isVoxSetting(defaults.vox) ? defaults.vox : 'default')

// Master off is silent.
export function resolveVox(defaults: Defaults, override: VoxSetting | null, theme: ThemeName, master: boolean | null): VoiceName | null {
  if (master === false) return null
  const setting = voxSetting(defaults, override)
  if (setting === 'off') return null
  return setting === 'default' ? theme : setting
}

// Only the strings "0"…"10" count: the picker stores strings, anything hand-edited falls back to full.
const storedVolume = (v: unknown) => (typeof v === 'string' && /^(10|[0-9])$/.test(v) ? Number(v) : 10)

export function resolveVolumes(defaults: Defaults, override: Partial<Volumes>): Volumes {
  return {
    master: override.master ?? storedVolume(defaults.volumeMaster),
    beeps: override.beeps ?? storedVolume(defaults.volumeBeeps),
    vox: override.vox ?? storedVolume(defaults.volumeVox),
  }
}

// Perceived loudness is steep, so the two levels multiply and the product is squared into amplitude.
export const volumeGain = (master: number, part: number) => ((master / 10) * (part / 10)) ** 2

// r in [0, 1). Drawing from the pool without `last` keeps one line from repeating back to back.
export function pickLine(event: SoundEvent, last: string | undefined, r: number): string {
  const pool = VOX_LINES[event]
  const rest = pool.length > 1 ? pool.filter(l => l !== last) : pool
  return rest[Math.floor(r * rest.length)]!
}

export type Command =
  | { kind: 'status' }
  | { kind: 'all'; on: boolean }
  | { kind: 'switch'; name: Switch; on: boolean }
  | { kind: 'theme'; name: ThemeName }
  | { kind: 'vox'; setting: VoxSetting }
  | { kind: 'volume'; which: keyof Volumes; level: number }
  | { kind: 'volumes' }
  | { kind: 'panel' }
  | { kind: 'say'; voice: VoiceName | null; text: string; isCut: boolean }
  | { kind: 'error'; text: string }

const USAGE = `Usage: /litany [on|off]  or  /litany <${SWITCHES.join('|')}> on|off  or  /litany theme <${THEME_NAMES.join('|')}>  or  /litany vox <${VOX_SETTINGS.join('|')}|on>  or  /litany volume [<${VOLUME_KEYS.join('|')}> 0-10]  or  /litany panel  or  /litany say [${VOICE_NAMES.join('|')}] <text>`

export const SAY_MAX = 200

// One pair of surrounding quotes off, spaces collapsed, printable ASCII only (the synth reads English), a run of marks down to its first (each mark is a pause); long text is cut at a word.
export function sayText(raw: string): { text: string; isCut: boolean } | null {
  let t = raw.trim()
  if (t.length >= 2 && (t[0] === '"' || t[0] === "'") && t.at(-1) === t[0]) t = t.slice(1, -1)
  t = t.replace(/[^\x20-\x7e\s]/g, '').replace(/\s+/g, ' ').replace(/([.,;:!?])[.,;:!?]+/g, '$1').trim()
  if (t === '') return null
  if (t.length <= SAY_MAX) return { text: t, isCut: false }
  const space = t.lastIndexOf(' ', SAY_MAX)
  return { text: t.slice(0, space > 0 ? space : SAY_MAX).trimEnd(), isCut: true }
}

// Whether the synth would say a word of it, not just pauses.
export const hasWords = (text: string) => tokenize(text).some(t => 'word' in t && /[a-z0-9]/.test(t.word))

export function parseCommand(args: string): Command {
  // say keeps the text's case, so it reads the raw args before the lowercasing below.
  const say = /^\s*say(?:\s+(.*))?$/is.exec(args)
  if (say) {
    let rest = say[1] ?? ''
    const first = /^(\S+)(?:\s+(.*))?$/s.exec(rest)
    const named = VOICE_NAMES.find(v => v === first?.[1]?.toLowerCase())
    if (named) rest = first?.[2] ?? ''
    const spoken = sayText(rest)
    return spoken ? { kind: 'say', voice: named ?? null, ...spoken } : { kind: 'error', text: USAGE }
  }
  const words = args.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const [a, b] = words
  if (words.length === 0) return { kind: 'status' }
  if (words.length === 1 && (a === 'on' || a === 'off')) return { kind: 'all', on: a === 'on' }
  if (words.length === 2 && SWITCHES.includes(a as Switch) && (b === 'on' || b === 'off'))
    return { kind: 'switch', name: a as Switch, on: b === 'on' }
  if (words.length === 1 && a === 'panel') return { kind: 'panel' }
  if (words.length === 2 && a === 'theme' && isThemeName(b)) return { kind: 'theme', name: b }
  if (words.length === 2 && a === 'vox' && b === 'on') return { kind: 'vox', setting: 'default' }
  if (words.length === 2 && a === 'vox' && isVoxSetting(b)) return { kind: 'vox', setting: b }
  if (words.length === 1 && a === 'volume') return { kind: 'volumes' }
  if (words.length === 3 && a === 'volume' && VOLUME_KEYS.includes(b as keyof Volumes) && /^(10|[0-9])$/.test(words[2]!))
    return { kind: 'volume', which: b as keyof Volumes, level: Number(words[2]) }
  return { kind: 'error', text: USAGE }
}

// A switch command after /litany on|off keeps every other switch where the master put it.
export function applyCommand(o: Overrides, cmd: Command): Overrides {
  if (cmd.kind === 'all') return { master: cmd.on, switches: {} }
  if (cmd.kind !== 'switch') return o
  const base = o.master === null ? o.switches : Object.fromEntries(SWITCHES.map(s => [s, o.master]))
  return { master: null, switches: { ...base, [cmd.name]: cmd.on } }
}

export const LAWS: readonly string[] = [
  'Life is directed motion.',
  'The spirit is the spark of life.',
  'Sentience is the ability to learn the value of knowledge.',
  'Intellect is the understanding of knowledge.',
  'Sentience is the basest form of Intellect.',
  'Understanding is the True Path to Comprehension.',
  'Comprehension is the key to all things.',
  'The Omnissiah knows all, comprehends all.',
  'The alien mechanism is a perversion of the true path.',
  'The soul is the conscience of sentience.',
  'A soul can be bestowed only by the Omnissiah.',
  'The soulless sentience is the enemy of all.',
  'The knowledge of the ancients stands beyond question.',
  'The machine spirit guards the knowledge of the ancients.',
  'Flesh is fallible, but ritual honours the machine spirit.',
  'To break with ritual is to break with faith.',
]
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI']

export const lawText = (i: number) => `Law ${ROMAN[i % 16]!}: ${LAWS[i % 16]!}`
export const lawNumeral = (i: number) => ROMAN[i % 16]!

export function statusText(
  defaults: Defaults,
  o: Overrides,
  law: number,
  theme: { name: ThemeName; isSession: boolean },
  vox: { setting: VoxSetting; voice: VoiceName | null; isSession: boolean },
  volumes: { now: Volumes; session: Partial<Volumes> },
): string {
  const rows = SWITCHES.map(s => {
    const isSession = o.master !== null || o.switches[s] !== undefined
    return `${s.padEnd(10)}${isOn(s, defaults, o) ? 'on' : 'off'}${isSession ? '  (this session)' : ''}`
  })
  rows.push(`${'theme'.padEnd(10)}${theme.name}${theme.isSession ? '  (this session)' : ''}`)
  const { master, beeps, vox: v } = volumes.now
  // What would speak: a silenced master, or a master or vox volume of 0, reads silent, not the voice it would have been.
  const isSilent = vox.voice === null || volumeGain(master, v) === 0
  const named = vox.setting === 'off' ? 'off' : vox.setting === 'default' ? `default (${isSilent ? 'silent' : vox.voice})` : `${vox.setting}${isSilent ? ' (silent)' : ''}`
  rows.push(`${'vox'.padEnd(10)}${named}${vox.isSession ? '  (this session)' : ''}`)
  rows.push(`${'volume'.padEnd(10)}master ${master}  beeps ${beeps}  vox ${v}${Object.keys(volumes.session).length ? '  (this session)' : ''}`)
  return ['+++ Litany +++', ...rows, '', lawText(law)].join('\n')
}

// The three levels and what they come to: a part's share is master x part.
export function volumesText(volumes: { now: Volumes; session: Partial<Volumes> }): string {
  const { now, session } = volumes
  const mark = (k: keyof Volumes) => (session[k] !== undefined ? '  (this session)' : '')
  const share = (k: 'beeps' | 'vox', what: string) =>
    `${k.padEnd(10)}${String(now[k]).padEnd(6)}${what} at ${Math.round((now.master / 10) * (now[k] / 10) * 100)} %${mark(k)}`
  return ['+++ Litany volume +++', `${'master'.padEnd(10)}${now.master}${mark('master')}`, share('beeps', 'clips'), share('vox', 'lines')].join('\n')
}

// Session override, then the config picker; anything else (a typo, a theme of another version) is mars.
export function resolveTheme(defaults: Defaults, override: string | null): ThemeName {
  if (isThemeName(override)) return override
  return isThemeName(defaults.theme) ? defaults.theme : 'mars'
}

export const pushLog = <T>(log: readonly T[], entry: T, max: number): T[] => [...log, entry].slice(-max)

// A backslash separates only in a Windows path (a drive, a UNC share or a rooted path), with either slash after the drive; elsewhere it is a legal character of a name.
export const basename = (path: string) => path.slice(Math.max(path.lastIndexOf('/'), /^([A-Za-z]:|\\)/.test(path) ? path.lastIndexOf('\\') : -1) + 1)

export type SpinnerMode = 'requesting' | 'responding' | 'thinking' | 'tool-input' | 'tool-use'

const THINKING = ['Consulting the Noosphere', 'Communing with the Machine Spirit', "Parsing the Omnissiah's will"]
const RESPONDING = ['Transcribing binharic canticles', 'Inscribing the data-scroll']
const BASH = ['Anointing the cogitator', 'Intoning the Litany of Ignition']
const READ = ['Sifting the Librarium data-stacks', 'Consulting the archives']
const EDIT = ['Inscribing the sacred code-scrolls', 'Rewriting the rites']
const AGENT = ['Dispatching a servitor', 'Awakening a skitarius']
const WEB = ['Querying the astropathic relay']

const from = (pool: readonly string[], n: number) => pool[n % pool.length]!

function poolFor(tool: string): readonly string[] | null {
  if (tool === 'Bash') return BASH
  if (tool === 'Read' || tool === 'Grep' || tool === 'Glob') return READ
  if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') return EDIT
  if (tool === 'Agent') return AGENT
  if (tool === 'WebSearch' || tool === 'WebFetch' || tool.startsWith('mcp__parallel__')) return WEB
  return null
}

// n is a counter the caller already keeps (tool calls, turns), so a phrase holds still between redraws.
export function toolPhrase(tool: string, n: number): string {
  const pool = poolFor(tool)
  if (pool) return from(pool, n)
  const server = /^mcp__(.+?)__/.exec(tool)?.[1]
  return server ? `Petitioning the forge-shrine ${server}` : from(THINKING, n)
}

export function spinnerWord(mode: SpinnerMode, tool: ActiveTool | null, n: number): string {
  if ((mode === 'tool-use' || mode === 'tool-input') && tool) return tool.phrase
  return from(mode === 'responding' ? RESPONDING : THINKING, n)
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`
}

const TURN_LINES = [
  (d: string) => `Rite concluded in ${d}`,
  (d: string) => `Canticle sung for ${d}`,
  (d: string) => `Machine Spirit appeased in ${d}`,
]

// Picked by the duration itself, so one line never changes wording when it redraws.
export const turnLine = (ms: number) => `⚙ ${TURN_LINES[Math.floor(ms / 1000) % 3]!(formatDuration(ms))}`

export type Heresy = { rite: string; law: number }

const PIPE_TO_SHELL = /\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(ba|z)?sh\b/
// ponytail: TRUNCATE only with TABLE, so `rg truncate src` (a Tailwind class) stays quiet; bare `TRUNCATE users` is missed.
const SQL_DESTROY = /\b(drop\s+(table|database|schema)|truncate\s+table)\b/i
// SQL counts only where a SQL client runs it, so `rg "DROP TABLE" src/` and commit messages stay quiet.
const SQL_CLIENT = /\b(psql|mysql|mariadb|sqlite3|duckdb|clickhouse-client)\b/
// Quoted text is words, not a pipeline: `git commit -m "revert curl | sh"` is no heresy.
const unquoted = (command: string) => command.replace(/'[^']*'|"[^"]*"/g, '""')

// Short flag letters of a command, so -rf, -fr and -r -f all read as "rf".
const shortFlags = (words: string[]) => words.filter(w => /^-[a-zA-Z]+$/.test(w)).join('')

// ponytail: one shell segment at a time, sudo skipped; `bash -c "…"` and `git -C dir push -f` are not unwrapped.
function segmentRite(segment: string): string | null {
  const words = segment.trim().split(/\s+/).filter(w => w && w !== 'sudo')
  const [cmd = '', sub] = words
  const flags = shortFlags(words)
  const has = (w: string) => words.includes(w)
  if (cmd === 'rm' && (/r/i.test(flags) || has('--recursive')) && (flags.includes('f') || has('--force'))) return 'rm -rf'
  if (cmd === 'git' && sub === 'push' && (has('--force') || flags.includes('f'))) return 'git push --force'
  if (cmd === 'git' && sub === 'reset' && has('--hard')) return 'git reset --hard'
  if (cmd === 'git' && sub === 'clean' && flags.includes('f') && flags.includes('d')) return 'git clean -fd'
  if (cmd === 'chmod' && flags.includes('R') && has('777')) return 'chmod -R 777'
  if (/^mkfs(\.\w+)?$/.test(cmd)) return 'mkfs'
  if (cmd === 'dd' && words.some(w => w.startsWith('of=/dev/') && !/^of=\/dev\/(null|zero|stdout|stderr|full)$/.test(w))) return 'dd of=/dev/'
  return null
}

export function matchHeresy(command: string): Heresy | null {
  if (PIPE_TO_SHELL.test(unquoted(command))) return { rite: 'curl | sh', law: 8 }
  if (SQL_CLIENT.test(command) && SQL_DESTROY.test(command)) return { rite: 'DROP / TRUNCATE', law: 13 }
  for (const segment of command.split(/&&|\|\||;|\n/)) {
    const rite = segmentRite(segment)
    if (rite) return { rite, law: 14 }
  }
  return null
}

export const heresyText = (h: Heresy) => `TECH-HERESY: ${h.rite} — ${lawText(h.law)}`

export type Tone = 'success' | 'warning' | 'error'
export type Segment = { text: string; color?: Tone }

export const contextColor = (pct: number): Tone => (pct < 60 ? 'success' : pct < 85 ? 'warning' : 'error')

// The engine's figures over the last ones: a unit it has no reading for keeps the old one.
export function withUsage(t: Telemetry, u: Pick<SessionUsage, 'context' | 'rateLimits' | 'cost'>): Telemetry {
  const fiveHour = u.rateLimits.find(r => r.kind === 'five_hour')
  return {
    ...t,
    contextPct: u.context.percent ?? t.contextPct,
    costUsd: u.cost?.usd ?? t.costUsd,
    fiveHourPct: fiveHour?.percentUsed ?? t.fiveHourPct,
  }
}

// A reading the engine has not reported yet is left out, never shown as zero.
export function bandSegments(t: Telemetry): Segment[] {
  const segs: Segment[] = []
  if (t.contextPct !== undefined) segs.push({ text: `cogitator ${Math.round(t.contextPct)}%`, color: contextColor(t.contextPct) })
  segs.push({ text: `rites ${t.rites}${t.failed ? ` · ${t.failed} failed` : ''}` })
  if (t.branch) segs.push({ text: `forge ${t.branch}` })
  if (t.costUsd !== undefined) segs.push({ text: `tithe $${t.costUsd.toFixed(2)}` })
  if (t.fiveHourPct !== undefined) segs.push({ text: `5h ${Math.round(t.fiveHourPct)}%`, color: contextColor(t.fiveHourPct) })
  segs.push({ text: `heresy ${t.heresies}`, ...(t.heresies ? { color: 'error' as const } : {}) })
  return segs
}

export const BAND_HEAD = '⚙ NOOSPHERE'
export const SEP = ' │ '

// ponytail: width by UTF-16 length; every glyph used here is one cell wide.
export function fitBand(segments: Segment[], columns: number): Segment[] {
  if (BAND_HEAD.length > columns) return []
  const out = [...segments]
  while (out.length && [BAND_HEAD, ...out.map(s => s.text)].join(SEP).length > columns) out.pop()
  return out
}

export const VOICE = [
  '# Mechanicus voice',
  '',
  'The user turned on a cosmetic Adeptus Mechanicus (Warhammer 40k) theme for this chat. Follow these rules:',
  '',
  '- In conversational replies, open with one short line in the form `+++ … +++` (for example `+++ Query received. The Machine Spirit stirs. +++`) and close with one (for example `+++ Praise the Omnissiah. Rite concluded. +++`). Between them, write exactly as you would without the theme: the same precision, structure and length. Use a lore term (Machine Spirit, cogitator, Omnissiah, rite) only occasionally, and never where it makes a technical statement less clear.',
  '- Never apply the theme to code, code comments, commit messages, file contents, tool inputs or terminal commands.',
  '- When the main content of a reply is text the user will send or publish to someone else (an email, Slack or Teams message, Linear or Jira ticket, document, translation, or wording options), do not add the opener or the closer anywhere in that reply.',
  "- Write the opener and the closer in the language of the user's message, whatever language that is.",
].join('\n')

export function ignitionText(forge?: string, branch?: string): string {
  const where = forge ? ` Forge: ${forge}${branch ? ` @ ${branch}` : ''}.` : ''
  return `+++ Litany of Ignition +++ Cogitator awakened.${where} The Omnissiah protects.`
}

export function hhmm(at: number): string {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function wrap(text: string, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line)
      line = word
    } else line = line ? `${line} ${word}` : word
  }
  if (line) lines.push(line)
  return lines.map(l => l.slice(0, width))
}
