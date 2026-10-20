import type { Color } from 'claude-code'

// The engine's Uint8Array has these (RasterProps' own example); TypeScript 5.6's lib does not declare them yet.
declare global {
  interface Uint8Array {
    toBase64(): string
  }
  interface Uint8ArrayConstructor {
    fromBase64(base64: string): Uint8Array
  }
}

export const THEME_NAMES = ['mars', 'cogitator', 'forge', 'claude'] as const
export type ThemeName = (typeof THEME_NAMES)[number]
export const isThemeName = (s: unknown): s is ThemeName => (THEME_NAMES as readonly unknown[]).includes(s)

export const ART_COLS = 24
export const ART_ROWS = 11
// Frames of boot litany after the pane opens, at 4 frames a second.
export const BOOT_TICKS = 4
// The art's own width inside the canvas; the boot litany uses all ART_COLS.
export const ART_SPAN = 17
export const PULSE_ROWS = 2

// Paint codes: ' ' the terminal's default colour, 'b' body, 'e' eye or screen, 'a' accent, 't' the hero band's rain.
export type Paint = 'b' | 'e' | 'a' | 't'
export type Frame = { rows: string[]; paint: string[] }
export type TextTone = 'head' | 'body' | 'ok' | 'warn' | 'error' | 'dim'

export type Theme = {
  name: ThemeName
  // undefined: the terminal's own text colour
  text: Record<TextTone, Color | undefined>
  // 0x00RRGGBB, or DEFAULT for the terminal's own colour
  art: Record<Paint, number>
  // The servitors' half of the mirrored pulse, 0x00RRGGBB.
  servitor: number
  boot: readonly string[]
  frame: (tick: number, isWorking: boolean) => Frame
}

const DEFAULT = 0x01000000

function canvas() {
  const rows = Array.from({ length: ART_ROWS }, () => Array<string>(ART_COLS).fill(' '))
  const paint = Array.from({ length: ART_ROWS }, () => Array<string>(ART_COLS).fill(' '))
  const put = (row: number, col: number, text: string, code: Paint) => {
    for (let i = 0; i < text.length; i++) {
      const c = col + i
      if (row < 0 || row >= ART_ROWS || c < 0 || c >= ART_COLS) continue
      rows[row]![c] = text[i]!
      paint[row]![c] = text[i] === ' ' ? ' ' : code
    }
  }
  const done = (): Frame => ({ rows: rows.map(r => r.join('')), paint: paint.map(r => r.join('')) })
  return { put, done }
}

type Put = ReturnType<typeof canvas>['put']

// A stable pseudo-random number per (a, b), so every frame is repeatable in tests.
const hash = (a: number, b: number) => Math.imul((a * 73856093) ^ (b * 19349663), 2654435761) >>> 0

const SWEEP = [0, 1, 2, 1]
const ANTENNA = ['|', ':', '¦', ':']

// The servo-skull hovers, one row up or down every 2 s. Working: the eye sweeps the lens and the antenna sparks.
export function servoSkull(tick: number, isWorking: boolean): Frame {
  const { put, done } = canvas()
  const y = Math.floor(tick / 8) % 2
  const isBlink = !isWorking && tick % 32 === 0
  if (isWorking && tick % 2 === 0) {
    put(y, 6, '·', 'a')
    put(y, 12, '·', 'a')
  }
  put(y, 9, isWorking ? ANTENNA[tick % 4]! : '|', 'a')
  put(y + 1, 4, '.-"""""""-.', 'b')
  put(y + 2, 3, '/  .-----.  \\', 'b')
  put(y + 3, 2, '|   |     | o |', 'b')
  put(y + 3, 7 + (isWorking ? SWEEP[tick % 4]! : 1), isBlink ? '(-)' : '(@)', 'e')
  put(y + 3, 14, isWorking && tick % 2 === 1 ? '.' : 'o', 'a')
  put(y + 4, 2, "|   '-----'   |", 'b')
  put(y + 5, 3, '\\   _/^\\_   /', 'b')
  put(y + 6, 4, "'.|vvvvv|.'", 'b')
  put(y + 7, 6, "'-----'", 'b')
  put(y + 8, 4, '==[]=:=[]==', 'b')
  put(y + 9, 7, isWorking && tick % 2 === 1 ? '≈~≈~≈' : '~≈~≈~', 'a')
  return done()
}

const TEETH_A = '    _ _ _ _ _    '
const TEETH_B = '     _ _ _ _     '
const HUB = ['|', '/', '-', '\\']

