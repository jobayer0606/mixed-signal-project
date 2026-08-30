/* =====================================================================
   SIGNAL LAB — app.js
   DSP visualization workbench over the PyAudioLab FastAPI backend.

   HARD RULE: every pixel drawn to the waveform, spectrum, spectrogram
   and meter canvases comes from actually decoded / actually processed
   PCM audio (Web Audio API decode of real WAV bytes returned by the
   backend), or from the exact closed-form transfer function the
   backend DSP uses (EQ biquad response, compressor gain-computer,
   distortion waveshaper) evaluated on the real parameter values.
   There is NO synthetic "demo" signal and NO canned effect animation
   anywhere in this file. While a backend request is in flight the UI
   shows a "Processing…" state instead of guessing at the result.
   ===================================================================== */

(() => {
"use strict";

/* --------------------------------------------------------------- *
 * 1. EFFECT METADATA — param UI schema + detail-panel routing      *
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
    explain: "Multiplies every sample by a constant factor. The whole trace grows or shrinks uniformly — nothing about its shape changes, only its loudness.",
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
    explain: "Flips the sign of every sample. The waveform mirrors across the zero line — identical loudness and shape, opposite polarity.",
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
    explain: "Any sample above the threshold gets clipped flat at that ceiling — a hard wall the signal cannot cross.",
    params: [{ key: "threshold_db", type: "dial", min: -24, max: 0, step: 0.5, unit: "dB", def: -6 }],
  },
  soft_clip: {
    label: "Soft Clipper", tier: "Intermediate", detail: "generic",
    explain: "Samples approaching the threshold are rounded off with a tanh curve instead of clipped flat — gentler, with added harmonics.",
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
    explain: "Pushes the signal into nonlinear territory, adding harmonics — the waveform squares off and the spectrum gains overtones.",
    params: [
      { key: "drive_db", type: "dial", min: 0, max: 36, step: 1, unit: "dB", def: 12 },
      { key: "mode", type: "seg", options: ["soft", "hard"], def: "soft" },
      { key: "mix", type: "dial", min: 0, max: 1, step: 0.01, unit: "", def: 1 },
    ],
  },
  reverse: {
    label: "Reverse", tier: "Basic", detail: "generic",
    explain: "Reads every sample back to front. The shape is identical, just played in the opposite order — watch it flip end-for-end in the waveform.",
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
    explain: "Uses a phase vocoder to compress or expand the signal in time while keeping pitch constant — length changes, tone doesn't.",
    params: [{ key: "factor", type: "dial", min: 0.25, max: 4, step: 0.05, unit: "x", def: 1.25 }],
  },
  eq: {
    label: "10-Band EQ", tier: "Stretch", detail: "eq",
    explain: "Ten peaking filters, one per band, each boosting or cutting a narrow range of frequencies around its center.",
    params: [{ key: "gains_db", type: "eqbands", bands: EQ_BANDS, min: -12, max: 12, def: EQ_BANDS.map(() => 0) }],
  },
  reverb: {
    label: "Schroeder Reverb", tier: "Stretch", detail: "generic",
    explain: "Runs the signal through parallel comb filters and series allpass filters to build a dense, decaying reflection tail — visible as trailing energy after the dry signal ends.",
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
const SESSION_KEY = "signalLabSession_v1";

const state = {
  audioCtx: null,
  fileId: null,           // committed session id on server (source of truth for "original/base")
  filename: null,
  sampleRate: 44100,
  duration: 0,
  channels: 1,
  currentBuffer: null,    // AudioBuffer — last committed (base) signal
  previewBuffer: null,    // AudioBuffer — pending live-preview signal (real backend output)
  previewFileId: null,
  activeEffect: null,     // key into EFFECTS
  paramValues: {},
  appliedEffects: new Set(),
  debounceTimer: null,
  requestGen: 0,          // guards against stale async responses overwriting newer ones
  isProcessing: false,

  // A/B + view state
  abMode: "original",     // 'original' | 'processed' — controls playback + primary trace
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

  // multi-song session — each song keeps its own committed fileId/metadata.
  songs: [],            // persistent song snapshots (metadata only, no AudioBuffer)
  activeSongIdx: -1,    // index into songs[] currently being edited
};

let aliasLabBuilt = false;
function ensureAliasingLabPanel() {
  if (aliasLabBuilt) return;
  aliasLabBuilt = true;
  const wrap = document.createElement("div");
  wrap.className = "panel";
  wrap.style.marginTop = "12px";
wrap.innerHTML = `<div class="panel-head"><span class="panel-label">Aliasing Lab — Synthetic DSP Experiment</span></div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end;margin-bottom:8px;">
      <label style="font:11px var(--ff-mono);color:var(--text-mid);">Test frequency (Hz)
        <input type="number" id="alias-freq" value="7000" min="1" step="1" style="display:block;width:100px;"></label>
      <label style="font:11px var(--ff-mono);color:var(--text-mid);">Sample rate (Hz)
        <input type="number" id="alias-sr" value="10000" min="100" step="1" style="display:block;width:100px;"></label>
    </div>
    <div id="alias-status" style="font:600 12px var(--ff-mono);margin-bottom:6px;"></div>
    <div>Sampled waveform</div>
    <canvas id="alias-wave" width="500" height="70" style="background:#10151d;border:1px solid var(--hairline);"></canvas>
    <div style="margin-top:6px;">Spectrum (Nyquist marked at right edge)</div>
    <canvas id="alias-spectrum" width="500" height="90" style="background:#10151d;border:1px solid var(--hairline);"></canvas>`;
  document.querySelector(".stage").appendChild(wrap);
  $("alias-freq").addEventListener("input", renderAliasingLab);
  $("alias-sr").addEventListener("input", renderAliasingLab);
}

function aliasedFrequency(f, fs) {
  let apparent = f % fs;
  if (apparent > fs / 2) apparent = fs - apparent;
  return apparent;
}

let aliasRAF = null;

function drawAliasWaveform() {
  const f = Math.max(1, Number($("alias-freq").value) || 0);
  const fs = Math.max(100, Number($("alias-sr").value) || 0);
  const nSamples = Math.max(64, Math.round(fs * 0.02));
  const tOffset = performance.now() / 1000;
  const samples = new Float64Array(nSamples);
  for (let i = 0; i < nSamples; i++) samples[i] = Math.sin(2 * Math.PI * f * (tOffset + i / fs));

  const dpr = window.devicePixelRatio || 1;
  const waveEl = $("alias-wave");
  const wRect = waveEl.getBoundingClientRect();
  waveEl.width = Math.max(1, Math.round(wRect.width * dpr));
  waveEl.height = Math.max(1, Math.round(70 * dpr));
  const wctx = waveEl.getContext("2d");
  wctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const ww = wRect.width, wh = 70;
  wctx.clearRect(0, 0, ww, wh);
  wctx.beginPath();
  for (let i = 0; i < nSamples; i++) { const x=(i/(nSamples-1))*ww, y=wh/2-samples[i]*(wh/2)*0.9; i===0?wctx.moveTo(x,y):wctx.lineTo(x,y); }
  wctx.strokeStyle = "#ffb454"; wctx.lineWidth = 1.3; wctx.stroke();
  wctx.fillStyle = "#ffb454";
  for (let i = 0; i < nSamples; i++) { const x=(i/(nSamples-1))*ww, y=wh/2-samples[i]*(wh/2)*0.9; wctx.beginPath(); wctx.arc(x,y,1.4,0,Math.PI*2); wctx.fill(); }
  const period = nSamples / fs;
  const playFrac = (tOffset % period) / period;
  const px = playFrac * ww;
  wctx.strokeStyle = "rgba(255,255,255,.6)";
  wctx.lineWidth = 1;
  wctx.beginPath(); wctx.moveTo(px, 0); wctx.lineTo(px, wh); wctx.stroke();
}

function aliasWaveTick() {
  drawAliasWaveform();
  aliasRAF = requestAnimationFrame(aliasWaveTick);
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) { if (aliasRAF) { cancelAnimationFrame(aliasRAF); aliasRAF = null; } }
  else if (!aliasRAF) { aliasRAF = requestAnimationFrame(aliasWaveTick); }
});

function naiveDownsample(mono, srIn, srOut) {
  const ratio = srIn / srOut;
  const nOut = Math.max(1, Math.floor(mono.length / ratio));
  const low = new Float32Array(nOut);
  for (let i = 0; i < nOut; i++) low[i] = mono[Math.min(mono.length - 1, Math.round(i * ratio))];
  return low;
}
function zeroOrderHoldUpsample(low, srOut, srIn, targetLen) {
  const ratio = srIn / srOut;
  const out = new Float32Array(targetLen);
  for (let j = 0; j < targetLen; j++) out[j] = low[Math.min(low.length - 1, Math.floor(j / ratio))];
  return out;
}
function computeEnergyAboveNyquist(mono, sr, targetNyquist) {
  const winSize = Math.min(nextPow2(mono.length), 65536);
  const start = Math.max(0, Math.floor((mono.length - winSize) / 2));
  const re = new Float64Array(winSize), im = new Float64Array(winSize);
  for (let i = 0; i < winSize; i++) { const s = mono[start + i] || 0; const w = 0.5 - 0.5*Math.cos((2*Math.PI*i)/(winSize-1)); re[i] = s * w; }
  fft(re, im);
  const half = winSize / 2;
  let totalE = 0, aboveE = 0;
  const cutoffBin = Math.floor((targetNyquist / (sr/2)) * half);
  for (let i = 0; i < half; i++) { const mag = re[i]*re[i] + im[i]*im[i]; totalE += mag; if (i >= cutoffBin) aboveE += mag; }
  return totalE > 0 ? (aboveE/totalE)*100 : 0;
}

let uploadedAliasBuilt = false;
let aliasPlaybackSource = null;
let uaReconstructed = null;

function ensureUploadedAliasingPanel() {
  if (uploadedAliasBuilt) return;
  uploadedAliasBuilt = true;
  const wrap = document.createElement("div");
  wrap.className = "panel";
  wrap.style.marginTop = "12px";
  wrap.innerHTML = `<div class="panel-head"><span class="panel-label">Analyze Uploaded Audio</span></div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end;margin-bottom:8px;">
      <label style="font:11px var(--ff-mono);color:var(--text-mid);">Target sample rate
        <select id="ua-target-sr" style="display:block;width:120px;">
          <option value="8000">8000 Hz</option>
          <option value="11025">11025 Hz</option>
          <option value="16000">16000 Hz</option>
          <option value="22050" selected>22050 Hz</option>
        </select></label>
      <button class="mini-btn" id="ua-analyze">Analyze Uploaded Audio</button>
      <button class="mini-btn" id="ua-play">Play Aliased Audio</button>
      <button class="mini-btn" id="ua-stop">Stop</button>
    </div>
    <div id="ua-status" style="font:600 12px var(--ff-mono);margin-bottom:6px;"></div>
    <div>Original Audio</div>
    <canvas id="ua-wave-orig" width="500" height="60" style="background:#10151d;border:1px solid var(--hairline);"></canvas>
    <canvas id="ua-spec-orig" width="500" height="80" style="background:#10151d;border:1px solid var(--hairline);"></canvas>
    <div style="margin-top:6px;">Aliased Audio (no anti-aliasing filter)</div>
    <canvas id="ua-wave-alias" width="500" height="60" style="background:#10151d;border:1px solid var(--hairline);"></canvas>
    <canvas id="ua-spec-alias" width="500" height="80" style="background:#10151d;border:1px solid var(--hairline);"></canvas>`;
  document.querySelector(".stage").appendChild(wrap);
  $("ua-analyze").addEventListener("click", runUploadedAliasing);
  $("ua-play").addEventListener("click", playAliasedAudio);
  $("ua-stop").addEventListener("click", stopAliasedAudio);
}

function drawUaPanel(waveCanvas, specCanvas, samples, sr) {
  const dpr = window.devicePixelRatio || 1;
  const wRect = waveCanvas.getBoundingClientRect();
  waveCanvas.width = Math.max(1, Math.round(wRect.width*dpr));
  waveCanvas.height = Math.max(1, Math.round(60*dpr));
  const wctx = waveCanvas.getContext("2d");
  wctx.setTransform(dpr,0,0,dpr,0,0);
  const ww = wRect.width, wh = 60;
  wctx.clearRect(0,0,ww,wh);
  const buckets = Math.max(2, Math.floor(ww));
  const env = downsampleMinMax(samples, buckets);
  const mid = wh/2;
  wctx.beginPath();
  for (let i=0;i<buckets;i++){ const x=(i/(buckets-1))*ww, y=mid-env.max[i]*mid*0.9; i===0?wctx.moveTo(x,y):wctx.lineTo(x,y); }
  for (let i=buckets-1;i>=0;i--){ const x=(i/(buckets-1))*ww, y=mid-env.min[i]*mid*0.9; wctx.lineTo(x,y); }
  wctx.closePath();
  wctx.fillStyle = "rgba(255,180,84,.18)"; wctx.fill();
  wctx.strokeStyle = "#ffb454"; wctx.lineWidth = 1.2; wctx.stroke();

  const sRect = specCanvas.getBoundingClientRect();
  specCanvas.width = Math.max(1, Math.round(sRect.width*dpr));
  specCanvas.height = Math.max(1, Math.round(80*dpr));
  const sctx = specCanvas.getContext("2d");
  sctx.setTransform(dpr,0,0,dpr,0,0);
  const sw = sRect.width, sh = 80;
  sctx.clearRect(0,0,sw,sh);
  const numBars = Math.max(24, Math.floor(sw/10));
  const bars = computeSpectrum(samples, sr, numBars);
  const gap=2, bw=(sw-gap*(numBars-1))/numBars;
  sctx.fillStyle = "rgba(155,140,255,.8)";
  for (let i=0;i<numBars;i++){ const bh=bars[i]*sh; sctx.fillRect(i*(bw+gap), sh-bh, bw, bh); }
}

function runUploadedAliasing() {
  ensureUploadedAliasingPanel();
  if (!state.currentBuffer) { $("ua-status").textContent = "Load an audio file first."; return; }
  const targetSR = Number($("ua-target-sr").value);
  const srIn = state.currentBuffer.sampleRate;
  const nyquist = targetSR / 2;
  const mono = monoOf(state.currentBuffer);

  const low = naiveDownsample(mono, srIn, targetSR);
  uaReconstructed = zeroOrderHoldUpsample(low, targetSR, srIn, mono.length);
  const energyPct = computeEnergyAboveNyquist(mono, srIn, nyquist);

  $("ua-status").innerHTML =
    `Original SR: ${srIn} Hz &nbsp; Target SR: ${targetSR} Hz &nbsp; Nyquist: ${nyquist} Hz<br>
     Aliasing risk: frequencies above Nyquist can fold into the audible spectrum.<br>
     Energy above Nyquist (original signal): ${energyPct.toFixed(1)}%`;

  drawUaPanel($("ua-wave-orig"), $("ua-spec-orig"), mono, srIn);
  drawUaPanel($("ua-wave-alias"), $("ua-spec-alias"), uaReconstructed, srIn);
}

function playAliasedAudio() {
  if (!uaReconstructed || !state.currentBuffer) return;
  stopAliasedAudio();
  const ctx = ac();
  const buf = ctx.createBuffer(1, uaReconstructed.length, state.currentBuffer.sampleRate);
  buf.copyToChannel(Float32Array.from(uaReconstructed), 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
  aliasPlaybackSource = src;
}
function stopAliasedAudio() {
  if (aliasPlaybackSource) { try { aliasPlaybackSource.stop(); } catch(_){} try { aliasPlaybackSource.disconnect(); } catch(_){} aliasPlaybackSource = null; }
}

function renderAliasingLab() {
  ensureAliasingLabPanel();
  const f = Math.max(1, Number($("alias-freq").value) || 0);
  const fs = Math.max(100, Number($("alias-sr").value) || 0);
  const nyquist = fs / 2;

  const nSamples = Math.max(64, Math.round(fs * 0.02));
  const samples = new Float64Array(nSamples);
  for (let i = 0; i < nSamples; i++) samples[i] = Math.sin(2 * Math.PI * f * (i / fs));

  const aliasing = f > nyquist;
  const apparentFreq = aliasedFrequency(f, fs);
  $("alias-status").innerHTML = aliasing
    ? `<span style="color:var(--danger);">Aliasing detected</span> — ${f.toFixed(0)} Hz > Nyquist ${nyquist.toFixed(0)} Hz. Aliased frequency: ${apparentFreq.toFixed(1)} Hz`
    : `<span style="color:var(--ok);">No aliasing</span> — ${f.toFixed(0)} Hz ≤ Nyquist ${nyquist.toFixed(0)} Hz`;

  const dpr = window.devicePixelRatio || 1;

  const size = nextPow2(nSamples);
  const re = new Float64Array(size), im = new Float64Array(size);
  for (let i = 0; i < nSamples; i++) re[i] = samples[i] * (0.5 - 0.5 * Math.cos((2*Math.PI*i)/(nSamples-1)));
  fft(re, im);
  const half = size / 2;
  const mags = new Float64Array(half);
  let maxMag = 1e-9;
  for (let i = 0; i < half; i++) { mags[i] = Math.hypot(re[i], im[i]); if (mags[i] > maxMag) maxMag = mags[i]; }

  const specEl = $("alias-spectrum");
  const sRect = specEl.getBoundingClientRect();
  specEl.width = Math.max(1, Math.round(sRect.width * dpr));
  specEl.height = Math.max(1, Math.round(90 * dpr));
  const sctx = specEl.getContext("2d");
  sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const sw = sRect.width, sh = 90;
  sctx.clearRect(0, 0, sw, sh);
  const bw = sw / half;
  sctx.fillStyle = "rgba(155,140,255,.8)";
  for (let i = 0; i < half; i++) { const barH=(mags[i]/maxMag)*sh; sctx.fillRect((i/half)*sw, sh-barH, Math.max(1,bw), barH); }
  sctx.strokeStyle = "#ffd166"; sctx.lineWidth = 1.5; sctx.setLineDash([4,3]);
  sctx.beginPath(); sctx.moveTo(sw-1,0); sctx.lineTo(sw-1,sh); sctx.stroke(); sctx.setLineDash([]);
  sctx.fillStyle = "#ffd166"; sctx.font = "10px monospace";
  sctx.fillText(`Nyquist ${nyquist.toFixed(0)} Hz`, Math.max(2, sw - 90), 12);
}

function computeDifferenceWave(orig, proc) {
  const n = Math.min(orig.length, proc.length);
  const diff = new Float32Array(n);
  for (let i = 0; i < n; i++) diff[i] = proc[i] - orig[i];
  return diff;
}

function computeStereoCorrelation(chL, chR) {
  const n = Math.min(chL.length, chR.length);
  if (!n) return 0;
  let sumLR = 0, sumLL = 0, sumRR = 0;
  for (let i = 0; i < n; i++) { sumLR += chL[i]*chR[i]; sumLL += chL[i]*chL[i]; sumRR += chR[i]*chR[i]; }
  const denom = Math.sqrt(sumLL * sumRR);
  return denom > 1e-9 ? sumLR / denom : 0;
}

let dspAnalyzerBuilt = false;
function ensureDspAnalyzerPanel() {
  if (dspAnalyzerBuilt) return;
  dspAnalyzerBuilt = true;
  const wrap = document.createElement("div");
  wrap.className = "detail-panel";
  wrap.style.marginTop = "10px";
  wrap.innerHTML = `<div class="detail-head">Difference (processed − original)</div>
    <canvas id="diff-canvas" height="60"></canvas>
    <div class="detail-head" style="margin-top:6px;">Spectrum difference</div>
    <canvas id="diff-spectrum-canvas" height="60"></canvas>
    <div class="detail-stats" id="diff-stats"></div>`;
  $("detail-panel").insertAdjacentElement("afterend", wrap);
}

function renderDifferencePanel() {
  if (!state.previewBuffer || !state.currentBuffer) return;
  ensureDspAnalyzerPanel();
  const dpr = window.devicePixelRatio || 1;

  const diffCanvas = $("diff-canvas");
  const dRect = diffCanvas.getBoundingClientRect();
  diffCanvas.width = Math.max(1, Math.round(dRect.width * dpr));
  diffCanvas.height = Math.max(1, Math.round(60 * dpr));
  const dctx = diffCanvas.getContext("2d");
  dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = dRect.width, h = 60;
  dctx.clearRect(0, 0, w, h);

  const origMono = monoOf(state.currentBuffer);
  const procMono = monoOf(state.previewBuffer);
  const diff = computeDifferenceWave(origMono, procMono);
  const buckets = Math.max(2, Math.floor(w));
  const env = downsampleMinMax(diff, buckets);
  const mid = h / 2;
  dctx.beginPath();
  for (let i = 0; i < buckets; i++) { const x = (i/(buckets-1))*w, y = mid - env.max[i]*mid*0.9; i===0?dctx.moveTo(x,y):dctx.lineTo(x,y); }
  for (let i = buckets - 1; i >= 0; i--) { const x = (i/(buckets-1))*w, y = mid - env.min[i]*mid*0.9; dctx.lineTo(x,y); }
  dctx.closePath();
  dctx.fillStyle = "rgba(255,107,122,.18)"; dctx.fill();
  dctx.strokeStyle = "#ff6b7a"; dctx.lineWidth = 1.2; dctx.stroke();

  const specCanvas = $("diff-spectrum-canvas");
  const sRect = specCanvas.getBoundingClientRect();
  specCanvas.width = Math.max(1, Math.round(sRect.width * dpr));
  specCanvas.height = Math.max(1, Math.round(60 * dpr));
  const sctx = specCanvas.getContext("2d");
  sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const sw = sRect.width, sh = 60;
  sctx.clearRect(0, 0, sw, sh);
  const numBars = Math.max(24, Math.floor(sw / 10));
  const origBars = computeSpectrum(origMono, state.currentBuffer.sampleRate, numBars);
  const procBars = computeSpectrum(procMono, state.previewBuffer.sampleRate, numBars);
  const gap = 2, bw = (sw - gap*(numBars-1)) / numBars;
  for (let i = 0; i < numBars; i++) {
    const dVal = procBars[i] - origBars[i];
    const bh = Math.abs(dVal) * (sh/2);
    sctx.fillStyle = dVal >= 0 ? "rgba(95,227,163,.75)" : "rgba(255,107,122,.75)";
    sctx.fillRect(i*(bw+gap), dVal >= 0 ? sh/2 - bh : sh/2, bw, bh);
  }

  let peakDiff = 0;
  for (let i = 0; i < diff.length; i++) peakDiff = Math.max(peakDiff, Math.abs(diff[i]));
  $("diff-stats").innerHTML = `<span>peak diff: <b>${peakDiff.toFixed(4)}</b></span>`;
}

function renderDifferencePanel() {
  if (!state.previewBuffer || !state.currentBuffer) return;
  ensureDspAnalyzerPanel();
  const dpr = window.devicePixelRatio || 1;

  const diffCanvas = $("diff-canvas");
  const dRect = diffCanvas.getBoundingClientRect();
  diffCanvas.width = Math.max(1, Math.round(dRect.width * dpr));
  diffCanvas.height = Math.max(1, Math.round(60 * dpr));
  const dctx = diffCanvas.getContext("2d");
  dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = dRect.width, h = 60;
  dctx.clearRect(0, 0, w, h);

  const origMono = monoOf(state.currentBuffer);
  const procMono = monoOf(state.previewBuffer);
  const diff = computeDifferenceWave(origMono, procMono);
  const buckets = Math.max(2, Math.floor(w));
  const env = downsampleMinMax(diff, buckets);
  const mid = h / 2;
  dctx.beginPath();
  for (let i = 0; i < buckets; i++) { const x = (i/(buckets-1))*w, y = mid - env.max[i]*mid*0.9; i===0?dctx.moveTo(x,y):dctx.lineTo(x,y); }
  for (let i = buckets - 1; i >= 0; i--) { const x = (i/(buckets-1))*w, y = mid - env.min[i]*mid*0.9; dctx.lineTo(x,y); }
  dctx.closePath();
  dctx.fillStyle = "rgba(255,107,122,.18)"; dctx.fill();
  dctx.strokeStyle = "#ff6b7a"; dctx.lineWidth = 1.2; dctx.stroke();

  const specCanvas = $("diff-spectrum-canvas");
  const sRect = specCanvas.getBoundingClientRect();
  specCanvas.width = Math.max(1, Math.round(sRect.width * dpr));
  specCanvas.height = Math.max(1, Math.round(60 * dpr));
  const sctx = specCanvas.getContext("2d");
  sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const sw = sRect.width, sh = 60;
  sctx.clearRect(0, 0, sw, sh);
  const numBars = Math.max(24, Math.floor(sw / 10));
  const origBars = computeSpectrum(origMono, state.currentBuffer.sampleRate, numBars);
  const procBars = computeSpectrum(procMono, state.previewBuffer.sampleRate, numBars);
  const gap = 2, bw = (sw - gap*(numBars-1)) / numBars;
  for (let i = 0; i < numBars; i++) {
    const dVal = procBars[i] - origBars[i];
    const bh = Math.abs(dVal) * (sh/2);
    sctx.fillStyle = dVal >= 0 ? "rgba(95,227,163,.75)" : "rgba(255,107,122,.75)";
    sctx.fillRect(i*(bw+gap), dVal >= 0 ? sh/2 - bh : sh/2, bw, bh);
  }

  let peakDiff = 0;
  for (let i = 0; i < diff.length; i++) peakDiff = Math.max(peakDiff, Math.abs(diff[i]));
  $("diff-stats").innerHTML = `<span>peak diff: <b>${peakDiff.toFixed(4)}</b></span>`;

  // INTEGRATED CALL:
  renderSpectrogramComparison();
}

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
 * 5. FFT (radix-2, real input via Hann window) — shared by         *
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

function initSpectrogramComparisonUI() {
    const detailArea = document.querySelector('#detail-panel') || document.querySelector('.detail-panel');
    if (!detailArea || document.getElementById('spectrogram-comparison-container')) return;

    const container = document.createElement('div');
    container.id = 'spectrogram-comparison-container';
    container.className = 'detail-panel';
    container.style.marginTop = '10px';
    container.innerHTML = `
        <div class="detail-head">Spectrogram Comparison</div>
        <div style="display: flex; gap: 10px; margin-top: 8px;">
            <div style="flex: 1;">
                <div style="font: 11px var(--ff-mono); color: var(--text-mid); margin-bottom: 4px;">Original</div>
                <canvas id="canvas-spec-orig" height="120" style="width: 100%; background: #10151d; border: 1px solid var(--hairline); display: block;"></canvas>
            </div>
            <div style="flex: 1;">
                <div style="font: 11px var(--ff-mono); color: var(--text-mid); margin-bottom: 4px;">Processed</div>
                <canvas id="canvas-spec-proc" height="120" style="width: 100%; background: #10151d; border: 1px solid var(--hairline); display: block;"></canvas>
            </div>
            <div style="flex: 1;">
                <div style="font: 11px var(--ff-mono); color: var(--text-mid); margin-bottom: 4px;">Difference (Processed − Original)</div>
                <canvas id="canvas-spec-diff" height="120" style="width: 100%; background: #10151d; border: 1px solid var(--hairline); display: block;"></canvas>
            </div>
        </div>
    `;
    detailArea.insertAdjacentElement('afterend', container);
}


function renderSpectrogramComparison() {
    if (!state.previewBuffer || !state.currentBuffer) return;
    initSpectrogramComparisonUI();

    const origCanvas = document.getElementById('canvas-spec-orig');
    const procCanvas = document.getElementById('canvas-spec-proc');
    const diffCanvas = document.getElementById('canvas-spec-diff');
    if (!origCanvas || !procCanvas || !diffCanvas) return;

    const dpr = window.devicePixelRatio || 1;
    [origCanvas, procCanvas, diffCanvas].forEach(c => {
        const rect = c.getBoundingClientRect();
        const w = Math.max(1, Math.round(rect.width * dpr));
        const h = Math.max(1, Math.round(120 * dpr));
        if (c.width !== w) c.width = w;
        if (c.height !== h) c.height = h;
    });

    const origCtx = origCanvas.getContext('2d');
    const procCtx = procCanvas.getContext('2d');
    const diffCtx = diffCanvas.getContext('2d');

    const origMono = monoOf(state.currentBuffer);
    const procMono = monoOf(state.previewBuffer);
    const sr = state.currentBuffer.sampleRate;

    const origSpec = computeSpectrogram(origMono, sr, 200, 100, 1024);
    const procSpec = computeSpectrogram(procMono, sr, 200, 100, 1024);

    if (!origSpec || !procSpec || !origSpec.data || !procSpec.data) return;

    const cols = Math.min(origSpec.cols, procSpec.cols);
    const rows = Math.min(origSpec.rows, procSpec.rows);

    const drawSpecToCanvas = (ctx, canvas, dataGetter) => {
        const w = canvas.width / dpr;
        const h = canvas.height / dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        const imgData = ctx.createImageData(Math.floor(w), Math.floor(h));
        const pixels = imgData.data;

        for (let x = 0; x < Math.floor(w); x++) {
            const col = Math.min(cols - 1, Math.floor((x / w) * cols));
            for (let y = 0; y < Math.floor(h); y++) {
                const row = Math.min(rows - 1, Math.floor(((h - 1 - y) / h) * rows));
                const val = dataGetter(col, row);
                const pxIdx = (y * Math.floor(w) + x) * 4;

                if (typeof val === 'number') {
                    pixels[pxIdx + 0] = Math.floor(val * 120);
                    pixels[pxIdx + 1] = Math.floor(val * 210);
                    pixels[pxIdx + 2] = Math.floor(val * 255);
                    pixels[pxIdx + 3] = 255;
                } else {
                    const d = val.delta;
                    if (d >= 0) {
                        pixels[pxIdx + 0] = Math.floor(Math.min(1, d * 2) * 255);
                        pixels[pxIdx + 1] = Math.floor(Math.min(1, d) * 180);
                        pixels[pxIdx + 2] = 0;
                    } else {
                        const absD = Math.abs(d);
                        pixels[pxIdx + 0] = 0;
                        pixels[pxIdx + 1] = Math.floor(Math.min(1, absD) * 180);
                        pixels[pxIdx + 2] = Math.floor(Math.min(1, absD * 2) * 255);
                    }
                    pixels[pxIdx + 3] = 255;
                }
            }
        }
        ctx.putImageData(imgData, 0, 0);
    };

    drawSpecToCanvas(origCtx, origCanvas, (c, r) => origSpec.data[c * origSpec.rows + r]);
    drawSpecToCanvas(procCtx, procCanvas, (c, r) => procSpec.data[c * procSpec.rows + r]);
    drawSpecToCanvas(diffCtx, diffCanvas, (c, r) => {
        const oVal = origSpec.data[c * origSpec.rows + r] || 0;
        const pVal = procSpec.data[c * procSpec.rows + r] || 0;
        return { delta: pVal - oVal };
    });
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
 * 8. WAVEFORM PANEL — real envelope, ruler, zoom, selection,       *
 *    synchronized playhead                                          *
 * --------------------------------------------------------------- */

function activeDisplayBuffers() {
  // "original" trace is always the last committed signal.
  // "processed" trace is the pending live preview, or (once nothing is
  // pending) the same committed signal — never a fabricated one.
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
  el.textContent = `${span.toFixed(span < 1 ? 3 : 2)}s window · ${zoomFactor().toFixed(1)}×`;
  $("zoom-label").textContent = `${zoomFactor().toFixed(1)}×`;
}

/* --------------------------------------------------------------- *
 * 9. SPECTRUM PANEL — real FFT bars + freq/dB axes + EQ overlay    *
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
 * 10. SPECTROGRAM PANEL — real STFT heatmap                        *
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
    $("spectrogram-sub").textContent = `STFT ${spec.fftSize}/${spec.hopSize} · ${spec.durationS.toFixed(1)}s`;
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
 * 11. METERS PANEL — real peak/RMS, L/R, clipping, dBFS            *
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
      <div class="meter-readout"><b class="mr-peak">-∞</b><br>pk<br><b class="mr-rms">-∞</b><br>rms</div>
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
  mrPeak.textContent = peakDbVal <= -99 ? "-∞" : peakDbVal.toFixed(1);
  mrRms.textContent = rmsDbVal <= -99 ? "-∞" : rmsDbVal.toFixed(1);
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
  if (nCh === 2) {
    const corr = computeStereoCorrelation(channelOf(src, 0), channelOf(src, 1));
    $("meters-source").textContent = `static · L/R corr ${corr.toFixed(2)}`;
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
 * 12. EFFECT DETAIL PANEL — analytic transfer curves (exact match  *
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
  renderDifferencePanel();
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

  let grStat = "—";
  if (state.previewBuffer && state.currentBuffer) {
    const before = rmsDb(monoOf(state.currentBuffer));
    const after = rmsDb(monoOf(state.previewBuffer));
    grStat = (after - before).toFixed(1) + " dB";
  }
  $("detail-stats").innerHTML = `<span>threshold: <b>${threshold} dB</b></span><span>ratio: <b>${ratio}:1</b></span><span>measured level Δ: <b>${grStat}</b></span>`;
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

  let harmStat = "—";
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
    `<span>peak: <b>${pB}→${pA} dB</b></span>` +
    `<span>rms: <b>${rB}→${rA} dB</b></span>` +
    (Math.abs(before.duration - after.duration) > 0.01 ? `<span>duration: <b>${durB}s→${durA}s</b></span>` : "");
}

/* --------------------------------------------------------------- *
 * 12.5. SEPARATE ANALYZER PANELS (Frequency & Spectrum Analyzers)  *
 * --------------------------------------------------------------- */

let faHoverFreq = null;
let faHoverDb = null;
let saHoverTime = null;
let saHoverFreq = null;

let faRangeMode = "full"; // "full" | "bass" | "mid" | "high"
let faFrozen = false;
let faFrozenData = null;

let saViewMode = "spectrum"; // "spectrum" | "spectrogram"
let saDisplayMode = "bars";   // "bars" | "line"
let saScaleMode = "log";     // "log" | "linear"
let saPeakHolds = null;
const saPeakDecay = 0.96;

let modalAnalyzerRAF = null;

function ensureAnalyzerLoop() {
  const fBack = $("freq-analyzer-backdrop");
  const sBack = $("spectrum-analyzer-backdrop");
  const isAnyOpen = (fBack && !fBack.hidden) || (sBack && !sBack.hidden);

  if (isAnyOpen) {
    if (!modalAnalyzerRAF) {
      modalAnalyzerRAF = requestAnimationFrame(modalAnalyzerLoop);
    }
  } else {
    if (modalAnalyzerRAF) {
      cancelAnimationFrame(modalAnalyzerRAF);
      modalAnalyzerRAF = null;
    }
  }
}

function modalAnalyzerLoop() {
  const fBack = $("freq-analyzer-backdrop");
  const sBack = $("spectrum-analyzer-backdrop");
  const isAnyOpen = (fBack && !fBack.hidden) || (sBack && !sBack.hidden);

  if (!isAnyOpen) {
    modalAnalyzerRAF = null;
    return;
  }

  if (fBack && !fBack.hidden) renderFrequencyAnalyzerPanel();
  if (sBack && !sBack.hidden) renderSpectrumAnalyzerPanel();

  modalAnalyzerRAF = requestAnimationFrame(modalAnalyzerLoop);
}

function renderFrequencyAnalyzerPanel() {
  const backdrop = $("freq-analyzer-backdrop");
  if (!backdrop || backdrop.hidden) return;

  const canvas = $("freq-analyzer-canvas");
  if (!canvas) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cw = rect.width, ch = rect.height;
  ctx.clearRect(0, 0, cw, ch);

  const buffer = state.previewBuffer || state.currentBuffer;
  if (!buffer) {
    ctx.fillStyle = "rgba(146,160,177,.6)";
    ctx.font = "600 13px 'IBM Plex Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText("REAL-TIME FREQUENCY ANALYZER", cw / 2, ch / 2 - 14);
    ctx.font = "11px 'IBM Plex Mono', monospace";
    ctx.fillStyle = "rgba(146,160,177,.4)";
    ctx.fillText("Load a signal or audio file to begin live analysis", cw / 2, ch / 2 + 10);
    return;
  }

  const channelVal = $("fa-channel-select") ? $("fa-channel-select").value : "mono";
  let fullSamples;
  if (channelVal === "left") fullSamples = channelOf(buffer, 0);
  else if (channelVal === "right") fullSamples = channelOf(buffer, 1);
  else fullSamples = monoOf(buffer);

  const sr = buffer.sampleRate;
  const fftSize = parseInt($("fa-fft-select") ? $("fa-fft-select").value : "2048") || 2048;

  let minHz = 20, maxHz = sr / 2;
  let isLog = true;
  if (faRangeMode === "bass") { minHz = 20; maxHz = 250; isLog = false; }
  else if (faRangeMode === "mid") { minHz = 250; maxHz = 4000; isLog = true; }
  else if (faRangeMode === "high") { minHz = 4000; maxHz = Math.min(20000, sr / 2); isLog = false; }
  else { minHz = 20; maxHz = Math.min(20000, sr / 2); isLog = true; }

  const padL = 44, padB = 24, padT = 16, padR = 14;
  const plotW = cw - padL - padR;
  const plotH = ch - padB - padT;

  // Grid & dB axes
  ctx.strokeStyle = "rgba(255,255,255,.05)";
  ctx.lineWidth = 1;
  ctx.font = "9.5px 'IBM Plex Mono', monospace";
  ctx.fillStyle = "rgba(146,160,177,.6)";

  const dbLevels = [0, -18, -36, -54, -72, -90];
  dbLevels.forEach((db) => {
    const y = padT + (1 - (db + 90) / 90) * plotH;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(cw - padR, y); ctx.stroke();
    ctx.textAlign = "right";
    ctx.fillText(`${db}dB`, padL - 4, y + 3);
  });

  let gridFreqs = [];
  if (faRangeMode === "bass") gridFreqs = [20, 50, 100, 150, 200, 250];
  else if (faRangeMode === "mid") gridFreqs = [250, 500, 1000, 2000, 3000, 4000];
  else if (faRangeMode === "high") gridFreqs = [4000, 8000, 12000, 16000, 20000];
  else gridFreqs = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 20000];

  gridFreqs.forEach((f) => {
    if (f < minHz || f > maxHz) return;
    let xFrac = isLog
      ? (Math.log10(f) - Math.log10(minHz)) / (Math.log10(maxHz) - Math.log10(minHz))
      : (f - minHz) / (maxHz - minHz);
    xFrac = Math.max(0, Math.min(1, xFrac));
    const x = padL + xFrac * plotW;
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH); ctx.stroke();
    ctx.textAlign = "center";
    const label = f >= 1000 ? `${(f / 1000).toFixed(f % 1000 === 0 ? 0 : 1)}k` : `${f}`;
    ctx.fillText(label, x, ch - 7);
  });

  let points = [];
  let peakMag = 0, peakHz = 0, peakDbVal = -90;
  let sumMag = 0, weightedSumFreq = 0;

  if (faFrozen && faFrozenData) {
    points = faFrozenData.points;
    peakHz = faFrozenData.peakHz;
    peakDbVal = faFrozenData.peakDbVal;
    sumMag = 1;
    weightedSumFreq = faFrozenData.centroidHz;
  } else {
    let centerSample = 0;
    if (state.htmlAudio && !state.htmlAudio.paused && state.htmlAudio.duration) {
      centerSample = Math.floor(state.htmlAudio.currentTime * sr);
    } else if (state.selection && state.selection.endS > state.selection.startS) {
      centerSample = Math.floor(((state.selection.startS + state.selection.endS) / 2) * sr);
    } else {
      centerSample = Math.floor(fullSamples.length / 2);
    }

    centerSample = Math.max(0, Math.min(fullSamples.length - 1, centerSample));
    const size = nextPow2(fftSize);
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    const start = centerSample - Math.floor(size / 2);

    for (let i = 0; i < size; i++) {
      const sIdx = start + i;
      const s = (sIdx >= 0 && sIdx < fullSamples.length) ? fullSamples[sIdx] : 0;
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
      re[i] = s * w;
    }
    fft(re, im);

    const half = size / 2;
    const numSteps = Math.max(128, Math.floor(plotW));

    for (let p = 0; p < numSteps; p++) {
      const frac = p / (numSteps - 1);
      const hz = isLog
        ? Math.pow(10, Math.log10(minHz) + frac * (Math.log10(maxHz) - Math.log10(minHz)))
        : minHz + frac * (maxHz - minHz);

      const bin = Math.min(half - 1, Math.max(1, Math.floor((hz / (sr / 2)) * half)));
      const mag = Math.hypot(re[bin], im[bin]) / half;
      const db = 20 * Math.log10(mag + 1e-9);
      const normDb = Math.max(0, Math.min(1, (db + 90) / 90));

      const x = padL + frac * plotW;
      const y = padT + (1 - normDb) * plotH;
      points.push({ x, y, hz, db });

      if (mag > peakMag && hz >= minHz && hz <= maxHz) {
        peakMag = mag;
        peakHz = hz;
        peakDbVal = db;
      }
      sumMag += mag;
      weightedSumFreq += hz * mag;
    }
  }

  const centroidHz = sumMag > 1e-9 ? weightedSumFreq / sumMag : 0;

  let bandName = "Mid";
  if (peakHz < 250) bandName = "Bass";
  else if (peakHz >= 4000) bandName = "High";

  if (!faFrozen) {
    faFrozenData = { points, peakHz, peakDbVal, centroidHz, bandName };
  }

  // Draw Area & Glowing Trace
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(padL, padT + plotH);
  points.forEach((pt) => ctx.lineTo(pt.x, pt.y));
  ctx.lineTo(padL + plotW, padT + plotH);
  ctx.closePath();
  ctx.fillStyle = "rgba(56, 189, 248, 0.12)";
  ctx.fill();

  ctx.beginPath();
  points.forEach((pt, i) => i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y));
  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 2.0;
  ctx.shadowColor = "rgba(56, 189, 248, 0.6)";
  ctx.shadowBlur = 8;
  ctx.stroke();
  ctx.restore();

  // Peak Marker
  if (peakHz >= minHz && peakHz <= maxHz) {
    let pxFrac = isLog
      ? (Math.log10(peakHz) - Math.log10(minHz)) / (Math.log10(maxHz) - Math.log10(minHz))
      : (peakHz - minHz) / (maxHz - minHz);
    pxFrac = Math.max(0, Math.min(1, pxFrac));
    const px = padL + pxFrac * plotW;
    const py = padT + (1 - Math.max(0, Math.min(1, (peakDbVal + 90) / 90))) * plotH;

    ctx.save();
    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 1.8;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(px, padT); ctx.lineTo(px, padT + plotH); ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "#fbbf24";
    ctx.shadowColor = "#fbbf24";
    ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(px, py, 4.5, 0, Math.PI * 2); ctx.fill();

    ctx.font = "700 10px 'IBM Plex Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText(`${peakHz.toFixed(0)} Hz`, Math.max(padL + 35, Math.min(cw - padR - 35, px)), padT + 12);
    ctx.restore();
  }

  // Update Stats UI
  if ($("fa-stat-peak")) $("fa-stat-peak").textContent = `${peakHz.toFixed(1)} Hz`;
  if ($("fa-stat-level")) $("fa-stat-level").textContent = `${peakDbVal.toFixed(1)} dB`;
  if ($("fa-stat-band")) $("fa-stat-band").textContent = bandName;
  if ($("fa-stat-centroid")) $("fa-stat-centroid").textContent = `${centroidHz.toFixed(0)} Hz`;
  if (faHoverFreq !== null && faHoverDb !== null) {
    if ($("fa-stat-cursor")) $("fa-stat-cursor").textContent = `${faHoverFreq.toFixed(1)} Hz (${faHoverDb.toFixed(1)} dB)`;
  }
}

