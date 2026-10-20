// Klatt-style cascade formant synthesizer: English text to 22,050 Hz mono samples and their timed segments. Derived from formant-tts, https://github.com/PrakharSaxena24/formant-tts, tts.js at commit 87261ce6f322048903d17b1064a2605f9ea7aa37. MIT licensed. formant-tts's notice: "MIT licensed. No dependencies, no build step, no network access." Cut down to the English path (no Japanese, no browser playback, no WAV), with the fixes the spike heard: frication after the radiation stage under its own gain, breath under its own gain, softer sibilants and bursts, phrase-final lengthening, per-syllable lift and length, and the voices' pitch, tract and pulse controls.

import { type Token, tokenize } from './lexicon'

export const SR = 22050
const FRAME_MS = 5
const FRAME_LEN = Math.round((SR * FRAME_MS) / 1000)
// Segment times are in frame ms: formant-tts's 5 ms frame is 110 samples (not 110.25), so 1 ms is 22 samples. A segment spans samples [startMs * SAMPLES_PER_MS, (startMs + durMs) * SAMPLES_PER_MS); SR / 1000 would drift ~7 ms by a line's end.
export const SAMPLES_PER_MS = FRAME_LEN / FRAME_MS

// A stretch of the utterance, timed in frame ms (× SAMPLES_PER_MS for samples): a vowel's phone is its ARPAbet id without the stress digit, and isAccent marks the stressed ones.
export type Segment = { kind: 'pause' | 'vowel' | 'closure' | 'burst' | 'aspiration' | 'fric' | 'nasal' | 'glide'; phone?: string; startMs: number; durMs: number; isAccent?: boolean }

