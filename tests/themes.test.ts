import { expect, test } from 'claude-code/testing'

import { basename } from '../hooks/lore'
import { ART_COLS, ART_ROWS, ART_SPAN, BOOT_TICKS, bootFrame, cog, heroCells, paneSvg, PULSE_ROWS, pulseCells, servoSkull, techPriest, THEME_NAMES, themeFor } from '../hooks/themes'

const GLYPH = /^[\x20-\x7e·≈¦]$/
const MARS_BOOT = ['+++ NOOSPHERE LINK +++', 'Machine Spirit: stirring', 'Servo-skull aloft.']

test('every theme draws inside its box with one-cell glyphs, working and idle', { timeoutMs: 60_000 }, () => {
  for (const name of THEME_NAMES)
    for (const isWorking of [true, false])
      for (let tick = 0; tick < 64; tick++) {
        const f = themeFor(name).frame(tick, isWorking)
        expect(f.rows.length, name).toBe(ART_ROWS)
        expect(f.paint.length, name).toBe(ART_ROWS)
        for (const [r, row] of f.rows.entries()) {
          expect(row.length, `${name} row ${r}`).toBe(ART_COLS)
          expect(f.paint[r]!.length, `${name} paint ${r}`).toBe(ART_COLS)
          for (const ch of row) expect(GLYPH.test(ch), `${name} tick ${tick}: ${JSON.stringify(ch)}`).toBe(true)
        }
      }
})

test('every theme moves while working', () => {
  for (const name of THEME_NAMES) {
    const frames = new Set([0, 1, 2, 3].map(t => themeFor(name).frame(t, true).rows.join('\n')))
    expect(frames.size > 1, name).toBe(true)
  }
})

test('idle, the servo-skull holds still between blinks and bobs', () => {
  const at = (t: number) => servoSkull(t, false).rows.join('\n')
  expect(at(4)).toBe(at(20))
  expect(at(0)).not.toBe(at(16))
  expect(at(4)).not.toBe(at(12))
  expect(at(0)).toMatch(/\(-\)/)
})

test('working, the eye sweeps across the lens', () => {
  const eyeCol = (t: number) => servoSkull(t, true).rows.find(r => r.includes('(@)'))!.indexOf('(@)')
  expect([0, 1, 2, 3].map(eyeCol)).toEqual([7, 8, 9, 8])
})

test('the boot litany types in, then holds whole', () => {
  const first = bootFrame(MARS_BOOT, 0).rows.join('')
  const last = bootFrame(MARS_BOOT, BOOT_TICKS - 1).rows.join('')
  expect(first).toMatch(/\+\+\+ NOOS/)
  expect(first).not.toMatch(/aloft/)
  expect(last).toMatch(/Servo-skull aloft\./)
})

const decode = (cells: string) => new Uint32Array(Uint8Array.fromBase64(cells).buffer)
const glyphAt = (w: Uint32Array, cols: number, r: number, c: number) => String.fromCharCode(w[(r * cols + c) * 3]!)
const fgAt = (w: Uint32Array, cols: number, r: number, c: number) => w[(r * cols + c) * 3 + 1]

test('the frames draw no rain of their own: the art stays in its first 17 columns', () => {
  for (const name of THEME_NAMES)
    for (const isWorking of [true, false])
      for (let tick = 0; tick < 32; tick++)
        for (const row of themeFor(name).frame(tick, isWorking).rows) expect(row.slice(ART_SPAN).trim(), `${name} tick ${tick}`).toBe('')
})

test('heroCells packs glyph, foreground and background per cell, base64', () => {
  const words = decode(heroCells(themeFor('mars'), ART_COLS, 5, true, 99))
  expect(words.length).toBe(ART_COLS * ART_ROWS * 3)
  // column 1 is odd, so never rain: a blank cell in the default colours
  expect(words[3]).toBe(0x20)
  expect(words[4]).toBe(0x01000000)
  expect(words[5]).toBe(0x01000000)
  // tick 5 working: the eye's '(' sits at row 3, art column 8, and the art starts at column 3 of 24
  expect(glyphAt(words, ART_COLS, 3, 11)).toBe('(')
  expect(fgAt(words, ART_COLS, 3, 11)).toBe(0xff3b30)
})

test('the hero band centres the art and rains only on its flanks', () => {
  const theme = themeFor('mars')
  const left = Math.floor((46 - ART_SPAN) / 2)
  for (const isWorking of [true, false])
    for (let tick = 0; tick < 16; tick++) {
      const words = decode(heroCells(theme, 46, tick, isWorking, 99))
      const art = theme.frame(tick, isWorking)
      for (let r = 0; r < ART_ROWS; r++)
        for (let c = 0; c < 46; c++) {
          const g = glyphAt(words, 46, r, c)
          const j = c - left
          if (j >= -1 && j <= ART_SPAN) expect(g, `r${r} c${c}`).toBe(j >= 0 && j < ART_SPAN ? art.rows[r]![j]! : ' ')
          else {
            expect(/^[ 01]$/.test(g), `r${r} c${c} ${g}`).toBe(true)
            if (g !== ' ') expect(fgAt(words, 46, r, c)).toBe(theme.art.t)
          }
        }
    }
})

