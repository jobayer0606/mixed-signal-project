/* =====================================================================
   SIGNAL LAB â€” app.js
   DSP visualization workbench over the PyAudioLab FastAPI backend.

   HARD RULE: every pixel drawn to the waveform, spectrum, spectrogram
   and meter canvases comes from actually decoded / actually processed
   PCM audio (Web Audio API decode of real WAV bytes returned by the
   backend), or from the exact closed-form transfer function the
   backend DSP uses (EQ biquad response, compressor gain-computer,
   distortion waveshaper) evaluated on the real parameter values.
   There is NO synthetic "demo" signal and NO canned effect animation
   anywhere in this file. While a backend request is in flight the UI
   shows a "Processingâ€¦" state instead of guessing at the result.
   ===================================================================== */

(() => {
"use strict";

/* --------------------------------------------------------------- *
 * 1. EFFECT METADATA â€” param UI schema + detail-panel routing      *
 * --------------------------------------------------------------- */

const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

const GROUPS = [
  { id: "shape",    label: "Level & shape", keys: ["gain", "normalize", "fade_in", "fade_out", "invert", "trim_silence"] },
  { id: "dynamics", label: "Dynamics",       keys: ["hard_limit", "soft_clip", "compress", "distort"] },
  { id: "time",     label: "Time & pitch",   keys: ["reverse", "delay", "change_speed", "time_stretch", "reverb"] },
  { id: "spectral", label: "Spectral",       keys: ["eq", "noise_reduction"] },
];

const EFFECTS = {
  gain: {
    label: "Gain", tier: "Basic", detail: "generic",
    explain: "Multiplies every sample by a constant factor. The whole trace grows or shrinks uniformly â€” nothing about its shape changes, only its loudness.",
    params: [{ key: "gain_db", type: "dial", min: -24, max: 24, step: 0.5, unit: "dB", def: 3 }],
  },
  normalize: {
    label: "Normalize", tier: "Basic", detail: "generic",
    explain: "Measures the loudest point (or RMS level) in the signal, then scales the entire track so that peak lands exactly on the target.",
    params: [
      { key: "target_db", type: "dial", min: -12, max: 0, step: 0.1, unit: "dB", def: -1 },
      { key: "mode", type: "seg", options: ["peak", "rms"], def: "peak" },
    ],
  },
  fade_in: {
    label: "Fade In", tier: "Basic", detail: "generic",
    explain: "Multiplies the start of the signal by a ramp that climbs from 0 to 1, so playback eases in instead of starting abruptly.",
    params: [
      { key: "duration_ms", type: "dial", min: 10, max: 3000, step: 10, unit: "ms", def: 500 },
      { key: "curve", type: "seg", options: ["linear", "exponential"], def: "linear" },
    ],
  },
  fade_out: {
    label: "Fade Out", tier: "Basic", detail: "generic",
    explain: "Multiplies the tail of the signal by a ramp that falls from 1 to 0, so playback eases out instead of cutting off sharply.",
    params: [
      { key: "duration_ms", type: "dial", min: 10, max: 3000, step: 10, unit: "ms", def: 500 },
      { key: "curve", type: "seg", options: ["linear", "exponential"], def: "linear" },
    ],
  },
  invert: {
    label: "Phase Invert", tier: "Basic", detail: "generic",
    explain: "Flips the sign of every sample. The waveform mirrors across the zero line â€” identical loudness and shape, opposite polarity.",
    params: [],
  },
  trim_silence: {
    label: "Trim Silence", tier: "Basic", detail: "generic",
    explain: "Scans for stretches below the threshold and removes them, pulling the remaining audio together.",
    params: [
      { key: "threshold_db", type: "dial", min: -60, max: -10, step: 1, unit: "dB", def: -40 },
      { key: "window_ms", type: "dial", min: 5, max: 100, step: 5, unit: "ms", def: 20 },
    ],
  },
  hard_limit: {
    label: "Hard Limiter", tier: "Intermediate", detail: "generic",
    explain: "Any sample above the threshold gets clipped flat at that ceiling â€” a hard wall the signal cannot cross.",
    params: [{ key: "threshold_db", type: "dial", min: -24, max: 0, step: 0.5, unit: "dB", def: -6 }],
  },
  soft_clip: {
    label: "Soft Clipper", tier: "Intermediate", detail: "generic",
    explain: "Samples approaching the threshold are rounded off with a tanh curve instead of clipped flat â€” gentler, with added harmonics.",
    params: [{ key: "threshold_db", type: "dial", min: -24, max: 0, step: 0.5, unit: "dB", def: -6 }],
  },
  compress: {
    label: "Compressor", tier: "Intermediate", detail: "compressor",
    explain: "Signal above the threshold is turned down by the ratio, so loud and quiet passages sit closer together in level.",
    params: [
      { key: "threshold_db", type: "dial", min: -40, max: 0, step: 0.5, unit: "dB", def: -20 },
      { key: "ratio", type: "dial", min: 1, max: 20, step: 0.5, unit: ":1", def: 4 },
      { key: "attack_ms", type: "dial", min: 1, max: 100, step: 1, unit: "ms", def: 10 },
      { key: "release_ms", type: "dial", min: 10, max: 500, step: 5, unit: "ms", def: 100 },
      { key: "makeup_db", type: "dial", min: 0, max: 24, step: 0.5, unit: "dB", def: 0 },
    ],
  },
  distort: {
    label: "Distortion", tier: "Stretch", detail: "distortion",
    explain: "Pushes the signal into nonlinear territory, adding harmonics â€” the waveform squares off and the spectrum gains overtones.",
    params: [
      { key: "drive_db", type: "dial", min: 0, max: 36, step: 1, unit: "dB", def: 12 },
      { key: "mode", type: "seg", options: ["soft", "hard"], def: "soft" },
      { key: "mix", type: "dial", min: 0, max: 1, step: 0.01, unit: "", def: 1 },
    ],
  },
  reverse: {
    label: "Reverse", tier: "Basic", detail: "generic",
    explain: "Reads every sample back to front. The shape is identical, just played in the opposite order â€” watch it flip end-for-end in the waveform.",
    params: [],
  },
  delay: {
    label: "Delay / Echo", tier: "Intermediate", detail: "generic",
    explain: "Mixes the signal with attenuated, time-shifted copies of itself, each copy quieter than the last as feedback decays. The repeats are visible directly in the waveform.",
    params: [
      { key: "delay_ms", type: "dial", min: 10, max: 1000, step: 10, unit: "ms", def: 250 },
      { key: "feedback", type: "dial", min: 0, max: 0.95, step: 0.01, unit: "", def: 0.4 },
      { key: "mix", type: "dial", min: 0, max: 1, step: 0.01, unit: "", def: 0.5 },
    ],
  },
  change_speed: {
    label: "Speed / Rate", tier: "Intermediate", detail: "generic",
    explain: "Resamples the signal at a new rate. Faster playback compresses the waveform in time AND raises pitch; slower does the reverse.",
    params: [{ key: "factor", type: "dial", min: 0.25, max: 4, step: 0.05, unit: "x", def: 1.25 }],
  },
  time_stretch: {
    label: "Time Stretch", tier: "Stretch", detail: "generic",
    explain: "Uses a phase vocoder to compress or expand the signal in time while keeping pitch constant â€” length changes, tone doesn't.",
    params: [{ key: "factor", type: "dial", min: 0.25, max: 4, step: 0.05, unit: "x", def: 1.25 }],
  },
  eq: {
    label: "10-Band EQ", tier: "Stretch", detail: "eq",
    explain: "Ten peaking filters, one per band, each boosting or cutting a narrow range of frequencies around its center.",
    params: [{ key: "gains_db", type: "eqbands", bands: EQ_BANDS, min: -12, max: 12, def: EQ_BANDS.map(() => 0) }],
  },
  reverb: {
    label: "Schroeder Reverb", tier: "Stretch", detail: "generic",
    explain: "Runs the signal through parallel comb filters and series allpass filters to build a dense, decaying reflection tail â€” visible as trailing energy after the dry signal ends.",
    params: [
      { key: "room_size", type: "dial", min: 0, max: 1, step: 0.01, unit: "", def: 0.5 },
      { key: "damping", type: "dial", min: 0, max: 1, step: 0.01, unit: "", def: 0.5 },
      { key: "mix", type: "dial", min: 0, max: 1, step: 0.01, unit: "", def: 0.3 },
    ],
  },
  noise_reduction: {
    label: "Noise Reduction", tier: "Stretch", detail: "generic",
    explain: "Estimates the noise floor from a quiet region, then subtracts that spectral profile from every frame via FFT.",
    params: [
      { key: "noise_duration_ms", type: "dial", min: 100, max: 2000, step: 50, unit: "ms", def: 500 },
      { key: "strength", type: "dial", min: 0, max: 3, step: 0.1, unit: "x", def: 1 },
      { key: "floor", type: "dial", min: 0, max: 0.02, step: 0.001, unit: "", def: 0.002 },
    ],
  },
};

const ICONS = {
  gain: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  normalize: '<path d="M4 18V6M9 18V9M14 18v-9M19 18V6"/>',
  fade_in: '<path d="M3 18 L21 6 M3 18 L21 18"/>',
  fade_out: '<path d="M3 6 L21 18 M3 18 L21 18"/>',
  invert: '<path d="M3 12h18 M6 12 L6 5 M10 12 L10 8 M14 12 L14 17 M18 12 L18 6"/>',
  trim_silence: '<path d="M3 12h5 M9 12l1-6 2 12 1-6h9" opacity=".9"/><path d="M9 12h6" stroke-dasharray="2 2"/>',
  hard_limit: '<path d="M3 6h18 M3 6 L3 18 M3 18 L9 6 M9 6 L15 18 M15 18 L21 6"/>',
  soft_clip: '<path d="M3 18c3-1 4-10 7-11s3 9 6 9 3-6 5-6"/>',
  compress: '<path d="M4 4v16M20 4v16 M4 12h16" opacity=".5"/><path d="M8 8l8 8M16 8l-8 8"/>',
  distort: '<path d="M3 12h2l2-7 2 14 2-14 2 14 2-7h2l2 4h2"/>',
  reverse: '<path d="M7 7l-4 5 4 5 M3 12h18"/>',
  delay: '<path d="M3 12h5 M11 12h4 M18 12h3" /><circle cx="4.5" cy="12" r="1.5"/><circle cx="13" cy="12" r="1.5" opacity=".6"/><circle cx="19.5" cy="12" r="1.5" opacity=".3"/>',
  change_speed: '<path d="M3 17l6-10 6 10 6-10"/>',
  time_stretch: '<path d="M3 12h2m3 0h2m3 0h2m3 0h2m3 0h2" stroke-width="2.4"/>',
  eq: '<path d="M4 20V10M9 20V4M14 20v-8M19 20V8"/>',
  reverb: '<path d="M4 12c2-6 4-6 6 0s4 6 6 0 4-6 6 0" opacity=".9"/>',
  noise_reduction: '<path d="M3 14l3-8 3 12 3-16 3 10 3-6 3 8"/>',
};

/* --------------------------------------------------------------- *
 * 2. STATE                                                          *
 * --------------------------------------------------------------- */

const API = "/api";

const state = {
  audioCtx: null,
  fileId: null,           // committed session id on server (source of truth for "original/base")
  filename: null,
  sampleRate: 44100,
  duration: 0,
  channels: 1,
  currentBuffer: null,    // AudioBuffer â€” last committed (base) signal
  previewBuffer: null,    // AudioBuffer â€” pending live-preview signal (real backend output)
  previewFileId: null,
  activeEffect: null,     // key into EFFECTS
  paramValues: {},
  appliedEffects: new Set(),
  debounceTimer: null,
  requestGen: 0,          // guards against stale async responses overwriting newer ones
  isProcessing: false,

  // A/B + view state
  abMode: "original",     // 'original' | 'processed' â€” controls playback + primary trace
  view: { start: 0, end: 0 },   // seconds, current waveform zoom window
  selection: null,        // { startS, endS } | null
  selectionOnly: false,

  // caches
  spectrogramCache: null,  // { key, canvas }

  // audio graph for live meters
  htmlAudio: new Audio(),
  mediaSource: null,
  analyserL: null,
  analyserR: null,
  meterRAF: null,
};

function ac() {
  if (!state.audioCtx) state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return state.audioCtx;
}

/* --------------------------------------------------------------- *
 * 3. DOM SHORTCUTS                                                  *
 * --------------------------------------------------------------- */

const $ = (id) => document.getElementById(id);
const waveCanvas = $("waveform-canvas");
const rulerCanvas = $("ruler-canvas");
const spectrumCanvas = $("spectrum-canvas");
const spectrogramCanvas = $("spectrogram-canvas");
const detailCanvas = $("detail-canvas");
const waveCtx = waveCanvas.getContext("2d");
const rulerCtx = rulerCanvas.getContext("2d");
const spectrumCtx = spectrumCanvas.getContext("2d");
const spectrogramCtx = spectrogramCanvas.getContext("2d");
const detailCtx = detailCanvas.getContext("2d");

function fitCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w: rect.width, h: rect.height };
}

