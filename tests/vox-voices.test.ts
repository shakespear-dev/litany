import { expect, test } from 'claude-code/testing'

import { level, scaleWav, toWav } from '../hooks/vox/dsp'
import { VOX_LINES } from '../hooks/vox/lines'
import { SAMPLES_PER_MS, SR, type Segment } from '../hooks/vox/synth'
import { newTake, speak, VOICE_NAMES, voiceSamples } from '../hooks/vox/voices'

const LINES = Object.values(VOX_LINES).flat()
// A voice renders up to three layers per line, the pool 22 lines: more than the default 5 s.
const SLOW = { timeoutMs: 120_000 }

const db = (v: number) => 20 * Math.log10(v + 1e-9)
const avg = (v: number[]) => v.reduce((p, q) => p + q, 0) / v.length
const median = (v: number[]) => [...v].sort((p, q) => p - q)[v.length >> 1]!
// A segment's samples: its times are frame ms, never SR / 1000 (that drifts ~7 ms by a line's end).
const span = (s: Segment, n: number) => {
  const a = Math.round(s.startMs * SAMPLES_PER_MS)
  return [a, Math.min(n, Math.max(a + 1, Math.round((s.startMs + s.durMs) * SAMPLES_PER_MS)))] as const
}

// The loudness `level` aims at: RMS of the 20 ms windows over 5 % of the loudest.
function voicedDb(x: Float32Array): number {
  const win = Math.round(SR * 0.02), rms: number[] = []
  for (let i = 0; i + win <= x.length; i += win) {
    let e = 0
    for (let j = i; j < i + win; j++) e += x[j]! * x[j]!
    rms.push(Math.sqrt(e / win))
  }
  const top = Math.max(...rms), voiced = rms.filter((r) => r > top * 0.05)
  return db(Math.sqrt(avg(voiced.map((r) => r * r))))
}

test('every line renders mono 22,050 Hz, −18 ± 1.5 dB voiced, peaks under 0.9, 1.0–4.5 s', SLOW, () => {
  const bad: string[] = []
  for (const voice of VOICE_NAMES) {
    LINES.forEach((line, i) => {
      const { wav, durationMs } = speak(voice, line, i * 7919 + 1)
      const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength), n = v.getUint32(40, true) / 2
      const head = [v.getUint16(20, true), v.getUint16(22, true), v.getUint32(24, true), v.getUint16(34, true), wav.length - 44 - n * 2]
      if (head.join() !== `1,1,${SR},16,0`) bad.push(`${voice} "${line}": header ${head}`)
      const x = new Float32Array(n)
      let peak = 0
      for (let j = 0; j < n; j++) (x[j] = v.getInt16(44 + j * 2, true) / 32767), (peak = Math.max(peak, Math.abs(x[j]!)))
      const s = n / SR, loud = voicedDb(x)
      if (Math.abs(durationMs - s * 1000) > 1) bad.push(`${voice} "${line}": durationMs ${durationMs} for ${s} s`)
      if (s < 1 || s > 4.5) bad.push(`${voice} "${line}": ${s.toFixed(2)} s`)
      if (peak >= 0.9) bad.push(`${voice} "${line}": peak ${peak.toFixed(3)}`)
      if (Math.abs(loud + 18) > 1.5) bad.push(`${voice} "${line}": ${loud.toFixed(1)} dB`)
    })
  }
  expect(bad).toEqual([])
})

test('sibilants sit 10–15 dB under stressed vowels', () => {
  // measure.js: the mean dB of the s, z and sh segments against that of the stressed vowels, on the words layer's timing. Take 1 is the parity take; there the approved spike reads mars 9.9 and cogitator 15.3, so the bounds carry the 0.5 dB the parity allows.
  const text = 'Tech heresy detected. Your sanction is required. A servitor awaits.', bad: string[] = []
  for (const voice of VOICE_NAMES) {
    const { samples: y, segments } = voiceSamples(voice, text, 1), fric: number[] = [], vow: number[] = []
    for (const s of segments) {
      const [a, b] = span(s, y.length)
      let e = 0
      for (let i = a; i < b; i++) e += y[i]! * y[i]!
      const d = 10 * Math.log10(e / (b - a) + 1e-12)
      if (s.kind === 'fric' && /^(s|z|sh)$/.test(s.phone ?? '')) fric.push(d)
      if (s.kind === 'vowel' && s.isAccent) vow.push(d)
    }
    const gap = avg(fric) - avg(vow)
    if (!(gap < -9.5 && gap > -15.5)) bad.push(`${voice}: sibilants ${gap.toFixed(2)} dB from the vowels`)
  }
  expect(bad).toEqual([])
})

