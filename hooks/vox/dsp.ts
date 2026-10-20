// The voices' effects, each exactly as tuned in the prototype, and the WAV writer. Float32Array in and out; every stage returns a new array except fade, which works in place as the prototype's did.

import { SR } from './synth'

// 2nd-order RBJ low- or high-pass, Q 0.707. y1 and y2 keep the full precision; only the output is rounded to float.
function rbj(x: Float32Array, isLow: boolean, f: number): Float32Array {
  const w = (2 * Math.PI * f) / SR, c = Math.cos(w), a = Math.sin(w) / (2 * 0.707)
  const b0 = isLow ? (1 - c) / 2 : (1 + c) / 2, b1 = isLow ? 1 - c : -(1 + c), b2 = b0
  const a0 = 1 + a, a1 = -2 * c, a2 = 1 - a
  const y = new Float32Array(x.length)
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i]! + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0
    x2 = x1, x1 = x[i]!, y2 = y1, y1 = v, y[i] = v
  }
  return y
}
export const lowpass = (x: Float32Array, f: number) => rbj(x, true, f)
export const highpass = (x: Float32Array, f: number) => rbj(x, false, f)
export const bandpass = (x: Float32Array, lo: number, hi: number) => lowpass(highpass(x, lo), hi)
// 4th order, last in every chain, so nothing sharp reaches the ear.
export const tame = (x: Float32Array, f: number) => lowpass(lowpass(x, f), f)

export function ringmod(x: Float32Array, hz: number, wet: number): Float32Array {
  const y = new Float32Array(x.length)
  for (let i = 0; i < x.length; i++) y[i] = x[i]! * (1 - wet + wet * Math.sin((2 * Math.PI * hz * i) / SR))
  return y
}

// Quantize to `bits`, sample-and-hold down to `holdHz`.
export function crush(x: Float32Array, bits: number, holdHz: number): Float32Array {
  const q = Math.pow(2, bits - 1), step = SR / holdHz, y = new Float32Array(x.length)
  let held = 0, acc = step
  for (let i = 0; i < x.length; i++) {
    if (acc >= step) (held = Math.round(x[i]! * q) / q), (acc -= step)
    acc++
    y[i] = held
  }
  return y
}

export function drive(x: Float32Array, k: number): Float32Array {
  const y = new Float32Array(x.length), n = Math.tanh(k)
  for (let i = 0; i < x.length; i++) y[i] = Math.tanh(k * x[i]!) / n
  return y
}

// Short feedback comb: the metal tube, the vox grille.
export function comb(x: Float32Array, ms: number, fb: number): Float32Array {
  const d = Math.round((SR * ms) / 1000), y = new Float32Array(x.length)
  for (let i = 0; i < x.length; i++) y[i] = x[i]! + (i >= d ? fb * y[i - d]! : 0)
  return y
}

export function flanger(x: Float32Array, depthMs: number, rateHz: number, fb: number): Float32Array {
  const y = new Float32Array(x.length), max = Math.ceil((SR * (depthMs + 1)) / 1000)
  for (let i = 0; i < x.length; i++) {
    const d = ((1 + depthMs * (0.5 + 0.5 * Math.sin((2 * Math.PI * rateHz * i) / SR))) * SR) / 1000
    const j = i - d, j0 = Math.floor(j), fr = j - j0
    const del = j0 >= 1 ? y[j0]! * (1 - fr) + y[j0 + 1]! * fr : 0
    y[i] = i < max ? x[i]! : x[i]! + fb * del
  }
  return y
}

// Grille hiss, band-limited and gated by a 60 ms peak follower so it breathes with the words. The follower is rounded to float where it is used, as the spike's Float32Array envelope was.
export function hiss(x: Float32Array, gain: number, lo: number, hi: number): Float32Array {
  let s = 7
  const n = new Float32Array(x.length)
  for (let i = 0; i < x.length; i++) n[i] = ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1
  const b = bandpass(n, lo, hi), a = Math.exp(-1 / ((SR * 60) / 1000)), y = new Float32Array(x.length)
  let e = 0
  for (let i = 0; i < x.length; i++) {
    e = Math.max(Math.abs(x[i]!), e * a)
    y[i] = x[i]! + b[i]! * gain * (0.25 + Math.fround(e))
  }
  return y
}

