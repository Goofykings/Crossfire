"""Synthesize the game's sound effects (original, procedurally generated) as 16-bit mono WAV files.

Usage: python -I tools/make_audio.py
Output: public/assets/audio/*.wav  (pure Python, no dependencies)
"""
from __future__ import annotations

import math
import random
import struct
import wave
from pathlib import Path

RATE = 44100
OUT = Path(__file__).resolve().parent.parent / "public" / "assets" / "audio"


def silence(seconds: float) -> list[float]:
    return [0.0] * int(RATE * seconds)


def mix(dst: list[float], src: list[float], offset: float = 0.0, gain: float = 1.0) -> list[float]:
    o = int(offset * RATE)
    need = o + len(src)
    if need > len(dst):
        dst.extend([0.0] * (need - len(dst)))
    for i, v in enumerate(src):
        dst[o + i] += v * gain
    return dst


def env(n: int, attack: float, decay: float, curve: float = 3.0) -> list[float]:
    a = max(1, int(attack * RATE))
    out = []
    for i in range(n):
        if i < a:
            out.append(i / a)
        else:
            t = (i - a) / max(1, n - a)
            out.append(max(0.0, 1 - t) ** curve * math.exp(-t * decay))
    return out


def tone(freq_fn, seconds: float, shape: str = "sine", seed: int = 0) -> list[float]:
    n = int(RATE * seconds)
    phase = 0.0
    out = []
    for i in range(n):
        f = freq_fn(i / RATE)
        phase += 2 * math.pi * f / RATE
        s = math.sin(phase)
        if shape == "square":
            s = math.tanh(s * 4)
        elif shape == "saw":
            s = ((phase / math.pi) % 2) - 1
        out.append(s)
    return out


def noise(seconds: float, seed: int) -> list[float]:
    rnd = random.Random(seed)
    return [rnd.uniform(-1, 1) for _ in range(int(RATE * seconds))]


def lowpass(x: list[float], cutoff: float) -> list[float]:
    a = math.exp(-2 * math.pi * cutoff / RATE)
    y, out = 0.0, []
    for v in x:
        y = (1 - a) * v + a * y
        out.append(y)
    return out


def highpass(x: list[float], cutoff: float) -> list[float]:
    lp = lowpass(x, cutoff)
    return [a - b for a, b in zip(x, lp)]


def apply(x: list[float], e: list[float]) -> list[float]:
    return [a * b for a, b in zip(x, e)]


def echo(x: list[float], delay: float, feedback: float, wet: float) -> list[float]:
    d = int(delay * RATE)
    out = x + [0.0] * (d * 4)
    for i in range(d, len(out)):
        out[i] += out[i - d] * feedback * (wet if i - d < len(x) else 1)
    return out


def normalize(x: list[float], peak: float = 0.85) -> list[float]:
    m = max(1e-9, max(abs(v) for v in x))
    return [v / m * peak for v in x]


def fade_tail(x: list[float], seconds: float = 0.01) -> list[float]:
    n = int(seconds * RATE)
    for i in range(min(n, len(x))):
        x[-1 - i] *= i / n
    return x


def write(name: str, x: list[float], peak: float = 0.85) -> None:
    x = fade_tail(normalize(x, peak))
    OUT.mkdir(parents=True, exist_ok=True)
    with wave.open(str(OUT / name), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, v)) * 32767)) for v in x))


def blaster_shot() -> list[float]:
    dur = 0.32
    zap = tone(lambda t: 2400 * math.exp(-t * 14) + 180, dur, "square")
    zap = apply(lowpass(zap, 6000), env(len(zap), 0.002, 9, 1.5))
    body = tone(lambda t: 140 * math.exp(-t * 6) + 55, dur, "sine")
    body = apply(body, env(len(body), 0.001, 14, 2))
    crack = apply(highpass(noise(0.05, 3), 1800), env(int(0.05 * RATE), 0.0005, 30, 2))
    out = mix(mix(zap, body, 0, 0.9), crack, 0, 0.5)
    return echo(out, 0.075, 0.28, 0.6)


def click(seed: int, cutoff: float, dur: float = 0.05) -> list[float]:
    return apply(lowpass(highpass(noise(dur, seed), 900), cutoff), env(int(dur * RATE), 0.0005, 40, 3))


def reload_out() -> list[float]:
    whine = apply(tone(lambda t: 900 - t * 2200, 0.22, "saw"), env(int(0.22 * RATE), 0.01, 6, 1.2))
    out = mix(click(5, 4000, 0.06), lowpass(whine, 3000), 0.02, 0.25)
    return mix(out, click(6, 2500, 0.08), 0.18, 0.9)