function renderSpectrumAnalyzerPanel() {
  const backdrop = $("spectrum-analyzer-backdrop");
  if (!backdrop || backdrop.hidden) return;

  const canvas = $("spectrum-analyzer-canvas");
  if (!canvas) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cw = rect.width, ch = rect.height;
  ctx.clearRect(0, 0, cw, ch);

  const buffer = state.previewBuffer || state.currentBuffer;
  if (!buffer) {
    ctx.fillStyle = "rgba(146,160,177,.6)";
    ctx.font = "600 13px 'IBM Plex Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText("REAL-TIME SPECTRUM ANALYZER", cw / 2, ch / 2 - 14);
    ctx.font = "11px 'IBM Plex Mono', monospace";
    ctx.fillStyle = "rgba(146,160,177,.4)";
    ctx.fillText("Load a signal or audio file to begin live analysis", cw / 2, ch / 2 + 10);
    return;
  }

  const mono = monoOf(buffer);
  const sr = buffer.sampleRate;
  const fftSize = parseInt($("sa-fft-select") ? $("sa-fft-select").value : "2048") || 2048;
  const padL = 44, padB = 24, padT = 16, padR = 14;
  const plotW = cw - padL - padR;
  const plotH = ch - padB - padT;

  if (saViewMode === "spectrogram") {
    // 2D STFT Spectrogram View
    const targetCols = Math.max(80, Math.floor(plotW));
    const targetRows = Math.max(60, Math.floor(plotH));
    const spec = computeSpectrogram(mono, sr, targetCols, targetRows, fftSize);

    const off = document.createElement("canvas");
    off.width = spec.cols; off.height = spec.rows;
    const octx = off.getContext("2d");
    const img = octx.createImageData(spec.cols, spec.rows);

    for (let c = 0; c < spec.cols; c++) {
      for (let r = 0; r < spec.rows; r++) {
        const v = spec.data[c * spec.rows + r] || 0;
        const [red, green, blue] = colorRamp(v);
        const pxIdx = ((spec.rows - 1 - r) * spec.cols + c) * 4;
        img.data[pxIdx] = red; img.data[pxIdx + 1] = green; img.data[pxIdx + 2] = blue; img.data[pxIdx + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    ctx.drawImage(off, padL, padT, plotW, plotH);

    // Playback cursor
    if (state.htmlAudio && state.htmlAudio.duration) {
      const curT = state.htmlAudio.currentTime;
      const xCur = padL + (curT / buffer.duration) * plotW;
      if (xCur >= padL && xCur <= padL + plotW) {
        ctx.save();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.shadowColor = "#fff";
        ctx.shadowBlur = 6;
        ctx.beginPath(); ctx.moveTo(xCur, padT); ctx.lineTo(xCur, padT + plotH); ctx.stroke();
        ctx.restore();
      }
    }
  } else {
    // LIVE MOVING FFT SPECTRUM VIEW
    const numBars = 64;
    if (!saPeakHolds || saPeakHolds.length !== numBars) {
      saPeakHolds = new Float32Array(numBars);
    }

    let centerSample = 0;
    if (state.htmlAudio && !state.htmlAudio.paused && state.htmlAudio.duration) {
      centerSample = Math.floor(state.htmlAudio.currentTime * sr);
    } else if (state.selection && state.selection.endS > state.selection.startS) {
      centerSample = Math.floor(((state.selection.startS + state.selection.endS) / 2) * sr);
    } else {
      centerSample = Math.floor(mono.length / 2);
    }
    centerSample = Math.max(0, Math.min(mono.length - 1, centerSample));

    const size = nextPow2(fftSize);
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    const start = centerSample - Math.floor(size / 2);

    for (let i = 0; i < size; i++) {
      const sIdx = start + i;
      const s = (sIdx >= 0 && sIdx < mono.length) ? mono[sIdx] : 0;
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
      re[i] = s * w;
    }
    fft(re, im);

    const half = size / 2;
    const minHz = 20, maxHz = Math.min(20000, sr / 2);
    const isLog = saScaleMode === "log";

    // Grid & Scales
    ctx.strokeStyle = "rgba(255,255,255,.05)";
    ctx.lineWidth = 1;
    ctx.font = "9.5px 'IBM Plex Mono', monospace";
    ctx.fillStyle = "rgba(146,160,177,.6)";

    const dbLevels = [0, -18, -36, -54, -72, -90];
    dbLevels.forEach((db) => {
      const y = padT + (1 - (db + 90) / 90) * plotH;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(cw - padR, y); ctx.stroke();
      ctx.textAlign = "right";
      ctx.fillText(`${db}dB`, padL - 4, y + 3);
    });

    const gridFreqs = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 20000];
    gridFreqs.forEach((f) => {
      if (f < minHz || f > maxHz) return;
      let xFrac = isLog
        ? (Math.log10(f) - Math.log10(minHz)) / (Math.log10(maxHz) - Math.log10(minHz))
        : (f - minHz) / (maxHz - minHz);
      xFrac = Math.max(0, Math.min(1, xFrac));
      const x = padL + xFrac * plotW;
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH); ctx.stroke();
      ctx.textAlign = "center";
      const label = f >= 1000 ? `${f / 1000}k` : `${f}`;
      ctx.fillText(label, x, ch - 7);
    });

    let peakMag = 0, peakHz = 0, peakDbVal = -90;
    const barSpacing = plotW / numBars;
    const barWidth = Math.max(barSpacing * 0.75, 2);
    const linePoints = [];

    for (let b = 0; b < numBars; b++) {
      const frac = b / (numBars - 1);
      const hz = isLog
        ? Math.pow(10, Math.log10(minHz) + frac * (Math.log10(maxHz) - Math.log10(minHz)))
        : minHz + frac * (maxHz - minHz);

      const bin = Math.min(half - 1, Math.max(1, Math.floor((hz / (sr / 2)) * half)));
      const mag = Math.hypot(re[bin], im[bin]) / half;
      const db = 20 * Math.log10(mag + 1e-9);
      const normDb = Math.max(0, Math.min(1, (db + 90) / 90));
      const hBar = normDb * plotH;

      if (normDb > saPeakHolds[b]) {
        saPeakHolds[b] = normDb;
      } else {
        saPeakHolds[b] *= saPeakDecay;
      }

      const px = padL + b * barSpacing;
      const py = (padT + plotH) - hBar;
      linePoints.push({ x: px + barWidth / 2, y: py });

      if (mag > peakMag && hz >= 20) {
        peakMag = mag;
        peakHz = hz;
        peakDbVal = db;
      }

      if (saDisplayMode === "bars") {
        ctx.fillStyle = "rgba(158, 122, 255, 0.85)";
        ctx.shadowColor = "rgba(158, 122, 255, 0.5)";
        ctx.shadowBlur = normDb > 0.4 ? 6 : 0;
        ctx.fillRect(px, py, barWidth, hBar);

        const holdY = (padT + plotH) - saPeakHolds[b] * plotH;
        ctx.fillStyle = "#ffb454";
        ctx.fillRect(px, holdY, barWidth, 2);
      }
    }
    ctx.shadowBlur = 0;

    if (saDisplayMode === "line") {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(padL, padT + plotH);
      linePoints.forEach((pt) => ctx.lineTo(pt.x, pt.y));
      ctx.lineTo(padL + plotW, padT + plotH);
      ctx.closePath();
      ctx.fillStyle = "rgba(158, 122, 255, 0.14)";
      ctx.fill();

      ctx.beginPath();
      linePoints.forEach((pt, i) => i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y));
      ctx.strokeStyle = "#9e7aff";
      ctx.lineWidth = 2;
      ctx.shadowColor = "rgba(158, 122, 255, 0.7)";
      ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.restore();
    }

    if (peakHz >= minHz && peakHz <= maxHz) {
      let pxFrac = isLog
        ? (Math.log10(peakHz) - Math.log10(minHz)) / (Math.log10(maxHz) - Math.log10(minHz))
        : (peakHz - minHz) / (maxHz - minHz);
      pxFrac = Math.max(0, Math.min(1, pxFrac));
      const px = padL + pxFrac * plotW;

      ctx.save();
      ctx.strokeStyle = "#34d399";
      ctx.lineWidth = 1.6;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(px, padT); ctx.lineTo(px, padT + plotH); ctx.stroke();
      ctx.setLineDash([]);

      ctx.font = "700 10px 'IBM Plex Mono', monospace";
      ctx.fillStyle = "#34d399";
      ctx.textAlign = "center";
      ctx.fillText(`LIVE PEAK: ${peakHz.toFixed(0)} Hz`, Math.max(padL + 45, Math.min(cw - padR - 45, px)), padT + 12);
      ctx.restore();
    }

    if ($("sa-stat-peak")) $("sa-stat-peak").textContent = `${peakHz.toFixed(1)} Hz`;
    if ($("sa-stat-level")) $("sa-stat-level").textContent = `${peakDbVal.toFixed(1)} dB`;
  }

  if ($("sa-stat-duration")) $("sa-stat-duration").textContent = `${buffer.duration.toFixed(2)} s`;
  if ($("sa-stat-sr")) $("sa-stat-sr").textContent = `${sr} Hz`;

  if (saHoverTime !== null && saHoverFreq !== null) {
    if ($("sa-stat-cursor")) $("sa-stat-cursor").textContent = `${saHoverTime.toFixed(2)}s, ${saHoverFreq.toFixed(0)} Hz`;
  }
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
  renderFrequencyAnalyzerPanel();
  renderSpectrumAnalyzerPanel();
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
    p.textContent = "No parameters — this module transforms the whole signal the same way every time.";
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
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const buf = await res.arrayBuffer();
  const ctx = ac();
  if (ctx.state === "suspended") {
    try { await ctx.resume(); } catch (_) {}
  }
  return new Promise((resolve, reject) => {
    try {
      const p = ctx.decodeAudioData(buf.slice(0), resolve, reject);
      if (p && typeof p.then === "function") {
        p.then(resolve, reject);
      }
    } catch (e) {
      reject(e);
    }
  });
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
    if (gen !== state.requestGen) return; // superseded by a newer parameter change — discard
    const buffer = await decodeFileId(meta.file_id);
    if (gen !== state.requestGen) return; // superseded while decoding — discard

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
  setStatus(`Applying ${EFFECTS[key].label}…`);
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
    state.requestGen++; // invalidate any in-flight preview so it can't overwrite the commit
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
    saveSongSnapshot(); // record this song's newly committed (processed) state
    saveSession();
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
  // Capture any unsaved live state (e.g. unapplied param tweaks) of the song
  // currently being edited before the new upload takes over as active.
  saveSongSnapshot();

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
  state.paramValues = {};
  state.selection = null;
  state.selectionOnly = false;
  state.abMode = "original";
  state.view = { start: 0, end: buffer.duration };
  state.spectrogramCache = null;

  // Multi-song: append the new upload as its own song and make it active.
  state.songs.push({});
  state.activeSongIdx = state.songs.length - 1;
  saveSongSnapshot();
  renderSongTabs();

  applySongUi();
  saveSession();
  setStatus("Signal loaded.");
}

