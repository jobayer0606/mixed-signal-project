/* =====================================================================
   CONCERT SOUND MIXER — additive feature.
   Self-contained: does not import from, modify, or depend on any
   internals of app.js (which is a closed IIFE with nothing exported).
   Reuses the project's existing Web Audio node types (GainNode,
   BiquadFilterNode, StereoPannerNode, AnalyserNode) and its existing
   CSS design system / class names (.panel, .dial-track, .eq-band-*,
   .meter-*, .btn, .mini-btn) so the mixer looks and behaves like the
   rest of the app without touching any existing file's logic.

   5 fixed channels (Vocals, Guitar, Drums, Bass, Keyboard), each with:
     Volume, Mute, Solo, Pan, 3-band EQ (Low/Mid/High), Monitor send.
   2 output buses: Main Speakers, Stage Monitors — each with its own
   master fader + level meter. Browsers only expose one physical audio
   output by default, so a "Listening to" toggle picks which bus is
   actually audible at any moment; both buses mix and meter live
   regardless, exactly like a real console's PFL/bus metering.
   ===================================================================== */

(() => {
"use strict";

const $ = (id) => document.getElementById(id);

const CHANNELS = [
  { id: "vocals",   name: "Vocals",   src: "test_dynamic.wav" },
  { id: "guitar",   name: "Guitar",   src: "test_sine_mono.wav" },
  { id: "drums",    name: "Drums",    src: "test_noise.wav" },
  { id: "bass",     name: "Bass",     src: "test_sine_stereo.wav" },
  { id: "keyboard", name: "Keyboard", src: "test_silence.wav" },
];

const mx = {
  ctx: null,
  playing: false,
  listen: "main",           // 'main' | 'monitor'
  mainBusGain: null,
  monitorBusGain: null,
  mainAnalyser: null,
  monitorAnalyser: null,
  channels: {},              // id -> channel runtime object
  buffersLoaded: false,
  meterRAF: null,
};

function ac() {
  if (!mx.ctx) mx.ctx = new (window.AudioContext || window.webkitAudioContext)();
  return mx.ctx;
}

/* ---------------- small local DSP-metering helpers (mirrors the ---
 * math the main app already uses for its meters; duplicated here in
 * a few lines rather than reaching into app.js's closed module). --- */
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

/* ---------------- audio graph ---------------- */

function ensureBuses() {
  if (mx.mainBusGain) return;
  const ctx = ac();
  mx.mainBusGain = ctx.createGain();
  mx.monitorBusGain = ctx.createGain();
  mx.mainAnalyser = ctx.createAnalyser(); mx.mainAnalyser.fftSize = 1024;
  mx.monitorAnalyser = ctx.createAnalyser(); mx.monitorAnalyser.fftSize = 1024;
  mx.mainBusGain.connect(mx.mainAnalyser);
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

async function loadBuffers() {
  if (mx.buffersLoaded) return;
  const ctx = ac();
  await Promise.all(CHANNELS.map(async (c) => {
    const res = await fetch(`sample_wavs/${c.src}`);
    const arr = await res.arrayBuffer();
    const buffer = await ctx.decodeAudioData(arr.slice(0));
    mx.channels[c.id].buffer = buffer;
  }));
  mx.buffersLoaded = true;
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

function initChannelState() {
  CHANNELS.forEach((c) => {
    mx.channels[c.id] = {
      meta: c,
      buffer: null,
      graph: null,
      volume: 0.85,
      pan: 0,
      eq: { low: 0, mid: 0, high: 0 },
      monitorSend: 0.3,
      muted: false,
      solo: false,
    };
  });
}

function anySolo() { return CHANNELS.some((c) => mx.channels[c.id].solo); }

function applyChannelGain(id) {
  const ch = mx.channels[id];
  if (!ch.graph) return;
  const solo = anySolo();
  const effectiveVol = (ch.muted || (solo && !ch.solo)) ? 0 : ch.volume;
  ch.graph.volGain.gain.setTargetAtTime(effectiveVol, ac().currentTime, 0.01);
}

function applyAllChannelGains() { CHANNELS.forEach((c) => applyChannelGain(c.id)); }

/* ---------------- transport ---------------- */

async function startMixer() {
  await loadBuffers();
  ensureBuses();
  await ac().resume();
  CHANNELS.forEach((c) => {
    const ch = mx.channels[c.id];
    if (!ch.graph) ch.graph = buildChannelGraph(c.id);
    const src = ac().createBufferSource();
    src.buffer = ch.buffer;
    src.loop = true;
    src.connect(ch.graph.low);
    src.start();
    ch.graph.source = src;
  });
  applyAllChannelGains();
  mx.playing = true;
  updateTransportUI();
  if (!mx.meterRAF) mx.meterRAF = requestAnimationFrame(meterLoop);
}

function stopMixer() {
  CHANNELS.forEach((c) => {
    const ch = mx.channels[c.id];
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
  $("mx-transport-label").textContent = mx.playing
    ? "Playing · 5 channels looping into the mix"
    : "Stopped · loops the 5 built-in sample inputs";
}

/* ---------------- generic UI builders (reuse existing classes) ---------------- */

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

/* ---------------- channel strip UI ---------------- */

function buildChannelStrip(c) {
  const ch = mx.channels[c.id];
  const strip = document.createElement("div");
  strip.className = "mixer-channel";

  strip.innerHTML = `<div class="mixer-channel-name">${c.name}</div><div class="mixer-channel-src">loop: ${c.src}</div>`;

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

/* ---------------- master bus strip UI ---------------- */

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

/* ---------------- meter animation loop ---------------- */

function meterLoop() {
  CHANNELS.forEach((c) => {
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

/* ---------------- build UI once ---------------- */

function buildUI() {
  initChannelState();
  const channelsWrap = $("mixer-channels");
  CHANNELS.forEach((c) => channelsWrap.appendChild(buildChannelStrip(c)));

  const masterWrap = $("mixer-master");
  mainBusUI = buildBusStrip("main", "Main Speakers", () => mx.mainBusGain);
  monitorBusUI = buildBusStrip("monitor", "Stage Monitors", () => mx.monitorBusGain);
  masterWrap.appendChild(mainBusUI.strip);
  masterWrap.appendChild(monitorBusUI.strip);
  refreshListenButtons();
}

/* ---------------- wiring ---------------- */

function openMixer() {
  $("mixer-backdrop").hidden = false;
}
function closeMixer() {
  $("mixer-backdrop").hidden = true;
}

function wire() {
  buildUI();
  $("btn-open-mixer").addEventListener("click", openMixer);
  $("btn-close-mixer").addEventListener("click", closeMixer);
  $("mixer-backdrop").addEventListener("click", (e) => { if (e.target.id === "mixer-backdrop") closeMixer(); });
  $("mx-play").addEventListener("click", () => {
    if (mx.playing) stopMixer(); else startMixer();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", wire);
} else {
  wire();
}
})();
