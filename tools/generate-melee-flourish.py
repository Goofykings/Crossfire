"""Generate the short original, quiet two-part dagger twirl sound (no external samples)."""
import math
import random
import struct
import wave
from pathlib import Path

rate, duration = 22050, 0.21
rng = random.Random(7042)
samples, previous = [], 0.0
for index in range(int(rate * duration)):
    time = index / rate
    previous = previous * 0.66 + rng.uniform(-1, 1) * 0.34
    envelope = (math.exp(-((time - 0.045) / 0.025) ** 2)
                + 0.65 * math.exp(-((time - 0.135) / 0.03) ** 2))
    sample = envelope * (previous * 0.16 + math.sin(2 * math.pi * (1600 * time - 700 * time * time)) * 0.025)
    samples.append(struct.pack('<h', round(sample * 32767)))
output = Path(__file__).resolve().parents[1] / 'public/assets/audio/melee_flourish.wav'
with wave.open(str(output), 'wb') as sound:
    sound.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
    sound.writeframes(b''.join(samples))