async function handleFile(file) {
  setStatus("Uploading…");
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
  setStatus("Loading sample…");
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
    ? `${state.sampleRate} Hz · ${state.channels === 2 ? "stereo" : "mono"} · ${fmtTime(state.duration)}`
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
  ensureAnalyzerLoop();
  playheadLoop();
});
state.htmlAudio.addEventListener("pause", () => {
  $("icon-play").hidden = false; $("icon-pause").hidden = true;
  renderStaticMeters();
  renderFrequencyAnalyzerPanel();
  renderSpectrumAnalyzerPanel();
});
state.htmlAudio.addEventListener("ended", () => {
  $("icon-play").hidden = false; $("icon-pause").hidden = true;
  renderStaticMeters();
  renderFrequencyAnalyzerPanel();
  renderSpectrumAnalyzerPanel();
});
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
  if (state.activeEffect) renderDetailPanel();
  renderFrequencyAnalyzerPanel();
  renderSpectrumAnalyzerPanel();
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
    $("selection-text").textContent = `${fmtTime(state.selection.startS)} → ${fmtTime(state.selection.endS)} (${d.toFixed(2)}s)`;
  } else {
    $("selection-text").textContent = "No selection · drag on waveform to select";
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

function renderAliasingLab() {
  ensureAliasingLabPanel();
  const f = Math.max(1, Number($("alias-freq").value) || 0);
  const fs = Math.max(100, Number($("alias-sr").value) || 0);
  const nyquist = fs / 2;

  const nSamples = Math.max(64, Math.round(fs * 0.02));
  const samples = new Float64Array(nSamples);
  for (let i = 0; i < nSamples; i++) samples[i] = Math.sin(2 * Math.PI * f * (i / fs));

  const aliasing = f > nyquist;
  const apparentFreq = aliasedFrequency(f, fs);
  $("alias-status").innerHTML = aliasing
    ? `<span style="color:var(--danger);">Aliasing detected</span> — ${f.toFixed(0)} Hz > Nyquist ${nyquist.toFixed(0)} Hz. Aliased frequency: ${apparentFreq.toFixed(1)} Hz`
    : `<span style="color:var(--ok);">No aliasing</span> — ${f.toFixed(0)} Hz ≤ Nyquist ${nyquist.toFixed(0)} Hz`;

  const dpr = window.devicePixelRatio || 1;

  const size = nextPow2(nSamples);
  const re = new Float64Array(size), im = new Float64Array(size);
  for (let i = 0; i < nSamples; i++) re[i] = samples[i] * (0.5 - 0.5 * Math.cos((2*Math.PI*i)/(nSamples-1)));
  fft(re, im);
  const half = size / 2;
  const mags = new Float64Array(half);
  let maxMag = 1e-9;
  for (let i = 0; i < half; i++) { mags[i] = Math.hypot(re[i], im[i]); if (mags[i] > maxMag) maxMag = mags[i]; }

  const specEl = $("alias-spectrum");
  const sRect = specEl.getBoundingClientRect();
  specEl.width = Math.max(1, Math.round(sRect.width * dpr));
  specEl.height = Math.max(1, Math.round(90 * dpr));
  const sctx = specEl.getContext("2d");
  sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const sw = sRect.width, sh = 90;
  sctx.clearRect(0, 0, sw, sh);
  const bw = sw / half;
  sctx.fillStyle = "rgba(155,140,255,.8)";
  for (let i = 0; i < half; i++) { const barH=(mags[i]/maxMag)*sh; sctx.fillRect((i/half)*sw, sh-barH, Math.max(1,bw), barH); }
  sctx.strokeStyle = "#ffd166"; sctx.lineWidth = 1.5; sctx.setLineDash([4,3]);
  sctx.beginPath(); sctx.moveTo(sw-1,0); sctx.lineTo(sw-1,sh); sctx.stroke(); sctx.setLineDash([]);
  sctx.fillStyle = "#ffd166"; sctx.font = "10px monospace";
  sctx.fillText(`Nyquist ${nyquist.toFixed(0)} Hz`, Math.max(2, sw - 90), 12);
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
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });

  document.querySelectorAll("[data-sample]").forEach((btn) => {
    btn.addEventListener("click", () => loadSample(btn.dataset.sample));
  });

  $("tp-play").addEventListener("click", togglePlay);
  $("tp-seek").addEventListener("input", (e) => {
    if (!state.htmlAudio.duration) return;
    state.htmlAudio.currentTime = (e.target.value / 1000) * state.htmlAudio.duration;
  });

  document.querySelectorAll(".ab-opt").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.abMode = btn.dataset.mode;
      updateAbSwitch();
      redrawAll();
    });
  });

  $("btn-apply-effect").addEventListener("click", applyCurrentEffect);
  $("btn-cancel-effect").addEventListener("click", cancelCurrentEffect);
  $("btn-export").addEventListener("click", async () => {
    if (!state.fileId) return;
    const url = downloadUrl(state.fileId);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = state.filename ? state.filename.replace(/\.[^.]+$/, "") + "_processed.wav" : "signal_lab_processed.wav";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (err) {
      // Fallback: direct navigation if blob/fetch fails (e.g. huge files on some browsers).
      window.location.href = url;
    }
  });

  $("btn-zoom-in").addEventListener("click", () => setZoom((state.view.end - state.view.start) / 1.5, (state.view.start + state.view.end) / 2));
  $("btn-zoom-out").addEventListener("click", () => setZoom((state.view.end - state.view.start) * 1.5, (state.view.start + state.view.end) / 2));
  $("btn-zoom-reset").addEventListener("click", () => {
    if (state.currentBuffer) { state.view = { start: 0, end: state.currentBuffer.duration }; redrawAll(); }
  });
  $("btn-clear-selection").addEventListener("click", () => {
    state.selection = null;
    state.selectionOnly = false;
    updateSelectionUI();
    renderWaveform();
  });

  wireWaveformInteraction();
  window.addEventListener("resize", () => redrawAll());

  // Dropdown toggle logic for View and Samples
  const btnView = $("btn-view");
  const viewMenu = $("view-menu");
  if (btnView && viewMenu) {
    btnView.addEventListener("click", (e) => {
      e.stopPropagation();
      viewMenu.classList.toggle("open");
      if ($("sample-menu")) $("sample-menu").classList.remove("open");
    });
  }

  const btnSamples = $("btn-samples");
  const sampleMenu = $("sample-menu");
  if (btnSamples && sampleMenu) {
    btnSamples.addEventListener("click", (e) => {
      e.stopPropagation();
      sampleMenu.classList.toggle("open");
      if (viewMenu) viewMenu.classList.remove("open");
    });
  }

  document.addEventListener("click", () => {
    if (viewMenu) viewMenu.classList.remove("open");
    if (sampleMenu) sampleMenu.classList.remove("open");
  });

  // View menu & Analyzer panels wiring
  if ($("btn-view-freq")) {
    $("btn-view-freq").addEventListener("click", (e) => {
      e.stopPropagation();
      if (viewMenu) viewMenu.classList.remove("open");
      $("freq-analyzer-backdrop").hidden = false;
      ensureAnalyzerLoop();
      renderFrequencyAnalyzerPanel();
    });
  }
  if ($("btn-view-spectrum")) {
    $("btn-view-spectrum").addEventListener("click", (e) => {
      e.stopPropagation();
      if (viewMenu) viewMenu.classList.remove("open");
      $("spectrum-analyzer-backdrop").hidden = false;
      ensureAnalyzerLoop();
      renderSpectrumAnalyzerPanel();
    });
  }
  if ($("btn-view-mixer")) {
    $("btn-view-mixer").addEventListener("click", (e) => {
      e.stopPropagation();
      if (viewMenu) viewMenu.classList.remove("open");
      if ($("btn-open-mixer")) $("btn-open-mixer").click();
    });
  }

  if ($("btn-close-freq-analyzer")) {
    $("btn-close-freq-analyzer").addEventListener("click", () => {
      $("freq-analyzer-backdrop").hidden = true;
      ensureAnalyzerLoop();
    });
  }
  if ($("btn-close-spectrum-analyzer")) {
    $("btn-close-spectrum-analyzer").addEventListener("click", () => {
      $("spectrum-analyzer-backdrop").hidden = true;
      ensureAnalyzerLoop();
    });
  }

  const fBackdrop = $("freq-analyzer-backdrop");
  if (fBackdrop) {
    fBackdrop.addEventListener("click", (e) => {
      if (e.target === fBackdrop) {
        fBackdrop.hidden = true;
        ensureAnalyzerLoop();
      }
    });
  }
  const sBackdrop = $("spectrum-analyzer-backdrop");
  if (sBackdrop) {
    sBackdrop.addEventListener("click", (e) => {
      if (e.target === sBackdrop) {
        sBackdrop.hidden = true;
        ensureAnalyzerLoop();
      }
    });
  }

  // Frequency Analyzer Controls
  document.querySelectorAll(".fa-range-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".fa-range-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      faRangeMode = btn.dataset.range || "full";
      renderFrequencyAnalyzerPanel();
    });
  });

  if ($("fa-btn-freeze")) {
    $("fa-btn-freeze").addEventListener("click", () => {
      faFrozen = !faFrozen;
      $("fa-btn-freeze").classList.toggle("frozen", faFrozen);
      $("fa-btn-freeze").textContent = faFrozen ? "▶ Resume" : "❄ Freeze";
      renderFrequencyAnalyzerPanel();
    });
  }

  if ($("fa-channel-select")) $("fa-channel-select").addEventListener("change", () => renderFrequencyAnalyzerPanel());
  if ($("fa-fft-select")) $("fa-fft-select").addEventListener("change", () => renderFrequencyAnalyzerPanel());

  // Spectrum Analyzer Controls
  document.querySelectorAll(".sa-view-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".sa-view-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      saViewMode = btn.dataset.view || "spectrum";
      renderSpectrumAnalyzerPanel();
    });
  });

  if ($("sa-fft-select")) $("sa-fft-select").addEventListener("change", () => renderSpectrumAnalyzerPanel());
  if ($("sa-display-select")) {
    $("sa-display-select").addEventListener("change", (e) => {
      saDisplayMode = e.target.value;
      renderSpectrumAnalyzerPanel();
    });
  }
  if ($("sa-scale-select")) {
    $("sa-scale-select").addEventListener("change", (e) => {
      saScaleMode = e.target.value;
      renderSpectrumAnalyzerPanel();
    });
  }
  if ($("sa-btn-reset-peaks")) {
    $("sa-btn-reset-peaks").addEventListener("click", () => {
      if (saPeakHolds) saPeakHolds.fill(0);
      renderSpectrumAnalyzerPanel();
    });
  }

  const faCanvas = $("freq-analyzer-canvas");
  if (faCanvas) {
    faCanvas.addEventListener("mousemove", (e) => {
      const rect = faCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const padL = 44, padR = 14;
      const plotW = rect.width - padL - padR;
      const buffer = state.previewBuffer || state.currentBuffer;
      if (!buffer || plotW <= 0) return;
      const sr = buffer.sampleRate;
      let minHz = 20, maxHz = sr / 2;
      let isLog = true;
      if (faRangeMode === "bass") { minHz = 20; maxHz = 250; isLog = false; }
      else if (faRangeMode === "mid") { minHz = 250; maxHz = 4000; isLog = true; }
      else if (faRangeMode === "high") { minHz = 4000; maxHz = Math.min(20000, sr / 2); isLog = false; }
      else { minHz = 20; maxHz = Math.min(20000, sr / 2); isLog = true; }

      let frac = (x - padL) / plotW;
      frac = Math.max(0, Math.min(1, frac));
      faHoverFreq = isLog
        ? Math.pow(10, Math.log10(minHz) + frac * (Math.log10(maxHz) - Math.log10(minHz)))
        : minHz + frac * (maxHz - minHz);
      const y = e.clientY - rect.top;
      const padT = 16, padB = 24;
      const plotH = rect.height - padT - padB;
      let yFrac = (y - padT) / plotH;
      yFrac = Math.max(0, Math.min(1, yFrac));
      faHoverDb = (1 - yFrac) * 90 - 90;
      renderFrequencyAnalyzerPanel();
    });
    faCanvas.addEventListener("mouseleave", () => {
      faHoverFreq = null; faHoverDb = null;
      if ($("fa-stat-cursor")) $("fa-stat-cursor").textContent = "-";
      renderFrequencyAnalyzerPanel();
    });
  }

  const saCanvas = $("spectrum-analyzer-canvas");
  if (saCanvas) {
    saCanvas.addEventListener("mousemove", (e) => {
      const rect = saCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const padL = 44, padR = 14, padT = 16, padB = 24;
      const plotW = rect.width - padL - padR;
      const plotH = rect.height - padT - padB;
      const buffer = state.previewBuffer || state.currentBuffer;
      if (!buffer || plotW <= 0 || plotH <= 0) return;

      if (saViewMode === "spectrogram") {
        const dur = buffer.duration;
        let xFrac = (x - padL) / plotW;
        xFrac = Math.max(0, Math.min(1, xFrac));
        saHoverTime = xFrac * dur;
        let yFrac = (y - padT) / plotH;
        yFrac = Math.max(0, Math.min(1, yFrac));
        const sr = buffer.sampleRate;
        const minHz = 20, maxHz = sr / 2;
        saHoverFreq = Math.pow(10, Math.log10(minHz) + (1 - yFrac) * (Math.log10(maxHz) - Math.log10(minHz)));
      } else {
        const sr = buffer.sampleRate;
        const minHz = 20, maxHz = Math.min(20000, sr / 2);
        const isLog = saScaleMode === "log";
        let xFrac = (x - padL) / plotW;
        xFrac = Math.max(0, Math.min(1, xFrac));
        saHoverTime = null;
        saHoverFreq = isLog
          ? Math.pow(10, Math.log10(minHz) + xFrac * (Math.log10(maxHz) - Math.log10(minHz)))
          : minHz + xFrac * (maxHz - minHz);
      }
      renderSpectrumAnalyzerPanel();
    });
    saCanvas.addEventListener("mouseleave", () => {
      saHoverTime = null; saHoverFreq = null;
      if ($("sa-stat-cursor")) $("sa-stat-cursor").textContent = "-";
      renderSpectrumAnalyzerPanel();
    });
  }
}