// [signal, gain] pairs, as long as the longest.
export function mix(...parts: [Float32Array, number][]): Float32Array {
  const y = new Float32Array(Math.max(...parts.map(([s]) => s.length)))
  for (const [s, g] of parts) for (let i = 0; i < s.length; i++) y[i]! += s[i]! * g
  return y
}

// Loudness, not peak: the voiced 20 ms windows to targetDb RMS, then a soft knee keeps every peak under the ceiling. Peak-normalizing let one sharp transient turn a whole line down (a 15 dB spread between lines).
export function level(x: Float32Array, targetDb = -18, knee = 0.6, ceiling = 0.9): Float32Array {
  const win = Math.round(SR * 0.02), rms: number[] = []
  for (let i = 0; i + win <= x.length; i += win) {
    let e = 0
    for (let j = i; j < i + win; j++) e += x[j]! * x[j]!
    rms.push(Math.sqrt(e / win))
  }
  const top = Math.max(...rms), voiced = rms.filter((r) => r > top * 0.05)
  const now = Math.sqrt(voiced.reduce((a, r) => a + r * r, 0) / voiced.length)
  const g = now > 0 ? Math.pow(10, targetDb / 20) / now : 1, span = ceiling - knee, y = new Float32Array(x.length)
  for (let i = 0; i < x.length; i++) {
    const v = x[i]! * g, a = Math.abs(v)
    y[i] = a <= knee ? v : Math.sign(v) * (knee + span * Math.tanh((a - knee) / span))
  }
  return y
}

export function fade(x: Float32Array, ms = 15): Float32Array {
  const n = Math.round((SR * ms) / 1000)
  for (let i = 0; i < n && i < x.length; i++) (x[i]! *= i / n), (x[x.length - 1 - i]! *= i / n)
  return x
}

// 22,050 Hz mono 16-bit PCM behind a 44-byte header, as formant-tts's toWav wrote it.
export function toWav(x: Float32Array): Uint8Array {
  const bytes = new Uint8Array(44 + x.length * 2), v = new DataView(bytes.buffer)
  const str = (at: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i)) }
  str(0, 'RIFF'), v.setUint32(4, 36 + x.length * 2, true), str(8, 'WAVE')
  str(12, 'fmt '), v.setUint32(16, 16, true), v.setUint16(20, 1, true), v.setUint16(22, 1, true)
  v.setUint32(24, SR, true), v.setUint32(28, SR * 2, true), v.setUint16(32, 2, true), v.setUint16(34, 16, true)
  str(36, 'data'), v.setUint32(40, x.length * 2, true)
  for (let i = 0; i < x.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x[i]!)) * 32767, true)
  return bytes
}

// A copy with its samples times gain; null unless the header is toWav's own (the clips and the lines both are).
export function scaleWav(wav: Uint8Array, gain: number): Uint8Array | null {
  if (wav.length < 44) return null
  const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
  const tag = (at: number) => String.fromCharCode(...wav.subarray(at, at + 4))
  const n = v.getUint32(40, true)
  const isOurs = tag(0) === 'RIFF' && tag(8) === 'WAVE' && tag(12) === 'fmt ' && tag(36) === 'data' && v.getUint32(16, true) === 16 &&
    v.getUint16(20, true) === 1 && v.getUint16(22, true) === 1 && v.getUint32(24, true) === SR && v.getUint16(34, true) === 16 && 44 + n <= wav.length
  if (!isOurs) return null
  const out = wav.slice(), o = new DataView(out.buffer)
  for (let i = 44; i + 1 < 44 + n; i += 2) o.setInt16(i, Math.max(-32768, Math.min(32767, Math.round(v.getInt16(i, true) * gain))), true)
  return out
}