// pitch in Hz, rate, the noise seed, the frication and breath gains, the final and comma lengthening; declination, a formant scale, pitch steps in semitones, a tract hold in frames, the glottal pulse's opening and closing fractions; a pitch curve over ms, the stressed vowels' lift and length; and the samples per coefficient update (1 is formant-tts's per sample).
export type SynthOptions = {
  pitch: number; rate?: number; seed?: number; fricGain?: number; aspGain?: number; finalStretch?: number; commaStretch?: number
  decl?: number; fscale?: number; quant?: number; hold?: number; tp?: number; tn?: number
  f0mod?: (ms: number) => number; syl?: () => { lift: number; len: number }; block?: number
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

// Two-pole resonator, unity gain at DC (Klatt): y[n] = a x[n] + b y[n-1] + c y[n-2].
class Resonator {
  y1 = 0
  y2 = 0
  a = 1
  b = 0
  c = 0
  set(freq: number, bw: number) {
    const r = Math.exp((-Math.PI * bw) / SR)
    this.c = -r * r
    this.b = 2 * r * Math.cos((2 * Math.PI * freq) / SR)
    this.a = 1 - this.b - this.c
  }
  run(x: number) {
    const y = this.a * x + this.b * this.y1 + this.c * this.y2
    this.y2 = this.y1
    this.y1 = y
    return y
  }
}

// A zero pair, the nasal notch.
class AntiResonator {
  x1 = 0
  x2 = 0
  a = 1
  b = 0
  c = 0
  set(freq: number, bw: number) {
    const r = Math.exp((-Math.PI * bw) / SR)
    const c = -r * r, b = 2 * r * Math.cos((2 * Math.PI * freq) / SR), a = 1 - b - c
    this.a = 1 / a
    this.b = -b / a
    this.c = -c / a
  }
  run(x: number) {
    const y = this.a * x + this.b * this.x1 + this.c * this.x2
    this.x2 = this.x1
    this.x1 = x
    return y
  }
}

type Formants = readonly number[]
// Diphthongs carry a second target `g`; the frames glide between the two.
const VOWELS: Record<string, { f: Formants; g?: Formants }> = {
  iy: { f: [280, 2250, 2890, 3400, 4500] },
  ih: { f: [400, 1920, 2560, 3400, 4500] },
  eh: { f: [550, 1770, 2490, 3400, 4500] },
  ae: { f: [690, 1660, 2490, 3400, 4500] },
  aa: { f: [730, 1090, 2440, 3400, 4500] },
  ao: { f: [570, 840, 2410, 3400, 4500] },
  uh: { f: [440, 1020, 2240, 3400, 4500] },
  uw: { f: [310, 870, 2250, 3400, 4500] },
  ah: { f: [640, 1190, 2390, 3400, 4500] },
  ax: { f: [500, 1500, 2500, 3400, 4500] },
  er: { f: [490, 1350, 1690, 3400, 4500] },
  ey: { f: [480, 1800, 2530, 3400, 4500], g: [340, 2200, 2800, 3400, 4500] },
  ay: { f: [730, 1090, 2440, 3400, 4500], g: [320, 2150, 2800, 3400, 4500] },
  oy: { f: [570, 840, 2410, 3400, 4500], g: [330, 2100, 2800, 3400, 4500] },
  aw: { f: [730, 1090, 2440, 3400, 4500], g: [330, 900, 2300, 3400, 4500] },
  ow: { f: [500, 900, 2500, 3400, 4500], g: [360, 800, 2400, 3400, 4500] },
}

// Consonant place: the formant locus the neighbouring vowel moves out of.
const PLACE: Record<string, Formants> = {
  labial: [250, 800, 2100, 3300, 4500],
  labiodental: [280, 1100, 2300, 3300, 4500],
  dental: [300, 1600, 2600, 3400, 4500],
  alveolar: [300, 1750, 2600, 3400, 4500],
  palatal: [280, 2100, 2900, 3500, 4600],
  velarFront: [300, 2050, 2450, 3400, 4500],
  velarBack: [300, 1150, 2200, 3300, 4500],
  lateral: [360, 1300, 2700, 3400, 4500],
  retroflex: [310, 1060, 1380, 3300, 4500],
  nasalLabial: [250, 900, 2100, 3300, 4500],
  nasalAlveolar: [250, 1600, 2600, 3400, 4500],
  nasalVelar: [250, 1200, 2300, 3300, 4500],
}

type Noise = { f: number; bw: number; amp: number }
type Cons = { manner: 'stop' | 'fric' | 'affr' | 'asp' | 'nasal' | 'glide'; voiced: boolean; place: string; vot?: number; burst?: Noise; noise?: Noise; zero?: number }
// formant-tts's English consonants, with the spike's levels: noise amps cut (the raw "s" sat 15 dB over the vowels), t k p bursts at 0.3 of formant-tts's and d g b at 0.5.
const CONS: Record<string, Cons> = {
  p: { manner: 'stop', voiced: false, place: 'labial', vot: 48, burst: { f: 900, bw: 1200, amp: 0.12 } },
  b: { manner: 'stop', voiced: true, place: 'labial', vot: 12, burst: { f: 850, bw: 1200, amp: 0.125 } },
  t: { manner: 'stop', voiced: false, place: 'alveolar', vot: 52, burst: { f: 3800, bw: 1200, amp: 0.165 } },
  d: { manner: 'stop', voiced: true, place: 'alveolar', vot: 14, burst: { f: 3600, bw: 1200, amp: 0.15 } },
  k: { manner: 'stop', voiced: false, place: 'velar', vot: 58, burst: { f: 2100, bw: 1000, amp: 0.15 } },
  g: { manner: 'stop', voiced: true, place: 'velar', vot: 16, burst: { f: 2000, bw: 1000, amp: 0.14 } },
  f: { manner: 'fric', voiced: false, place: 'labiodental', noise: { f: 4200, bw: 2200, amp: 0.12 } },
  v: { manner: 'fric', voiced: true, place: 'labiodental', noise: { f: 3800, bw: 2200, amp: 0.07 } },
  th: { manner: 'fric', voiced: false, place: 'dental', noise: { f: 5600, bw: 2400, amp: 0.09 } },
  dh: { manner: 'fric', voiced: true, place: 'dental', noise: { f: 4600, bw: 2400, amp: 0.05 } },
  s: { manner: 'fric', voiced: false, place: 'alveolar', noise: { f: 6200, bw: 1100, amp: 0.16 } },
  z: { manner: 'fric', voiced: true, place: 'alveolar', noise: { f: 5200, bw: 1200, amp: 0.09 } },
  sh: { manner: 'fric', voiced: false, place: 'palatal', noise: { f: 2900, bw: 900, amp: 0.2 } },
  zh: { manner: 'fric', voiced: true, place: 'palatal', noise: { f: 2650, bw: 900, amp: 0.1 } },
  h: { manner: 'asp', voiced: false, place: 'vowelish' },
  ch: { manner: 'affr', voiced: false, place: 'palatal', noise: { f: 3000, bw: 900, amp: 0.22 } },
  jh: { manner: 'affr', voiced: true, place: 'palatal', noise: { f: 2700, bw: 900, amp: 0.12 } },
  m: { manner: 'nasal', voiced: true, place: 'nasalLabial', zero: 1000 },
  n: { manner: 'nasal', voiced: true, place: 'nasalAlveolar', zero: 1600 },
  ng: { manner: 'nasal', voiced: true, place: 'nasalVelar', zero: 2000 },
  l: { manner: 'glide', voiced: true, place: 'lateral' },
  r: { manner: 'glide', voiced: true, place: 'retroflex' },
  w: { manner: 'glide', voiced: true, place: 'labial' },
  y: { manner: 'glide', voiced: true, place: 'palatal' },
}

const isVowel = (ph: string) => /[01]$/.test(ph)
const vowelId = (ph: string) => ph.replace(/[01]$/, '')

function locus(def: Cons, ctx: string): Formants {
  if (def.place === 'velar') return ['iy', 'ih', 'ey', 'eh', 'ae'].includes(ctx) ? PLACE.velarFront! : PLACE.velarBack!
  if (def.place === 'vowelish') return (VOWELS[ctx] ?? VOWELS.ah!).f
  return PLACE[def.place] ?? PLACE.alveolar!
}

// formant-tts's segment: the public one plus what the frames need (consonant, formant targets, pitch lift, pause kind).
type Seg = {
  kind: Segment['kind']; dur: number; startMs: number; phone?: string; def?: Cons; f?: Formants; g?: Formants
  accent?: boolean; lift?: number; voiced?: boolean; zero?: number; terminal?: boolean; question?: boolean
}

function segmentsOf(tokens: Token[], o: SynthOptions): Seg[] {
  const rate = o.rate || 1, final = o.finalStretch ?? 1.6, comma = o.commaStretch ?? 1.25
  const segs: Seg[] = [{ kind: 'pause', dur: 60, startMs: 0 }]
  const push = (s: Omit<Seg, 'startMs'>) => segs.push({ ...s, startMs: 0 })
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!
    if ('pause' in tok) {
      push({ kind: 'pause', dur: tok.pause / rate, terminal: !!tok.isTerminal, question: !!tok.isQuestion })
      continue
    }
    // Phrase-final lengthening: the stressed vowel of the last word before a stop (or, less, a comma) is held longer.
    let stretch = 1, q = i + 1
    for (; q < tokens.length; q++) {
      const next = tokens[q]!
      if ('word' in next) break
      if (next.pause > 26) {
        stretch = next.isTerminal ? final : comma
        break
      }
    }
    if (q >= tokens.length) stretch = final
    const ph = tok.phones
    for (let j = 0; j < ph.length; j++) {
      const t = ph[j]!
      if (isVowel(t)) {
        const id = vowelId(t), stressed = t.endsWith('1'), spec = VOWELS[id] ?? VOWELS.ax!
        const dur = ((stressed ? 148 : id === 'ax' ? 58 : 80) + (spec.g ? 45 : 0)) * (stressed ? stretch : 1)
        // Every vowel draws, so a take's draws stay in step whatever the stress pattern.
        const sv = o.syl ? o.syl() : { lift: 1.1, len: 1 }
        push({ kind: 'vowel', phone: id, f: spec.f, g: spec.g, accent: stressed, lift: sv.lift, dur: (dur * (stressed ? sv.len : 1)) / rate })
        continue
      }
      const def = CONS[t]
      if (!def) continue
      // Context vowel: the next vowel in the word, else the previous one.
      let ctx = 'ah'
      for (let k = j + 1; k < ph.length; k++) if (isVowel(ph[k]!)) { ctx = vowelId(ph[k]!); break }
      if (ctx === 'ah') for (let k = j - 1; k >= 0; k--) if (isVowel(ph[k]!)) { ctx = vowelId(ph[k]!); break }
      const f = locus(def, ctx), c = { phone: t, def, f }
      if (def.manner === 'stop') {
        push({ kind: 'closure', dur: (def.voiced ? 45 : 52) / rate, voiced: def.voiced, ...c })
        push({ kind: 'burst', dur: 8 / rate, ...c })
        push({ kind: 'aspiration', dur: def.vot! / rate, ...c })
      } else if (def.manner === 'fric') {
        push({ kind: 'fric', dur: (t === 's' || t === 'z' || t === 'sh' || t === 'zh' ? 95 : 68) / rate, ...c })
      } else if (def.manner === 'affr') {
        push({ kind: 'closure', dur: 40 / rate, voiced: def.voiced, ...c })
        push({ kind: 'fric', dur: 55 / rate, ...c })
      } else if (def.manner === 'asp') push({ kind: 'aspiration', dur: 55 / rate, ...c })
      else if (def.manner === 'nasal') push({ kind: 'nasal', dur: 68 / rate, zero: def.zero, ...c })
      else push({ kind: 'glide', dur: 60 / rate, ...c })
    }
  }
  push({ kind: 'pause', dur: 130, terminal: true })
  return segs
}

