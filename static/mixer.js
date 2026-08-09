/* =====================================================================
   CONCERT SOUND MIXER — additive feature.
   Self-contained: does not import from, modify, or depend on any
   internals of app.js (which is a closed IIFE with nothing exported).
   Reuses the project's existing Web Audio node types (GainNode,
   BiquadFilterNode, StereoPannerNode, AnalyserNode) and its existing
   CSS design system / class names (.panel, .dial-track, .eq-band-*,
   .meter-*, .btn, .mini-btn) so the mixer looks and behaves like the
   rest of the app without touching any existing file's logic.

   Dynamic channels (Vocals, Guitar, Drums, Bass, Piano + added tracks), each with:
     Volume, Mute, Solo, Pan, 3-band EQ (Low/Mid/High), Monitor send.
   2 output buses: Main Speakers, Stage Monitors — each with its own
   master fader + level meter. Browsers only expose one physical audio
   output by default, so a "Listening to" toggle picks which bus is
   actually audible at any moment; both buses mix and meter live.
   ===================================================================== */

(() => {
"use strict";

const $ = (id) => document.getElementById(id);

const DEFAULT_TRACKS = [
  { id: "vocals", name: "Vocals", kind: "preset", src: "vocal.mp3" },
  { id: "guitar", name: "Guitar", kind: "preset", src: "guitar.mp3" },
  { id: "drums",  name: "Drums",  kind: "preset", src: "drum.mp3" },
  { id: "bass",   name: "Bass",   kind: "preset", src: "bass.mp3" },
  { id: "piano",  name: "Piano",  kind: "preset", src: "piano.mp3" },
];

const SAMPLE_CATALOG = DEFAULT_TRACKS.map((t) => ({ name: t.name, src: t.src }));

const mx = {
  ctx: null,
  playing: false,
  listen: "main",
  mainBusGain: null,
  monitorBusGain: null,
  mainAnalyser: null,
  monitorAnalyser: null,
  channels: {},
  tracks: [],
  trackSeq: 0,
  meterRAF: null,
  exportDestination: null,
  exportRecorder: null,
  exportChunks: [],
};

function ac() {
  if (!mx.ctx) mx.ctx = new (window.AudioContext || window.webkitAudioContext)();
  return mx.ctx;
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
  return 20 * Math.log10(Math.max(Math.sqrt(sum / samples.length), 1e-9));
}
function dbToPct(db) { return Math.max(0, Math.min(100, ((db + 60) / 60) * 100)); }

function ensureBuses() {
  if (mx.mainBusGain) return;
  const ctx = ac();
  mx.mainBusGain = ctx.createGain();
  mx.monitorBusGain = ctx.createGain();
  mx.mainAnalyser = ctx.createAnalyser(); mx.mainAnalyser.fftSize = 1024;
  mx.monitorAnalyser = ctx.createAnalyser(); mx.monitorAnalyser.fftSize = 1024;
  mx.mainBusGain.connect(mx.mainAnalyser);
  const mxSplitter = ctx.createChannelSplitter(2);
  mx.mainBusGain.connect(mxSplitter);
  mx.mainAnalyserL = ctx.createAnalyser(); mx.mainAnalyserL.fftSize = 1024;
  mx.mainAnalyserR = ctx.createAnalyser(); mx.mainAnalyserR.fftSize = 1024;
  mxSplitter.connect(mx.mainAnalyserL, 0);
  mxSplitter.connect(mx.mainAnalyserR, 1);
  mx.monitorBusGain.connect(mx.monitorAnalyser);
  applyListenRouting();
}

function applyListenRouting() {
  if (!mx.mainBusGain) return;
  try { mx.mainBusGain.disconnect(ac().destination); } catch (_) {}
  try { mx.monitorBusGain.disconnect(ac().destination); } catch (_) {}
  if (mx.listen === "main") mx.mainBusGain.connect(ac().destination);
  else mx.monitorBusGain.connect(ac().destination);
}

async function loadTrackBuffer(t) {
  const ctx = ac();
  const ch = mx.channels[t.id];
  ch.loading = true;
  ch.error = null;
  updateChannelLoadingUI(t.id);
  try {
    let arrayBuf;
    if (t.kind === "upload") {
      arrayBuf = await t.file.arrayBuffer();
    } else {
      const res = await fetch(`sample_wavs/${t.src}`);
      if (!res.ok) throw new Error(`could not fetch sample (${res.status})`);
      arrayBuf = await res.arrayBuffer();
    }
    const buffer = await ctx.decodeAudioData(arrayBuf.slice(0));
    ch.buffer = buffer;
    ch.loading = false;
    updateChannelLoadingUI(t.id);
    return buffer;
  } catch (err) {
    ch.loading = false;
    ch.error = (err && err.message) ? err.message : "failed to decode audio";
    updateChannelLoadingUI(t.id);
    throw err;
  }
}

async function loadAllBuffers() {
  await Promise.all(mx.tracks.map(async (t) => {
    const ch = mx.channels[t.id];
    if (ch.buffer || ch.loading) return;
    try { await loadTrackBuffer(t); } catch (_) {}
  }));
}

function buildChannelGraph(id) {
  const ctx = ac();
  const low = ctx.createBiquadFilter(); low.type = "lowshelf"; low.frequency.value = 200;
  const mid = ctx.createBiquadFilter(); mid.type = "peaking"; mid.frequency.value = 1000; mid.Q.value = 1;
  const high = ctx.createBiquadFilter(); high.type = "highshelf"; high.frequency.value = 5000;
  const pan = ctx.createStereoPanner();
  const volGain = ctx.createGain();
  const monitorSendGain = ctx.createGain();
  const analyser = ctx.createAnalyser(); analyser.fftSize = 1024;

  low.connect(mid); mid.connect(high); high.connect(pan); pan.connect(volGain);
  volGain.connect(analyser);
  volGain.connect(mx.mainBusGain);
  volGain.connect(monitorSendGain);
  monitorSendGain.connect(mx.monitorBusGain);

  return { low, mid, high, pan, volGain, monitorSendGain, analyser, source: null };
}

function registerTrackState(t) {
  mx.tracks.push(t);
  mx.channels[t.id] = {
    meta: t,
    buffer: null,
    graph: null,
    volume: 0.85,
    pan: 0,
    eq: { low: 0, mid: 0, high: 0 },
    monitorSend: 0.3,
    muted: false,
    solo: false,
    loading: false,
    error: null,
  };
}

function initChannelState() {
  mx.tracks = [];
  mx.channels = {};
  DEFAULT_TRACKS.forEach((t) => registerTrackState(t));
}

function anySolo() { return mx.tracks.some((c) => mx.channels[c.id].solo); }

function applyChannelGain(id) {
  const ch = mx.channels[id];
  if (!ch.graph) return;
  const solo = anySolo();
  const effectiveVol = (ch.muted || (solo && !ch.solo)) ? 0 : ch.volume;
  ch.graph.volGain.gain.setTargetAtTime(effectiveVol, ac().currentTime, 0.01);
}

function applyAllChannelGains() { mx.tracks.forEach((c) => applyChannelGain(c.id)); }

async function startMixer() {
  await loadAllBuffers();
  ensureBuses();
  await ac().resume();
  mx.tracks.forEach((t) => startTrackPlayback(t));
  applyAllChannelGains();
  mx.playing = true;
  updateTransportUI();
  if (!mx.meterRAF) mx.meterRAF = requestAnimationFrame(meterLoop);
}

function startTrackPlayback(t) {
  const ch = mx.channels[t.id];
  if (!ch || !ch.buffer) return;
  if (!ch.graph) ch.graph = buildChannelGraph(t.id);
  if (ch.graph.source) return;
  const src = ac().createBufferSource();
  src.buffer = ch.buffer;
  src.loop = true;
  src.connect(ch.graph.low);
  src.start();
  ch.graph.source = src;
}

function stopMixer() {
  mx.tracks.forEach((t) => {
    const ch = mx.channels[t.id];
    if (ch.graph && ch.graph.source) {
      try { ch.graph.source.stop(); } catch (_) {}
      try { ch.graph.source.disconnect(); } catch (_) {}
      ch.graph.source = null;
    }
  });
  mx.playing = false;
  updateTransportUI();
}

function updateTransportUI() {
  $("mx-icon-play").hidden = mx.playing;
  $("mx-icon-stop").hidden = !mx.playing;
  const n = mx.tracks.length;
  $("mx-transport-label").textContent = mx.playing
    ? `Playing · ${n} channel${n === 1 ? "" : "s"} looping into the mix`
    : "Stopped · loops the built-in sample inputs (add tracks below)";
}

/* ---------------- final-mix browser export ---------------- */

function getSupportedRecorderMimeType() {
  if (!window.MediaRecorder) return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function ensureExportDestination() {
  ensureBuses();
  if (!mx.exportDestination) {
    mx.exportDestination = ac().createMediaStreamDestination();

    // Capture the existing mixer Main bus.
    mx.mainBusGain.connect(mx.exportDestination);

    // Also capture the existing main-song Web Audio source.
    // Do not create another MediaElementSource.
    if (window.signalLabMainSongSource) {
      window.signalLabMainSongSource.connect(mx.exportDestination);
    }
  }
  return mx.exportDestination;
}

function setExportButtonState(recording) {
  const btn = $("mx-export-mix");
  if (!btn) return;
  btn.textContent = recording ? "Stop Export" : "Export Mix";
  btn.classList.toggle("active", recording);
  btn.title = recording ? "Stop recording the final mixer output" : "Record and download the final mixer output";
}

function triggerAudioDownload(blob, mimeType) {
  const extension = mimeType.includes("ogg") ? "ogg" : "webm";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `signal-lab-mix-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function startExportRecording() {
  if (!mx.playing) {
    $("mx-transport-label").textContent = "Start the mixer before exporting";
    return;
  }
  if (mx.exportRecorder && mx.exportRecorder.state !== "inactive") return;
  const mimeType = getSupportedRecorderMimeType();
  if (!mimeType) {
    $("mx-transport-label").textContent = "Export unavailable: this browser has no supported audio recorder";
    return;
  }

  const destination = ensureExportDestination();
  mx.exportChunks = [];
  const recorder = new MediaRecorder(destination.stream, { mimeType });
  mx.exportRecorder = recorder;

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data && event.data.size > 0) mx.exportChunks.push(event.data);
  });
  recorder.addEventListener("stop", () => {
    const blob = new Blob(mx.exportChunks, { type: mimeType });
    mx.exportChunks = [];
    mx.exportRecorder = null;
    setExportButtonState(false);
    if (blob.size > 0) triggerAudioDownload(blob, mimeType);
    updateTransportUI();
  });
  recorder.addEventListener("error", () => {
    mx.exportChunks = [];
    mx.exportRecorder = null;
    setExportButtonState(false);
    $("mx-transport-label").textContent = "Export failed while recording the mixer output";
  });

  recorder.start();
  setExportButtonState(true);
  $("mx-transport-label").textContent = "Recording final mix… Click Stop Export when finished";
}

function stopExportRecording() {
  if (!mx.exportRecorder || mx.exportRecorder.state === "inactive") return;
  mx.exportRecorder.stop();
}

function toggleExportRecording() {
  if (mx.exportRecorder && mx.exportRecorder.state !== "inactive") stopExportRecording();
  else startExportRecording();
}

function hSlider(min, max, step, value, unit, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "dial-row";
  const pct = ((value - min) / (max - min)) * 100;
  wrap.innerHTML = `
    <div class="dial-top"><span class="dial-value">${value.toFixed(step < 1 ? 2 : 0)}${unit}</span></div>
    <div class="dial-track"><div class="dial-fill" style="width:${pct}%"></div><div class="dial-thumb" style="left:${pct}%"></div></div>
  `;
  const track = wrap.querySelector(".dial-track");
  const fill = wrap.querySelector(".dial-fill");
  const thumb = wrap.querySelector(".dial-thumb");
  const valueEl = wrap.querySelector(".dial-value");
  function set(clientX) {
    const rect = track.getBoundingClientRect();
    let frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    let v = min + frac * (max - min);
    v = Math.round(v / step) * step;
    v = Math.max(min, Math.min(max, v));
    const p = ((v - min) / (max - min)) * 100;
    fill.style.width = p + "%"; thumb.style.left = p + "%";
    valueEl.textContent = `${v.toFixed(step < 1 ? 2 : 0)}${unit}`;
    onChange(v);
  }
  let dragging = false;
  track.addEventListener("pointerdown", (e) => { dragging = true; track.setPointerCapture(e.pointerId); set(e.clientX); });
  track.addEventListener("pointermove", (e) => { if (dragging) set(e.clientX); });
  track.addEventListener("pointerup", (e) => { dragging = false; try { track.releasePointerCapture(e.pointerId); } catch (_) {} });
  return wrap;
}

function eqBand(label, min, max, value, onChange) {
  const band = document.createElement("div");
  band.className = "eq-band";
  band.innerHTML = `
    <div class="eq-band-track"><div class="eq-band-zero"></div><div class="eq-band-fill"></div></div>
    <div class="eq-band-freq">${label}</div>
  `;
  const track = band.querySelector(".eq-band-track");
  const fill = band.querySelector(".eq-band-fill");
  function applyVisual(v) {
    const pct = (Math.abs(v) / max) * 50;
    if (v >= 0) { fill.style.bottom = "50%"; fill.style.height = pct + "%"; }
    else { fill.style.bottom = (50 - pct) + "%"; fill.style.height = pct + "%"; }
  }
  applyVisual(value);
  function set(clientY) {
    const rect = track.getBoundingClientRect();
    let frac = 1 - (clientY - rect.top) / rect.height;
    let v = Math.max(min, Math.min(max, Math.round((frac - 0.5) * 2 * max)));
    applyVisual(v);
    onChange(v);
  }
  let dragging = false;
  track.addEventListener("pointerdown", (e) => { dragging = true; track.setPointerCapture(e.pointerId); set(e.clientY); });
  track.addEventListener("pointermove", (e) => { if (dragging) set(e.clientY); });
  track.addEventListener("pointerup", (e) => { dragging = false; try { track.releasePointerCapture(e.pointerId); } catch (_) {} });
  return band;
}

function meterBlock(label) {
  const wrap = document.createElement("div");
  wrap.className = "mixer-meter-row";
  wrap.innerHTML = `
    <div class="meter-ch">
      <div class="meter-ch-label">${label}</div>
      <div class="meter-track">
        <div class="meter-fill-rms" style="height:0%"></div>
        <div class="meter-fill-peak" style="height:0%"></div>
        <div class="meter-peak-hold" style="bottom:0%"></div>
      </div>
      <div class="meter-clip"></div>
      <div class="meter-readout"><b class="mr-peak">-∞</b></div>
    </div>
  `;
  return wrap;
}

function setMeterBlock(wrap, peak, rms) {
  wrap.querySelector(".meter-fill-peak").style.height = dbToPct(peak) + "%";
  wrap.querySelector(".meter-fill-rms").style.height = dbToPct(rms) + "%";
  wrap.querySelector(".meter-peak-hold").style.bottom = dbToPct(peak) + "%";
  wrap.querySelector(".meter-clip").classList.toggle("on", peak >= -0.15);
  wrap.querySelector(".mr-peak").textContent = peak <= -99 ? "-∞" : peak.toFixed(1);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function buildChannelStrip(c) {
  const ch = mx.channels[c.id];
  const strip = document.createElement("div");
  strip.className = "mixer-channel";

  const srcLabel = c.kind === "upload" ? "uploaded file" : `loop: ${c.src}`;
  strip.innerHTML = `<div class="mixer-channel-name">${escapeHtml(c.name)}</div><div class="mixer-channel-src">${srcLabel}</div><div class="mixer-channel-status" data-role="status"></div>`;
  ch.statusEl = strip.querySelector('[data-role="status"]');
  updateChannelLoadingUI(c.id);

  const btnRow = document.createElement("div");
  btnRow.className = "mx-btn-row";
  btnRow.innerHTML = `<div class="mx-toggle mute">Mute</div><div class="mx-toggle solo">Solo</div>`;
  const muteBtn = btnRow.querySelector(".mute");
  const soloBtn = btnRow.querySelector(".solo");
  muteBtn.addEventListener("click", () => {
    ch.muted = !ch.muted; muteBtn.classList.toggle("active", ch.muted);
    applyChannelGain(c.id);
  });
  soloBtn.addEventListener("click", () => {
    ch.solo = !ch.solo; soloBtn.classList.toggle("active", ch.solo);
    applyAllChannelGains();
  });
  strip.appendChild(btnRow);

  const volLabel = document.createElement("div");
  volLabel.className = "mixer-row-label"; volLabel.textContent = "Volume";
  strip.appendChild(volLabel);
  strip.appendChild(hSlider(0, 1.5, 0.01, ch.volume, "", (v) => { ch.volume = v; applyChannelGain(c.id); }));

  const panLabel = document.createElement("div");
  panLabel.className = "mixer-row-label"; panLabel.textContent = "Pan (L ↔ R)";
  strip.appendChild(panLabel);
  strip.appendChild(hSlider(-1, 1, 0.05, ch.pan, "", (v) => { ch.pan = v; if (ch.graph) ch.graph.pan.pan.setTargetAtTime(v, ac().currentTime, 0.01); }));

  const eqLabel = document.createElement("div");
  eqLabel.className = "mixer-row-label"; eqLabel.textContent = "3-Band EQ";
  strip.appendChild(eqLabel);
  const eqRow = document.createElement("div");
  eqRow.className = "mixer-eq-row";
  eqRow.appendChild(eqBand("Low", -12, 12, ch.eq.low, (v) => { ch.eq.low = v; if (ch.graph) ch.graph.low.gain.setTargetAtTime(v, ac().currentTime, 0.01); }));
  eqRow.appendChild(eqBand("Mid", -12, 12, ch.eq.mid, (v) => { ch.eq.mid = v; if (ch.graph) ch.graph.mid.gain.setTargetAtTime(v, ac().currentTime, 0.01); }));
  eqRow.appendChild(eqBand("High", -12, 12, ch.eq.high, (v) => { ch.eq.high = v; if (ch.graph) ch.graph.high.gain.setTargetAtTime(v, ac().currentTime, 0.01); }));
  strip.appendChild(eqRow);

  const sendLabel = document.createElement("div");
  sendLabel.className = "mixer-row-label"; sendLabel.textContent = "Monitor Send";
  strip.appendChild(sendLabel);
  strip.appendChild(hSlider(0, 1, 0.05, ch.monitorSend, "", (v) => { ch.monitorSend = v; if (ch.graph) ch.graph.monitorSendGain.gain.setTargetAtTime(v, ac().currentTime, 0.01); }));

  const meter = meterBlock("LVL");
  strip.appendChild(meter);
  ch.meterEl = meter;

  return strip;
}

function buildBusStrip(key, label, gainNodeGetter) {
  const strip = document.createElement("div");
  strip.className = "bus-strip";
  strip.innerHTML = `<div class="bus-strip-head"><span class="bus-strip-name">${label}</span><button class="listen-btn" data-bus="${key}">Listening</button></div>`;
  const listenBtn = strip.querySelector(".listen-btn");
  listenBtn.addEventListener("click", () => {
    mx.listen = key;
    applyListenRouting();
    refreshListenButtons();
  });

  const label2 = document.createElement("div");
  label2.className = "mixer-row-label"; label2.textContent = "Master Level";
  strip.appendChild(label2);
  strip.appendChild(hSlider(0, 1.5, 0.01, 1, "", (v) => { const g = gainNodeGetter(); if (g) g.gain.setTargetAtTime(v, ac().currentTime, 0.01); }));

  const meter = meterBlock(label === "Main Speakers" ? "MAIN" : "MON");
  strip.appendChild(meter);

  return { strip, listenBtn, meterEl: meter };
}

let mainBusUI, monitorBusUI;

function refreshListenButtons() {
  mainBusUI.listenBtn.classList.toggle("active", mx.listen === "main");
  monitorBusUI.listenBtn.classList.toggle("active", mx.listen === "monitor");
}

function meterLoop() {
  mx.tracks.forEach((c) => {
    const ch = mx.channels[c.id];
    if (!ch.graph || !ch.meterEl) return;
    const buf = new Float32Array(ch.graph.analyser.fftSize);
    ch.graph.analyser.getFloatTimeDomainData(buf);
    setMeterBlock(ch.meterEl, peakDb(buf), rmsDb(buf));
  });
  if (mx.mainAnalyser) {
    const buf = new Float32Array(mx.mainAnalyser.fftSize);
    mx.mainAnalyser.getFloatTimeDomainData(buf);
    setMeterBlock(mainBusUI.meterEl, peakDb(buf), rmsDb(buf));
  }
  if (mx.monitorAnalyser) {
    const buf = new Float32Array(mx.monitorAnalyser.fftSize);
    mx.monitorAnalyser.getFloatTimeDomainData(buf);
    setMeterBlock(monitorBusUI.meterEl, peakDb(buf), rmsDb(buf));
  }
  mx.meterRAF = requestAnimationFrame(meterLoop);
}

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "track";
}

function uniqueTrackId(base) {
  mx.trackSeq += 1;
  return `${base}-${mx.trackSeq}`;
}

function updateChannelLoadingUI(id) {
  const ch = mx.channels[id];
  if (!ch || !ch.statusEl) return;
  if (ch.loading) {
    ch.statusEl.textContent = "Decoding…";
    ch.statusEl.className = "mixer-channel-status loading";
  } else if (ch.error) {
    ch.statusEl.textContent = `Error: ${ch.error}`;
    ch.statusEl.className = "mixer-channel-status error";
  } else {
    ch.statusEl.textContent = "";
    ch.statusEl.className = "mixer-channel-status";
  }
}

function addTrackToUI(t) {
  registerTrackState(t);
  const channelsWrap = $("mixer-channels");
  const addTile = $("mixer-add-track-tile");
  const strip = buildChannelStrip(t);
  if (addTile) channelsWrap.insertBefore(strip, addTile);
  else channelsWrap.appendChild(strip);
}

async function addPresetTrack(preset) {
  const t = { id: uniqueTrackId(slugify(preset.name)), name: preset.name, kind: "preset", src: preset.src };
  addTrackToUI(t);
  try {
    await loadTrackBuffer(t);
    if (mx.playing) { startTrackPlayback(t); applyChannelGain(t.id); }
  } catch (_) {}
}

async function addUploadTrack(file) {
  const t = { id: uniqueTrackId("upload"), name: file.name, kind: "upload", file };
  addTrackToUI(t);
  try {
    await loadTrackBuffer(t);
    if (mx.playing) { startTrackPlayback(t); applyChannelGain(t.id); }
  } catch (_) {}
}

function buildAddTrackTile() {
  const tile = document.createElement("div");
  tile.className = "mixer-channel mixer-add-track";
  tile.id = "mixer-add-track-tile";
  tile.innerHTML = `
    <button type="button" class="btn btn-ghost mixer-add-track-btn" id="btn-add-track">+ Add Track</button>
    <div class="mixer-add-track-panel" id="mixer-add-track-panel" hidden>
      <div class="mixer-row-label">Add sample instrument</div>
      <div class="mixer-add-track-presets" id="mixer-add-track-presets"></div>
      <div class="mixer-row-label">Or upload audio</div>
      <label class="btn btn-ghost mixer-upload-btn" for="mixer-track-file-input">Upload WAV / MP3</label>
      <input type="file" id="mixer-track-file-input" accept=".wav,.mp3,audio/wav,audio/mpeg" hidden>
    </div>
  `;

  const toggleBtn = tile.querySelector("#btn-add-track");
  const panel = tile.querySelector("#mixer-add-track-panel");
  const presetsWrap = tile.querySelector("#mixer-add-track-presets");
  const fileInput = tile.querySelector("#mixer-track-file-input");

  SAMPLE_CATALOG.forEach((preset) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "mini-btn mixer-preset-btn";
    b.textContent = preset.name;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      addPresetTrack(preset);
      panel.hidden = true;
    });
    presetsWrap.appendChild(b);
  });

  toggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
  });
  tile.addEventListener("click", (e) => e.stopPropagation());

  fileInput.addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) addUploadTrack(f);
    fileInput.value = "";
    panel.hidden = true;
  });

  return tile;
}

function buildExportButton() {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "mini-btn";
  btn.id = "mx-export-mix";
  btn.textContent = "Export Mix";
  btn.title = "Record and download the final mixer output";
  btn.addEventListener("click", toggleExportRecording);
  return btn;
}

function buildUI() {
  initChannelState();
  const channelsWrap = $("mixer-channels");
  channelsWrap.innerHTML = "";
  mx.tracks.forEach((t) => channelsWrap.appendChild(buildChannelStrip(t)));
  channelsWrap.appendChild(buildAddTrackTile());

  const masterWrap = $("mixer-master");
  mainBusUI = buildBusStrip("main", "Main Speakers", () => mx.mainBusGain);
  monitorBusUI = buildBusStrip("monitor", "Stage Monitors", () => mx.monitorBusGain);
  masterWrap.appendChild(mainBusUI.strip);
  masterWrap.appendChild(monitorBusUI.strip);

  const transport = document.querySelector(".mixer-transport");
  if (transport && !$("mx-export-mix")) transport.appendChild(buildExportButton());

  refreshListenButtons();
}

function openMixer() {
  $("mixer-backdrop").hidden = false;
}
function closeMixer() {
  $("mixer-backdrop").hidden = true;
}

/* ---------------- Mix Analyzer (read-only; reuses existing analysers) ---------------- */

let azRAF = null;

function computeSignalMetrics(analyser) {
  const buf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buf);
  let peak = 0, sumSq = 0, clipped = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]);
    if (a > peak) peak = a;
    sumSq += buf[i] * buf[i];
    if (a >= 0.98) clipped++;
  }
  const rms = Math.sqrt(sumSq / buf.length);
  const peakDb = 20 * Math.log10(Math.max(peak, 1e-9));
  const rmsDb = 20 * Math.log10(Math.max(rms, 1e-9));
  const freq = new Float32Array(analyser.frequencyBinCount);
  analyser.getFloatFrequencyData(freq);
  const n = freq.length;
  const band = (lo, hi) => { let s=0,c=0; for(let i=Math.floor(lo*n); i<Math.floor(hi*n); i++){ if(isFinite(freq[i])){s+=freq[i];c++;} } return c ? s/c : -100; };
  return { peakDb, rmsDb, crest: peakDb - rmsDb, clipped, low: band(0,.15), mid: band(.15,.5), high: band(.5,1), waveform: buf, freq };
}

function drawWave(canvas, buf) {
  const c = canvas.getContext("2d"), w = canvas.width, h = canvas.height;
  c.fillStyle = "#10151d"; c.fillRect(0,0,w,h);
  c.strokeStyle = "#ffb454"; c.lineWidth = 1.5; c.beginPath();
  for (let i=0;i<buf.length;i++){ const x=(i/buf.length)*w, y=h/2-buf[i]*(h/2)*.9; i===0?c.moveTo(x,y):c.lineTo(x,y); }
  c.stroke();
}

function drawSpectrum(canvas, freq) {
  const c = canvas.getContext("2d"), w = canvas.width, h = canvas.height;
  c.fillStyle = "#10151d"; c.fillRect(0,0,w,h);
  c.fillStyle = "#9b8cff";
  const n = freq.length, bw = w / n;
  for (let i=0;i<n;i++){ const v = Math.max(0, Math.min(1, (freq[i]+100)/100)); c.fillRect(i*bw, h-v*h, bw, v*h); }
}

function chStereoBalance(analyserL, analyserR) {
  if (!analyserL || !analyserR) return 100;
  const bufL = new Float32Array(analyserL.fftSize), bufR = new Float32Array(analyserR.fftSize);
  analyserL.getFloatTimeDomainData(bufL); analyserR.getFloatTimeDomainData(bufR);
  let sL=0, sR=0;
  for (let i=0;i<bufL.length;i++) sL += bufL[i]*bufL[i];
  for (let i=0;i<bufR.length;i++) sR += bufR[i]*bufR[i];
  const rmsL = Math.sqrt(sL/bufL.length), rmsR = Math.sqrt(sR/bufR.length);
  const dbL = 20*Math.log10(Math.max(rmsL,1e-9)), dbR = 20*Math.log10(Math.max(rmsR,1e-9));
  const diff = Math.abs(dbL - dbR);
  return Math.max(0, 100 - diff * 12); // ~8dB imbalance -> 0
}

function scoreDetailed(m, analyserL, analyserR) {
  const clippingScore = Math.max(0, 100 - m.clipped * 4);
  const loudnessScore = Math.max(0, 100 - Math.abs(m.rmsDb - (-16)) * 4); // target ~-16 dBFS RMS
  const headroomScore = Math.max(0, Math.min(100, (0 - m.peakDb) * 20)); // 5dB headroom = 100
  const dynamicsScore = m.crest < 4 ? m.crest / 4 * 60
    : m.crest > 20 ? Math.max(0, 100 - (m.crest - 20) * 5)
    : 60 + (m.crest - 4) / 16 * 40;
  const spread = Math.max(m.low, m.mid, m.high) - Math.min(m.low, m.mid, m.high);
  const spectralScore = Math.max(0, 100 - Math.max(0, spread - 6) * 4);
  const stereoScore = chStereoBalance(analyserL, analyserR);

  const total = clippingScore*0.25 + loudnessScore*0.20 + headroomScore*0.15 +
    dynamicsScore*0.15 + spectralScore*0.15 + stereoScore*0.10;

  return {
    total: Math.max(0, Math.min(100, Math.round(total))),
    clippingScore: Math.round(clippingScore), loudnessScore: Math.round(loudnessScore),
    headroomScore: Math.round(headroomScore), dynamicsScore: Math.round(dynamicsScore),
    spectralScore: Math.round(spectralScore), stereoScore: Math.round(stereoScore),
  };
}
function azStatus(msg) { $("az-status").textContent = msg || ""; }

function azTick() {
  const mainA = window.signalLabMainSongAnalyser;
  const mixA = mx.mainAnalyser;

  if (!mainA) { azStatus("Main song analyzer unavailable — start the main song first."); azRAF = requestAnimationFrame(azTick); return; }
  if (!mixA) { azStatus("Mixer analyzer unavailable — start the mixer first."); azRAF = requestAnimationFrame(azTick); return; }
  const mainPaused = !window.signalLabMainAudioEl || window.signalLabMainAudioEl.paused;
  if (mainPaused && !mx.playing) { azStatus("Playback stopped."); azRAF = null; return; }  azStatus("");

  const mMain = computeSignalMetrics(mainA);
  const mMix = computeSignalMetrics(mixA);
  drawWave($("az-wave-main"), mMain.waveform);
  drawWave($("az-wave-mixed"), mMix.waveform);
  drawSpectrum($("az-spec-main"), mMain.freq);
  drawSpectrum($("az-spec-mixed"), mMix.freq);
  const sc = scoreDetailed(mMix, mx.mainAnalyserL, mx.mainAnalyserR);
  $("az-score").textContent = `Technical Mix Quality: ${sc.total} / 100 (heuristic, not a standard loudness metric)`;
  $("az-stats").innerHTML = `<div>Peak: ${mMix.peakDb.toFixed(1)} dB</div><div>RMS: ${mMix.rmsDb.toFixed(1)} dB</div>
    <div>Clipping: ${mMix.clipped>0?"Detected":"None"}</div><div>Dynamic Range: ${mMix.crest.toFixed(1)} dB</div>
    <div>Low: ${mMix.low.toFixed(1)} dB</div><div>Mid: ${mMix.mid.toFixed(1)} dB</div><div>High: ${mMix.high.toFixed(1)} dB</div>
    <div>Clipping score: ${sc.clippingScore}</div><div>Loudness (RMS): ${sc.loudnessScore}</div>
    <div>Headroom: ${sc.headroomScore}</div><div>Dynamics: ${sc.dynamicsScore}</div>
    <div>Spectral Balance: ${sc.spectralScore}</div><div>Stereo Balance: ${sc.stereoScore}</div>
    <div>Main→Mixed RMS: ${(mMix.rmsDb-mMain.rmsDb).toFixed(1)} dB, Peak: ${(mMix.peakDb-mMain.peakDb).toFixed(1)} dB,
    Low: ${(mMix.low-mMain.low).toFixed(1)} dB, Mid: ${(mMix.mid-mMain.mid).toFixed(1)} dB, High: ${(mMix.high-mMain.high).toFixed(1)} dB</div>`;
  azRAF = requestAnimationFrame(azTick);
}

function runAnalyzer() {
  if (azRAF) { cancelAnimationFrame(azRAF); azRAF = null; }
  azTick();
}

function buildAnalyzerPanel() {
  const wrap = document.createElement("div");
  wrap.className = "panel"; wrap.style.marginTop = "12px";
  wrap.innerHTML = `<div class="panel-head"><span class="panel-label">Mix Analyzer</span></div>
    <div id="az-status" style="color:var(--warn);font:11px var(--ff-mono);"></div>
    <div>Main Song</div><canvas id="az-wave-main" width="500" height="60" style="background:#10151d;border:1px solid var(--hairline);"></canvas>
    <canvas id="az-spec-main" width="500" height="40" style="background:#10151d;border:1px solid var(--hairline);"></canvas>
    <div>Mixed Signal</div><canvas id="az-wave-mixed" width="500" height="60" style="background:#10151d;border:1px solid var(--hairline);"></canvas>
    <canvas id="az-spec-mixed" width="500" height="40" style="background:#10151d;border:1px solid var(--hairline);"></canvas>
    <div>Technical Mix Score: <span id="az-score">—</span></div>
    <div id="az-stats" style="font:11px var(--ff-mono);color:var(--text-mid);"></div>`;
  $("mixer-master").insertAdjacentElement("afterend", wrap);
  const btn = document.createElement("button");
  btn.className = "mini-btn"; btn.textContent = "Analyze Mix"; btn.style.marginLeft = "8px";
  btn.addEventListener("click", runAnalyzer);
  document.querySelector(".mixer-modal-head").appendChild(btn);
}

function wire() {
  buildUI();
  buildAnalyzerPanel();
  $("btn-open-mixer").addEventListener("click", openMixer);
  $("btn-close-mixer").addEventListener("click", closeMixer);
  $("mixer-backdrop").addEventListener("click", (e) => { if (e.target.id === "mixer-backdrop") closeMixer(); });
  $("mx-play").addEventListener("click", () => {
    if (mx.playing) stopMixer(); else startMixer();
  });
  document.addEventListener("click", () => {
    const panel = $("mixer-add-track-panel");
    if (panel) panel.hidden = true;
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", wire);
} else {
  wire();
}
})();