/* --------------------------------------------------------------- *
 * 24. SESSION PERSISTENCE (survives browser refresh)                *
 * --------------------------------------------------------------- */

/* --------------------------------------------------------------- *
 * Multi-song helpers — snapshots carry metadata only (no AudioBuffer) *
 * --------------------------------------------------------------- */

/** Deep-ish copy of paramValues (per-song effect settings) so two songs
 *  never share a mutable object and overwrite each other's state. */
function cloneParams(pv) {
  const out = {};
  if (!pv || typeof pv !== "object") return out;
  for (const k of Object.keys(pv)) {
    const inner = pv[k];
    if (inner && typeof inner === "object") {
      out[k] = {};
      for (const pk of Object.keys(inner)) {
        const v = inner[pk];
        out[k][pk] = Array.isArray(v) ? v.slice() : v;
      }
    } else {
      out[k] = inner;
    }
  }
  return out;
}

/** Snapshot the currently-active song's committed state into state.songs[activeSongIdx]. */
function saveSongSnapshot() {
  if (!state.fileId) return null;
  const snap = {
    fileId: state.fileId,
    filename: state.filename || "song",
    sampleRate: state.sampleRate,
    duration: state.duration,
    channels: state.channels,
    appliedEffects: Array.from(state.appliedEffects || []),
    paramValues: cloneParams(state.paramValues || {}),
    view: state.view && state.view.end ? { ...state.view } : { start: 0, end: state.duration },
    selection: state.selection ? { startS: state.selection.startS, endS: state.selection.endS } : null,
    selectionOnly: !!state.selectionOnly,
    abMode: state.abMode,
  };
  if (state.activeSongIdx >= 0 && state.activeSongIdx < state.songs.length) {
    state.songs[state.activeSongIdx] = snap;
  }
  return snap;
}