// The cog's teeth step between two phases and its hub turns while working; idle, the hub flickers every ~8 s.
export function cog(tick: number, isWorking: boolean): Frame {
  const { put, done } = canvas()
  const teeth = isWorking && tick % 2 === 1 ? TEETH_B : TEETH_A
  put(1, 0, teeth, 'a')
  put(2, 0, '  _|_________|_  ', 'b')
  put(3, 0, ' |   .-----.   | ', 'b')
  put(4, 0, '_|  /       \\  |_', 'b')
  put(5, 0, '|   |       |   |', 'b')
  put(5, 8, isWorking ? HUB[tick % 4]! : tick % 32 === 0 ? 'x' : '+', 'e')
  put(6, 0, '|_  \\       /  _|', 'b')
  put(7, 0, " |   '-----'   | ", 'b')
  put(8, 0, '  -|---------|-  ', 'b')
  put(9, 0, teeth.replaceAll('_', '-'), 'a')
  return done()
}

// One line of the console: four bits, a gap, two bits, stable per line number.
function screenLine(n: number): string {
  const h = hash(n, 7)
  const bit = (i: number) => String((h >>> i) & 1)
  return `${[0, 1, 2, 3].map(bit).join('')} ${[8, 9].map(bit).join('')}`
}

// The tech-priest at its console: working, binharic scrolls up the screen, the eyes flare and a mechadendrite twitches.
export function techPriest(tick: number, isWorking: boolean): Frame {
  const { put, done } = canvas()
  const t = isWorking ? tick : 0
  const eyes = !isWorking && tick % 32 === 0 ? '- -' : isWorking && tick % 4 === 0 ? 'O O' : 'o o'
  put(0, 0, '      .---.      ', 'b')
  put(1, 0, '     /     \\     ', 'b')
  put(2, 0, '    |       |~~. ', 'b')
  put(2, 7, eyes, 'e')
  put(3, 0, '     \\  =  /    \\', 'b')
  put(4, 0, '   __/|   |\\__  |', 'b')
  put(5, 0, '  /   | # |   \\  ', 'b')
  put(5, isWorking && tick % 2 === 1 ? 15 : 16, '@', 'a')
  put(6, 0, ' /____|_#_|____\\ ', 'b')
  put(7, 0, ' |[===========]| ', 'b')
  put(8, 0, ' ||           || ', 'b')
  put(9, 0, ' ||           || ', 'b')
  put(8, 5, screenLine(t), 'e')
  put(9, 5, screenLine(t + 1), 'e')
  put(10, 0, ' |[===========]| ', 'b')
  return done()
}

// The litany types in over BOOT_TICKS frames, a quarter of its characters per frame.
export function bootFrame(lines: readonly string[], step: number): Frame {
  const { put, done } = canvas()
  const total = lines.reduce((n, l) => n + l.length, 0)
  let left = Math.ceil(((step + 1) / BOOT_TICKS) * total)
  lines.forEach((line, i) => {
    put(3 + i * 2, 0, line.slice(0, Math.max(0, left)), 'a')
    left -= line.length
  })
  return done()
}

// The hero band: the art (or the boot litany) centred in `cols` columns, binharic rain on both flanks. The rain falls one row per working frame and holds still idle; a column of air is kept each side of the art.
export function heroCells(theme: Theme, cols: number, tick: number, isWorking: boolean, sinceOpen: number): string {
  const isBooting = sinceOpen >= 0 && sinceOpen < BOOT_TICKS
  const f = isBooting ? bootFrame(theme.boot, sinceOpen) : theme.frame(tick, isWorking)
  const span = isBooting ? ART_COLS : ART_SPAN
  const left = Math.max(0, Math.floor((cols - span) / 2))
  const t = isWorking ? tick : 0
  const words = new Uint32Array(cols * ART_ROWS * 3)
  for (let r = 0; r < ART_ROWS; r++)
    for (let c = 0; c < cols; c++) {
      const j = c - left
      let ch = ' '
      let fg = DEFAULT
      if (j >= 0 && j < span) {
        const code = f.paint[r]![j]!
        ch = f.rows[r]![j]!
        fg = code === ' ' ? DEFAULT : theme.art[code as Paint]
      } else if (!isBooting && j !== -1 && j !== span && c % 2 === 0) {
        const h = hash(r - t, c)
        if (h % 4 === 0) {
          ch = String((h >>> 9) & 1)
          fg = theme.art.t
        }
      }
      const i = (r * cols + c) * 3
      words[i] = ch.charCodeAt(0)
      words[i + 1] = fg
      words[i + 2] = DEFAULT
    }
  return new Uint8Array(words.buffer).toBase64()
}

