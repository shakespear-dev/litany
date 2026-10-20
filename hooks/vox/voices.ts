// The four voices, one per theme, and the takes that make each utterance a little different. Every value was tuned by ear in a prototype before the mod was built.

import { bandpass, comb, crush, drive, fade, flanger, hiss, level, lowpass, mix, ringmod, tame, toWav } from './dsp'
import { mulberry32, type Segment, SR, synth, type SynthOptions } from './synth'

export type VoiceName = 'mars' | 'cogitator' | 'forge' | 'claude'
export const VOICE_NAMES: readonly VoiceName[] = ['mars', 'cogitator', 'forge', 'claude']

// One random variation per utterance, shared by every layer of its voice so the layers stay sample-aligned.
export type Take = { seed: number; pitch: number; rate: number; stretch: number; decl: number; fscale: number; driftHz: number; driftPh: number }

export function newTake(seed: number): Take {
  const r = mulberry32(seed), u = (lo: number, hi: number) => lo + (hi - lo) * r()
  return { seed, pitch: u(0.91, 1.09), rate: u(0.9, 1.1), stretch: u(0.85, 1.2), decl: u(0.04, 0.3), fscale: u(0.96, 1.04), driftHz: u(0.3, 1.2), driftPh: u(0, 6.28) }
}

// A layer's options before the take; the take scales them. Each render draws the stressed syllables afresh from the same seed, so every layer gets the same lifts and lengths.
type Layer = Omit<SynthOptions, 'seed' | 'syl' | 'decl' | 'finalStretch' | 'commaStretch' | 'block'>

function render(text: string, k: Take, o: Layer, block: number | undefined) {
  const r = mulberry32(k.seed ^ 0x9e3779b9), base = o.f0mod
  return synth(text, {
    ...o,
    pitch: o.pitch * k.pitch, rate: (o.rate || 1) * k.rate, finalStretch: 1.6 * k.stretch, commaStretch: 1.25 * k.stretch,
    seed: k.seed, decl: k.decl, fscale: k.fscale * (o.fscale || 1),
    syl: () => ({ lift: 1.03 + 0.2 * r(), len: 0.85 + 0.33 * r() }),
    f0mod: (t) => (base ? base(t) : 1) * (1 + 0.03 * Math.sin((2 * Math.PI * k.driftHz * t) / 1000 + k.driftPh)),
    block,
  })
}

const st = (n: number) => Math.pow(2, n / 12)
const wobble = (hz: number, semis: number) => (t: number) => st(semis * Math.sin((2 * Math.PI * hz * t) / 1000))

// Each voice renders its layers through `say`, the words first, and returns them mixed to mono.
const VOICES: Record<VoiceName, (say: (o: Layer) => Float32Array) => Float32Array> = {
  // A chanting tech-priest through a vox-horn: semitone steps, a choir of the words, an octave below and a quiet fifth above (only the words hiss; at 74 Hz the vowels carry less, so their hiss comes down too), a hint of 30 Hz ring, a brass horn.
  mars: (say) => {
    const o = { rate: 1.15, fscale: 0.89, quant: 1, fricGain: 0.046 }
    const a = say({ ...o, pitch: 74 }), sub = say({ ...o, pitch: 74 / st(12), fricGain: 0 }), fifth = say({ ...o, pitch: 74 * st(7), fricGain: 0 })
    const choir = mix([a, 0.8], [lowpass(drive(lowpass(sub, 1400), 1.6), 1800), 0.6], [bandpass(fifth, 300, 2600), 0.22])
    const horn = bandpass(crush(ringmod(choir, 30, 0.25), 10, 16000), 150, 3600)
    return tame(comb(hiss(horn, 0.015, 900, 2800), 4.5, 0.45), 3600)
  },
  // The console's machine-spirit, a mechanical woman: a short tract, minor-third steps, the mouth stepping every 25 ms, a firm buzz, 9-bit at 11 kHz out of a small tinny speaker.
  cogitator: (say) => {
    const a = say({ pitch: 205, rate: 1.2, fscale: 1.17, quant: 3, hold: 5, tp: 0.3, tn: 0.08, fricGain: 0.17 })
    return tame(comb(bandpass(crush(a, 9, 11025), 350, 3800), 2, 0.22), 3800)
  },
  // An ancient, unstable engine: a 2 Hz wobble, ring-modulated words over an overdriven, flanged twin a fifth down (which flattens the vowels, so the breath comes down further).
  forge: (say) => {
    const o = { rate: 1.0, f0mod: wobble(2, 0.8), aspGain: 0.15 }
    const a = say({ ...o, pitch: 72 }), b = say({ ...o, pitch: 72 / st(7) })
    const A = bandpass(ringmod(a, 52, 0.45), 120, 2800)
    const B = lowpass(flanger(drive(lowpass(b, 1800), 3.5), 3, 0.35, 0.55), 2200)
    return tame(comb(hiss(mix([A, 0.6], [B, 0.7]), 0.025, 600, 2500), 9, 0.4), 3200)
  },
  // The clean one: a light band-limit and a faint metal ring, words first.
  claude: (say) => tame(comb(bandpass(say({ pitch: 112, rate: 1.17 }), 180, 5200), 4, 0.22), 4500),
}

// Every layer of the voice under one take, mixed, before levelling; the segments are the words layer's.
export function voiceSamples(voice: VoiceName, text: string, seed: number, block?: number): { samples: Float32Array; segments: Segment[] } {
  const k = newTake(seed)
  let segments: Segment[] | undefined
  const samples = VOICES[voice]((o) => {
    const r = render(text, k, o, block)
    segments ??= r.segments
    return r.samples
  })
  return { samples, segments: segments! }
}

// A line ready to play: levelled by loudness, faded, at `gain` (the volumes' share, after the levelling).
export function speak(voice: VoiceName, text: string, seed: number, gain = 1): { wav: Uint8Array; durationMs: number } {
  const x = fade(level(voiceSamples(voice, text, seed).samples))
  if (gain !== 1) for (let i = 0; i < x.length; i++) x[i]! *= gain
  return { wav: toWav(x), durationMs: Math.round((x.length * 1000) / SR) }
}