/** Copy a song snapshot's metadata into the live state (AudioBuffer is assigned
 *  separately by the caller after (re)decoding the committed fileId). */
function restoreStateFromSong(snap) {
  if (!snap) return;
  state.fileId = snap.fileId || null;
  state.filename = snap.filename || "song";
  state.sampleRate = snap.sampleRate || 44100;
  state.duration = snap.duration || 0;
  state.channels = snap.channels || 1;
  state.currentBuffer = null; // caller assigns after decode
  state.previewBuffer = null;
  state.previewFileId = null;
  state.appliedEffects = new Set(snap.appliedEffects || []);
  state.activeEffect = null;
  state.paramValues = cloneParams(snap.paramValues || {});
  state.view = snap.view && snap.view.end > snap.view.start
    ? { ...snap.view }
    : { start: 0, end: state.duration };
  state.selection = snap.selection ? { startS: snap.selection.startS, endS: snap.selection.endS } : null;
  state.selectionOnly = !!snap.selectionOnly;
  state.abMode = "original"; // previews are transient and never restored
  state.spectrogramCache = null;
}

/** Rebuild the per-song UI visuals once a song's buffer is active. */
function applySongUi() {
  $("dropzone").hidden = true;
  $("viz-stack").hidden = false;
  $("transport").hidden = false;
  $("btn-export").disabled = false;
  $("file-dot").classList.add("on");
  $("header-filename").textContent = state.filename || "song";
  buildRack();
  closeParamPanel();
  updateAbSwitch();
  updateSelectionUI();
  updateHeaderMeta();
  updateTransportEnabled();
  redrawAll();
}

