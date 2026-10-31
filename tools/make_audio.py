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


def click(seed: int, cutoff: float, dur: float = 0.05) -> list[float]:
    return apply(lowpass(highpass(noise(dur, seed), 900), cutoff), env(int(dur * RATE), 0.0005, 40, 3))


def softclip(x: list[float], drive: float) -> list[float]:
    return [math.tanh(v * drive) for v in x]


def bandpass(x: list[float], lo: float, hi: float) -> list[float]:
    return lowpass(highpass(x, lo), hi)


def gunshot(seed: int, crack: float, blast_cut: float, blast_decay: float, blast_len: float, thump: tuple[float, float, float],
            tail_len: float, tail_cut: float, tail_decay: float, tail_gain: float, reflections: list[tuple[float, float]],
            drive: float = 2.2) -> list[float]:
    """Layered gunshot: supersonic/muzzle crack, gas blast, low thump, room tail and early reflections off walls."""
    out = silence(0.0)
    c = apply(highpass(noise(0.007, seed), 2600), env(int(0.007 * RATE), 0.0002, 30, 2))
    mix(out, c, 0, crack)
    b = apply(lowpass(noise(blast_len, seed + 1), blast_cut), env(int(blast_len * RATE), 0.0006, blast_decay, 1.4))
    mix(out, b, 0.0005, 1.0)
    f0, f1, dur = thump
    t = apply(tone(lambda tt: f1 + (f0 - f1) * math.exp(-tt * 28), dur), env(int(dur * RATE), 0.001, 9, 1.5))
    mix(out, t, 0.0, 0.85)
    tail = apply(lowpass(noise(tail_len, seed + 2), tail_cut), env(int(tail_len * RATE), 0.02, tail_decay, 1.2))
    mix(out, tail, 0.012, tail_gain)
    out = softclip(out, drive)
    dry = list(out)
    for delay, g in reflections:
        mix(out, lowpass(dry, 2400), delay, g)
    return out


def rifle_shot() -> list[float]:
    return gunshot(101, 0.9, 3800, 38, 0.13, (150, 52, 0.1), 0.75, 1100, 6, 0.22, [(0.043, 0.22), (0.09, 0.12), (0.16, 0.07)])


def shotgun_shot() -> list[float]:
    return gunshot(202, 0.6, 2300, 20, 0.22, (115, 36, 0.16), 1.1, 800, 4.2, 0.32, [(0.05, 0.25), (0.12, 0.16), (0.21, 0.09)], 2.6)


def sniper_shot() -> list[float]:
    return gunshot(303, 1.3, 3000, 24, 0.2, (95, 30, 0.2), 1.7, 700, 2.6, 0.34,
                   [(0.06, 0.2), (0.19, 0.16), (0.42, 0.11), (0.7, 0.06)], 2.8)


def metal(freq: float, dur: float, decay: float, seed: int, ratios=(1.0, 2.71, 5.1, 8.3)) -> list[float]:
    """Struck-metal ring: a few inharmonic partials, the higher ones dying faster."""
    rnd = random.Random(seed)
    out = silence(0.0)
    for k, r in enumerate(ratios):
        f = freq * r * (1 + rnd.uniform(-0.01, 0.01))
        x = apply(tone(lambda t, f=f: f, dur), env(int(dur * RATE), 0.0005, decay * (1 + k * 0.8), 2.0))
        mix(out, x, 0, 0.6 / (k + 1))
    return mix(out, click(seed + 7, 6000, 0.02), 0, 0.8)


def slide(dur: float, lo: float, hi: float, seed: int) -> list[float]:
    """Metal sliding on metal: band-passed noise swelling and fading."""
    n = int(dur * RATE)
    e = [math.sin(math.pi * i / n) ** 0.8 for i in range(n)]
    return apply(bandpass(noise(dur, seed), lo, hi), e)


def mag_out() -> list[float]:
    out = mix(click(401, 3500, 0.03), metal(1400, 0.08, 40, 402), 0.0, 0.5)
    mix(out, slide(0.12, 600, 3000, 403), 0.03, 0.55)
    return mix(out, click(404, 1800, 0.06), 0.15, 0.6)


def mag_in() -> list[float]:
    out = slide(0.07, 700, 3200, 411)
    mix(out, metal(900, 0.12, 28, 412), 0.065, 1.0)
    return mix(out, click(413, 2500, 0.05), 0.07, 1.2)


def bolt_release() -> list[float]:
    out = mix(click(421, 5000, 0.015), metal(620, 0.25, 16, 422), 0.004, 1.3)
    return mix(out, slide(0.03, 1500, 6000, 423), 0.0, 0.5)


def pump_back() -> list[float]:
    out = slide(0.11, 400, 2600, 431)
    return mix(out, metal(720, 0.14, 26, 432), 0.1, 1.0)


