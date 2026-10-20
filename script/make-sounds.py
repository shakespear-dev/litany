"""Synthesize the seven clips with the Python standard library only.

Run from anywhere: python3 -I script/make-sounds.py
"""
import math
import pathlib
import random
import struct
import wave

RATE = 22050
OUT = pathlib.Path(__file__).resolve().parent.parent / "sounds"


def tone(freq, secs, shape="sine", vol=0.35):
    n = int(RATE * secs)
    out = []
    for i in range(n):
        phase = (freq * i / RATE) % 1.0
        s = math.sin(2 * math.pi * phase) if shape == "sine" else (1.0 if phase < 0.5 else -1.0)
        # 10 ms attack and 20 ms release, so no clip starts or ends with a click
        env = min(1.0, i / (RATE * 0.01), (n - i) / (RATE * 0.02))
        out.append(s * vol * env)
    return out


def chord(freqs, secs, vol=0.35):
    voices = [tone(f, secs, "sine", vol / len(freqs)) for f in freqs]
    return [sum(v) for v in zip(*voices)]


def silence(secs):
    return [0.0] * int(RATE * secs)


def binharic(byte, hi=1760, lo=880, step=0.045, vol=0.12, gap=0.01):
    """Eight square-wave chirps, high for a 1 bit and low for a 0 bit."""
    out = []
    for bit in f"{byte:08b}":
        out += tone(hi if bit == "1" else lo, step, "square", vol) + silence(gap)
    return out


def noise(secs, vol, seed, levels=0):
    """Seeded white noise (same WAV on every run); levels > 0 crushes it to that many steps."""
    rng = random.Random(seed)
    n = int(RATE * secs)
    out = []
    for i in range(n):
        s = rng.uniform(-1.0, 1.0)
        if levels:
            s = round(s * levels) / levels
        env = min(1.0, i / (RATE * 0.01), (n - i) / (RATE * 0.02))
        out.append(s * vol * env)
    return out


def glide(f0, f1, secs, vol=0.35):
    """Sine sweeping from f0 to f1 Hz."""
    n = int(RATE * secs)
    out, phase = [], 0.0
    for i in range(n):
        phase += (f0 + (f1 - f0) * i / n) / RATE
        env = min(1.0, i / (RATE * 0.01), (n - i) / (RATE * 0.02))
        out.append(math.sin(2 * math.pi * phase) * vol * env)
    return out


def mix(*parts):
    n = max(len(p) for p in parts)
    return [sum(p[i] for p in parts if i < len(p)) for i in range(n)]


def write(name, samples):
    OUT.mkdir(exist_ok=True)
    frames = b"".join(struct.pack("<h", int(max(-1.0, min(1.0, s)) * 32767)) for s in samples)
    with wave.open(str(OUT / f"{name}.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(frames)


CLIPS = {
    # 'O' for Omnissiah in binharic, then a low servo-hum fifth
    "rite-done": binharic(0x4F) + chord([110, 165, 220], 0.9),
    # two-tone klaxon, twice
    "heresy": (tone(440, 0.18, "square", 0.25) + silence(0.06) + tone(415, 0.18, "square", 0.25) + silence(0.06)) * 2,
    # all-zero chirps a fifth lower, then a sagging sine
    "displeased": binharic(0x00, hi=660, lo=330) + tone(196, 0.35),
}

NEW = {
    # 'S' for sanction, rising chirps, then a held open fourth that never resolves, like a question
    "sanction": binharic(0x53, hi=1320, lo=660, step=0.04, vol=0.14) + silence(0.04) + chord([440, 587], 0.4, 0.4),
    # a burst of crushed noise falling into a low sine that cuts off
    "severed": noise(0.18, 0.16, 7, levels=3) + mix(glide(420, 70, 0.3, 0.22), noise(0.3, 0.04, 8, levels=3)) + tone(70, 0.12, vol=0.22),
    # '?' for servitor, a quick small high chirp, quieter than sanction
    "servitor": binharic(0x3F, hi=2349, lo=1760, step=0.03, vol=0.2, gap=0.005) + tone(1760, 0.08, vol=0.2),
    # fast low chirps over a soft whir, settling into a quiet chord
    "engrams": mix(binharic(0xA5, hi=330, lo=220, step=0.035, vol=0.12, gap=0.005), noise(0.36, 0.05, 11, levels=6)) + chord([147, 220, 294], 0.4, 0.3),
}

if __name__ == "__main__":
    for name, samples in {**CLIPS, **NEW}.items():
        write(name, samples)
        with wave.open(str(OUT / f"{name}.wav")) as w:
            secs = w.getnframes() / w.getframerate()
        hi = 1.2 if name in NEW else 2.0
        assert 0.3 < secs < hi, f"{name}: {secs:.2f}s is outside 0.3–{hi}s"
        print(f"{name}.wav  {secs:.2f}s")