/** Render the song tab bar. */
function renderSongTabs() {
  const tabs = $("song-tabs");
  if (!tabs) return;
  tabs.innerHTML = "";
  tabs.hidden = !state.songs.length;
  state.songs.forEach((s, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "song-tab" + (i === state.activeSongIdx ? " active" : "");
    const label = s.filename || `Song ${i + 1}`;
    btn.textContent = label;
    btn.title = label;
    btn.addEventListener("click", () => switchToSong(i));
    tabs.appendChild(btn);
  });
}

/** Switch the active editing target to another loaded song. */
async function switchToSong(idx) {
  if (idx === state.activeSongIdx && state.currentBuffer) return;
  if (idx < 0 || idx >= state.songs.length) return;
  saveSongSnapshot();               // remember the song we're leaving
  const target = state.songs[idx];
  state.activeSongIdx = idx;
  state.requestGen++;               // invalidate in-flight previews from the old song
  const token = state.requestGen;   // guard against a newer switch superseding the decode
  restoreStateFromSong(target);     // apply target's metadata immediately (synchronous)
  renderSongTabs();
  setProcessing(true);
  setStatus(`Loading ${target.filename || "song"}…`);
  try {
    const buffer = await decodeFileId(target.fileId); // existing decode path
    if (token !== state.requestGen) return;           // superseded by a newer switch
    state.currentBuffer = buffer;
    applySongUi();
    setProcessing(false);
    setStatus("Ready.");
    saveSession();
  } catch (err) {
    if (token !== state.requestGen) return;
    setProcessing(false);
    setStatus("Ready.");
    toast(`Could not load ${target.filename || "song"} — ${err.message}`, "error");
  }
}