type Frame = { f0: number; av: number; ah: number; af: number; F: Formants; nasal: number; zero: number; noiseF: number; noiseBW: number }
type Knot = { t: number; f: Formants; nasal: number; zero: number }

// Formant knots per segment, linearly interpolated: the consonant-vowel transitions, not isolated steady states.
function framesOf(segs: Seg[], o: SynthOptions): Frame[] {
  let total = 0
  for (const s of segs) (s.startMs = total), (total += s.dur)
  const knots: Knot[] = []
  for (const s of segs) {
    if (!s.f) continue
    const nasal = s.kind === 'nasal' ? 1 : 0, zero = s.zero || 0
    if (s.g) {
      knots.push({ t: s.startMs + s.dur * 0.25, f: s.f, nasal, zero })
      knots.push({ t: s.startMs + s.dur * 0.88, f: s.g, nasal, zero })
    } else knots.push({ t: s.startMs + s.dur / 2, f: s.f, nasal, zero })
  }
  if (!knots.length) knots.push({ t: 0, f: [750, 1200, 2550, 3400, 4500], nasal: 0, zero: 0 }) // no words: formant-tts's open "a"
  const first = knots[0]!, last = knots[knots.length - 1]!
  const knotAt = (t: number): Knot => {
    if (t <= first.t) return first
    if (t >= last.t) return last
    for (let k = 0; k < knots.length - 1; k++) {
      const a = knots[k]!, b = knots[k + 1]!
      if (t >= a.t && t <= b.t) {
        const p = (t - a.t) / (b.t - a.t || 1), f: number[] = []
        for (let n = 0; n < 5; n++) f[n] = lerp(a.f[n]!, b.f[n]!, p)
        return { t, f, nasal: lerp(a.nasal, b.nasal, p), zero: a.zero || b.zero || 0 }
      }
    }
    return last
  }

  const base = o.pitch || 118, decl = o.decl ?? 0.16, frames: Frame[] = []
  const count = Math.max(1, Math.ceil(total / FRAME_MS))
  let si = 0
  for (let fi = 0; fi < count; fi++) {
    const t = fi * FRAME_MS
    while (si < segs.length - 1 && t >= segs[si]!.startMs + segs[si]!.dur) si++
    const seg = segs[si]!, pos = seg.dur ? (t - seg.startMs) / seg.dur : 0, k = knotAt(t)

    let f0 = base * (1 - decl * (t / total))
    if (seg.accent) f0 *= seg.lift || 1.1
    if (seg.question) f0 *= 1.25
    if (seg.terminal && !seg.question) f0 *= 0.86
    f0 *= 1 + 0.012 * Math.sin(t / 190)
    if (o.f0mod) f0 *= o.f0mod(t)
    if (o.quant) f0 = base * Math.pow(2, (Math.round((12 * Math.log2(f0 / base)) / o.quant) * o.quant) / 12)

    let av = 0, ah = 0, af = 0, noise: Noise | undefined
    const def = seg.def
    if (seg.kind === 'vowel') av = 1
    else if (seg.kind === 'glide') av = 0.85
    else if (seg.kind === 'nasal') av = 0.72
    else if (seg.kind === 'closure') av = seg.voiced ? 0.12 : 0
    else if (seg.kind === 'burst') (noise = def?.burst), (af = noise ? noise.amp : 0.4), (av = def?.voiced ? 0.2 : 0)
    else if (seg.kind === 'aspiration') (ah = seg.phone === 'h' ? 0.5 : 0.34), (av = def?.voiced ? 0.35 : 0)
    else if (seg.kind === 'fric') (noise = def?.noise ?? { f: 5000, bw: 1200, amp: 0.4 }), (af = noise.amp), (av = def?.voiced ? 0.4 : 0)
    // Edge tapers stop clicks at the joins.
    if (seg.kind === 'vowel') av *= Math.min(1, clamp(pos / 0.12, 0, 1)) * Math.min(1, clamp((1 - pos) / 0.16, 0, 1)) * 0.85 + 0.15

    const fs = o.fscale
    frames.push({
      f0, av, ah, af,
      F: fs ? k.f.map((v) => v * fs) : k.f,
      nasal: k.nasal, zero: k.zero,
      noiseF: noise ? noise.f : 0, noiseBW: noise ? noise.bw : 1000,
    })
  }
  return frames
}

