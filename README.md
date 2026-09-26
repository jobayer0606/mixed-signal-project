# PyAudioLab 🎛️✨
### Professional Mixed-Signal DSP Workbench, Mastering Suite & Interactive Signal Labs

[![Python 3.10+](https://img.shields.io/badge/python-3.10+-blue.svg?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.109+-009688.svg?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![NumPy & SciPy](https://img.shields.io/badge/DSP-NumPy%20%7C%20SciPy-013243.svg?style=for-the-badge&logo=scipy&logoColor=white)](https://scipy.org/)
[![Tests](https://img.shields.io/badge/Tests-130%20Passed-brightgreen.svg?style=for-the-badge&logo=pytest&logoColor=white)](https://docs.pytest.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

**PyAudioLab** is a full-stack, mixed-signal digital signal processing (DSP) platform and web-based audio mastering laboratory. Built from mathematical first principles using **NumPy** and **SciPy**, it pairs a high-performance **FastAPI backend** with a hardware-accelerated **interactive web suite** for audio editing, spectral analysis, and educational signal theory experiments.

---

## 📑 Table of Contents

1. [Key Highlights](#-key-highlights)
2. [Web Application Suite](#-web-application-suite)
   - [1. Audio Studio & Mastering Suite (`/index.html`)](#1-audio-studio--mastering-suite)
   - [2. Signal Labs: Interactive DSP Sandbox (`/labs.html`)](#2-signal-labs-interactive-dsp-sandbox)
   - [3. Speed & Pitch Visualizer (`/speed-pitch.html`)](#3-speed--pitch-visualizer)
3. [Quick Start & Installation](#-quick-start--installation)
4. [Signal Labs Interactive Experiments](#-signal-labs-interactive-experiments)
   - [Experiment 1: Wave Interference & Beat Frequency](#experiment-1-wave-interference--beat-frequency)
   - [Experiment 2: Sampling, Aliasing & Nyquist Foldback](#experiment-2-sampling-aliasing--nyquist-foldback)
   - [Experiment 3: Fourier Series & Gibbs Phenomenon](#experiment-3-fourier-series--gibbs-phenomenon)
   - [Experiment 4: Discrete Linear Convolution](#experiment-4-discrete-linear-convolution)
   - [Experiment 5: FFT Frequency Range Explorer (8th-Order Butterworth)](#experiment-5-fft-frequency-range-explorer)
5. [Audio Enhancement & Mastering Studio](#-audio-enhancement--mastering-studio)
6. [CLI & Effect Chain Reference](#-cli--effect-chain-reference)
7. [Comprehensive DSP Effects Library](#-comprehensive-dsp-effects-library)
8. [REST API Reference](#-rest-api-reference)
9. [Architecture & System Design](#-architecture--system-design)
10. [Testing & Quality Assurance](#-testing--quality-assurance)

---

## 🚀 Key Highlights

- **Pure Mathematical DSP**: Core algorithms implemented using NumPy vectorized transforms, SciPy IIR/FIR filter topologies (`sosfilt`, `butter`, `sosfreqz`), and STFT phase vocoders.
- **5 Signal Labs Interactive Experiments**: Real-time sandboxes covering Wave Interference, Nyquist Sampling & Foldback, Fourier Series expansion, Linear Convolution, and the new **Frequency Range Explorer**.
- **Dual-Engine Architecture**: Seamless bridge between zero-latency browser Web Audio API rendering and 64-bit float precision Python backend DSP services.
- **Audio Enhancement Studio**: Broadcast-grade mastering pipeline with Voice Activity Detection (VAD), Multiband Spectral Subtraction, Dereverberation, 4-Band Vocal EQ, Feedforward Compression, and ITU-R BS.1770 / EBU R128 Loudness Normalization.
- **Full CLI & Chain Runner**: Chain arbitrary combinations of 21+ DSP effects with before/after waveform and log-magnitude spectral plots.
- **Rock-Solid Test Coverage**: 130 comprehensive unit and integration tests verifying numerical stability, phase coherence, and signal boundaries.

---

## 🌐 Web Application Suite

The web workbench provides three dedicated environments:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            PyAudioLab Web Suite                             │
├───────────────────────┬────────────────────────────┬────────────────────────┤
│     Audio Studio      │        Signal Labs         │     Speed & Pitch      │
│     (index.html)      │        (labs.html)         │   (speed-pitch.html)   │
├───────────────────────┼────────────────────────────┼────────────────────────┤
│ • Interactive Waveform│ • Wave Interference & Beats│ • Tape Resampling      │
│ • FFT Log Spectrum    │ • Nyquist Aliasing Foldback│ • STFT Phase Vocoder   │
│ • STFT Spectrogram    │ • Fourier Harmonic Series  │ • Pitch Shifter        │
│ • 21+ Real-time Dials │ • Discrete Linear Conv     │ • Spectrogram Compare  │
│ • Mastering Modal     │ • Frequency Range Explorer │ • Real-time Scrubbing  │
└───────────────────────┴────────────────────────────┴────────────────────────┘
```

### 1. Audio Studio & Mastering Suite
- **Interactive Multi-Scale Visualizers**: Waveform overview with selection bounds, logarithmic FFT spectrum analyzer (20 Hz – 20 kHz), and real-time STFT 2D spectrogram.
- **Metering Rack**: Live Peak Level, RMS Energy, Crest Factor (Peak-to-Average Power Ratio), and Zero Crossing Rate (ZCR).
- **Mastering Suite**: One-click professional speech enhancement with Podcast, Voiceover, Clean Dialogue, and Broadcast presets.

### 2. Signal Labs: Interactive DSP Sandbox
- Five isolated laboratory modules combining real-time canvas oscilloscopes, mathematical step-by-step derivations, and interactive parameter manipulation.

### 3. Speed & Pitch Visualizer
- Visualizes the mathematical difference between **Time Resampling** (varispeed tape style: changes tempo and pitch together) versus **STFT Phase Vocoder Time Stretching** (tempo modified with pitch preserved) and **Pitch Shifting**.

---

## ⚡ Quick Start & Installation

### 1. Clone & Environment Setup

```bash
# Clone repository
git clone https://github.com/jobayer0606/mixed-signal-project.git
cd mixed-signal-project

# Install dependencies
pip install -r requirements.txt

# (Optional) Install in editable mode
pip install -e .
```

### 2. Launch the Web Workbench

```bash
# Start FastAPI backend & static server
python server.py
```
Open **`http://localhost:8000`** in your browser:
- **Audio Studio**: `http://localhost:8000/index.html`
- **Signal Labs**: `http://localhost:8000/labs.html`
- **Speed & Pitch**: `http://localhost:8000/speed-pitch.html`

### 3. Run Command-Line Effects

```bash
# Generate bundled test signals
python -m pyaudiolab.generate_test_wav

# Apply 8th-order Butterworth bandpass filter
python -m pyaudiolab.cli sample_wavs/test_dynamic.wav out.wav \
    --effect freq_filter --filter_type bandpass --low_freq 300 --high_freq 3000 --order 8 --plot
```

---

## 🔬 Signal Labs Interactive Experiments

Signal Labs features five dedicated DSP sandboxes:

```
+-------------------------------------------------------------------------------+
|                        SIGNAL LABS EXPERIMENT MODULES                         |
+-------------------------------------------------------------------------------+
|  1. WAVE INTERFERENCE  | Superposition, acoustic beats, envelope modulation   |
|  2. SAMPLING & ALIAS   | Continuous to discrete, Nyquist theorem, foldback    |
|  3. FOURIER SERIES     | Harmonic synthesis, Gibbs phenomenon, RMSE error     |
|  4. CONVOLUTION LAB    | Flip, shift, multiply, discrete linear convolution   |
|  5. FREQUENCY EXPLORER | FFT spectrum, draggable handles, 8th-order Butter DSP|
+-------------------------------------------------------------------------------+
```

### Experiment 1: Wave Interference & Beat Frequency
- **Theory**: $y(t) = A_1 \sin(2\pi f_1 t) + A_2 \sin(2\pi f_2 t) = 2 A \cos\left(2\pi \frac{f_1 - f_2}{2} t\right) \sin\left(2\pi \frac{f_1 + f_2}{2} t\right)$
- **Metrics**: Calculates exact Beat Frequency $f_{\text{beat}} = |f_1 - f_2|$, Average Carrier $f_c = \frac{f_1+f_2}{2}$, modulation envelope, and acoustic flutter state.
- **Audio**: Dual isolated Web Audio oscillator bank with real-time waveform sum oscilloscope.

### Experiment 2: Sampling, Aliasing & Nyquist Foldback
- **Theory**: Nyquist Sampling Theorem $f_s \ge 2 f_{\text{max}}$.
- **Aliasing Foldback**: When $f > f_s / 2$, the apparent frequency folds back:
  $$f_{\text{alias}} = \left| \left( (f + f_s/2) \pmod{f_s} \right) - f_s/2 \right|$$
- **Visualizer**: Real-time continuous analog trace superimposed with discrete impulse stem samples and folded alias reconstruction curve.

### Experiment 3: Fourier Series & Gibbs Phenomenon
- **Decomposition**: Reconstructs Square, Triangle, and Sawtooth waves from orthogonal sinusoids:
  $$\text{Square: } y(t) = \frac{4A}{\pi} \sum_{k=1}^N \frac{\sin((2k-1)\omega_0 t)}{2k-1}, \quad \text{Triangle: } y(t) = \frac{8A}{\pi^2} \sum_{k=1}^N \frac{(-1)^{k-1} \sin((2k-1)\omega_0 t)}{(2k-1)^2}$$
- **Analysis**: Calculates Mean Squared Error (MSE), Root-Mean-Square Error (RMSE %), and monitors the ~9% Gibbs phenomenon overshoot near jump discontinuities.

### Experiment 4: Discrete Linear Convolution
- **Formula**: $y[n] = x[n] * h[n] = \sum_{k=-\infty}^{\infty} x[k] h[n - k]$
- **Interactive 4-Stage Oscilloscope**:
  1. Input sequence $x[k]$
  2. Time-reversed and shifted impulse response $h[n-k]$
  3. Overlap multiplication terms $x[k] \cdot h[n-k]$
  4. Cumulative convolution output sequence $y[n]$ with full step-by-step mathematical expansion string.

### Experiment 5: FFT Frequency Range Explorer
- **Interactive FFT Spectrum**: High-resolution log-magnitude spectrum (20 Hz – 20 kHz) with dB scale calibration.
- **Dual Draggable Handles**: Interactive handles with floating frequency badges for $f_{\text{low}}$ and $f_{\text{high}}$ (or drag the entire band between handles).
- **Filter Modes**: **Low-pass** (default 300 Hz cutoff), **High-pass** (default 3000 Hz cutoff), **Band-pass** (default 300–3000 Hz), and **Notch / Band-stop**.
- **Butterworth 8th-Order DSP**: Second-order sections (SOS) implementation with **−48 dB/octave** roll-off using `scipy.signal.butter` and `scipy.signal.sosfilt`.
- **Transfer Function Curve $H(f)$**: Overlaid analytical filter response computed via `scipy.signal.sosfreqz`.
- **Audition & Playback**: "Listen to Selected Range" button with peak normalization (−0.5 dBFS) for instantaneous, clear audio comparison against the full-band original.

---

## 🎙️ Audio Enhancement & Mastering Studio

PyAudioLab features a modular vocal and speech enhancement pipeline:

```
Raw Audio ──► [1. VAD & Noise Profiler] ──► [2. Multiband Spectral Denoise]
                     │
                     ▼
          [3. Dereverberation / Late-Reflection Suppression]
                     │
                     ▼
          [4. 4-Band Parametric Voice EQ (Warmth, Air, De-box)]
                     │
                     ▼
          [5. Feedforward Voice Compressor (Auto-Knee & Makeup)]
                     │
                     ▼
          [6. True-Peak Limiter & ITU-R BS.1770 Loudness Normalizer] ──► Mastered WAV
```

### Enhancement Stages & Metrics:
- **Energy-based Voice Activity Detection (VAD)**: Computes speech preservation masks to eliminate noise pumping during vocal pauses.
- **Spectral Subtraction with Adaptive Floor**: Reduces continuous ambient rumble and hiss while preventing "musical noise" artifacts.
- **Spectral Envelope Dereverberation**: Attenuates diffuse late reflections without dry signal degradation.
- **4-Band Speech EQ**: Low-cut rumble filter (80 Hz), warmth boost (220 Hz), presence/intelligibility peak (3.2 kHz), and air shelf (10 kHz).
- **Mastering Limiter & BS.1770 / EBU R128 Loudness**: Delivers standardized podcast/broadcast levels (-16 LUFS / -14 LUFS / -23 LUFS).

---

## 🛠️ CLI & Effect Chain Reference

```bash
python -m pyaudiolab.cli <input.wav> <output.wav> --effect <effect1,effect2,...> [options]
```

### Core CLI Flags
| Flag | Default | Description |
|---|---|---|
| `--effect` | *(required)* | Comma-delimited effect chain, e.g. `freq_filter,compress,normalize` |
| `--plot` | `False` | Generates Before/After waveform and spectrum comparison plots |
| `--plot_dir` | `plots/` | Directory where visualizer PNGs are saved |

---

## 📚 Comprehensive DSP Effects Library

| Effect Name | Category | Mathematical Description | Key CLI / API Parameters |
|---|---|---|---|
| `gain` | Tier 1 — Basic | Linear amplitude scaling $y[n] = x[n] \cdot 10^{\frac{\text{gain\_db}}{20}}$ with soft clip guard | `--gain_db` (float) |
| `fade_in` / `fade_out` | Tier 1 — Basic | Linear ($env[i] = i/N$) or Exponential ($env[i] = \frac{e^t - 1}{e - 1}$) amplitude tapering | `--fade_in_ms`, `--fade_out_ms`, `--fade_curve` |
| `normalize` | Tier 1 — Basic | Peak scaling ($y = \frac{x}{\max \|x\|} \cdot T$) or RMS energy normalization | `--target_db`, `--norm_mode` (`peak`/`rms`) |
| `reverse` | Tier 1 — Basic | Time-axis inversion $y[n] = x[N - 1 - n]$ | None |
| `invert` | Tier 1 — Basic | Phase polarity inversion $y[n] = -x[n]$ (180° phase flip) | None |
| `trim_silence` | Tier 1 — Basic | Windowed RMS energy gate; removes leading/trailing/intermediate silence | `--threshold_db`, `--window_ms` |
| `hard_limit` | Tier 2 — Intermediate | Hard threshold clamping $y = \text{clip}(x, -T, +T)$ | `--threshold_db` |
| `soft_clip` | Tier 2 — Intermediate | Hyperbolic tangent saturation $y = T \cdot \tanh(x / T)$ | `--threshold_db` |
| `compress` | Tier 2 — Intermediate | Feed-forward RMS dynamics compressor with 1-pole attack/release smoothing | `--threshold_db`, `--ratio`, `--attack_ms`, `--release_ms`, `--makeup_db` |
| `delay` | Tier 2 — Intermediate | Circular delay buffer with feedback recirculation and wet/dry mix | `--delay_ms`, `--feedback`, `--delay_mix` |
| `change_speed` | Tier 2 — Intermediate | Varispeed resampling via `scipy.signal.resample` (alters pitch and tempo) | `--speed_factor` |
| `time_stretch` | Tier 3 — Advanced | Overlap-Add (OLA) Phase Vocoder; alters tempo while preserving exact pitch | `--stretch_factor`, `--window_size`, `--hop_length` |
| `eq` | Tier 3 — Advanced | 10-Band Graphic EQ (ISO 266 center frequencies 31 Hz to 16 kHz) via SOS biquads | `--eq_gains` (10 comma-separated dB values) |
| `freq_filter` | Tier 3 — Advanced | **8th-Order Butterworth Filter** (Low-pass, High-pass, Band-pass, Notch) via SOS | `--filter_type`, `--low_freq`, `--high_freq`, `--order`, `--gain_db` |
| `distort` | Tier 3 — Advanced | Tube-amp style polynomial and tanh saturation waveshaper with gain drive | `--drive_db`, `--distort_mode`, `--distort_mix` |
| `reverb` | Tier 3 — Advanced | Classic 1961 Schroeder Reverb (4 parallel comb filters + 2 series allpass filters) | `--room_size`, `--damping`, `--reverb_mix` |
| `noise_reduction` | Tier 3 — Advanced | Spectral subtraction with noise PSD estimation and spectral flooring | `--noise_dur_ms`, `--nr_strength`, `--nr_floor` |
| `enhance` | Mastering Suite | Full-stack multiband denoiser, dereverb, vocal EQ, compression, and loudness | `--preset`, `--noise_reduction`, `--voice_clarity`, `--loudness` |

---

## 📡 REST API Reference

The FastAPI server exposes clean JSON endpoints for DSP calculations, file operations, and audio streaming:

### Core File & Effect Endpoints

```http
POST /api/upload
Content-Type: multipart/form-data
Body: file (WAV or MP3)
Response: { "file_id": "...", "filename": "audio.wav", "sample_rate": 44100, "duration_s": 3.5, "channels": 2 }
```

```http
POST /api/effects/{effect_name}
Content-Type: application/json
Body: { "file_id": "...", "params": { "gain_db": 6.0 }, "selection": { "start_s": 0.0, "end_s": 1.5 } }
Response: { "file_id": "new-file-id", "sample_rate": 44100, "duration_s": 3.5 }
```

```http
GET /api/download/{file_id}
Response: Audio stream (audio/wav with Accept-Ranges: bytes)
```

```http
POST /api/effects/enhance
Content-Type: application/json
Body: { "file_id": "...", "noise_reduction": 0.7, "voice_clarity": 0.5, "room_reduction": 0.45, "loudness": -16.0 }
Response: { "enhanced_file_id": "...", "input_metrics": {...}, "output_metrics": {...}, "stages": [...] }
```

### Signal Labs Endpoints

```http
POST /api/labs/freq_filter
Content-Type: application/json
Body: {
  "file_id": "uuid-string",
  "filter_type": "bandpass",
  "low_freq": 300.0,
  "high_freq": 3000.0,
  "order": 8,
  "normalize_audio": true,
  "num_bars": 64
}
Response: {
  "file_id": "...",
  "filtered_file_id": "...",
  "spectrum_before": { "bars": [...] },
  "spectrum_after": { "bars": [...] },
  "response_curve": [...],
  "bandwidth_hz": 2700.0,
  "peak_before": 0.85,
  "peak_after": 0.95
}
```

```http
POST /api/labs/beat
Body: { "f1": 440.0, "f2": 444.0, "a1": 0.8, "a2": 0.8, "shape1": "sine", "shape2": "sine" }
```

```http
POST /api/labs/sampling
Body: { "f": 700.0, "fs": 1000.0, "amp": 0.8 }
```

```http
POST /api/labs/fourier
Body: { "shape": "square", "n_terms": 5, "amp": 0.8, "f0": 100.0 }
```

```http
POST /api/labs/convolution
Body: { "x": [1.0, 2.0, 1.0], "h": [1.0, 1.0], "n_index": 2 }
```

---

## 🏗️ Architecture & System Design

```
mixed-signal-project/
├── server.py                        # FastAPI backend application & routing
├── setup.py                         # Package installer configuration
├── requirements.txt                 # Project dependencies
├── pyaudiolab/                      # Core DSP package
│   ├── __init__.py                  # Package root & public exports
│   ├── cli.py                       # CLI parser & chain pipeline runner
│   ├── io_utils.py                  # Audio I/O (float64 mono/stereo contract)
│   ├── labs.py                      # Pure Python calculation engines for Labs
│   ├── spectral.py                  # FFT log spectra & STFT spectrograms
│   ├── visualize.py                 # Matplotlib waveform & spectral plot generator
│   ├── generate_test_wav.py         # Synthetic audio generator
│   └── effects/                     # 21+ DSP effect implementations
│       ├── __init__.py              # Central Effect Registry
│       ├── basic.py                 # Reverse, invert, trim silence
│       ├── compressor.py            # Vocal compressor
│       ├── delay.py                 # Feedback delay line & echo
│       ├── dereverb.py              # Spectral envelope dereverberator
│       ├── distortion.py            # Waveshaping saturation
│       ├── dynamics.py              # Hard limiter, soft clipper, RMS compressor
│       ├── enhance.py               # Multiband voice enhancement pipeline
│       ├── eq.py                    # 10-band graphic EQ (biquad IIR)
│       ├── fades.py                 # Linear & exponential fades
│       ├── freq_filter.py           # 8th-order Butterworth Frequency Filter
│       ├── gain.py                  # dB gain scaling & soft clip guard
│       ├── limiter.py               # Lookahead true-peak limiter
│       ├── loudness.py              # BS.1770 / EBU R128 loudness normalizer
│       ├── neural_enhance.py        # Neural spectral enhancer fallback
│       ├── noise_reduction.py       # Spectral subtraction denoiser
│       ├── normalize.py             # Peak & RMS normalization
│       ├── pitch_time.py            # Resampling speed & phase vocoder stretch
│       ├── reverb.py                # Schroeder reverberator (comb + allpass)
│       ├── vad.py                   # Energy & spectral Voice Activity Detector
│       └── voice_eq.py              # 4-band speech presence parametric EQ
├── sample_wavs/                     # Bundled audio demos (dynamic, noise, sine, etc.)
├── static/                          # Web Workbench frontend assets
│   ├── index.html                   # Audio Studio & Mastering Workbench
│   ├── app.js                       # Audio Studio client & canvas rendering
│   ├── style.css                    # Audio Studio theme & responsive styling
│   ├── labs.html                    # Signal Labs Interactive Experiments
│   ├── labs.js                      # Signal Labs controllers & math visualizers
│   ├── labs.css                     # Signal Labs dark laboratory styling
│   ├── speed-pitch.html             # Speed, Pitch & Resampling Workbench
│   ├── speed-pitch.js               # Phase vocoder & varispeed visualizer
│   └── speed-pitch.css              # Speed & pitch styling
└── tests/                           # Complete Test Suite (130 tests)
    ├── conftest.py                  # Synthetic audio fixtures & generators
    ├── test_basic.py
    ├── test_delay.py
    ├── test_dynamics.py
    ├── test_enhance.py
    ├── test_eq.py
    ├── test_fades.py
    ├── test_freq_filter.py          # 8th-order Butterworth filter unit tests
    ├── test_gain.py
    ├── test_labs.py                 # Signal Labs DSP & API unit tests
    ├── test_noise_reduction.py
    ├── test_normalize.py
    ├── test_pitch_time.py
    ├── test_reverb.py
    ├── test_server.py               # FastAPI endpoint integration tests
    └── test_spectral.py
```

---

## 🧪 Testing & Quality Assurance

All unit tests run on synthetic mathematical signals (pure sines, white noise, harmonic sweeps, impulses, and silence) with zero external audio dependencies:

```bash
# Run complete test suite
$env:PYTHONPATH="."; python -m pytest -v

# Run specific test module
$env:PYTHONPATH="."; python -m pytest tests/test_freq_filter.py -v

# Run with test coverage report
$env:PYTHONPATH="."; python -m pytest --cov=pyaudiolab --cov-report=term-missing
```

### Test Suite Summary:
```
============================== 130 passed in 4.64s ==============================
✔ tests/test_basic.py .................
✔ tests/test_delay.py ......
✔ tests/test_dynamics.py ...........
✔ tests/test_enhance.py ...........
✔ tests/test_eq.py ........
✔ tests/test_fades.py ..........
✔ tests/test_freq_filter.py ........
✔ tests/test_gain.py ........
✔ tests/test_labs.py .......
✔ tests/test_noise_reduction.py ..........
✔ tests/test_normalize.py .......
✔ tests/test_pitch_time.py ...........
✔ tests/test_reverb.py ........
✔ tests/test_server.py ..
✔ tests/test_spectral.py ......
```

---

## 📄 License

Distributed under the **MIT License**. See `LICENSE` for details.
Designed with precision for audio engineers, DSP researchers, and signal processing students.