/**
 * SIGNAL LAB — Page 3: Audio Speed, Pitch & Resampling Visualizer (v2)
 * Real-time dynamic moving-frame FFT spectrum analyzer + real-time waveform sync.
 * Completely isolated JS module.
 * No modifications to app.js, server.py, mixer.js, or Page 2 labs.
 */

(function () {
  'use strict';

  // =========================================================================
  // 1. STATE & GLOBAL PARAMETERS
  // =========================================================================
  const state = {
    speedFactor: 1.0,          // 0.25x to 2.0x
    targetFsSelect: 'orig',     // 'orig' | '44100' | '22050' | '11025' | '8000'
    timeWindowMs: 20.0,        // Oscilloscope window

    // Audio Buffers
    origAudioBuffer: null,
    resampledAudioBuffer: null,
    fileName: 'Synthetic 440 Hz Reference',

    // Calculated DSP metrics
    origDuration: 2.0,
    procDuration: 2.0,
    origFs: 44100,
    targetFs: 44100,
    nyquist: 22050,
    origPeakFreq: 440.0,
    procPeakFreq: 440.0,
    aliasFreq: null,
    status: 'SAFE',            // 'SAFE' | 'NEAR NYQUIST' | 'ALIASING'

    // Playback state
    playbackMode: null,        // 'orig' | 'resampled' | null
    playbackStartTime: 0
  };

  let audioCtx = null;
  let activeSourceNode = null;
  let animFrameId = null;

  // =========================================================================
  // 2. OPTIMIZED FFT & REAL-TIME SPECTRUM ANALYZER ENGINE
  // =========================================================================
  const FFT_SIZE = 2048;
  const NUM_BARS = 64;

  // Precomputed Hann window table to avoid recalculating trigonometric weights
  const hannTable = new Float64Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) {
    hannTable[i] = 0.5 * (1.0 - Math.cos((2.0 * Math.PI * i) / (FFT_SIZE - 1)));
  }

  // Preallocated working buffers for FFT to prevent garbage collection pressure
  const origRe = new Float64Array(FFT_SIZE);
  const origIm = new Float64Array(FFT_SIZE);
  const procRe = new Float64Array(FFT_SIZE);
  const procIm = new Float64Array(FFT_SIZE);

  // In-place Radix-2 Cooley-Tukey FFT
  function fft(re, im) {
    const n = re.length;
    if (n <= 1) return;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        const tr = re[i]; re[i] = re[j]; re[j] = tr;
        const ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
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

  // Extract a moving short-time audio frame at current playback second and compute FFT
  function analyzeMovingFrame(buffer, timeSec, reBuf, imBuf) {
    if (!buffer) return { barMags: new Float32Array(NUM_BARS), peakFreq: 440.0, maxBarMag: 1.0, sampleRate: 44100 };

    const data = buffer.getChannelData(0);
    const totalSamples = data.length;
    const sampleRate = buffer.sampleRate;

    // Center the moving frame at the exact playback position
    let centerSample = Math.floor(timeSec * sampleRate);
    if (centerSample < 0) centerSample = 0;
    if (totalSamples > 0 && centerSample >= totalSamples) centerSample = centerSample % totalSamples;

    const startSample = centerSample - Math.floor(FFT_SIZE / 2);

    // Apply Hann window and copy to working real buffer
    for (let i = 0; i < FFT_SIZE; i++) {
      const sIdx = startSample + i;
      const sVal = (sIdx >= 0 && sIdx < totalSamples) ? data[sIdx] : 0.0;
      reBuf[i] = sVal * hannTable[i];
      imBuf[i] = 0.0;
    }

    // Execute FFT
    fft(reBuf, imBuf);

    const half = FFT_SIZE / 2;
    const barMags = new Float32Array(NUM_BARS);
    let maxBarMag = 0.0001;

    let maxBinMag = 0;
    let peakBin = 1;

    const binsPerBar = Math.floor(half / NUM_BARS);

    for (let b = 0; b < NUM_BARS; b++) {
      let barSum = 0;
      const startBin = b * binsPerBar;
      const endBin = Math.min(startBin + binsPerBar, half);

      for (let k = startBin; k < endBin; k++) {
        if (k === 0) continue; // Ignore DC
        const mag = Math.hypot(reBuf[k], imBuf[k]) / (FFT_SIZE / 2);
        barSum += mag;

        if (mag > maxBinMag && k >= 2) {
          maxBinMag = mag;
          peakBin = k;
        }
      }
      const avgMag = barSum / Math.max(endBin - startBin, 1);
      barMags[b] = avgMag;
      if (avgMag > maxBarMag) maxBarMag = avgMag;
    }

    const peakFreq = (peakBin * sampleRate) / FFT_SIZE;
    return { barMags, peakFreq, maxBarMag, sampleRate };
  }

  // =========================================================================
  // 3. AUDIO CONTEXT & SYNTHETIC BUFFER GENERATOR
  // =========================================================================
  function initAudioContext() {
    if (audioCtx) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    audioCtx = new AudioContextClass();
  }

  function generateSynthetic440Buffer() {
    initAudioContext();
    const sampleRate = 44100;
    const duration = 2.0;
    const numSamples = Math.floor(sampleRate * duration);

    const buffer = audioCtx.createBuffer(1, numSamples, sampleRate);
    const data = buffer.getChannelData(0);

    const f0 = 440.0;
    const f1 = 880.0;

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      // 440 Hz fundamental (0.7) + 880 Hz harmonic (0.25) with smooth envelope
      const env = Math.sin(Math.PI * t / duration);
      data[i] = env * (0.7 * Math.sin(2 * Math.PI * f0 * t) + 0.25 * Math.sin(2 * Math.PI * f1 * t));
    }

    state.origAudioBuffer = buffer;
    state.fileName = 'Synthetic 440 Hz Reference';
    recomputeDSP();
  }

  // =========================================================================
  // 4. REAL NAIVE RESAMPLING & DSP COMPUTATIONS
  // =========================================================================
  function computeResampledBuffer(origBuffer, speedFactor) {
    if (!origBuffer || !audioCtx) return null;

    const numChannels = origBuffer.numberOfChannels;
    const origSampleRate = origBuffer.sampleRate;
    const origLength = origBuffer.length;

    // Resampled buffer length is inversely proportional to speed factor
    const newLength = Math.max(Math.floor(origLength / speedFactor), 1);
    const resampledBuffer = audioCtx.createBuffer(numChannels, newLength, origSampleRate);

    for (let c = 0; c < numChannels; c++) {
      const srcData = origBuffer.getChannelData(c);
      const dstData = resampledBuffer.getChannelData(c);

      for (let j = 0; j < newLength; j++) {
        const srcIdxFloat = j * speedFactor;
        const idx0 = Math.floor(srcIdxFloat);
        const idx1 = Math.min(idx0 + 1, origLength - 1);
        const frac = srcIdxFloat - idx0;

        if (idx0 < origLength) {
          dstData[j] = (1 - frac) * srcData[idx0] + frac * srcData[idx1];
        } else {
          dstData[j] = 0;
        }
      }
    }

    return resampledBuffer;
  }

  function recomputeDSP() {
    if (!state.origAudioBuffer) return;

    state.origFs = state.origAudioBuffer.sampleRate;
    state.origDuration = state.origAudioBuffer.duration;

    // Resolve target sample rate
    if (state.targetFsSelect === 'orig') {
      state.targetFs = state.origFs;
    } else {
      state.targetFs = parseFloat(state.targetFsSelect);
    }

    state.nyquist = state.targetFs / 2.0;

    // Perform real naive resampling
    state.resampledAudioBuffer = computeResampledBuffer(state.origAudioBuffer, state.speedFactor);
    state.procDuration = state.resampledAudioBuffer ? state.resampledAudioBuffer.duration : state.origDuration;

    // Compute initial peak frequency for static state
    const initOrig = analyzeMovingFrame(state.origAudioBuffer, 0.5, origRe, origIm);
    state.origPeakFreq = initOrig.peakFreq;
    state.procPeakFreq = state.origPeakFreq * state.speedFactor;

    // Aliasing Check
    if (state.procPeakFreq > state.nyquist) {
      const signedFolded = ((state.procPeakFreq + state.nyquist) % state.targetFs) - state.nyquist;
      state.aliasFreq = Math.abs(signedFolded);
      state.status = 'ALIASING';
    } else if (Math.abs(state.procPeakFreq - state.nyquist) < 0.1 * state.nyquist) {
      state.aliasFreq = null;
      state.status = 'NEAR NYQUIST';
    } else {
      state.aliasFreq = null;
      state.status = 'SAFE';
    }

    updateMetricsUI();
  }

  // =========================================================================
  // 5. METRICS & UI UPDATE
  // =========================================================================
  function updateMetricsUI() {
    const elOrigDur = document.getElementById('sp-metric-orig-dur');
    const elOrigFs = document.getElementById('sp-metric-orig-fs');
    const elProcDur = document.getElementById('sp-metric-proc-dur');
    const elSpeed = document.getElementById('sp-metric-speed');
    const elOrigPeak = document.getElementById('sp-metric-orig-peak');
    const elProcPeak = document.getElementById('sp-metric-proc-peak');
    const elNyquist = document.getElementById('sp-metric-nyquist');
    const elAliasFreq = document.getElementById('sp-metric-alias-freq');
    const elStatus = document.getElementById('sp-metric-status');
    const elStatusSub = document.getElementById('sp-metric-status-sub');
    const elFileName = document.getElementById('sp-file-name-label');

    if (elOrigDur) elOrigDur.textContent = `${state.origDuration.toFixed(3)} s`;
    if (elOrigFs) elOrigFs.textContent = `Fs = ${state.origFs} Hz`;
    if (elProcDur) elProcDur.textContent = `${state.procDuration.toFixed(3)} s`;
    if (elSpeed) elSpeed.textContent = `Speed Factor: ${state.speedFactor.toFixed(2)}x`;
    if (elOrigPeak) elOrigPeak.textContent = `${state.origPeakFreq.toFixed(1)} Hz`;
    if (elProcPeak) elProcPeak.textContent = `${state.procPeakFreq.toFixed(1)} Hz`;
    if (elNyquist) elNyquist.textContent = `${state.nyquist.toFixed(1)} Hz`;

    if (elAliasFreq) {
      elAliasFreq.textContent = state.aliasFreq !== null ? `Alias: ${state.aliasFreq.toFixed(1)} Hz` : 'Alias: None';
    }

    if (elStatus && elStatusSub) {
      elStatus.textContent = state.status;
      if (state.status === 'SAFE') {
        elStatus.className = 'metric-value badge-safe';
        elStatusSub.textContent = 'f < Fs/2 (No aliasing)';
      } else if (state.status === 'NEAR NYQUIST') {
        elStatus.className = 'metric-value badge-nyquist';
        elStatusSub.textContent = 'f ≈ Fs/2 (Boundary)';
      } else {
        elStatus.className = 'metric-value badge-aliasing';
        elStatusSub.textContent = `Folded to ${state.aliasFreq ? state.aliasFreq.toFixed(1) : 0} Hz`;
      }
    }

    if (elFileName) elFileName.textContent = `File: ${state.fileName}`;

    // Readout tags
    const elReadoutSpeed = document.getElementById('sp-readout-speed');
    const elReadoutFs = document.getElementById('sp-readout-fs');
    const elValSpeed = document.getElementById('sp-val-speed');
    const elValWindow = document.getElementById('sp-val-time-window');

    if (elReadoutSpeed) elReadoutSpeed.textContent = `${state.speedFactor.toFixed(2)}x`;
    if (elReadoutFs) elReadoutFs.textContent = `${state.targetFs} Hz`;
    if (elValSpeed) elValSpeed.textContent = `${state.speedFactor.toFixed(2)}x`;
    if (elValWindow) elValWindow.textContent = `${state.timeWindowMs} ms`;

    // Scope subtitles
    const elScope1 = document.getElementById('sp-scope1-sub');
    const elScope2 = document.getElementById('sp-scope2-sub');
    const elScope3 = document.getElementById('sp-scope3-sub');
    const elScope4 = document.getElementById('sp-scope4-sub');
    const elScope5 = document.getElementById('sp-scope5-sub');
    const elScope6 = document.getElementById('sp-scope6-sub');

    if (elScope1) elScope1.textContent = `Amber = Original Buffer (${state.origDuration.toFixed(2)}s, ${state.origFs} Hz)`;
    if (elScope2) elScope2.textContent = `Violet = Resampled Buffer (${state.procDuration.toFixed(2)}s, Speed ${state.speedFactor.toFixed(2)}x)`;
    if (elScope3) elScope3.textContent = `Strongest Spectral Peak: ${state.origPeakFreq.toFixed(1)} Hz (Live Frame)`;
    if (elScope4) elScope4.textContent = `Shifted Peak: ${state.procPeakFreq.toFixed(1)} Hz (${state.speedFactor.toFixed(2)}x)`;
    if (elScope5) elScope5.textContent = `Cyan Stems at 1/Fs (${state.targetFs} Hz) · Nyquist f_N = ${state.nyquist.toFixed(1)} Hz`;
    if (elScope6) elScope6.textContent = state.status === 'ALIASING'
      ? `Magenta = Reconstructed Alias Wave (f_alias = ${state.aliasFreq.toFixed(1)} Hz)`
      : `No Aliasing · Perfect Baseband Reconstruction`;
  }

  // =========================================================================
  // 6. AUDIO PLAYBACK ENGINE
  // =========================================================================
  function playAudio(bufferToPlay, mode) {
    initAudioContext();
    if (!audioCtx || !bufferToPlay) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    stopAudio();

    const source = audioCtx.createBufferSource();
    source.buffer = bufferToPlay;
    source.connect(audioCtx.destination);
    source.start(0);

    activeSourceNode = source;
    state.playbackMode = mode;
    state.playbackStartTime = audioCtx.currentTime;

    source.onended = () => {
      if (activeSourceNode === source) {
        activeSourceNode = null;
        state.playbackMode = null;
        updatePlaybackButtons();
      }
    };

    updatePlaybackButtons();
  }

  function stopAudio() {
    if (activeSourceNode) {
      try { activeSourceNode.stop(); activeSourceNode.disconnect(); } catch (e) {}
      activeSourceNode = null;
    }
    state.playbackMode = null;
    updatePlaybackButtons();
  }

  function updatePlaybackButtons() {
    const btnOrig = document.getElementById('sp-btn-play-orig');
    const btnProc = document.getElementById('sp-btn-play-resampled');
    const btnStop = document.getElementById('sp-btn-stop');

    if (btnOrig) btnOrig.classList.toggle('active', state.playbackMode === 'orig');
    if (btnProc) btnProc.classList.toggle('active', state.playbackMode === 'resampled');
    if (btnStop) btnStop.classList.toggle('active', state.playbackMode === null);
  }

  // =========================================================================
  // 7. RENDER 7 SYNCHRONIZED CANVASES WITH MOVING FFT SPECTRUM
  // =========================================================================
  function globalRender(now) {
    if (!state.origAudioBuffer) {
      animFrameId = requestAnimationFrame(globalRender);
      return;
    }

    let origPlaybackSec = 0;
    let procPlaybackSec = 0;

    if (state.playbackMode && audioCtx) {
      const elapsed = audioCtx.currentTime - state.playbackStartTime;
      if (state.playbackMode === 'orig') {
        origPlaybackSec = elapsed % Math.max(state.origDuration, 0.01);
        procPlaybackSec = (origPlaybackSec / state.speedFactor) % Math.max(state.procDuration, 0.01);
      } else if (state.playbackMode === 'resampled') {
        procPlaybackSec = elapsed % Math.max(state.procDuration, 0.01);
        origPlaybackSec = (procPlaybackSec * state.speedFactor) % Math.max(state.origDuration, 0.01);
      }
    }

    // 1 & 2. Time-domain waveforms + live moving cursors
    renderWaveform('canvas-sp-orig-wave', state.origAudioBuffer, '#ffb454', origPlaybackSec);
    renderWaveform('canvas-sp-proc-wave', state.resampledAudioBuffer, '#9e7aff', procPlaybackSec);

    // 3 & 4. Real-time dynamic moving-frame FFT spectrums
    renderSpectrum('canvas-sp-orig-spec', state.origAudioBuffer, origPlaybackSec, '#ffb454', true, origRe, origIm);
    renderSpectrum('canvas-sp-proc-spec', state.resampledAudioBuffer, procPlaybackSec, '#9e7aff', false, procRe, procIm);

    // Update real-time spectral peak metrics in DOM
    const elOrigPeak = document.getElementById('sp-metric-orig-peak');
    const elProcPeak = document.getElementById('sp-metric-proc-peak');
    const elScope3 = document.getElementById('sp-scope3-sub');
    const elScope4 = document.getElementById('sp-scope4-sub');

    if (elOrigPeak) elOrigPeak.textContent = `${state.origPeakFreq.toFixed(1)} Hz`;
    if (elProcPeak) elProcPeak.textContent = `${state.procPeakFreq.toFixed(1)} Hz`;
    if (elScope3) elScope3.textContent = `Strongest Spectral Peak: ${state.origPeakFreq.toFixed(1)} Hz (Live Frame)`;
    if (elScope4) elScope4.textContent = `Shifted Peak: ${state.procPeakFreq.toFixed(1)} Hz (${state.speedFactor.toFixed(2)}x)`;

    // 5 & 6. Sampling & Aliasing viewports
    renderSamplingView('canvas-sp-sampling', now);
    renderAliasingView('canvas-sp-aliasing', now);

    animFrameId = requestAnimationFrame(globalRender);
  }

  // ── Render Waveform Trace + Playback Cursor ────────────────────────
  function renderWaveform(canvasId, buffer, strokeColor, cursorSec) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !buffer) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.parentElement.clientWidth;
    const height = canvas.parentElement.clientHeight;
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }

    ctx.clearRect(0, 0, width, height);
    drawGrid(ctx, width, height);

    const data = buffer.getChannelData(0);
    const midY = height / 2;
    const scaleY = (height / 2 - 10);
    const duration = buffer.duration;

    const step = Math.ceil(data.length / width);
    ctx.beginPath();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 1.8;

    for (let px = 0; px < width; px++) {
      const idx = px * step;
      const val = idx < data.length ? data[idx] : 0;
      const py = midY - val * scaleY;
      if (px === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Playback Cursor Line
    if (cursorSec > 0 && cursorSec <= duration) {
      const cursorPx = (cursorSec / duration) * width;
      ctx.beginPath();
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#38bdf8';
      ctx.shadowBlur = 8;
      ctx.moveTo(cursorPx, 0);
      ctx.lineTo(cursorPx, height);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }

  // ── Render Real-Time Animated Spectrum Canvas ──────────────────────
  function renderSpectrum(canvasId, buffer, currentSec, strokeColor, isOriginal, reBuf, imBuf) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !buffer) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.parentElement.clientWidth;
    const height = canvas.parentElement.clientHeight;
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }

    ctx.clearRect(0, 0, width, height);
    drawGrid(ctx, width, height);

    const { barMags, peakFreq, maxBarMag, sampleRate } = analyzeMovingFrame(buffer, currentSec, reBuf, imBuf);

    if (isOriginal) {
      state.origPeakFreq = peakFreq;
    } else {
      state.procPeakFreq = peakFreq;
    }

    const paddingLeft = 32;
    const paddingBottom = 22;
    const plotWidth = width - paddingLeft - 12;
    const plotHeight = height - paddingBottom - 14;
    const barSpacing = plotWidth / NUM_BARS;
    const barWidth = Math.max(barSpacing * 0.75, 2);

    // Draw Frequency Spectrum Bars
    for (let b = 0; b < NUM_BARS; b++) {
      const mag = barMags[b];
      const norm = Math.min(mag / Math.max(maxBarMag, 0.005), 1.0);
      const hBar = norm * plotHeight;
      const px = paddingLeft + b * barSpacing;
      const py = (height - paddingBottom) - hBar;

      ctx.fillStyle = strokeColor;
      ctx.shadowColor = strokeColor;
      ctx.shadowBlur = norm > 0.4 ? 6 : 0;
      ctx.fillRect(px, py, barWidth, hBar);
    }
    ctx.shadowBlur = 0;

    // Peak Frequency Marker
    const peakFraction = peakFreq / (sampleRate / 2);
    const pxPeak = paddingLeft + Math.min(Math.max(peakFraction * plotWidth, 0), plotWidth);

    ctx.beginPath();
    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = 1.8;
    ctx.setLineDash([3, 3]);
    ctx.moveTo(pxPeak, 0);
    ctx.lineTo(pxPeak, height - paddingBottom);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = '700 9.5px var(--ff-mono)';
    ctx.fillStyle = '#34d399';
    ctx.textAlign = 'center';
    ctx.fillText(`Peak: ${peakFreq.toFixed(0)} Hz`, Math.min(Math.max(pxPeak, paddingLeft + 35), width - 35), 14);

    // X Axis Labels
    ctx.font = '9px var(--ff-mono)';
    ctx.fillStyle = 'var(--text-dim)';
    ctx.textAlign = 'left';
    ctx.fillText('0 Hz', paddingLeft, height - 6);
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(sampleRate / 2000)} kHz`, width - 12, height - 6);
  }

  // ── Render Discrete Sampling Visualizer ────────────────────────────
  function renderSamplingView(canvasId, now) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.parentElement.clientWidth;
    const height = canvas.parentElement.clientHeight;
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }

    ctx.clearRect(0, 0, width, height);
    drawGrid(ctx, width, height);

    const midY = height / 2;
    const scaleY = (height / 2 - 12);
    const timeWinSec = state.timeWindowMs / 1000.0;
    const tNow = (now / 1000.0) % 100.0;

    // Continuous Source Wave Trace
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255, 180, 84, 0.4)';
    ctx.lineWidth = 1.8;
    ctx.setLineDash([3, 3]);

    for (let px = 0; px < width; px++) {
      const t = tNow + (px / width) * timeWinSec;
      const val = 0.8 * Math.sin(2 * Math.PI * state.procPeakFreq * t);
      const py = midY - val * scaleY;
      if (px === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Discrete Sampling Stems at 1 / Fs
    const sampleIntervalSec = 1.0 / state.targetFs;
    const kStart = Math.floor(tNow / sampleIntervalSec);
    const kEnd = Math.ceil((tNow + timeWinSec) / sampleIntervalSec);

    for (let k = kStart; k <= kEnd; k++) {
      const tSample = k * sampleIntervalSec;
      const px = ((tSample - tNow) / timeWinSec) * width;
      if (px < -5 || px > width + 5) continue;

      const val = 0.8 * Math.sin(2 * Math.PI * state.procPeakFreq * tSample);
      const py = midY - val * scaleY;

      ctx.beginPath();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.moveTo(px, midY);
      ctx.lineTo(px, py);
      ctx.stroke();

      ctx.beginPath();
      ctx.fillStyle = '#38bdf8';
      ctx.arc(px, py, 3.5, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  // ── Render Aliasing Comparison View ────────────────────────────────
  function renderAliasingView(canvasId, now) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.parentElement.clientWidth;
    const height = canvas.parentElement.clientHeight;
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }

    ctx.clearRect(0, 0, width, height);
    drawGrid(ctx, width, height);

    const midY = height / 2;
    const scaleY = (height / 2 - 12);
    const timeWinSec = state.timeWindowMs / 1000.0;
    const tNow = (now / 1000.0) % 100.0;

    // Faint high-frequency original trace
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255, 180, 84, 0.25)';
    ctx.lineWidth = 1.5;
    for (let px = 0; px < width; px++) {
      const t = tNow + (px / width) * timeWinSec;
      const val = 0.8 * Math.sin(2 * Math.PI * state.procPeakFreq * t);
      const py = midY - val * scaleY;
      if (px === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Discrete sample points
    const sampleIntervalSec = 1.0 / state.targetFs;
    const kStart = Math.floor(tNow / sampleIntervalSec);
    const kEnd = Math.ceil((tNow + timeWinSec) / sampleIntervalSec);

    for (let k = kStart; k <= kEnd; k++) {
      const tSample = k * sampleIntervalSec;
      const px = ((tSample - tNow) / timeWinSec) * width;
      if (px < -5 || px > width + 5) continue;

      const val = 0.8 * Math.sin(2 * Math.PI * state.procPeakFreq * tSample);
      const py = midY - val * scaleY;

      ctx.beginPath();
      ctx.fillStyle = '#38bdf8';
      ctx.arc(px, py, 3.5, 0, 2 * Math.PI);
      ctx.fill();
    }

    // Reconstructed Alias Waveform (Magenta)
    const renderFreq = state.status === 'ALIASING' && state.aliasFreq ? state.aliasFreq : state.procPeakFreq;
    ctx.beginPath();
    ctx.strokeStyle = state.status === 'ALIASING' ? '#e879f9' : '#34d399';
    ctx.lineWidth = 2.4;
    ctx.shadowColor = state.status === 'ALIASING' ? '#e879f9' : '#34d399';
    ctx.shadowBlur = 10;

    for (let px = 0; px < width; px++) {
      const t = tNow + (px / width) * timeWinSec;
      const val = 0.8 * Math.sin(2 * Math.PI * renderFreq * t);
      const py = midY - val * scaleY;
      if (px === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  function drawGrid(ctx, width, height) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    const numDivs = 8;
    for (let i = 1; i < numDivs; i++) {
      const x = (width / numDivs) * i;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
  }

  // =========================================================================
  // 8. FILE UPLOAD & EVENT BINDINGS
  // =========================================================================
  function handleFileUpload(file) {
    if (!file) return;
    initAudioContext();
    const reader = new FileReader();

    reader.onload = (e) => {
      const arrayBuffer = e.target.result;
      audioCtx.decodeAudioData(arrayBuffer, (decodedBuffer) => {
        state.origAudioBuffer = decodedBuffer;
        state.fileName = file.name;
        recomputeDSP();
      }, (err) => {
        console.error('Audio decode error:', err);
      });
    };

    reader.readAsArrayBuffer(file);
  }

  function bindEvents() {
    // Sliders & Selects
    bindInput('sp-input-speed', (val) => { state.speedFactor = parseFloat(val); recomputeDSP(); });
    bindSelect('sp-select-fs', (val) => { state.targetFsSelect = val; recomputeDSP(); });
    bindInput('sp-input-window', (val) => { state.timeWindowMs = parseFloat(val); updateMetricsUI(); });

    // Buttons
    const btnUpload = document.getElementById('sp-btn-upload');
    const fileInput = document.getElementById('sp-file-input');
    const btnSynth = document.getElementById('sp-btn-synth');
    const btnPlayOrig = document.getElementById('sp-btn-play-orig');
    const btnPlayProc = document.getElementById('sp-btn-play-resampled');
    const btnStop = document.getElementById('sp-btn-stop');

    if (btnUpload && fileInput) {
      btnUpload.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', (e) => handleFileUpload(e.target.files[0]));
    }

    if (btnSynth) btnSynth.addEventListener('click', generateSynthetic440Buffer);
    if (btnPlayOrig) btnPlayOrig.addEventListener('click', () => playAudio(state.origAudioBuffer, 'orig'));
    if (btnPlayProc) btnPlayProc.addEventListener('click', () => playAudio(state.resampledAudioBuffer, 'resampled'));
    if (btnStop) btnStop.addEventListener('click', stopAudio);

    // Presets
    bindPreset('sp-preset-1x', 1.0, 'orig');
    bindPreset('sp-preset-slow', 0.5, 'orig');
    bindPreset('sp-preset-fast', 2.0, 'orig');
    bindPreset('sp-preset-44k', 1.0, '44100');
    bindPreset('sp-preset-22k', 1.0, '22050');
    bindPreset('sp-preset-11k', 1.0, '11025');
    bindPreset('sp-preset-8k', 1.0, '8000');
  }

  function bindPreset(id, speedVal, fsVal) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener('click', () => {
      state.speedFactor = speedVal;
      state.targetFsSelect = fsVal;

      const elSpeed = document.getElementById('sp-input-speed');
      const elFs = document.getElementById('sp-select-fs');

      if (elSpeed) elSpeed.value = speedVal;
      if (elFs) elFs.value = fsVal;

      recomputeDSP();
    });
  }

  function bindInput(id, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', (e) => fn(e.target.value));
  }

  function bindSelect(id, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', (e) => fn(e.target.value));
  }

  // Init on DOM ready
  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    generateSynthetic440Buffer();
    animFrameId = requestAnimationFrame(globalRender);
  });

  window.addEventListener('beforeunload', () => {
    stopAudio();
    if (animFrameId) cancelAnimationFrame(animFrameId);
  });

})();
