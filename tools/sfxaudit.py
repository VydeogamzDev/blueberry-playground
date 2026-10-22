"""Audits every sample in public/sfx for faults you would hear, without listening.

    python tools/sfxaudit.py            report (exit 1 if anything is flagged)
    python tools/sfxaudit.py --all      every file's numbers, not just the flagged ones

Decodes each file with ffmpeg (on PATH) and checks:
  click in / click out   the sound starts or stops on a jump from silence
  cut off                still sounding in its last 10 ms (the tail was chopped)
  late start             silence before it begins (it would sound late)
  DC offset              the waveform sits off zero (a thump on start/stop)
  clipped                runs of full-scale samples (distortion)
  hiss                   a flat (white) noise floor close to the sound itself
  rumble                 most of the energy below 60 Hz (mud that eats headroom)
  seam                   loops whose end doesn't meet their start (a click every lap)
  uneven                 variants of one sound that differ a lot in loudness (A-weighted, as heard)
"""
import json
import os
import subprocess
import sys

import numpy as np

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SFX = os.path.join(ROOT, 'public')
SR = 44100
# noise is what these are: a flat floor is the sound, not hiss
NOISY = ('liquid/sizzle', 'liquid/steam', 'liquid/pour', 'explosion/fuse', 'fire/')
# mains hum: low by nature (it is meant to be felt more than heard)
LOW_BY_NATURE = ('machine/hum_loop',)


def decode(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', '1', '-ar', str(SR), '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)


def db(x):
    return 20 * np.log10(max(x, 1e-9))


def windows_rms(x, n):
    if len(x) < n:
        return np.array([np.sqrt(np.mean(x * x))]) if len(x) else np.array([0.0])
    k = len(x) // n
    return np.sqrt(np.mean(x[:k * n].reshape(k, n) ** 2, axis=1))


def a_weight(f):
    """IEC 61672 A-weighting (gain, 1 at 1 kHz): roughly how loud each frequency sounds."""
    f2 = np.maximum(f, 1e-3) ** 2
    return 12194 ** 2 * f2 ** 2 / ((f2 + 20.6 ** 2) * np.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2)) / 0.794


def analyse(x, loop):
    peak = float(np.max(np.abs(x))) if len(x) else 0.0
    w5 = windows_rms(x, int(SR * 0.005))
    w50 = windows_rms(x, int(SR * 0.05))
    loud = float(np.max(w50))
    # the same, as heard: rumble counts in plain RMS but barely in the ear
    xa = np.fft.irfft(np.fft.rfft(x) * a_weight(np.fft.rfftfreq(len(x), 1 / SR)), n=len(x)) if len(x) > 1 else x
    r = {
        'dur': len(x) / SR,
        'peak': db(peak),
        'loud': db(loud),
        'aloud': db(float(np.max(windows_rms(xa, int(SR * 0.05))))),
        'dc': float(np.mean(x)),
    }
    # how big a jump the very first/last sample is, against the sound's own peak
    r['in'] = abs(x[0]) / peak if peak else 0
    r['out'] = abs(x[-1]) / peak if peak else 0
    # still sounding at the end: last 10 ms against the loudest 50 ms
    tail = x[-int(SR * 0.01):]
    r['tail'] = db(float(np.sqrt(np.mean(tail * tail)))) - db(loud)
    # silence before it starts (first 5 ms window within 30 dB of the loudest)
    on = np.argmax(w5 > loud * 10 ** (-30 / 20))
    r['lead'] = on * 0.005
    r['clip'] = int(np.sum(np.abs(x) >= 0.999))
    # noise floor: the quietest 50 ms while it lasts (not the fade at the end), and
    # how flat its spectrum is (1: white noise; near 0: tones, the sound's own texture)
    n50 = int(SR * 0.05)
    body = w50[: max(1, int(len(w50) * 0.8))]
    r['floor'] = db(float(np.min(body))) - db(loud) if len(body) > 3 else -99
    r['flat'] = 0.0
    if len(body) > 3:
        i = int(np.argmin(body))
        p = np.abs(np.fft.rfft(x[i * n50:(i + 1) * n50] * np.hanning(n50))) ** 2 + 1e-20
        r['flat'] = float(np.exp(np.mean(np.log(p[1:]))) / np.mean(p[1:]))
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x)))) ** 2 if len(x) > 64 else np.ones(2)
    f = np.fft.rfftfreq(len(x), 1 / SR) if len(x) > 64 else np.array([0, 1])
    tot = float(np.sum(spec)) or 1
    r['low'] = float(np.sum(spec[f < 60])) / tot
    r['centroid'] = float(np.sum(f * spec)) / tot
    if loop:
        # the lap: end sample to start sample, against the usual step between samples
        step = float(np.median(np.abs(np.diff(x)))) or 1e-9
        r['seam'] = abs(x[-1] - x[0]) / step
    return r


def main():
    show_all = '--all' in sys.argv
    with open(os.path.join(SFX, 'sfx', 'manifest.json')) as fh:
        manifest = json.load(fh)
    loops = set(manifest.get('loops', []))
    flagged = 0
    rows = []
    for key, files in manifest.items():
        if not isinstance(files, list) or key == 'loops':
            continue
        loop = key in loops
        res = [(f, analyse(decode(os.path.join(SFX, f)), loop)) for f in files]
        louds = [r['aloud'] for _, r in res]
        spread = max(louds) - min(louds) if louds else 0
        for f, r in res:
            why = []
            if not loop and r['in'] > 0.1:
                why.append(f"click in ({r['in']:.0%} of peak)")
            if not loop and r['out'] > 0.02:
                why.append(f"click out ({r['out']:.0%} of peak)")
            if not loop and r['tail'] > -30 and r['dur'] > 0.08:
                why.append(f"cut off (last 10 ms at {r['tail']:.0f} dB)")
            if not loop and r['lead'] > 0.03:
                why.append(f"late start ({r['lead'] * 1000:.0f} ms)")
            if abs(r['dc']) > 0.01:
                why.append(f"DC offset {r['dc']:+.3f}")
            if r['clip'] > 3:
                why.append(f"clipped ({r['clip']} samples)")
            if not loop and r['floor'] > -30 and r['flat'] > 0.3 and not key.startswith(NOISY):
                why.append(f"hiss (floor {r['floor']:.0f} dB, flatness {r['flat']:.2f})")
            if r['low'] > 0.5 and key not in LOW_BY_NATURE:
                why.append(f"rumble ({r['low']:.0%} below 60 Hz)")
            if loop and r.get('seam', 0) > 8:
                why.append(f"seam (jump {r['seam']:.0f}x a normal step)")
            if spread > 9 and abs(r['aloud'] - float(np.median(louds))) > 6:
                why.append(f"uneven ({r['aloud'] - float(np.median(louds)):+.0f} dB A-weighted from its variants)")
            if why:
                flagged += 1
            if why or show_all:
                rows.append(f"{f[4:]:34} {r['dur']:5.2f}s peak {r['peak']:6.1f} loud {r['loud']:6.1f} A {r['aloud']:6.1f} {'  '.join(why)}")
    print('\n'.join(rows))
    total = sum(len(v) for k, v in manifest.items() if isinstance(v, list) and k != 'loops')
    print(f"\n{flagged} of {total} files flagged")
    sys.exit(1 if flagged else 0)


if __name__ == '__main__':
    main()