def pump_fwd() -> list[float]:
    out = slide(0.09, 450, 2800, 441)
    return mix(out, metal(820, 0.18, 22, 442), 0.085, 1.3)


def shell_in() -> list[float]:
    out = slide(0.06, 500, 2500, 451)
    return mix(out, click(452, 2800, 0.05), 0.05, 1.1)


def bolt_up() -> list[float]:
    return mix(click(461, 4000, 0.03), metal(1500, 0.07, 45, 462), 0.0, 0.6)


def bolt_back() -> list[float]:
    out = slide(0.13, 500, 3000, 471)
    return mix(out, metal(980, 0.12, 30, 472), 0.12, 0.8)


def bolt_fwd() -> list[float]:
    out = slide(0.1, 550, 3200, 481)
    return mix(out, metal(1050, 0.14, 28, 482), 0.09, 1.0)


def bolt_down() -> list[float]:
    return mix(click(491, 3000, 0.04), metal(760, 0.12, 30, 492), 0.005, 0.9)


def draw() -> list[float]:
    rustle = apply(bandpass(noise(0.26, 501), 300, 2400), env(int(0.26 * RATE), 0.06, 5, 1.4))
    return mix(rustle, metal(1300, 0.08, 40, 502), 0.17, 0.4)


def casing(seed: int) -> list[float]:
    """Brass case bouncing on stone: three ever smaller tinks."""
    out = silence(0.0)
    t, g = 0.0, 1.0
    rnd = random.Random(seed)
    for _ in range(3):
        mix(out, metal(3100 * rnd.uniform(0.95, 1.08), 0.09, 34, seed + int(t * 100), ratios=(1.0, 1.52, 2.4)), t, g)
        t += rnd.uniform(0.07, 0.12) * g
        g *= 0.45
    return out


def shell_drop() -> list[float]:
    """Plastic shotgun hull landing: a dull double knock."""
    out = apply(lowpass(noise(0.05, 511), 1500), env(int(0.05 * RATE), 0.001, 30, 2))
    return mix(out, apply(lowpass(noise(0.04, 512), 1300), env(int(0.04 * RATE), 0.001, 30, 2)), 0.09, 0.5)


def hit_head() -> list[float]:
    """Headshot confirmation: a bright double ping over a muted knock."""
    a = apply(tone(lambda t: 2300, 0.16), env(int(0.16 * RATE), 0.001, 12, 2))
    b = apply(tone(lambda t: 3450, 0.18), env(int(0.18 * RATE), 0.001, 11, 2))
    knock = apply(lowpass(noise(0.05, 521), 900), env(int(0.05 * RATE), 0.001, 30, 2))
    return mix(mix(a, b, 0.05, 0.9), knock, 0, 0.6)


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


def smg_shot() -> list[float]:
    # Original synthesized transient: short enough to keep rapid fire distinct.
    duration = 0.055
    crack = apply(highpass(noise(duration, 740), 1200), env(int(duration * RATE), 0.0003, 14, 1.3))
    body = apply(tone(lambda t: 280 - 1800 * t, duration), env(int(duration * RATE), 0.0006, 13, 1.3))
    return mix(crack, body, 0, 0.75)


def main() -> None:
    write("smg_shot.wav", smg_shot(), 0.8)
    write("rifle_shot.wav", rifle_shot(), 0.92)
    write("shotgun_shot.wav", shotgun_shot(), 0.95)
    write("sniper_shot.wav", sniper_shot(), 0.95)
    write("empty_click.wav", click(4, 3500, 0.06), 0.6)
    for name, fn in (("mag_out", mag_out), ("mag_in", mag_in), ("bolt_release", bolt_release), ("pump_back", pump_back),
                     ("pump_fwd", pump_fwd), ("shell_in", shell_in), ("bolt_up", bolt_up), ("bolt_back", bolt_back),
                     ("bolt_fwd", bolt_fwd), ("bolt_down", bolt_down), ("draw", draw)):
        write(f"{name}.wav", fn(), 0.7)
    write("casing.wav", casing(530), 0.35)
    write("shell_drop.wav", shell_drop(), 0.4)
    write("hit_marker.wav", hit_marker(), 0.55)
    write("hit_crit.wav", hit_crit(), 0.6)
    write("hit_head.wav", hit_head(), 0.62)
    write("target_down.wav", target_down(), 0.6)
    for i in range(4):
        write(f"step_{i + 1}.wav", footstep(20 + i), 0.5)
    write("land.wav", land(), 0.6)
    write("jump.wav", jump(), 0.4)
    write("ui_click.wav", ui_click(), 0.45)
    write("ui_hover.wav", ui_hover(), 0.25)
    total = sum(f.stat().st_size for f in OUT.glob("*.wav"))
    print(f"audio written to {OUT} ({total // 1024} KB)")


if __name__ == "__main__":
    main()
