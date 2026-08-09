# PyAudioLab 🎛️

> A lightweight Python audio effects editor — correct DSP, not a polished UI.

Processes WAV files through a chain of classic audio effects implemented from scratch with **NumPy** and **SciPy**. Inspired by [AudioMass](https://audiomass.co/).

---

## Table of Contents

1. [Installation](#installation)
2. [Quick Start](#quick-start)
3. [CLI Reference](#cli-reference)
4. [Effect Chain](#effect-chain)
5. [Effects Documentation](#effects-documentation)
   - [Tier 1 — Basic](#tier-1--basic)
   - [Tier 2 — Intermediate](#tier-2--intermediate)
   - [Tier 3 — Stretch Goals](#tier-3--stretch-goals)
6. [Architecture](#architecture)
7. [Testing](#testing)
8. [Generating Test Audio](#generating-test-audio)

---

## Installation

```bash
# 1. Clone
git clone https://github.com/yourname/pyaudiolab.git
cd pyaudiolab

# 2. Install dependencies
pip install -r requirements.txt

# 3. (Optional) Editable install
pip install -e .
```

**Dependencies:** `numpy`, `scipy`, `soundfile`, `matplotlib`, `pytest`

---

## Quick Start

```bash
# Generate test WAV files
python -m pyaudiolab.generate_test_wav

# Apply a single effect
python -m pyaudiolab.cli test_sine_mono.wav out.wav --effect gain --gain_db 6

# Chain multiple effects + save before/after plots
python -m pyaudiolab.cli test_sine_mono.wav out.wav \
    --effect gain,normalize,fade_out \
    --gain_db 3 --target_db -1 --fade_out_ms 1000 \
    --plot
```

---

## CLI Reference

```
python -m pyaudiolab.cli <input.wav> <output.wav> --effect <chain> [options]
```

### Positional Arguments

| Argument | Description |
|---|---|
| `input` | Input WAV file path |
| `output` | Output WAV file path |

### Core Options

| Option | Default | Description |
|---|---|---|
| `--effect` | *(required)* | Comma-separated effect chain, e.g. `gain,normalize,fade_out` |
| `--plot` | off | Save before/after waveform + spectrum PNGs to `--plot_dir` |
| `--plot_dir` | `plots/` | Output directory for PNG plots |

### Effect Parameters

#### Gain
| Option | Default | Description |
|---|---|---|
| `--gain_db` | `0.0` | Gain in dB (positive = louder, negative = quieter) |

#### Fades
| Option | Default | Description |
|---|---|---|
| `--fade_in_ms` | `500.0` | Fade-in duration in milliseconds |
| `--fade_out_ms` | `500.0` | Fade-out duration in milliseconds |
| `--fade_curve` | `linear` | Curve shape: `linear` or `exponential` |

#### Normalize
| Option | Default | Description |
|---|---|---|
| `--target_db` | `-1.0` | Target level in dBFS |
| `--norm_mode` | `peak` | Normalization mode: `peak` or `rms` |

#### Trim Silence / Dynamics Threshold
| Option | Default | Description |
|---|---|---|
| `--threshold_db` | `-40.0` | Threshold in dBFS (used by `trim_silence`, `hard_limit`, `soft_clip`, `compress`) |
| `--window_ms` | `20.0` | Analysis window for `trim_silence` |

#### Compressor
| Option | Default | Description |
|---|---|---|
| `--ratio` | `4.0` | Compression ratio (4 = 4:1) |
| `--attack_ms` | `10.0` | Attack time in ms |
| `--release_ms` | `100.0` | Release time in ms |
| `--makeup_db` | `0.0` | Make-up gain in dB |

#### Delay
| Option | Default | Description |
|---|---|---|
| `--delay_ms` | `250.0` | Echo delay in ms |
| `--feedback` | `0.4` | Feedback fraction [0, 0.95] |
| `--delay_mix` | `0.5` | Wet/dry mix [0, 1] |

#### Speed / Time Stretch
| Option | Default | Description |
|---|---|---|
| `--speed_factor` | `1.0` | Speed multiplier (>1 = faster + higher pitch) |
| `--stretch_factor` | `1.0` | Time-stretch factor (>1 = faster, pitch preserved) |
| `--window_size` | `2048` | STFT window size for phase vocoder |
| `--hop_length` | `512` | STFT hop size for phase vocoder |

#### Graphic EQ
| Option | Default | Description |
|---|---|---|
| `--eq_gains` | `0,0,0,0,0,0,0,0,0,0` | 10 comma-separated dB gains for bands: 31/62/125/250/500/1k/2k/4k/8k/16k Hz |

#### Distortion
| Option | Default | Description |
|---|---|---|
| `--drive_db` | `12.0` | Pre-amp drive in dB |
| `--distort_mode` | `soft` | Waveshaper: `soft` (tanh) or `hard` (clip) |
| `--distort_mix` | `1.0` | Wet/dry mix |

#### Reverb
| Option | Default | Description |
|---|---|---|
| `--room_size` | `0.5` | Room size [0.1, 1.0] |
| `--damping` | `0.5` | High-frequency damping [0, 1] |
| `--reverb_mix` | `0.3` | Wet/dry mix |

#### Noise Reduction
| Option | Default | Description |
|---|---|---|
| `--noise_dur_ms` | `500.0` | Duration (ms) of noise-only region at start |
| `--nr_strength` | `1.0` | Subtraction strength [0, 2] |
| `--nr_floor` | `0.002` | Spectral floor fraction |

---

## Effect Chain

Effects are applied **left to right** in the order specified:

```bash
--effect gain,normalize,fade_in,fade_out,reverb
```

Each effect receives the output of the previous one as its input.
All effects share a uniform internal signature: `effect(audio, sr, **kwargs) → audio`.

---

## Effects Documentation

### Tier 1 — Basic

#### 1. `gain` — Amplitude Gain

**DSP:** Linear amplitude scaling `scale = 10^(gain_db/20)`. Samples exceeding `|1.0|` after scaling are soft-clipped via `tanh(x)` to prevent hard digital distortion.

```bash
python -m pyaudiolab.cli in.wav out.wav --effect gain --gain_db 6
```

| Parameter | Type | Default | Range |
|---|---|---|---|
| `gain_db` | float | 0.0 | any real |

---

#### 2. `fade_in` / `fade_out` — Amplitude Fades

**DSP:** A ramp envelope `[0 → 1]` (fade-in) or `[1 → 0]` (fade-out) is multiplied sample-by-sample over the fade region.
- **Linear:** `env[i] = i / N`
- **Exponential:** `env[i] = (e^t - 1) / (e - 1)` — better matches human loudness perception

```bash
python -m pyaudiolab.cli in.wav out.wav --effect fade_in,fade_out \
    --fade_in_ms 500 --fade_out_ms 1000 --fade_curve exponential
```

| Parameter | Type | Default | Range |
|---|---|---|---|
| `fade_in_ms` / `fade_out_ms` | float | 500.0 | [0, duration_ms] |
| `fade_curve` | str | linear | linear, exponential |

---

#### 3. `normalize` — Loudness Normalization

**DSP:**
- **Peak:** `scale = target_linear / max(|audio|)` — guarantees the loudest sample hits target.
- **RMS:** `scale = target_linear / rms(audio)` — matches perceived loudness; used in broadcast standards.

```bash
python -m pyaudiolab.cli in.wav out.wav --effect normalize --target_db -1 --norm_mode peak
```

| Parameter | Type | Default | Options |
|---|---|---|---|
| `target_db` | float | -1.0 | any (typical: -6 to 0 dBFS) |
| `norm_mode` | str | peak | peak, rms |

---

#### 4. `reverse` — Time Reversal

**DSP:** `output = audio[::-1]`. Preserves stereo channel pairing.

```bash
python -m pyaudiolab.cli in.wav out.wav --effect reverse
```

---

#### 5. `invert` — Phase Invert

**DSP:** `output = audio * -1.0`. Flips waveform polarity. Mixing with the original produces perfect cancellation (null test).

```bash
python -m pyaudiolab.cli in.wav out.wav --effect invert
```

---

#### 6. `trim_silence` — Silence Removal

**DSP:** Divides audio into windows of `window_ms`. Computes per-window RMS energy. Windows below `threshold_db` are discarded; the rest are concatenated.

```bash
python -m pyaudiolab.cli in.wav out.wav --effect trim_silence \
    --threshold_db -40 --window_ms 20
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `threshold_db` | float | -40.0 | Gate threshold in dBFS |
| `window_ms` | float | 20.0 | Analysis window length |

---

### Tier 2 — Intermediate

#### 7. `hard_limit` — Hard Limiter

**DSP:** `output = clip(audio, -thresh, +thresh)`. Any sample exceeding the threshold is clipped to exactly ±threshold.

```bash
python -m pyaudiolab.cli in.wav out.wav --effect hard_limit --threshold_db -3
```

---

#### 8. `soft_clip` — Soft Clipper

**DSP:** `output = thresh * tanh(audio / thresh)` above the threshold. Smoothly compresses transients without the harsh spectral artifacts of hard clipping.

```bash
python -m pyaudiolab.cli in.wav out.wav --effect soft_clip --threshold_db -6
```

---

#### 9. `compress` — Dynamic Range Compressor

**DSP:** Feed-forward RMS compressor with:
1. **Level detection:** per-sample RMS with 1-pole IIR attack/release smoothing
2. **Gain computer:** `gain_db = -(over_dB)(1 - 1/ratio)` above threshold
3. **Smooth gain application:** same attack/release time constants

```bash
python -m pyaudiolab.cli in.wav out.wav --effect compress \
    --threshold_db -20 --ratio 4 --attack_ms 10 --release_ms 100 --makeup_db 3
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `threshold_db` | float | -20.0 | Compression starts above this level |
| `ratio` | float | 4.0 | Compression ratio (4 = 4:1) |
| `attack_ms` | float | 10.0 | Attack time constant |
| `release_ms` | float | 100.0 | Release time constant |
| `makeup_db` | float | 0.0 | Post-compression make-up gain |

---

#### 10. `delay` — Feedback Delay / Echo

**DSP:** Circular delay buffer with exponentially decaying echoes:
`y[n] = dry*x[n] + wet*(x[n-D] + feedback*x[n-2D] + ...)`

```bash
python -m pyaudiolab.cli in.wav out.wav --effect delay \
    --delay_ms 250 --feedback 0.4 --delay_mix 0.5
```

| Parameter | Type | Default | Range |
|---|---|---|---|
| `delay_ms` | float | 250.0 | > 0 |
| `feedback` | float | 0.4 | [0, 0.95] |
| `delay_mix` | float | 0.5 | [0, 1] |

---

#### 11. `change_speed` — Speed / Pitch Change

**DSP:** Resamples to a new length via `scipy.signal.resample`. Factor > 1 shortens (faster + higher pitch); < 1 lengthens (slower + lower pitch). Analogous to tape speed change.

```bash
python -m pyaudiolab.cli in.wav out.wav --effect change_speed --speed_factor 1.5
```

---

#### 12. `time_stretch` — Pitch-Preserving Time Stretch

**DSP:** OLA (Overlap-Add) Phase Vocoder:
1. Compute STFT with Hanning window
2. Track instantaneous phase of each bin using phase difference between adjacent frames
3. Accumulate phase at the output frame rate scaled by `factor`
4. Reconstruct via inverse STFT with overlap-add

```bash
python -m pyaudiolab.cli in.wav out.wav --effect time_stretch \
    --stretch_factor 0.75 --window_size 2048 --hop_length 512
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `stretch_factor` | float | 1.0 | > 1 = faster, < 1 = slower |
| `window_size` | int | 2048 | STFT analysis window (power of 2) |
| `hop_length` | int | 512 | STFT hop size |

---

### Tier 3 — Stretch Goals

#### 13. `eq` — 10-Band Graphic EQ

**DSP:** Bank of 10 peaking biquad IIR filters (Audio EQ Cookbook, R. Bristow-Johnson) at standard ISO 266 centers: **31, 62, 125, 250, 500, 1k, 2k, 4k, 8k, 16k Hz**. Applied sequentially via `scipy.signal.sosfilt` for numerical stability.

```bash
python -m pyaudiolab.cli in.wav out.wav --effect eq \
    --eq_gains "0,0,6,3,0,-3,0,0,0,0"
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `eq_gains` | 10 floats | all 0 | Per-band gain in dB |

---

#### 14. `distort` — Waveshaping Distortion

**DSP:**
- **Soft (tanh):** `output = tanh(drive * x) / tanh(drive)` — tube-amp saturation character
- **Hard (clip):** `output = clip(drive * x, -1, +1)` — transistor/fuzz character

```bash
python -m pyaudiolab.cli in.wav out.wav --effect distort \
    --drive_db 20 --distort_mode soft --distort_mix 0.8
```

---

#### 15. `reverb` — Schroeder Reverb

**DSP:** Classic Schroeder reverb (1961):
1. **4 parallel comb filters** — feedback delay lines with damping, prime-ish delays to avoid metallic resonances
2. **2 series allpass filters** — diffuse energy without frequency colouration
Output mixed with dry signal via `mix`.

```bash
python -m pyaudiolab.cli in.wav out.wav --effect reverb \
    --room_size 0.8 --damping 0.3 --reverb_mix 0.4
```

| Parameter | Type | Default | Range |
|---|---|---|---|
| `room_size` | float | 0.5 | [0.1, 1.0] |
| `damping` | float | 0.5 | [0, 1] |
| `reverb_mix` | float | 0.3 | [0, 1] |

---

#### 16. `noise_reduction` — Spectral Subtraction

**DSP:**
1. Estimate noise PSD `N(k)` from the first `noise_duration_ms` of audio (assumes silence/noise only)
2. For each frame: `|Y(k)| = sqrt(max(|X(k)|² - strength·N(k), floor·N(k)))`
3. Preserve original phase; reconstruct via overlap-add ISTFT

```bash
python -m pyaudiolab.cli in.wav out.wav --effect noise_reduction \
    --noise_dur_ms 500 --nr_strength 1.2 --nr_floor 0.002
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `noise_dur_ms` | float | 500.0 | Duration of noise-only region at start |
| `nr_strength` | float | 1.0 | Subtraction aggressiveness [0, 2] |
| `nr_floor` | float | 0.002 | Prevents spectral holes |

---

## Architecture

```
pyaudiolab/
├── __init__.py              # Package root, exposes load/save/EFFECT_REGISTRY
├── io_utils.py              # WAV I/O (float64 contract, mono/stereo)
├── visualize.py             # Before/after waveform + spectrum PNG plots
├── cli.py                   # argparse entry point + effect chain runner
├── generate_test_wav.py     # Synthetic test WAV generator
└── effects/
    ├── __init__.py          # Effect registry dict
    ├── gain.py              # Amplitude gain + soft-clip guard
    ├── fades.py             # Fade-in / fade-out (linear + exponential)
    ├── normalize.py         # Peak and RMS normalization
    ├── basic.py             # Reverse, invert, trim silence
    ├── dynamics.py          # Hard limit, soft clip, compressor
    ├── delay.py             # Feedback delay line (echo)
    ├── pitch_time.py        # Speed change + phase vocoder time-stretch
    ├── eq.py                # 10-band graphic EQ (biquad IIR)
    ├── distortion.py        # Tanh/hard-clip waveshaping
    ├── reverb.py            # Schroeder reverb (comb + allpass)
    └── noise_reduction.py   # FFT spectral subtraction

tests/
├── conftest.py              # Shared fixtures (synthetic audio — no WAV files needed)
├── test_gain.py
├── test_fades.py
├── test_normalize.py
├── test_basic.py
├── test_dynamics.py
├── test_delay.py
├── test_eq.py
├── test_pitch_time.py
├── test_reverb.py
└── test_noise_reduction.py
```

### Internal Data Contract

- All audio is processed as **`float64` in `[-1.0, 1.0]`** internally
- **Mono:** shape `(N,)` | **Stereo:** shape `(N, 2)`
- Effects preserve channel count and shape (except `change_speed`, `time_stretch`, `delay` which may change `N`)
- On save, audio is clipped to `[-1, 1]` and written as 16-bit PCM

---

## Testing

```bash
# Run all tests
pytest tests/ -v

# Run specific module
pytest tests/test_gain.py -v

# With coverage
pytest tests/ --cov=pyaudiolab --cov-report=term-missing
```

All tests use synthetic signals (sine waves, impulses, white noise, silence) — **no real WAV files required**.

---

## Generating Test Audio

```bash
python -m pyaudiolab.generate_test_wav --out_dir test_files/
```

Produces:
| File | Description |
|---|---|
| `test_sine_mono.wav` | 3s, 440 Hz sine, mono |
| `test_sine_stereo.wav` | 3s, 440/880 Hz, stereo |
| `test_noise.wav` | 3s, white noise, mono |
| `test_silence.wav` | 3s, silence-tone-silence |
| `test_dynamic.wav` | 3s, quiet→loud transition |

---

## Example Effect Chains

```bash
# Master bus chain
python -m pyaudiolab.cli in.wav out.wav \
    --effect eq,compress,normalize,fade_in,fade_out \
    --eq_gains "0,0,2,0,0,-2,0,1,0,0" \
    --threshold_db -18 --ratio 3 --attack_ms 5 --release_ms 80 \
    --target_db -1 --fade_in_ms 200 --fade_out_ms 500 --plot

# Vintage tape effect (distort + reverb)
python -m pyaudiolab.cli in.wav out.wav \
    --effect gain,distort,reverb \
    --gain_db -6 --drive_db 8 --distort_mode soft \
    --room_size 0.4 --damping 0.6 --reverb_mix 0.25 --plot

# Podcast noise cleanup
python -m pyaudiolab.cli in.wav out.wav \
    --effect noise_reduction,compress,normalize \
    --noise_dur_ms 800 --nr_strength 1.2 \
    --threshold_db -24 --ratio 3 --makeup_db 2 --target_db -3 --plot
```

---

## License

MIT — see `LICENSE`.