function saveSession() {
  if (!state.fileId && !state.songs.length) return;
  try {
    const active = (state.activeSongIdx >= 0 && state.activeSongIdx < state.songs.length)
      ? state.songs[state.activeSongIdx]
      : null;
    const payload = {
      // Active-song fields kept for backward compatibility with older sessions.
      fileId: active ? active.fileId : state.fileId,
      filename: active ? active.filename : state.filename,
      sampleRate: active ? active.sampleRate : state.sampleRate,
      duration: active ? active.duration : state.duration,
      channels: active ? active.channels : state.channels,
      appliedEffects: active ? active.appliedEffects : Array.from(state.appliedEffects || []),
      songs: state.songs,
      activeSongIdx: state.activeSongIdx,
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
  } catch (_) { /* storage full or unavailable — ignore */ }
}

function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch (_) {}
}

/**
 * Gesture-independent decode for session restore.
 * At cold page load (before any user interaction) the main AudioContext from
 * ac() can be stuck suspended, and decodeAudioData on it can reject — which
 * is exactly why refresh used to lose the session even though the file still
 * exists on the server. An OfflineAudioContext decodes without depending on
 * the main context's running/autoplay state, so restore is reliable on reload.
 */
async function decodeForRestore(fileId) {
  const res = await fetch(downloadUrl(fileId));
  if (!res.ok) throw new Error(`session file not found (${res.status})`);
  const buf = await res.arrayBuffer();
  const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (OfflineCtx) {
    const ctx = new OfflineCtx(1, 2, 44100);
    return ctx.decodeAudioData(buf.slice(0));
  }
  return ac().decodeAudioData(buf.slice(0));
}