test('bursts, breath and h peak under the vowels\' median peak', SLOW, () => {
  // transients.js: each segment's peak on the levelled pool, medians per kind.
  const bad: string[] = []
  for (const voice of VOICE_NAMES) {
    const peaks: Record<'vowel' | 'burst' | 'aspiration' | 'h', number[]> = { vowel: [], burst: [], aspiration: [], h: [] }
    for (const line of LINES) {
      const { samples, segments } = voiceSamples(voice, line, 1), y = level(samples)
      for (const s of segments) {
        const [a, b] = span(s, y.length)
        let pk = 0
        for (let i = a; i < b; i++) pk = Math.max(pk, Math.abs(y[i]!))
        if (s.kind === 'vowel' && s.isAccent) peaks.vowel.push(pk)
        if (s.kind === 'burst') peaks.burst.push(pk)
        if (s.kind === 'aspiration') peaks[s.phone === 'h' ? 'h' : 'aspiration'].push(pk)
      }
    }
    const vowel = median(peaks.vowel)
    for (const kind of ['burst', 'aspiration', 'h'] as const) {
      const over = db(median(peaks[kind])) - db(vowel)
      if (!(over < 0)) bad.push(`${voice}: ${kind} median peak ${over.toFixed(2)} dB over the vowels'`)
    }
  }
  expect(bad).toEqual([])
})

test('a take stays in its ranges over 200 seeds and two seeds differ', () => {
  const RANGES = { pitch: [0.91, 1.09], rate: [0.9, 1.1], stretch: [0.85, 1.2], decl: [0.04, 0.3], fscale: [0.96, 1.04], driftHz: [0.3, 1.2] }
  const out: string[] = []
  for (let seed = 1; seed <= 200; seed++) {
    const k = newTake(seed)
    expect(k.seed).toBe(seed)
    for (const [key, [lo, hi]] of Object.entries(RANGES)) {
      const v = k[key as keyof typeof RANGES]
      if (!(v >= lo! && v <= hi!)) out.push(`${seed} ${key} ${v}`)
    }
    if (!(k.driftPh >= 0 && k.driftPh <= 6.28)) out.push(`${seed} driftPh ${k.driftPh}`)
  }
  expect(out).toEqual([])
  expect(newTake(1)).toEqual(newTake(1))
  expect(newTake(1)).not.toEqual(newTake(2))
  const a = voiceSamples('claude', 'Rite concluded.', 1).samples, b = voiceSamples('claude', 'Rite concluded.', 2).samples
  expect(Array.from(voiceSamples('claude', 'Rite concluded.', 1).samples)).toEqual(Array.from(a))
  expect(a.length === b.length && a.every((v, i) => v === b[i])).toBe(false)
})

test('a WAV scales only when its header is 22,050 Hz mono 16-bit PCM', () => {
  const wav = toWav(new Float32Array([0.5, -0.5, 0.25]))
  const pcm = (w: Uint8Array) => [0, 1, 2].map((i) => new DataView(w.buffer, w.byteOffset).getInt16(44 + i * 2, true))
  expect(pcm(wav)).toEqual([16383, -16383, 8191])
  expect(Array.from(scaleWav(wav, 2)!.subarray(0, 44))).toEqual(Array.from(wav.subarray(0, 44)))
  expect(pcm(scaleWav(wav, 2)!)).toEqual([32766, -32766, 16382])
  expect(pcm(scaleWav(wav, 4)!)).toEqual([32767, -32768, 32764])
  const stereo = wav.slice()
  stereo[22] = 2
  expect(scaleWav(stereo, 0.5)).toBe(null)
  expect(scaleWav(wav.subarray(0, 40), 0.5)).toBe(null)
})

test('render CPU stays under the limits with CI slack', SLOW, () => {
  // Wall time per line, three times the Resources limits (50 ms warm, 150 ms cold): mean under 150 ms, any line under 450 ms.
  const ms: number[] = []
  for (const voice of VOICE_NAMES) {
    for (const line of LINES) {
      const t0 = Date.now()
      speak(voice, line, 1)
      ms.push(Date.now() - t0)
    }
  }
  expect(avg(ms)).toBeLessThan(150)
  expect(Math.max(...ms)).toBeLessThan(450)
})
