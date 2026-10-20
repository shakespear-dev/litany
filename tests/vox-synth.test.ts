import { expect, test } from 'claude-code/testing'

import { VOX_LINES } from '../hooks/vox/lines'
import { SAMPLES_PER_MS, SR, type Segment, synth } from '../hooks/vox/synth'

const FRAME = 110 // 5 ms at 22,050 Hz

// 2nd-order RBJ high-pass, run twice: the hiss band without the vowels' low harmonics.
function highpass(x: Float32Array, hz: number): Float32Array {
  const w = (2 * Math.PI * hz) / SR, c = Math.cos(w), a = Math.sin(w) / (2 * 0.707)
  const b0 = (1 + c) / 2 / (1 + a), b1 = -(1 + c) / (1 + a), a1 = (-2 * c) / (1 + a), a2 = (1 - a) / (1 + a)
  let y = x
  for (let pass = 0; pass < 2; pass++) {
    const out = new Float32Array(y.length)
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0
    for (let i = 0; i < y.length; i++) {
      const v = b0 * y[i]! + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2
      x2 = x1, x1 = y[i]!, y2 = y1, y1 = v, out[i] = v
    }
    y = out
  }
  return y
}

// RMS in dB over the samples the segments cover, pooled.
function segDb(x: Float32Array, segs: Segment[]): number {
  let e = 0, n = 0
  for (const s of segs) {
    const a = Math.round(s.startMs * SAMPLES_PER_MS), b = Math.min(x.length, Math.round((s.startMs + s.durMs) * SAMPLES_PER_MS))
    for (let i = a; i < b; i++) e += x[i]! * x[i]!, n++
  }
  return 10 * Math.log10(e / Math.max(n, 1) + 1e-12)
}

test('a render is deterministic for a seed', () => {
  const a = synth('Rite concluded.', { pitch: 100, seed: 7 }).samples
  const b = synth('Rite concluded.', { pitch: 100, seed: 7 }).samples
  expect(a.length).toBeGreaterThan(0)
  expect(Array.from(a)).toEqual(Array.from(b))
})

test('segments are timed and cover the samples, on every pool line', () => {
  for (const line of Object.values(VOX_LINES).flat()) {
    const { samples, segments } = synth(line, { pitch: 100 })
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i]!.startMs).toBe(segments[i - 1]!.startMs + segments[i - 1]!.durMs)
    }
    // The last frame is whole, so the samples end at most one frame past the last segment, never before it.
    const end = (segments[segments.length - 1]!.startMs + segments[segments.length - 1]!.durMs) * SAMPLES_PER_MS
    expect(samples.length - end).toBeGreaterThanOrEqual(0)
    expect(samples.length - end).toBeLessThan(FRAME)
  }
  const accents = synth('Rite concluded.', { pitch: 100 }).segments.filter((s) => s.kind === 'vowel' && s.isAccent)
  expect(accents.map((s) => s.phone)).toEqual(['ay', 'uw'])
})

test('frication joins after radiation, under its own gain', () => {
  const hiss = (fricGain: number) => {
    const { samples, segments } = synth('sss', { pitch: 100, fricGain })
    return segDb(highpass(samples, 4000), segments.filter((s) => s.kind === 'fric'))
  }
  expect(hiss(0)).toBeLessThan(-50)
  expect(hiss(0.09)).toBeGreaterThan(-40)
})

test('breath has its own gain', () => {
  // Breath against the stressed vowels of the same render, so the peak normalization cancels out.
  const breath = (aspGain: number) => {
    const { samples, segments } = synth('Tech heresy detected.', { pitch: 100, aspGain })
    const asp = segments.filter((s) => s.kind === 'aspiration' && /^[ptkh]$/.test(s.phone ?? ''))
    return segDb(samples, asp) - segDb(samples, segments.filter((s) => s.kind === 'vowel' && s.isAccent))
  }
  const drop = breath(1) - breath(0.22)
  expect(drop).toBeGreaterThan(12)
  expect(drop).toBeLessThan(14)
})