async function restoreSession() {
  let raw = null;
  try { raw = localStorage.getItem(SESSION_KEY); } catch (_) { return; }
  if (!raw) return;
  let saved;
  try { saved = JSON.parse(raw); } catch (_) { clearSession(); return; }
  if (!saved) { clearSession(); return; }

  // Build the song list. New sessions store `songs`; upgrade the older
  // single-song shape into a one-song list for backward compatibility.
  let songs = Array.isArray(saved.songs) ? saved.songs.filter((s) => s && s.fileId) : null;
  if (!songs || !songs.length) {
    if (saved.fileId) {
      songs = [{
        fileId: saved.fileId,
        filename: saved.filename || "song",
        sampleRate: saved.sampleRate,
        duration: saved.duration,
        channels: saved.channels,
        appliedEffects: saved.appliedEffects || [],
        paramValues: {},
        view: { start: 0, end: saved.duration || 0 },
        selection: null,
        selectionOnly: false,
        abMode: "original",
      }];
    } else {
      clearSession();
      return;
    }
  }
  state.songs = songs;
  state.activeSongIdx = Math.min(Math.max(0, saved.activeSongIdx | 0), songs.length - 1);
  restoreStateFromSong(state.songs[state.activeSongIdx]);
  $("dropzone").hidden = true;
  $("viz-stack").hidden = false;
  $("transport").hidden = false;
  renderSongTabs();

  setStatus("Restoring session…");

  const tryLoadSong = async (song) => {
    try {
      return { ok: true, buffer: await decodeFileId(song.fileId) };
    } catch (err) {
      const isExpired = err && err.message && (err.message.includes("404") || err.message.includes("405"));
      return { ok: false, expired: isExpired };
    }
  };

  const finishRestore = (idx, buffer) => {
    state.activeSongIdx = idx;
    restoreStateFromSong(state.songs[idx]);
    state.currentBuffer = buffer;
    applySongUi();
    renderSongTabs();
    saveSession();
    setStatus("Session restored.");
  };

  // Prefer the previously-active song; fall back to the first decodable one.
  const order = songs.map((_, i) => i);
  order.sort((a, b) => (a === state.activeSongIdx ? -1 : b === state.activeSongIdx ? 1 : a - b));

  let anyTransient = false;
  for (const i of order) {
    const res = await tryLoadSong(songs[i]);
    if (res.ok) { finishRestore(i, res.buffer); return; }
    if (!res.expired) anyTransient = true;
  }

  if (anyTransient) {
    toast("Could not restore audio — refresh to retry.", "error");
    setStatus("Ready.");
    return;
  }

  clearSession(); // every song's server file is gone — nothing left to restore
  $("dropzone").hidden = false;
  $("viz-stack").hidden = true;
  $("transport").hidden = true;
  toast("Previous session expired — please reload your audio.", "error");
  setStatus("Ready.");
}

/* --------------------------------------------------------------- *
 * 25. INIT                                                          *
 * --------------------------------------------------------------- */

wire();
setStatus("Ready.");
ensureAliasingLabPanel();
renderAliasingLab();
aliasRAF = requestAnimationFrame(aliasWaveTick);
ensureUploadedAliasingPanel();
restoreSession();



})();