def reload_in() -> list[float]:
    whine = apply(tone(lambda t: 400 + t * 2600, 0.26, "saw"), env(int(0.26 * RATE), 0.02, 3, 1.0))
    out = mix(lowpass(whine, 3500), click(7, 3000, 0.07), 0.24, 1.2)
    beep = apply(tone(lambda t: 1760, 0.08), env(int(0.08 * RATE), 0.003, 8, 1.5))
    return mix(out, beep, 0.34, 0.35)


def hit_marker() -> list[float]:
    x = tone(lambda t: 2800, 0.07)
    return mix(apply(x, env(len(x), 0.001, 30, 2)), click(9, 6000, 0.02), 0, 0.3)


def hit_crit() -> list[float]:
    a = apply(tone(lambda t: 1900, 0.14), env(int(0.14 * RATE), 0.001, 12, 2))
    b = apply(tone(lambda t: 2850, 0.14), env(int(0.14 * RATE), 0.001, 12, 2))
    return mix(a, b, 0.045, 0.8)


def target_down() -> list[float]:
    out = silence(0.0)
    for k, (f, g) in enumerate(((520, 1.0), (1183, 0.6), (1717, 0.45), (2410, 0.3), (3170, 0.2))):
        x = apply(tone(lambda t, f=f: f * (1 + 0.002 * math.sin(t * 30)), 0.7), env(int(0.7 * RATE), 0.001, 5 + k * 2, 1.6))
        mix(out, x, 0, g)
    return mix(out, click(12, 2500, 0.06), 0, 1.5)


def blocked() -> list[float]:
    x = apply(tone(lambda t: 150, 0.22, "square"), env(int(0.22 * RATE), 0.005, 6, 1.2))
    y = apply(tone(lambda t: 113, 0.22, "square"), env(int(0.22 * RATE), 0.005, 6, 1.2))
    return lowpass(mix(x, y, 0.0, 0.7), 1200)


def footstep(seed: int) -> list[float]:
    rnd = random.Random(seed)
    dur = 0.14
    thud = apply(lowpass(noise(dur, seed), 420 + rnd.uniform(-60, 60)), env(int(dur * RATE), 0.002, 22, 2))
    grit = apply(highpass(noise(0.05, seed + 50), 2500), env(int(0.05 * RATE), 0.001, 40, 2))
    return mix(thud, grit, 0.004, 0.12)


def land() -> list[float]:
    thud = apply(lowpass(noise(0.25, 31), 260), env(int(0.25 * RATE), 0.003, 14, 2))
    return mix(thud, footstep(32), 0.0, 0.6)


def jump() -> list[float]:
    whoosh = apply(lowpass(highpass(noise(0.18, 41), 500), 2200), env(int(0.18 * RATE), 0.05, 6, 1.5))
    return mix(whoosh, footstep(42), 0.0, 0.5)


def ui_click() -> list[float]:
    x = apply(tone(lambda t: 1300 - t * 3000, 0.05), env(int(0.05 * RATE), 0.001, 25, 2))
    return mix(x, click(51, 5000, 0.02), 0, 0.3)


def ui_hover() -> list[float]:
    return apply(tone(lambda t: 2200, 0.03), env(int(0.03 * RATE), 0.001, 30, 2))


def zone_enter() -> list[float]:
    out = silence(0.0)
    for f, start in ((659.25, 0.0), (987.77, 0.09), (1318.5, 0.18)):
        x = apply(tone(lambda t, f=f: f, 0.7), env(int(0.7 * RATE), 0.02, 4, 1.3))
        mix(out, x, start, 0.5)
    return echo(out, 0.11, 0.3, 0.5)


def main() -> None:
    write("blaster_shot.wav", blaster_shot(), 0.9)
    write("empty_click.wav", click(4, 3500, 0.06), 0.6)
    write("reload_out.wav", reload_out(), 0.7)
    write("reload_in.wav", reload_in(), 0.7)
    write("hit_marker.wav", hit_marker(), 0.55)
    write("hit_crit.wav", hit_crit(), 0.6)
    write("target_down.wav", target_down(), 0.6)
    write("blocked.wav", blocked(), 0.45)
    for i in range(4):
        write(f"step_{i + 1}.wav", footstep(20 + i), 0.5)
    write("land.wav", land(), 0.6)
    write("jump.wav", jump(), 0.4)
    write("ui_click.wav", ui_click(), 0.45)
    write("ui_hover.wav", ui_hover(), 0.25)
    write("zone_enter.wav", zone_enter(), 0.4)
    total = sum(f.stat().st_size for f in OUT.glob("*.wav"))
    print(f"audio written to {OUT} ({total // 1024} KB)")


if __name__ == "__main__":
    main()