/* --------------------------------------------------------------- *
 * 4. TOAST / STATUS                                                 *
 * --------------------------------------------------------------- */

let toastTimer = null;
function toast(msg, type = "") {
  const el = $("toast");
  el.textContent = msg;
  el.className = "toast show" + (type ? " " + type : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}
function setStatus(msg) { $("status-text").textContent = msg; }

/* --------------------------------------------------------------- *
 * 5. FFT (radix-2, real input via Hann window) â€” shared by         *
 *    spectrum analyzer + spectrogram, all on real decoded PCM      *
 * --------------------------------------------------------------- */

function fft(re, im) {
  const n = re.length;
  if (n <= 1) return;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cwr = 1, cwi = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cwr - im[i + k + len / 2] * cwi;
        const vi = re[i + k + len / 2] * cwi + im[i + k + len / 2] * cwr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const nwr = cwr * wr - cwi * wi, nwi = cwr * wi + cwi * wr;
        cwr = nwr; cwi = nwi;
      }
    }
  }
}

function nextPow2(n) { let p = 1; while (p < n) p <<= 1; return p; }

/** Compute a log-binned magnitude spectrum (0..1 normalized dB) for a mono Float32Array. */
function computeSpectrum(samples, sr, numBars = 48, fftSize = 2048) {
  const size = nextPow2(Math.min(fftSize, nextPow2(Math.max(1, samples.length))));
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const start = Math.max(0, Math.floor((samples.length - size) / 2));
  for (let i = 0; i < size; i++) {
    const s = samples[start + i] || 0;
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)); // Hann
    re[i] = s * w;
  }
  fft(re, im);
  const half = size / 2;
  const mags = new Float64Array(half);
  for (let i = 0; i < half; i++) mags[i] = Math.hypot(re[i], im[i]) / half;

  const minHz = 20, maxHz = sr / 2;
  const bars = new Float64Array(numBars);
  const logMin = Math.log10(minHz), logMax = Math.log10(maxHz);
  for (let b = 0; b < numBars; b++) {
    const f0 = Math.pow(10, logMin + ((logMax - logMin) * b) / numBars);
    const f1 = Math.pow(10, logMin + ((logMax - logMin) * (b + 1)) / numBars);
    const i0 = Math.max(1, Math.floor((f0 / maxHz) * half));
    const i1 = Math.min(half, Math.ceil((f1 / maxHz) * half));
    let peak = 0;
    for (let i = i0; i < i1; i++) peak = Math.max(peak, mags[i]);
    const db = 20 * Math.log10(peak + 1e-6);
    bars[b] = Math.max(0, Math.min(1, (db + 90) / 90)); // normalize -90..0dB -> 0..1
  }
  return bars;
}

/** Real STFT-based spectrogram. Returns {cols, rows, data(Float32 0..1), sr, fftSize, hopSize, durationS}. */
function computeSpectrogram(samples, sr, targetCols = 360, targetRows = 160, fftSize = 1024) {
  const n = samples.length;
  if (n < fftSize) fftSize = nextPow2(Math.max(64, n));
  let hop = Math.max(32, Math.floor((n - fftSize) / Math.max(1, targetCols - 1)));
  let cols = Math.max(1, Math.floor((n - fftSize) / hop) + 1);
  if (cols > targetCols * 2) { hop = Math.floor((n - fftSize) / targetCols); cols = Math.max(1, Math.floor((n - fftSize) / hop) + 1); }

  const half = fftSize / 2;
  const window = new Float64Array(fftSize);
  for (let i = 0; i < fftSize; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (fftSize - 1));

  const minHz = 20, maxHz = sr / 2;
  const logMin = Math.log10(minHz), logMax = Math.log10(maxHz);
  const rowLo = new Int32Array(targetRows), rowHi = new Int32Array(targetRows);
  for (let r = 0; r < targetRows; r++) {
    const f0 = Math.pow(10, logMin + ((logMax - logMin) * r) / targetRows);
    const f1 = Math.pow(10, logMin + ((logMax - logMin) * (r + 1)) / targetRows);
    rowLo[r] = Math.max(1, Math.floor((f0 / maxHz) * half));
    rowHi[r] = Math.min(half, Math.ceil((f1 / maxHz) * half));
  }

  const data = new Float32Array(cols * targetRows);
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);

  for (let c = 0; c < cols; c++) {
    const start = c * hop;
    im.fill(0);
    for (let i = 0; i < fftSize; i++) {
      const s = samples[start + i] || 0;
      re[i] = s * window[i];
    }
    fft(re, im);
    for (let r = 0; r < targetRows; r++) {
      let peak = 0;
      for (let i = rowLo[r]; i < rowHi[r]; i++) {
        const mag = Math.hypot(re[i], im[i]) / half;
        if (mag > peak) peak = mag;
      }
      const db = 20 * Math.log10(peak + 1e-7);
      data[c * targetRows + r] = Math.max(0, Math.min(1, (db + 95) / 95));
    }
  }
  return { cols, rows: targetRows, data, sr, fftSize, hopSize: hop, durationS: n / sr };
}

/* --------------------------------------------------------------- *
 * 6. AUDIO BUFFER HELPERS (real PCM utilities)                     *
 * --------------------------------------------------------------- */

function monoOf(audioBuffer) {
  if (!audioBuffer) return new Float32Array(0);
  if (audioBuffer.numberOfChannels === 1) return audioBuffer.getChannelData(0);
  const a = audioBuffer.getChannelData(0), b = audioBuffer.getChannelData(1);
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = (a[i] + b[i]) / 2;
  return out;
}

function channelOf(audioBuffer, ch) {
  if (!audioBuffer) return new Float32Array(0);
  const idx = Math.min(ch, audioBuffer.numberOfChannels - 1);
  return audioBuffer.getChannelData(idx);
}

function peakDb(samples) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) { const a = Math.abs(samples[i]); if (a > peak) peak = a; }
  return 20 * Math.log10(Math.max(peak, 1e-9));
}
function rmsDb(samples) {
  if (!samples.length) return -120;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / samples.length);
  return 20 * Math.log10(Math.max(rms, 1e-9));
}