const BW = [90, 110, 170, 250, 300]

function samplesOf(frames: Frame[], o: SynthOptions): Float32Array {
  const rnd = mulberry32(o.seed || 20260802)
  const out = new Float32Array(frames.length * FRAME_LEN)
  const cascade = BW.map(() => new Resonator())
  const nasalPole = new Resonator(), nasalZero = new AntiResonator(), fricRes = new Resonator()
  const tp = o.tp || 0.42, tn = o.tn || 0.18, fricGain = o.fricGain ?? 0.09, aspGain = o.aspGain ?? 0.22, hold = o.hold || 0
  const block = Math.max(1, Math.round(o.block ?? 32))
  let phase = 0, prevOut = 0, dcX = 0, dcY = 0, idx = 0
  nasalPole.set(270, 120)
  for (let fi = 0; fi < frames.length; fi++) {
    // A held tract steps every `hold` frames with no glide between.
    const cur = frames[hold ? fi - (fi % hold) : fi]!, nxt = hold ? cur : frames[Math.min(fi + 1, frames.length - 1)]!
    // The nasal zero and the frication filter depend on the frame alone, so one set per frame equals formant-tts's per-sample one.
    nasalZero.set(cur.zero || nxt.zero || 1500, 250)
    fricRes.set(cur.noiseF || nxt.noiseF || 4000, cur.noiseBW || 1000)
    for (let s = 0; s < FRAME_LEN; s++) {
      const p = s / FRAME_LEN
      const f0 = lerp(cur.f0, nxt.f0, p), av = lerp(cur.av, nxt.av, p), ah = lerp(cur.ah, nxt.ah, p), af = lerp(cur.af, nxt.af, p)
      const nasalAmt = lerp(cur.nasal, nxt.nasal, p)
      // The tract's coefficients (ten exp and cos) once per block, taken at its middle; block 1 is formant-tts's per sample.
      if (s % block === 0) {
        const pc = (s + (Math.min(block, FRAME_LEN - s) - 1) / 2) / FRAME_LEN, widen = 1 + 0.6 * lerp(cur.nasal, nxt.nasal, pc)
        for (let r = 0; r < 5; r++) cascade[r]!.set(lerp(cur.F[r]!, nxt.F[r]!, pc), BW[r]! * widen)
      }

      // Rosenberg glottal pulse with light jitter.
      phase += (f0 * (1 + (rnd() - 0.5) * 0.008)) / SR
      if (phase >= 1) phase -= 1
      let g = 0
      if (phase < tp) g = 0.5 * (1 - Math.cos((Math.PI * phase) / tp))
      else if (phase < tp + tn) g = Math.cos((Math.PI * (phase - tp)) / (2 * tn))

      const white = rnd() * 2 - 1
      let y = g * av + white * ah * 0.5 * aspGain
      for (let c = 0; c < 5; c++) y = cascade[c]!.run(y)
      if (nasalAmt > 0.01) y = lerp(y, nasalZero.run(nasalPole.run(y)) * 1.4, nasalAmt)

      // Frication joins after the radiation stage: before it, the noise took the +6 dB/oct lip tilt.
      const fric = af > 0.001 ? fricRes.run(white) * af * 0.9 * fricGain : 0
      const radiated = y - prevOut * 0.94 + fric
      prevOut = y
      dcY = 0.995 * (dcY + radiated - dcX)
      dcX = radiated
      out[idx++] = dcY
    }
  }
  let peak = 0
  for (const v of out) if (Math.abs(v) > peak) peak = Math.abs(v)
  const gain = peak > 0 ? 0.82 / peak : 1
  for (let i = 0; i < out.length; i++) out[i] = clamp(out[i]! * gain, -1, 1)
  return out
}

export function synth(text: string, o: SynthOptions): { samples: Float32Array; segments: Segment[] } {
  const segs = segmentsOf(tokenize(text), o)
  const samples = samplesOf(framesOf(segs, o), o)
  const segments = segs.map(
    (s): Segment => ({ kind: s.kind, phone: s.phone, startMs: s.startMs, durMs: s.dur, ...(s.kind === 'vowel' ? { isAccent: !!s.accent } : {}) }),
  )
  return { samples, segments }
}