test('the rain falls one row per frame while working and holds still idle', () => {
  const flank = (tick: number, isWorking: boolean, r: number) => {
    const w = decode(heroCells(themeFor('mars'), 46, tick, isWorking, 99))
    return [0, 2, 4, 6, 8, 10].map(c => glyphAt(w, 46, r, c)).join('')
  }
  expect(flank(6, true, 4)).toBe(flank(5, true, 3))
  expect(flank(5, false, 3)).toBe(flank(9, false, 3))
  expect(Array.from({ length: ART_ROWS }, (_, r) => flank(5, true, r)).join('')).toMatch(/[01]/)
})

test('the boot litany types in centred in the hero band, with no rain', () => {
  const words = decode(heroCells(themeFor('mars'), 46, 0, false, 0))
  const row3 = Array.from({ length: 46 }, (_, c) => glyphAt(words, 46, 3, c)).join('')
  expect(row3.slice(11)).toMatch(/^\+\+\+ NOOS/)
  expect(row3.slice(0, 11).trim()).toBe('')
})

test('the pulse fills braille dots from the bottom, two samples per cell', () => {
  const w = decode(pulseCells(themeFor('mars'), [1, 0, 0, 0.5, 0.01, 0], 3))
  expect(w.length).toBe(3 * PULSE_ROWS * 3)
  const at = (y: number, x: number) => w[(y * 3 + x) * 3]
  expect([at(0, 0), at(1, 0)]).toEqual([0x2847, 0x2847]) // left column full
  expect([at(0, 1), at(1, 1)]).toEqual([0x2800, 0x28b8]) // right column, half height
  expect([at(0, 2), at(1, 2)]).toEqual([0x2800, 0x2840]) // a trace still shows one dot
  expect(w[1]).toBe(themeFor('mars').art.a)
})

test('the cog turns its hub while working and flickers it idle', () => {
  expect([0, 1, 2, 3].map(t => cog(t, true).rows[5]![8])).toEqual(['|', '/', '-', '\\'])
  expect(cog(4, false).rows[5]![8]).toBe('+')
  expect(cog(0, false).rows[5]![8]).toBe('x')
  expect(cog(0, true).rows[1]).not.toBe(cog(1, true).rows[1])
  expect(THEME_NAMES).toContain('cogitator')
})

test('the tech-priest scrolls binharic up the screen while working', () => {
  const screen = (t: number, row: number) => techPriest(t, true).rows[row]!.slice(5, 12)
  expect(screen(0, 9)).toBe(screen(1, 8))
  expect(screen(0, 8)).not.toBe(screen(1, 8))
  expect(techPriest(0, false).rows[2]).toMatch(/- -/)
  expect(techPriest(4, false).rows[2]).toMatch(/o o/)
  expect(THEME_NAMES).toContain('forge')
})

test('the mirrored pulse: main rites rise in the top row, servitors hang in the bottom row', () => {
  const theme = themeFor('mars')
  const w = decode(pulseCells(theme, [1, 0.5], 1, [0.25, 1]))
  expect([w[0], w[3]]).toEqual([0x28e7, 0x28b9]) // top: left full, right half; bottom: left one dot, right full
  expect([w[1], w[4]]).toEqual([theme.art.a, theme.servitor])
  for (const name of THEME_NAMES) expect(typeof themeFor(name).servitor).toBe('number')
})

test('the Svg pane escapes untrusted text and never leaves half an emoji at the cut', () => {
  const fg = '#d4d4d4'
  // 'echo <a>&' is 9 units; the emoji's pair sits at 9-10, and a 12-column pane cuts after its first half.
  const svg = paneSvg([[{ col: 0, text: 'echo <a>&\u{1F389}', fg }]], 12, 1)
  expect(svg).toContain('&lt;a&gt;&amp;')
  expect(svg).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/)
  expect(svg).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f]/)
  // A whole emoji inside the pane stays.
  expect(paneSvg([[{ col: 0, text: 'a \u{1F389} b', fg }]], 12, 1)).toContain('\u{1F389}')
})

test('the Svg pane stays under the Svg source cap however big the pane', () => {
  const row = Array.from({ length: 200 }, (_, c) => ({ col: c * 2, text: 'x', fg: '#d4d4d4' }))
  const svg = paneSvg(Array.from({ length: 256 }, () => row), 402, 256)
  expect(svg.length).toBeLessThanOrEqual(131_072)
  expect(svg.endsWith('</svg>')).toBe(true)
})

test('a backslash separates only in a Windows path', () => {
  expect(basename('C:\\Users\\me\\repo\\a.md')).toBe('a.md')
  expect(basename('\\\\server\\share\\a.md')).toBe('a.md')
  expect(basename('C:/Users/me/a.md')).toBe('a.md')
  expect(basename('/home/me/a\\b.md')).toBe('a\\b.md')
})