function downsampleMinMax(samples, buckets) {
  const min = new Float32Array(buckets), max = new Float32Array(buckets);
  const bucketSize = samples.length / buckets;
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * bucketSize);
    const end = Math.max(start + 1, Math.floor((b + 1) * bucketSize));
    let lo = 1, hi = -1;
    for (let i = start; i < end && i < samples.length; i++) {
      const v = samples[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (lo > hi) { lo = 0; hi = 0; }
    min[b] = lo; max[b] = hi;
  }
  return { min, max };
}

/* --------------------------------------------------------------- *
 * 7. COLORS                                                         *
 * --------------------------------------------------------------- */

const COLOR_A = "rgba(255,180,84,FILLALPHA)";
const COLOR_A_STROKE = "#ffb454";
const COLOR_A_GLOW = "rgba(255,180,84,.5)";
const COLOR_B = "rgba(155,140,255,FILLALPHA)";
const COLOR_B_STROKE = "#9b8cff";
const COLOR_B_GLOW = "rgba(155,140,255,.55)";

/* --------------------------------------------------------------- *
 * 8. WAVEFORM PANEL â€” real envelope, ruler, zoom, selection,       *
 *    synchronized playhead                                          *
 * --------------------------------------------------------------- */

function activeDisplayBuffers() {
  // "original" trace is always the last committed signal.
  // "processed" trace is the pending live preview, or (once nothing is
  // pending) the same committed signal â€” never a fabricated one.
  const original = state.currentBuffer;
  const processed = state.previewBuffer || state.currentBuffer;
  return { original, processed };
}

function playbackTarget() {
  if (state.abMode === "processed" && state.previewFileId) {
    return { fileId: state.previewFileId, buffer: state.previewBuffer };
  }
  return { fileId: state.fileId, buffer: state.currentBuffer };
}

function ensureView() {
  if (!state.currentBuffer) return;
  const dur = state.currentBuffer.duration;
  if (state.view.end <= state.view.start || state.view.end > dur + 0.001) {
    state.view = { start: 0, end: dur };
  }
}

function zoomFactor() {
  const dur = state.currentBuffer ? state.currentBuffer.duration : 1;
  const span = state.view.end - state.view.start;
  return dur > 0 ? dur / Math.max(span, 1e-6) : 1;
}

function drawWaveGrid(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(255,255,255,.05)";
  ctx.lineWidth = 1;
  [1, 0.5, 0, -0.5, -1].forEach((amp) => {
    const y = h / 2 - amp * (h / 2) * 0.92;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  });
  ctx.strokeStyle = "rgba(255,255,255,.12)";
  ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();

  ctx.fillStyle = "rgba(146,160,177,.55)";
  ctx.font = "9px 'IBM Plex Mono', monospace";
  ctx.fillText("+1.0", 4, h / 2 - (h / 2) * 0.92 + 9);
  ctx.fillText("0", 4, h / 2 - 3);
  ctx.fillText("-1.0", 4, h / 2 + (h / 2) * 0.92 - 2);
}

function timeToX(t, w) {
  const { start, end } = state.view;
  return ((t - start) / Math.max(end - start, 1e-9)) * w;
}
function xToTime(x, w) {
  const { start, end } = state.view;
  return start + (x / w) * (end - start);
}

