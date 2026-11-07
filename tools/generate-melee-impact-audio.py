"""Original bounded, non-graphic dagger sweeps and a dry impact. No external samples."""
import math
import random
import struct
import wave
from pathlib import Path

root = Path(__file__).resolve().parents[1] / 'public/assets/audio'
rate = 22050
for name, seed, duration in [('melee_swing1', 8101, .11), ('melee_swing2', 8102, .115), ('melee_swing3', 8103, .17), ('melee_impact', 8104, .065)]:
    rng = random.Random(seed)
    samples = []
    low = 0
    impact = name == 'melee_impact'
    heavy = name == 'melee_swing3'
    for i in range(round(rate * duration)):
        t = i / rate
        low = low * .58 + rng.uniform(-1, 1) * .42
        envelope = math.sin(math.pi * t / duration) ** (1 if impact else 2)
        if impact:
            sample = (low * .4 + math.sin(2 * math.pi * (240*t-700*t*t)) * .3) * envelope * math.exp(-t*38)
        else:
            sample = (low * .48 + math.sin(2*math.pi*((230 if heavy else 360)*t-650*t*t)) * (.14 if heavy else .055)) * envelope
            if heavy:
                sample += .06 * math.sin(2 * math.pi * 150 * t) * envelope
        samples.append(struct.pack('<h', round(max(-1, min(1, sample)) * 32767)))
    with wave.open(str(root / (name + '.wav')), 'wb') as sound:
        sound.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
        sound.writeframes(b''.join(samples))