// Braille dot bits, bottom row first: dots 7, 3, 2, 1 on the left and 8, 6, 5, 4 on the right.
const LEFT = [0x40, 0x04, 0x02, 0x01]
const RIGHT = [0x80, 0x20, 0x10, 0x08]

// PULSE_ROWS of braille, two samples (0 to 1) per cell; a sample above 0 shows at least one dot. Without `below`: one graph filled from the bottom. With it: `values` rise from the middle line, `below` hangs from it.
export function pulseCells(theme: Theme, values: readonly number[], cols: number, below?: readonly number[]): string {
  const words = new Uint32Array(cols * PULSE_ROWS * 3)
  const put = (y: number, x: number, bits: number, fg: number) => {
    const i = (y * cols + x) * 3
    words[i] = 0x2800 + bits
    words[i + 1] = fg
    words[i + 2] = DEFAULT
  }
  const dotsOf = (v: number, dots: number) => (v > 0 ? Math.max(1, Math.round(v * dots)) : 0)
  for (let x = 0; x < cols; x++) {
    const pair = (vs: readonly number[]) => [[LEFT, vs[2 * x] ?? 0], [RIGHT, vs[2 * x + 1] ?? 0]] as const
    if (!below) {
      for (let y = 0; y < PULSE_ROWS; y++) {
        let bits = 0
        for (const [side, v] of pair(values)) {
          const h = dotsOf(v, PULSE_ROWS * 4)
          for (let d = 0; d < 4; d++) if ((PULSE_ROWS - 1 - y) * 4 + d < h) bits |= side[d]!
        }
        put(y, x, bits, theme.art.a)
      }
      continue
    }
    let up = 0
    let down = 0
    for (const [side, v] of pair(values)) for (let d = 0; d < dotsOf(v, 4); d++) up |= side[d]!
    for (const [side, v] of pair(below)) for (let d = 0; d < dotsOf(v, 4); d++) down |= side[3 - d]!
    put(0, x, up, theme.art.a)
    put(1, x, down, theme.servitor)
  }
  return new Uint8Array(words.buffer).toBase64()
}

const MARS_BOOT = ['+++ NOOSPHERE LINK +++', 'Machine Spirit: stirring', 'Servo-skull aloft.']

export const THEMES: Record<ThemeName, Theme> = {
  mars: {
    name: 'mars',
    text: { head: '#C0392B', body: '#D8C7A4', ok: '#6FAF5F', warn: '#D9A441', error: '#FF4136', dim: '#8C7A5B' },
    art: { b: 0xb08d57, e: 0xff3b30, a: 0xc0392b, t: 0x6e5b3e },
    servitor: 0xd9a441,
    boot: MARS_BOOT,
    frame: servoSkull,
  },
  cogitator: {
    name: 'cogitator',
    text: { head: '#33FF66', body: '#9CFFB4', ok: '#33FF66', warn: '#FFB000', error: '#FF5555', dim: '#1F7A3A' },
    art: { b: 0x33ff66, e: 0x9cffb4, a: 0x1f9e40, t: 0x1f7a3a },
    servitor: 0xffb000,
    boot: ['+++ COGITATOR ONLINE +++', 'Rotae engaged.', 'Binharic stream: open'],
    frame: cog,
  },
  forge: {
    name: 'forge',
    text: { head: '#FFB000', body: '#FFE4A0', ok: '#FFD27F', warn: '#FF8C00', error: '#FF5555', dim: '#8A6A2A' },
    art: { b: 0xffb000, e: 0xffe4a0, a: 0xb37a00, t: 0x8a6a2a },
    servitor: 0xff8c00,
    boot: ['+++ FORGE LITANY +++', 'Enginseer at console.', 'Data-psalm loaded.'],
    frame: techPriest,
  },
  claude: {
    name: 'claude',
    text: { head: 'claude', body: undefined, ok: 'success', warn: 'warning', error: 'error', dim: 'inactive' },
    art: { b: DEFAULT, e: 0xd97757, a: DEFAULT, t: DEFAULT },
    servitor: 0xd97757,
    boot: MARS_BOOT,
    frame: servoSkull,
  },
}

export const themeFor = (name: ThemeName) => THEMES[name]