function drawEnvelopeInView(ctx, samples, sr, w, h, color, glow, alpha = 1) {
  const { start, end } = state.view;
  const totalSamples = samples.length;
  const s0 = Math.max(0, Math.floor(start * sr));
  const s1 = Math.min(totalSamples, Math.ceil(end * sr));
  if (s1 <= s0) return;
  const view = samples.subarray(s0, s1);
  const buckets = Math.max(2, Math.min(Math.floor(w), view.length));
  const { min, max } = downsampleMinMax(view, buckets);
  const mid = h / 2;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  for (let i = 0; i < buckets; i++) {
    const x = (i / (buckets - 1 || 1)) * w;
    const y = mid - max[i] * mid * 0.92;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  for (let i = buckets - 1; i >= 0; i--) {
    const x = (i / (buckets - 1 || 1)) * w;
    const y = mid - min[i] * mid * 0.92;
    ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = color.replace("FILLALPHA", "0.16");
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.25;
  ctx.shadowColor = glow;
  ctx.shadowBlur = 5;
  ctx.stroke();
  ctx.restore();
}

function renderWaveform() {
  const { w, h } = fitCanvas(waveCanvas);
  drawWaveGrid(waveCtx, w, h);
  if (!state.currentBuffer) return;
  ensureView();

  const { original, processed } = activeDisplayBuffers();
  const hasPreview = !!state.previewBuffer;

  drawEnvelopeInView(waveCtx, monoOf(original), original.sampleRate, w, h, COLOR_A, COLOR_A_GLOW, hasPreview ? 0.5 : 1);
  if (hasPreview) {
    drawEnvelopeInView(waveCtx, monoOf(processed), processed.sampleRate, w, h, COLOR_B, COLOR_B_GLOW, 0.95);
  }

  if (state.selection) {
    const x0 = timeToX(state.selection.startS, w);
    const x1 = timeToX(state.selection.endS, w);
    waveCtx.save();
    waveCtx.fillStyle = "rgba(255,255,255,.07)";
    waveCtx.fillRect(Math.min(x0, x1), 0, Math.abs(x1 - x0), h);
    waveCtx.strokeStyle = "rgba(255,255,255,.35)";
    waveCtx.lineWidth = 1;
    waveCtx.beginPath(); waveCtx.moveTo(x0, 0); waveCtx.lineTo(x0, h); waveCtx.stroke();
    waveCtx.beginPath(); waveCtx.moveTo(x1, 0); waveCtx.lineTo(x1, h); waveCtx.stroke();
    waveCtx.restore();
  }

  const { buffer: playBuf } = playbackTarget();
  if (state.htmlAudio.duration && playBuf) {
    const t = state.htmlAudio.currentTime;
    const x = timeToX(t, w);
    if (x >= 0 && x <= w) {
      waveCtx.save();
      waveCtx.strokeStyle = "#fff";
      waveCtx.globalAlpha = 0.85;
      waveCtx.lineWidth = 1.5;
      waveCtx.shadowColor = "rgba(255,255,255,.8)";
      waveCtx.shadowBlur = 6;
      waveCtx.beginPath(); waveCtx.moveTo(x, 0); waveCtx.lineTo(x, h); waveCtx.stroke();
      waveCtx.restore();
    }
  }

  renderRuler();
  updateWaveformSub();
}

function renderRuler() {
  const { w, h } = fitCanvas(rulerCanvas);
  rulerCtx.clearRect(0, 0, w, h);
  if (!state.currentBuffer) return;
  const { start, end } = state.view;
  const span = end - start;
  const roughStep = span / 8;
  const steps = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  let step = steps[steps.length - 1];
  for (const s of steps) { if (s >= roughStep) { step = s; break; } }
  const first = Math.ceil(start / step) * step;
  rulerCtx.font = "9.5px 'IBM Plex Mono', monospace";
  rulerCtx.fillStyle = "rgba(146,160,177,.8)";
  rulerCtx.strokeStyle = "rgba(255,255,255,.1)";
  for (let t = first; t <= end + 1e-9; t += step) {
    const x = timeToX(t, w);
    rulerCtx.beginPath(); rulerCtx.moveTo(x, 0); rulerCtx.lineTo(x, 5); rulerCtx.stroke();
    const label = step < 1 ? `${(t).toFixed(step < 0.01 ? 3 : 2)}s` : fmtTime(t);
    rulerCtx.fillText(label, Math.min(Math.max(x + 3, 2), w - 40), 15);
  }
}

function updateWaveformSub() {
  const el = $("waveform-sub");
  if (!state.currentBuffer) { el.textContent = ""; return; }
  const span = state.view.end - state.view.start;
  el.textContent = `${span.toFixed(span < 1 ? 3 : 2)}s window Â· ${zoomFactor().toFixed(1)}Ã—`;
  $("zoom-label").textContent = `${zoomFactor().toFixed(1)}Ã—`;
}

/* --------------------------------------------------------------- *
 * 9. SPECTRUM PANEL â€” real FFT bars + freq/dB axes + EQ overlay    *
 * --------------------------------------------------------------- */

function renderSpectrum() {
  const { w, h } = fitCanvas(spectrumCanvas);
  spectrumCtx.clearRect(0, 0, w, h);
  if (!state.currentBuffer) return;

  const axisPad = { l: 30, b: 14, t: 4, r: 2 };
  const plotW = w - axisPad.l - axisPad.r;
  const plotH = h - axisPad.b - axisPad.t;

  spectrumCtx.strokeStyle = "rgba(255,255,255,.05)";
  spectrumCtx.fillStyle = "rgba(146,160,177,.6)";
  spectrumCtx.font = "9px 'IBM Plex Mono', monospace";
  for (let db = 0; db >= -90; db -= 18) {
    const y = axisPad.t + (1 - (db + 90) / 90) * plotH;
    spectrumCtx.beginPath(); spectrumCtx.moveTo(axisPad.l, y); spectrumCtx.lineTo(w - axisPad.r, y); spectrumCtx.stroke();
    spectrumCtx.fillText(`${db}`, 2, y + 3);
  }

  const { original, processed } = activeDisplayBuffers();
  const hasPreview = !!state.previewBuffer;
  const numBars = Math.max(24, Math.floor(plotW / 10));
  const origBars = computeSpectrum(monoOf(original), original.sampleRate, numBars);
  const procBars = hasPreview ? computeSpectrum(monoOf(processed), processed.sampleRate, numBars) : null;

  const gap = 2;
  const bw = (plotW - gap * (numBars - 1)) / numBars;
  for (let i = 0; i < numBars; i++) {
    const x = axisPad.l + i * (bw + gap);
    const bhA = origBars[i] * plotH;
    spectrumCtx.fillStyle = procBars ? "rgba(255,180,84,.35)" : "rgba(255,180,84,.75)";
    spectrumCtx.fillRect(x, axisPad.t + plotH - bhA, bw, bhA);
    if (procBars) {
      const bhB = procBars[i] * plotH;
      spectrumCtx.fillStyle = "rgba(155,140,255,.82)";
      const bw2 = bw * 0.55;
      spectrumCtx.fillRect(x + bw - bw2, axisPad.t + plotH - bhB, bw2, bhB);
    }
  }

  const sr = original.sampleRate;
  const maxHz = Math.min(20000, sr / 2);
  const freqs = [20, 100, 1000, 10000].filter((f) => f <= maxHz);
  const logMin = Math.log10(20), logMax = Math.log10(maxHz);
  spectrumCtx.fillStyle = "rgba(146,160,177,.7)";
  freqs.forEach((f) => {
    const frac = (Math.log10(f) - logMin) / (logMax - logMin);
    const x = axisPad.l + frac * plotW;
    const label = f >= 1000 ? `${f / 1000}k` : `${f}`;
    spectrumCtx.fillText(label, x - 8, h - 2);
  });

  if (state.activeEffect === "eq") {
    drawEqCurveOverlay(spectrumCtx, axisPad, plotW, plotH, sr);
  }
}

function biquadPeakingDb(f, sr, centerHz, gainDb, q) {
  if (Math.abs(gainDb) < 1e-6 || centerHz >= sr / 2) return 0;
  const A = Math.pow(10, gainDb / 40);
  const w0 = 2 * Math.PI * centerHz / sr;
  const cosw0 = Math.cos(w0), sinw0 = Math.sin(w0);
  const alpha = sinw0 / (2 * q);
  const b0 = 1 + alpha * A, b1 = -2 * cosw0, b2 = 1 - alpha * A;
  const a0 = 1 + alpha / A, a1 = -2 * cosw0, a2 = 1 - alpha / A;
  const B0 = b0 / a0, B1 = b1 / a0, B2 = b2 / a0, A1 = a1 / a0, A2 = a2 / a0;
  const w = 2 * Math.PI * f / sr;
  const c1 = Math.cos(w), s1 = Math.sin(w);
  const c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const numRe = B0 + B1 * c1 + B2 * c2, numIm = -B1 * s1 - B2 * s2;
  const denRe = 1 + A1 * c1 + A2 * c2, denIm = -A1 * s1 - A2 * s2;
  const mag = Math.hypot(numRe, numIm) / Math.max(Math.hypot(denRe, denIm), 1e-12);
  return 20 * Math.log10(Math.max(mag, 1e-6));
}

function eqResponseDb(f, gainsArr, sr) {
  let total = 0;
  EQ_BANDS.forEach((c, i) => { total += biquadPeakingDb(f, sr, c, gainsArr[i] || 0, 1.41); });
  return total;
}

function drawEqCurveOverlay(ctx, axisPad, plotW, plotH, sr) {
  const gains = (state.paramValues.eq && state.paramValues.eq.gains_db) || EQ_BANDS.map(() => 0);
  const maxHz = Math.min(20000, sr / 2);
  const logMin = Math.log10(20), logMax = Math.log10(maxHz);
  const dbRange = 18;
  ctx.save();
  ctx.beginPath();
  const N = 160;
  for (let i = 0; i <= N; i++) {
    const frac = i / N;
    const f = Math.pow(10, logMin + frac * (logMax - logMin));
    const db = eqResponseDb(f, gains, sr);
    const x = axisPad.l + frac * plotW;
    const y = axisPad.t + plotH / 2 - (db / dbRange) * (plotH / 2);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.strokeStyle = "#5fe3a3";
  ctx.lineWidth = 2;
  ctx.shadowColor = "rgba(95,227,163,.7)";
  ctx.shadowBlur = 6;
  ctx.stroke();
  ctx.setLineDash([3, 3]);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255,255,255,.2)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  const y0 = axisPad.t + plotH / 2;
  ctx.moveTo(axisPad.l, y0); ctx.lineTo(axisPad.l + plotW, y0);
  ctx.stroke();
  ctx.restore();
}

/* --------------------------------------------------------------- *
 * 10. SPECTROGRAM PANEL â€” real STFT heatmap                        *
 * --------------------------------------------------------------- */

function colorRamp(v) {
  v = Math.max(0, Math.min(1, v));
  const stops = [
    [0.00, 9, 12, 17],
    [0.35, 34, 26, 58],
    [0.62, 122, 76, 200],
    [0.82, 200, 120, 90],
    [1.00, 255, 214, 140],
  ];
  let i = 0;
  while (i < stops.length - 2 && v > stops[i + 1][0]) i++;
  const [t0, r0, g0, b0] = stops[i];
  const [t1, r1, g1, b1] = stops[i + 1];
  const f = (v - t0) / Math.max(t1 - t0, 1e-6);
  return [r0 + (r1 - r0) * f, g0 + (g1 - g0) * f, b0 + (b1 - b0) * f];
}

function computeSpectrogramForBuffer(buffer) {
  const mono = monoOf(buffer);
  return computeSpectrogram(mono, buffer.sampleRate);
}

function renderSpectrogram() {
  const { w, h } = fitCanvas(spectrogramCanvas);
  spectrogramCtx.clearRect(0, 0, w, h);
  if (!state.currentBuffer) return;

  const { processed } = activeDisplayBuffers();
  const cacheKey = processed === state.currentBuffer
    ? `base:${state.fileId}`
    : `preview:${state.previewFileId}`;

  if (!state.spectrogramCache || state.spectrogramCache.key !== cacheKey) {
    const spec = computeSpectrogramForBuffer(processed);
    const off = document.createElement("canvas");
    off.width = spec.cols; off.height = spec.rows;
    const octx = off.getContext("2d");
    const img = octx.createImageData(spec.cols, spec.rows);
    for (let c = 0; c < spec.cols; c++) {
      for (let r = 0; r < spec.rows; r++) {
        const v = spec.data[c * spec.rows + r];
        const [rr, gg, bb] = colorRamp(v);
        const py = spec.rows - 1 - r;
        const idx = (py * spec.cols + c) * 4;
        img.data[idx] = rr; img.data[idx + 1] = gg; img.data[idx + 2] = bb; img.data[idx + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    state.spectrogramCache = { key: cacheKey, canvas: off, meta: spec };
    $("spectrogram-sub").textContent = `STFT ${spec.fftSize}/${spec.hopSize} Â· ${spec.durationS.toFixed(1)}s`;
  }

  spectrogramCtx.imageSmoothingEnabled = true;
  spectrogramCtx.drawImage(state.spectrogramCache.canvas, 0, 0, w, h);

  if (state.htmlAudio.duration && state.currentBuffer) {
    const t = state.htmlAudio.currentTime;
    const dur = state.spectrogramCache.meta.durationS;
    const x = (t / Math.max(dur, 1e-9)) * w;
    if (x >= 0 && x <= w) {
      spectrogramCtx.save();
      spectrogramCtx.strokeStyle = "rgba(255,255,255,.85)";
      spectrogramCtx.lineWidth = 1;
      spectrogramCtx.beginPath(); spectrogramCtx.moveTo(x, 0); spectrogramCtx.lineTo(x, h); spectrogramCtx.stroke();
      spectrogramCtx.restore();
    }
  }
}

/* --------------------------------------------------------------- *
 * 11. METERS PANEL â€” real peak/RMS, L/R, clipping, dBFS            *
 * --------------------------------------------------------------- */

function buildMetersDom(numChannels) {
  const body = $("meters-body");
  body.innerHTML = "";
  const labels = numChannels === 2 ? ["L", "R"] : ["M"];
  labels.forEach((lab) => {
    const ch = document.createElement("div");
    ch.className = "meter-ch";
    ch.dataset.ch = lab;
    ch.innerHTML = `
      <div class="meter-ch-label">${lab}</div>
      <div class="meter-track">
        <div class="meter-fill-rms" style="height:0%"></div>
        <div class="meter-fill-peak" style="height:0%"></div>
        <div class="meter-peak-hold" style="bottom:0%"></div>
      </div>
      <div class="meter-clip"></div>
      <div class="meter-readout"><b class="mr-peak">-âˆž</b><br>pk<br><b class="mr-rms">-âˆž</b><br>rms</div>
    `;
    body.appendChild(ch);
  });
}

function dbToPct(db) {
  return Math.max(0, Math.min(100, ((db + 60) / 60) * 100)); // -60..0dB -> 0..100%
}

function setMeterChannel(labEl, peakDbVal, rmsDbVal) {
  const fillPeak = labEl.querySelector(".meter-fill-peak");
  const fillRms = labEl.querySelector(".meter-fill-rms");
  const hold = labEl.querySelector(".meter-peak-hold");
  const clip = labEl.querySelector(".meter-clip");
  const mrPeak = labEl.querySelector(".mr-peak");
  const mrRms = labEl.querySelector(".mr-rms");
  fillPeak.style.height = dbToPct(peakDbVal) + "%";
  fillRms.style.height = dbToPct(rmsDbVal) + "%";
  hold.style.bottom = dbToPct(peakDbVal) + "%";
  clip.classList.toggle("on", peakDbVal >= -0.15);
  mrPeak.textContent = peakDbVal <= -99 ? "-âˆž" : peakDbVal.toFixed(1);
  mrRms.textContent = rmsDbVal <= -99 ? "-âˆž" : rmsDbVal.toFixed(1);
}

function renderStaticMeters() {
  const { buffer } = playbackTarget();
  const src = buffer || state.currentBuffer;
  if (!src) return;
  const nCh = src.numberOfChannels;
  if (!$("meters-body").children.length || $("meters-body").children.length !== nCh) buildMetersDom(nCh);
  $("meters-source").textContent = "static";

  const chEls = $("meters-body").children;
  for (let c = 0; c < nCh; c++) {
    const data = channelOf(src, c);
    setMeterChannel(chEls[c], peakDb(data), rmsDb(data));
  }
}

function ensureAudioGraph() {
  if (state.mediaSource) return;
  const ctx = ac();
  const source = ctx.createMediaElementSource(state.htmlAudio);
  window.signalLabMainSongSource = source;
  const splitter = ctx.createChannelSplitter(2);
  const analyserL = ctx.createAnalyser();
  const analyserR = ctx.createAnalyser();
  analyserL.fftSize = 1024;
  analyserR.fftSize = 1024;
  source.connect(ctx.destination);
  source.connect(splitter);
  splitter.connect(analyserL, 0);
  splitter.connect(analyserR, 1);
  state.mediaSource = source;
  state.analyserL = analyserL;
  state.analyserR = analyserR;
  window.signalLabMainSongAnalyser = analyserL;
  window.signalLabMainAudioEl = state.htmlAudio;
  window.signalLabMainSongAnalyserR = analyserR;
}

function liveMeterLoop() {
  if (state.htmlAudio.paused) { state.meterRAF = null; return; }
  const nCh = (playbackTarget().buffer || state.currentBuffer || {}).numberOfChannels || 1;
  const chEls = $("meters-body").children;
  if (chEls.length === nCh && state.analyserL) {
    const bufL = new Float32Array(state.analyserL.fftSize);
    state.analyserL.getFloatTimeDomainData(bufL);
    setMeterChannel(chEls[0], peakDb(bufL), rmsDb(bufL));
    if (nCh === 2 && state.analyserR) {
      const bufR = new Float32Array(state.analyserR.fftSize);
      state.analyserR.getFloatTimeDomainData(bufR);
      setMeterChannel(chEls[1], peakDb(bufR), rmsDb(bufR));
    }
    $("meters-source").textContent = "live";
  }
  state.meterRAF = requestAnimationFrame(liveMeterLoop);
}

/* --------------------------------------------------------------- *
 * 12. EFFECT DETAIL PANEL â€” analytic transfer curves (exact match  *
 *     to backend DSP formulas) + real before/after stats           *
 * --------------------------------------------------------------- */

function fitDetailCanvas() {
  const rect = detailCanvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  detailCanvas.width = Math.max(1, Math.round(rect.width * dpr));
  detailCanvas.height = Math.max(1, Math.round(120 * dpr));
  detailCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w: rect.width, h: 120 };
}

function renderDetailPanel() {
  const key = state.activeEffect;
  if (!key) return;
  const eff = EFFECTS[key];
  const { w, h } = fitDetailCanvas();
  detailCtx.clearRect(0, 0, w, h);
  detailCtx.fillStyle = "rgba(255,255,255,.03)";
  detailCtx.fillRect(0, 0, w, h);

  if (eff.detail === "eq") renderEqDetail(w, h, key);
  else if (eff.detail === "compressor") renderCompressorDetail(w, h, key);
  else if (eff.detail === "distortion") renderDistortionDetail(w, h, key);
  else renderGenericDetail(w, h, key);
}

function axisLine(x0, y0, x1, y1, color = "rgba(255,255,255,.15)") {
  detailCtx.strokeStyle = color; detailCtx.lineWidth = 1;
  detailCtx.beginPath(); detailCtx.moveTo(x0, y0); detailCtx.lineTo(x1, y1); detailCtx.stroke();
}

function renderEqDetail(w, h, key) {
  $("detail-head").textContent = "Frequency response (from actual band gains)";
  const gains = (state.paramValues[key] && state.paramValues[key].gains_db) || EQ_BANDS.map(() => 0);
  const sr = state.sampleRate || 44100;
  const maxHz = Math.min(20000, sr / 2);
  const logMin = Math.log10(20), logMax = Math.log10(maxHz);
  const pad = 6, dbRange = 18;
  axisLine(pad, h / 2, w - pad, h / 2);
  detailCtx.beginPath();
  for (let i = 0; i <= 140; i++) {
    const frac = i / 140;
    const f = Math.pow(10, logMin + frac * (logMax - logMin));
    const db = eqResponseDb(f, gains, sr);
    const x = pad + frac * (w - pad * 2);
    const y = h / 2 - (db / dbRange) * (h / 2 - 8);
    i === 0 ? detailCtx.moveTo(x, y) : detailCtx.lineTo(x, y);
  }
  detailCtx.strokeStyle = "#5fe3a3"; detailCtx.lineWidth = 2;
  detailCtx.shadowColor = "rgba(95,227,163,.6)"; detailCtx.shadowBlur = 5;
  detailCtx.stroke(); detailCtx.shadowBlur = 0;

  const boosted = gains.filter((g) => g > 0.5).length;
  const cut = gains.filter((g) => g < -0.5).length;
  $("detail-stats").innerHTML = `<span>bands boosted: <b>${boosted}</b></span><span>bands cut: <b>${cut}</b></span><span>Q: <b>1.41</b></span>`;
}

function renderCompressorDetail(w, h, key) {
  $("detail-head").textContent = "Static transfer curve (gain computer)";
  const p = state.paramValues[key] || {};
  const threshold = p.threshold_db ?? -20, ratio = p.ratio ?? 4, makeup = p.makeup_db ?? 0;
  const pad = 22;
  const xMin = -60, xMax = 0;
  const toX = (db) => pad + ((db - xMin) / (xMax - xMin)) * (w - pad - 4);
  const toY = (db) => (h - 4) - ((db - xMin) / (xMax - xMin)) * (h - 4 - 4);

  axisLine(pad, 4, pad, h - 4);
  axisLine(pad, h - 4, w - 4, h - 4);
  detailCtx.fillStyle = "rgba(146,160,177,.7)"; detailCtx.font = "8.5px 'IBM Plex Mono', monospace";
  detailCtx.fillText("in dB", w - 32, h - 6);
  detailCtx.save(); detailCtx.translate(9, 12); detailCtx.fillText("out", 0, 0); detailCtx.restore();

  detailCtx.setLineDash([3, 3]);
  detailCtx.strokeStyle = "rgba(255,255,255,.15)";
  detailCtx.beginPath(); detailCtx.moveTo(toX(xMin), toY(xMin)); detailCtx.lineTo(toX(xMax), toY(xMax)); detailCtx.stroke();
  detailCtx.setLineDash([]);

  axisLine(toX(threshold), 4, toX(threshold), h - 4, "rgba(255,209,102,.5)");

  detailCtx.beginPath();
  for (let db = xMin; db <= xMax; db += 0.5) {
    let gr = 0;
    if (db > threshold) gr = -(db - threshold) * (1 - 1 / ratio);
    const outDb = db + gr + makeup;
    const x = toX(db), y = toY(Math.max(xMin, Math.min(6, outDb)));
    db === xMin ? detailCtx.moveTo(x, y) : detailCtx.lineTo(x, y);
  }
  detailCtx.strokeStyle = "#9b8cff"; detailCtx.lineWidth = 2;
  detailCtx.shadowColor = "rgba(155,140,255,.6)"; detailCtx.shadowBlur = 5;
  detailCtx.stroke(); detailCtx.shadowBlur = 0;

  let grStat = "â€”";
  if (state.previewBuffer && state.currentBuffer) {
    const before = rmsDb(monoOf(state.currentBuffer));
    const after = rmsDb(monoOf(state.previewBuffer));
    grStat = (after - before).toFixed(1) + " dB";
  }
  $("detail-stats").innerHTML = `<span>threshold: <b>${threshold} dB</b></span><span>ratio: <b>${ratio}:1</b></span><span>measured level Î”: <b>${grStat}</b></span>`;
}

function renderDistortionDetail(w, h, key) {
  $("detail-head").textContent = "Waveshaper transfer curve (exact DSP function)";
  const p = state.paramValues[key] || {};
  const driveDb = p.drive_db ?? 12, mode = p.mode || "soft", mix = p.mix ?? 1;
  const driveLin = Math.pow(10, driveDb / 20);
  const pad = 6;
  const toX = (x) => pad + ((x + 1) / 2) * (w - pad * 2);
  const toY = (y) => (h - pad) - ((y + 1) / 2) * (h - pad * 2);

  axisLine(toX(-1), toY(0), toX(1), toY(0));
  axisLine(toX(0), toY(-1), toX(0), toY(1));
  detailCtx.setLineDash([3, 3]);
  detailCtx.strokeStyle = "rgba(255,255,255,.12)";
  detailCtx.beginPath(); detailCtx.moveTo(toX(-1), toY(-1)); detailCtx.lineTo(toX(1), toY(1)); detailCtx.stroke();
  detailCtx.setLineDash([]);

  detailCtx.beginPath();
  const norm = mode === "soft" ? (Math.tanh(driveLin) || 1) : 1;
  for (let i = 0; i <= 200; i++) {
    const x = -1 + (2 * i) / 200;
    const driven = x * driveLin;
    const wet = mode === "soft" ? Math.tanh(driven) / norm : Math.max(-1, Math.min(1, driven));
    const y = (1 - mix) * x + mix * wet;
    const px = toX(x), py = toY(Math.max(-1, Math.min(1, y)));
    i === 0 ? detailCtx.moveTo(px, py) : detailCtx.lineTo(px, py);
  }
  detailCtx.strokeStyle = "#ff8a8a"; detailCtx.lineWidth = 2;
  detailCtx.shadowColor = "rgba(255,138,138,.55)"; detailCtx.shadowBlur = 5;
  detailCtx.stroke(); detailCtx.shadowBlur = 0;

  let harmStat = "â€”";
  if (state.previewBuffer && state.currentBuffer) {
    const before = computeSpectrum(monoOf(state.currentBuffer), state.currentBuffer.sampleRate, 48);
    const after = computeSpectrum(monoOf(state.previewBuffer), state.previewBuffer.sampleRate, 48);
    let addedHi = 0;
    for (let i = 24; i < 48; i++) addedHi += Math.max(0, after[i] - before[i]);
    harmStat = addedHi > 0.3 ? "significant" : addedHi > 0.05 ? "moderate" : "subtle";
  }
  $("detail-stats").innerHTML = `<span>mode: <b>${mode}</b></span><span>drive: <b>${driveDb} dB</b></span><span>added harmonics: <b>${harmStat}</b></span>`;
}

function renderGenericDetail(w, h, key) {
  $("detail-head").textContent = "Before / after amplitude envelope (actual audio)";
  const before = state.currentBuffer;
  const after = state.previewBuffer || state.currentBuffer;
  if (!before) { $("detail-stats").innerHTML = ""; return; }

  const bMono = monoOf(before), aMono = monoOf(after);
  const buckets = Math.max(2, Math.floor(w));
  const bEnv = downsampleMinMax(bMono, buckets);
  const aEnv = downsampleMinMax(aMono, buckets);
  const mid = h / 2;

  function drawEnv(env, color, glow, alpha) {
    detailCtx.save(); detailCtx.globalAlpha = alpha;
    detailCtx.beginPath();
    for (let i = 0; i < buckets; i++) {
      const x = (i / (buckets - 1)) * w;
      const y = mid - env.max[i] * mid * 0.9;
      i === 0 ? detailCtx.moveTo(x, y) : detailCtx.lineTo(x, y);
    }
    for (let i = buckets - 1; i >= 0; i--) {
      const x = (i / (buckets - 1)) * w;
      const y = mid - env.min[i] * mid * 0.9;
      detailCtx.lineTo(x, y);
    }
    detailCtx.closePath();
    detailCtx.fillStyle = color.replace("FILLALPHA", "0.18");
    detailCtx.fill();
    detailCtx.strokeStyle = color.replace("FILLALPHA", "1");
    detailCtx.lineWidth = 1.2; detailCtx.shadowColor = glow; detailCtx.shadowBlur = 4;
    detailCtx.stroke(); detailCtx.restore();
  }
  drawEnv(bEnv, COLOR_A, COLOR_A_GLOW, state.previewBuffer ? 0.5 : 1);
  if (state.previewBuffer) drawEnv(aEnv, COLOR_B, COLOR_B_GLOW, 0.95);

  const pB = peakDb(bMono).toFixed(1), pA = peakDb(aMono).toFixed(1);
  const rB = rmsDb(bMono).toFixed(1), rA = rmsDb(aMono).toFixed(1);
  const durB = before.duration.toFixed(2), durA = after.duration.toFixed(2);
  $("detail-stats").innerHTML =
    `<span>peak: <b>${pB}â†’${pA} dB</b></span>` +
    `<span>rms: <b>${rB}â†’${rA} dB</b></span>` +
    (Math.abs(before.duration - after.duration) > 0.01 ? `<span>duration: <b>${durB}sâ†’${durA}s</b></span>` : "");
}

/* --------------------------------------------------------------- *
 * 13. MASTER REDRAW                                                 *
 * --------------------------------------------------------------- */

function redrawAll() {
  renderWaveform();
  renderSpectrum();
  renderSpectrogram();
  renderStaticMeters();
  if (state.activeEffect) renderDetailPanel();
}

function setProcessing(on) {
  state.isProcessing = on;
  $("processing-indicator").hidden = !on;
  ["waveform-overlay", "spectrum-overlay", "spectrogram-overlay"].forEach((id) => { $(id).hidden = !on; });
}

/* --------------------------------------------------------------- *
 * 14. RACK (left rail)                                              *
 * --------------------------------------------------------------- */

function buildRack() {
  const rack = $("rack");
  rack.querySelectorAll(".rack-group").forEach((n) => n.remove());
  GROUPS.forEach((group) => {
    const wrap = document.createElement("div");
    wrap.className = "rack-group";
    const label = document.createElement("div");
    label.className = "rack-group-label";
    label.textContent = group.label;
    wrap.appendChild(label);
    const list = document.createElement("div");
    list.className = "rack-group";
    group.keys.forEach((key) => {
      const eff = EFFECTS[key];
      const item = document.createElement("div");
      item.className = "rack-item";
      item.dataset.key = key;
      item.innerHTML = `
        <span class="ri-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[key] || ""}</svg></span>
        <span class="ri-label">${eff.label}</span>
        <span class="ri-applied" title="Applied"></span>
      `;
      item.addEventListener("click", () => selectEffect(key));
      list.appendChild(item);
    });
    wrap.appendChild(list);
    rack.appendChild(wrap);
  });
}

function refreshRackState() {
  document.querySelectorAll(".rack-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.key === state.activeEffect);
    el.classList.toggle("applied", state.appliedEffects.has(el.dataset.key));
  });
}

/* --------------------------------------------------------------- *
 * 15. PARAM PANEL                                                   *
 * --------------------------------------------------------------- */

function selectEffect(key) {
  if (!state.fileId) return;
  state.activeEffect = key;
  state.previewBuffer = null;
  state.previewFileId = null;
  const eff = EFFECTS[key];

  $("params-empty").hidden = true;
  $("params-active").hidden = false;
  $("params-title").textContent = eff.label;
  $("params-tier").textContent = eff.tier;
  $("params-explain").textContent = eff.explain;

  state.paramValues[key] = state.paramValues[key] || defaultParams(eff);
  renderParamControls(eff, key);
  refreshRackState();

  redrawAll();
  if ($("live-preview-toggle").checked) scheduleLivePreview();
}

function defaultParams(eff) {
  const out = {};
  eff.params.forEach((p) => { out[p.key] = p.type === "eqbands" ? [...p.def] : p.def; });
  return out;
}

function renderParamControls(eff, key) {
  const wrap = $("params-controls");
  wrap.innerHTML = "";
  if (eff.params.length === 0) {
    const p = document.createElement("p");
    p.style.cssText = "color:var(--text-dim);font-size:12px;margin:0;";
    p.textContent = "No parameters â€” this module transforms the whole signal the same way every time.";
    wrap.appendChild(p);
    return;
  }
  eff.params.forEach((param) => {
    if (param.type === "dial") wrap.appendChild(buildDial(key, param));
    else if (param.type === "seg") wrap.appendChild(buildSeg(key, param));
    else if (param.type === "eqbands") wrap.appendChild(buildEqBands(key, param));
  });
}

function fmtVal(param, v) {
  const decimals = param.step && param.step < 1 ? (param.step < 0.01 ? 3 : 2) : (Number.isInteger(param.step) ? 0 : 1);
  return `${Number(v).toFixed(decimals)}${param.unit ? param.unit : ""}`;
}

function onParamChanged(key) {
  if (EFFECTS[key].detail !== "generic" && state.activeEffect === key) renderDetailPanel();
  if ($("live-preview-toggle").checked) scheduleLivePreview();
}

function buildDial(key, param) {
  const row = document.createElement("div");
  row.className = "dial-row";
  const val = state.paramValues[key][param.key];
  const pct = ((val - param.min) / (param.max - param.min)) * 100;
  row.innerHTML = `
    <div class="dial-top">
      <span class="dial-label">${param.key.replace(/_/g, " ")}</span>
      <span class="dial-value">${fmtVal(param, val)}</span>
    </div>
    <div class="dial-track">
      <div class="dial-fill" style="width:${pct}%"></div>
      <div class="dial-thumb" style="left:${pct}%"></div>
    </div>
  `;
  const track = row.querySelector(".dial-track");
  const fill = row.querySelector(".dial-fill");
  const thumb = row.querySelector(".dial-thumb");
  const valueEl = row.querySelector(".dial-value");

  function setFromClientX(clientX) {
    const rect = track.getBoundingClientRect();
    let frac = (clientX - rect.left) / rect.width;
    frac = Math.max(0, Math.min(1, frac));
    let v = param.min + frac * (param.max - param.min);
    v = Math.round(v / param.step) * param.step;
    v = Math.max(param.min, Math.min(param.max, v));
    state.paramValues[key][param.key] = v;
    const p = ((v - param.min) / (param.max - param.min)) * 100;
    fill.style.width = p + "%";
    thumb.style.left = p + "%";
    valueEl.textContent = fmtVal(param, v);
    onParamChanged(key);
  }

  let dragging = false;
  track.addEventListener("pointerdown", (e) => { dragging = true; track.setPointerCapture(e.pointerId); setFromClientX(e.clientX); });
  track.addEventListener("pointermove", (e) => { if (dragging) setFromClientX(e.clientX); });
  track.addEventListener("pointerup", (e) => { dragging = false; try { track.releasePointerCapture(e.pointerId); } catch (_) {} });
  return row;
}

function buildSeg(key, param) {
  const row = document.createElement("div");
  row.className = "seg-row";
  const current = state.paramValues[key][param.key];
  row.innerHTML = `
    <div class="dial-label">${param.key.replace(/_/g, " ")}</div>
    <div class="seg-group">
      ${param.options.map((opt) => `<div class="seg-opt${opt === current ? " active" : ""}" data-val="${opt}">${opt}</div>`).join("")}
    </div>
  `;
  row.querySelectorAll(".seg-opt").forEach((el) => {
    el.addEventListener("click", () => {
      row.querySelectorAll(".seg-opt").forEach((o) => o.classList.remove("active"));
      el.classList.add("active");
      state.paramValues[key][param.key] = el.dataset.val;
      onParamChanged(key);
    });
  });
  return row;
}

function buildEqBands(key, param) {
  const wrap = document.createElement("div");
  wrap.className = "dial-row";
  const bandsWrap = document.createElement("div");
  bandsWrap.className = "eq-bands";
  const vals = state.paramValues[key][param.key];

  param.bands.forEach((freq, idx) => {
    const band = document.createElement("div");
    band.className = "eq-band";
    const label = freq >= 1000 ? `${freq / 1000}k` : `${freq}`;
    band.innerHTML = `
      <div class="eq-band-track" data-idx="${idx}">
        <div class="eq-band-zero"></div>
        <div class="eq-band-fill"></div>
      </div>
      <div class="eq-band-freq">${label}</div>
    `;
    const track = band.querySelector(".eq-band-track");
    const fill = band.querySelector(".eq-band-fill");

    function applyVisual() {
      const v = vals[idx];
      const pct = (Math.abs(v) / param.max) * 50;
      if (v >= 0) { fill.style.bottom = "50%"; fill.style.height = pct + "%"; }
      else { fill.style.bottom = 50 - pct + "%"; fill.style.height = pct + "%"; }
    }
    applyVisual();

    function setFromClientY(clientY) {
      const rect = track.getBoundingClientRect();
      let frac = 1 - (clientY - rect.top) / rect.height;
      let v = (frac - 0.5) * 2 * param.max;
      v = Math.max(param.min, Math.min(param.max, Math.round(v)));
      vals[idx] = v;
      applyVisual();
      onParamChanged(key);
    }
    let dragging = false;
    track.addEventListener("pointerdown", (e) => { dragging = true; track.setPointerCapture(e.pointerId); setFromClientY(e.clientY); });
    track.addEventListener("pointermove", (e) => { if (dragging) setFromClientY(e.clientY); });
    track.addEventListener("pointerup", (e) => { dragging = false; try { track.releasePointerCapture(e.pointerId); } catch (_) {} });

    bandsWrap.appendChild(band);
  });
  wrap.appendChild(bandsWrap);
  return wrap;
}

/* --------------------------------------------------------------- *
 * 16. API CALLS                                                     *
 * --------------------------------------------------------------- */

async function apiUpload(file) {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`${API}/upload`, { method: "POST", body: fd });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Upload failed");
  return data;
}

async function apiApplyEffect(fileId, name, params, selection) {
  const body = { file_id: fileId, params };
  if (selection) body.selection = selection;
  const res = await fetch(`${API}/effects/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || `Effect '${name}' failed`);
  return data;
}

function downloadUrl(fileId) { return `${API}/download/${fileId}`; }

async function decodeFileId(fileId) {
  const res = await fetch(downloadUrl(fileId));
  const buf = await res.arrayBuffer();
  return ac().decodeAudioData(buf.slice(0));
}

function getSelectionPayload() {
  if (!state.selection || !state.selectionOnly) return null;
  return { start_s: state.selection.startS, end_s: state.selection.endS };
}

/* --------------------------------------------------------------- *
 * 17. LIVE PREVIEW (debounced backend call, race-safe)              *
 * --------------------------------------------------------------- */

function scheduleLivePreview() {
  clearTimeout(state.debounceTimer);
  const dot = $("live-dot");
  dot.classList.remove("done"); dot.classList.add("busy");
  setProcessing(true);
  state.debounceTimer = setTimeout(runLivePreview, 380);
}

async function runLivePreview() {
  const key = state.activeEffect;
  if (!key) { setProcessing(false); return; }
  const dot = $("live-dot");
  const gen = ++state.requestGen;
  const baseFileId = state.fileId;
  try {
    const params = { ...state.paramValues[key] };
    const selection = getSelectionPayload();
    const meta = await apiApplyEffect(baseFileId, key, params, selection);
    if (gen !== state.requestGen) return; // superseded by a newer parameter change â€” discard
    const buffer = await decodeFileId(meta.file_id);
    if (gen !== state.requestGen) return; // superseded while decoding â€” discard

    state.previewFileId = meta.file_id;
    state.previewBuffer = buffer;
    state.abMode = "processed";
    updateAbSwitch();
    dot.classList.remove("busy"); dot.classList.add("done");
    setProcessing(false);
    updateTransportEnabled();
    redrawAll();
  } catch (err) {
    if (gen !== state.requestGen) return;
    dot.classList.remove("busy");
    setProcessing(false);
    toast(err.message, "error");
  }
}

/* --------------------------------------------------------------- *
 * 18. APPLY / CANCEL                                                *
 * --------------------------------------------------------------- */

async function applyCurrentEffect() {
  const key = state.activeEffect;
  if (!key) return;
  setStatus(`Applying ${EFFECTS[key].label}â€¦`);
  setProcessing(true);
  try {
    let fileId, buffer;
    if (state.previewFileId) {
      fileId = state.previewFileId; buffer = state.previewBuffer;
    } else {
      const selection = getSelectionPayload();
      const meta = await apiApplyEffect(state.fileId, key, { ...state.paramValues[key] }, selection);
      fileId = meta.file_id;
      buffer = await decodeFileId(fileId);
    }
    state.fileId = fileId;
    state.currentBuffer = buffer;
    state.previewBuffer = null;
    state.previewFileId = null;
    state.duration = buffer.duration;
    state.appliedEffects.add(key);
    state.abMode = "original";
    state.spectrogramCache = null;
    state.view = { start: 0, end: buffer.duration };

    updateHeaderMeta();
    updateAbSwitch();
    refreshRackState();
    setProcessing(false);
    updateTransportEnabled();
    toast(`${EFFECTS[key].label} applied to signal`, "success");
    setStatus("Ready.");
    closeParamPanel();
    redrawAll();
  } catch (err) {
    setProcessing(false);
    toast(err.message, "error");
    setStatus("Ready.");
  }
}

function cancelCurrentEffect() {
  state.requestGen++; // invalidate any in-flight preview
  state.previewBuffer = null;
  state.previewFileId = null;
  state.abMode = "original";
  updateAbSwitch();
  setProcessing(false);
  closeParamPanel();
  redrawAll();
}

function closeParamPanel() {
  state.activeEffect = null;
  $("params-active").hidden = true;
  $("params-empty").hidden = false;
  refreshRackState();
}

/* --------------------------------------------------------------- *
 * 19. UPLOAD / LOAD FLOW                                            *
 * --------------------------------------------------------------- */

async function loadFromUploadResponse(meta, buffer) {
  state.fileId = meta.file_id;
  state.filename = meta.filename || "sample";
  state.sampleRate = meta.sample_rate;
  state.duration = meta.duration_s;
  state.channels = meta.channels;
  state.currentBuffer = buffer;
  state.previewBuffer = null;
  state.previewFileId = null;
  state.appliedEffects = new Set();
  state.activeEffect = null;
  state.selection = null;
  state.selectionOnly = false;
  state.abMode = "original";
  state.view = { start: 0, end: buffer.duration };
  state.spectrogramCache = null;

  $("dropzone").hidden = true;
  $("viz-stack").hidden = false;
  $("transport").hidden = false;
  $("btn-export").disabled = false;
  $("file-dot").classList.add("on");
  $("header-filename").textContent = state.filename;

  buildRack();
  closeParamPanel();
  updateAbSwitch();
  updateSelectionUI();
  updateHeaderMeta();
  updateTransportEnabled();
  redrawAll();
  setStatus("Signal loaded.");
}

async function handleFile(file) {
  setStatus("Uploadingâ€¦");
  try {
    const meta = await apiUpload(file);
    const buffer = await decodeFileId(meta.file_id);
    await loadFromUploadResponse(meta, buffer);
    toast("Signal loaded", "success");
  } catch (err) {
    toast(err.message, "error");
    setStatus("Ready.");
  }
}

async function loadSample(name) {
  setStatus("Loading sampleâ€¦");
  try {
    const res = await fetch(`sample_wavs/${name}`);
    const blob = await res.blob();
    const file = new File([blob], name, { type: "audio/wav" });
    await handleFile(file);
  } catch (err) {
    toast("Could not load sample", "error");
    setStatus("Ready.");
  }
}

/* --------------------------------------------------------------- *
 * 20. HEADER / STATUS META                                          *
 * --------------------------------------------------------------- */

function fmtTime(s) {
  if (!isFinite(s)) s = 0;
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${String(m).padStart(2, "0")}:${sec.toFixed(3).padStart(6, "0")}`;
}

function updateHeaderMeta() {
  $("status-meta").textContent = state.currentBuffer
    ? `${state.sampleRate} Hz Â· ${state.channels === 2 ? "stereo" : "mono"} Â· ${fmtTime(state.duration)}`
    : "";
  $("tp-duration").textContent = fmtTime(state.duration);
}

/* --------------------------------------------------------------- *
 * 21. TRANSPORT (HTML5 audio) + PLAYHEAD + LIVE METERS              *
 * --------------------------------------------------------------- */

function updateTransportEnabled() {
  const target = playbackTarget();
  if (!target.fileId) return;
  const wasPlaying = !state.htmlAudio.paused;
  const newSrc = downloadUrl(target.fileId);
  if (!state.htmlAudio.src.endsWith(newSrc)) {
    const t = state.htmlAudio.currentTime;
    state.htmlAudio.src = newSrc;
    state.htmlAudio.currentTime = t || 0;
  }
  if (wasPlaying) state.htmlAudio.play().catch(() => {});
}

function togglePlay() {
  if (!state.fileId) return;
  ac().resume().catch(() => {});
  ensureAudioGraph();
  if (state.htmlAudio.paused) {
    if (!state.htmlAudio.src) updateTransportEnabled();
    state.htmlAudio.play();
  } else {
    state.htmlAudio.pause();
  }
}

function updateAbSwitch() {
  document.querySelectorAll(".ab-opt").forEach((el) => {
    el.classList.toggle("active", el.dataset.mode === state.abMode);
  });
  updateTransportEnabled();
  renderStaticMeters();
}

state.htmlAudio.addEventListener("play", () => {
  $("icon-play").hidden = true; $("icon-pause").hidden = false;
  if (!state.meterRAF) state.meterRAF = requestAnimationFrame(liveMeterLoop);
  playheadLoop();
});
state.htmlAudio.addEventListener("pause", () => { $("icon-play").hidden = false; $("icon-pause").hidden = true; renderStaticMeters(); });
state.htmlAudio.addEventListener("ended", () => { $("icon-play").hidden = false; $("icon-pause").hidden = true; renderStaticMeters(); });
state.htmlAudio.addEventListener("timeupdate", () => {
  $("tp-time").textContent = fmtTime(state.htmlAudio.currentTime);
  if (state.htmlAudio.duration) {
    $("tp-seek").value = Math.round((state.htmlAudio.currentTime / state.htmlAudio.duration) * 1000);
  }
});

let playheadRAF = null;
function playheadLoop() {
  if (state.htmlAudio.paused) { playheadRAF = null; return; }
  renderWaveform();
  renderSpectrogram();
  playheadRAF = requestAnimationFrame(playheadLoop);
}

/* --------------------------------------------------------------- *
 * 22. ZOOM / SELECTION INTERACTION on waveform canvas               *
 * --------------------------------------------------------------- */

function updateSelectionUI() {
  const hasSel = !!state.selection;
  $("btn-clear-selection").hidden = !hasSel;
  if (hasSel) {
    const d = state.selection.endS - state.selection.startS;
    $("selection-text").textContent = `${fmtTime(state.selection.startS)} â†’ ${fmtTime(state.selection.endS)} (${d.toFixed(2)}s)`;
  } else {
    $("selection-text").textContent = "No selection Â· drag on waveform to select";
  }
}

function setZoom(newSpan, centerT) {
  if (!state.currentBuffer) return;
  const dur = state.currentBuffer.duration;
  newSpan = Math.max(0.02, Math.min(dur, newSpan));
  let start = centerT - newSpan / 2;
  start = Math.max(0, Math.min(dur - newSpan, start));
  state.view = { start, end: start + newSpan };
  redrawAll();
}

function wireWaveformInteraction() {
  let dragStartX = null, dragging = false, isSelectDrag = false;

  waveCanvas.addEventListener("pointerdown", (e) => {
    if (!state.currentBuffer) return;
    const rect = waveCanvas.getBoundingClientRect();
    dragStartX = e.clientX - rect.left;
    dragging = true; isSelectDrag = false;
    waveCanvas.setPointerCapture(e.pointerId);
  });
  waveCanvas.addEventListener("pointermove", (e) => {
    if (!dragging || !state.currentBuffer) return;
    const rect = waveCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (Math.abs(x - dragStartX) > 3) isSelectDrag = true;
    if (isSelectDrag) {
      const t0 = xToTime(Math.min(dragStartX, x), rect.width);
      const t1 = xToTime(Math.max(dragStartX, x), rect.width);
      state.selection = { startS: Math.max(0, t0), endS: Math.min(state.currentBuffer.duration, t1) };
      state.selectionOnly = true;
      updateSelectionUI();
      renderWaveform();
    }
  });
  waveCanvas.addEventListener("pointerup", (e) => {
    if (!dragging || !state.currentBuffer) return;
    dragging = false;
    try { waveCanvas.releasePointerCapture(e.pointerId); } catch (_) {}
    const rect = waveCanvas.getBoundingClientRect();
    if (!isSelectDrag) {
      const t = xToTime(dragStartX, rect.width);
      if (state.htmlAudio.duration) state.htmlAudio.currentTime = Math.max(0, Math.min(state.htmlAudio.duration, t));
      renderWaveform();
    } else if (state.selection && state.selection.endS - state.selection.startS < 0.005) {
      state.selection = null;
      state.selectionOnly = false;
      updateSelectionUI();
    } else if (state.selectionOnly && $("live-preview-toggle").checked && state.activeEffect) {
      scheduleLivePreview();
    }
  });

  waveCanvas.addEventListener("wheel", (e) => {
    if (!state.currentBuffer) return;
    e.preventDefault();
    const rect = waveCanvas.getBoundingClientRect();
    const t = xToTime(e.clientX - rect.left, rect.width);
    const span = state.view.end - state.view.start;
    const factor = e.deltaY > 0 ? 1.35 : 1 / 1.35;
    setZoom(span * factor, t);
  }, { passive: false });

  waveCanvas.addEventListener("dblclick", () => {
    if (!state.currentBuffer) return;
    state.view = { start: 0, end: state.currentBuffer.duration };
    redrawAll();
  });
}

/* --------------------------------------------------------------- *
 * 23. WIRING                                                        *
 * --------------------------------------------------------------- */

function wire() {
  const fileInput = $("file-input");
  $("btn-open").addEventListener("click", () => fileInput.click());
  $("dropzone").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => { if (e.target.files[0]) handleFile(e.target.files[0]); });

  ["dragover", "dragenter"].forEach((ev) =>
    $("dropzone").addEventListener(ev, (e) => { e.preventDefault(); $("dropzone").classList.add("drag-over"); }));
  ["dragleave", "drop"].forEach((ev) =>
    $("dropzone").addEventListener(ev, (e) => { e.preventDefault(); $("dropzone").classList.remove("drag-over"); }));
  $("dropzone").addEventListener("drop", (e) => {
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  });
  ["dragover", "drop"].forEach((ev) => document.body.addEventListener(ev, (e) => e.preventDefault()));
  document.body.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f);
  });

  $("btn-samples").addEventListener("click", (e) => {
    e.stopPropagation();
    $("sample-menu").classList.toggle("open");
  });
  document.addEventListener("click", () => $("sample-menu").classList.remove("open"));
  document.querySelectorAll(".sample-item").forEach((el) => {
    el.addEventListener("click", (e) => { e.stopPropagation(); loadSample(el.dataset.sample); $("sample-menu").classList.remove("open"); });
  });

  $("btn-export").addEventListener("click", () => {
    if (!state.fileId) return;
    window.open(downloadUrl(state.fileId), "_blank");
  });

  $("btn-cancel-effect").addEventListener("click", cancelCurrentEffect);
  $("btn-apply-effect").addEventListener("click", applyCurrentEffect);

  $("live-preview-toggle").addEventListener("change", (e) => {
    if (e.target.checked && state.activeEffect) scheduleLivePreview();
  });

  $("tp-play").addEventListener("click", togglePlay);
  $("tp-seek").addEventListener("input", (e) => {
    if (!state.htmlAudio.duration) return;
    state.htmlAudio.currentTime = (e.target.value / 1000) * state.htmlAudio.duration;
  });
  $("tp-selection-only").addEventListener("change", (e) => {
    state.selectionOnly = e.target.checked && !!state.selection;
    if (state.activeEffect && $("live-preview-toggle").checked) scheduleLivePreview();
  });

  document.querySelectorAll(".ab-opt").forEach((el) => {
    el.addEventListener("click", () => {
      state.abMode = el.dataset.mode;
      updateAbSwitch();
      redrawAll();
    });
  });

  $("btn-zoom-in").addEventListener("click", () => {
    if (!state.currentBuffer) return;
    const center = (state.view.start + state.view.end) / 2;
    setZoom((state.view.end - state.view.start) / 1.6, center);
  });
  $("btn-zoom-out").addEventListener("click", () => {
    if (!state.currentBuffer) return;
    const center = (state.view.start + state.view.end) / 2;
    setZoom((state.view.end - state.view.start) * 1.6, center);
  });
  $("btn-zoom-fit").addEventListener("click", () => {
    if (!state.currentBuffer) return;
    state.view = { start: 0, end: state.currentBuffer.duration };
    redrawAll();
  });

  $("btn-clear-selection").addEventListener("click", () => {
    state.selection = null;
    state.selectionOnly = false;
    $("tp-selection-only").checked = false;
    updateSelectionUI();
    redrawAll();
    if (state.activeEffect && $("live-preview-toggle").checked) scheduleLivePreview();
  });

  wireWaveformInteraction();

  window.addEventListener("resize", () => {
    if (!state.currentBuffer) return;
    redrawAll();
  });
}

wire();
setStatus("Ready.");
})();

