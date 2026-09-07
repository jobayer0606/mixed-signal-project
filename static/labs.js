/**
 * SIGNAL LABS — Interactive Signal Processing Experiments (v4)
 * Lab 1: Wave Interference & Beat Frequency Engine
 * Lab 2: Sampling & Aliasing Engine
 * Lab 3: Fourier Series & Harmonics Synthesizer Engine
 * Lab 4: Convolution & Filtering Engine
 * Lab Switcher Controller (4 Labs)
 * Completely isolated from Page 1 Audio Studio.
 *
 * Architecture:
 * - JavaScript: UI, controls, animations, Canvas visualization, Web Audio playback, and API communication.
 * - Python / DSP Service: Mathematical calculations (signal synthesis, Nyquist/aliasing folding,
 *   Fourier harmonic expansion & MSE/RMSE errors, discrete linear convolution & mathematical step derivation).
 */

(function () {
  'use strict';

  // =========================================================================
  // 1. PYTHON / DSP CALCULATION ENGINE (Reference DSP Implementations)
  // =========================================================================
  const PythonDSP = {
    /**
     * Evaluates standard waveforms at a given continuous phase.
     */
    evalWaveform: function (phase, shape) {
      let p = phase % (2 * Math.PI);
      if (p < 0) p += 2 * Math.PI;

      switch (shape) {
        case 'sine':
          return Math.sin(p);
        case 'square':
          return p < Math.PI ? 1.0 : -1.0;
        case 'triangle':
          return p < Math.PI
            ? (2.0 * p / Math.PI) - 1.0
            : 3.0 - (2.0 * p / Math.PI);
        case 'sawtooth':
          return 1.0 - (p / Math.PI);
        default:
          return Math.sin(p);
      }
    },

    /**
     * Lab 1: Wave Interference & Beat Frequency DSP calculations.
     */
    calculateBeatMetrics: function (f1, f2, a1, a2, shape1, shape2) {
      const beatFreq = Math.abs(f1 - f2);
      const avgCarrier = (f1 + f2) / 2.0;
      const beatPeriod = beatFreq > 0.001 ? (1.0 / beatFreq) : null;

      let stateTitle = 'Dual Tone';
      let stateSub = 'Perceived as 2 separate pitches';

      if (beatFreq === 0) {
        stateTitle = 'Unison State';
        stateSub = 'Perfect constructive phase';
      } else if (beatFreq <= 15) {
        stateTitle = 'Acoustic Beat Pulse';
        stateSub = 'Clear periodic envelope swell';
      } else if (beatFreq <= 30) {
        stateTitle = 'Fast Flutter';
        stateSub = 'Rapid amplitude flutter';
      }

      const isSine1 = shape1 === 'sine';
      const isSine2 = shape2 === 'sine';
      const isEqualAmp = Math.abs(a1 - a2) < 0.05;
      const isValidEnvelope = isSine1 && isSine2 && isEqualAmp && beatFreq > 0.01;
      const modFreq = beatFreq / 2.0;
      const envAmp = a1 + a2;

      return {
        beat_freq: beatFreq,
        carrier_freq: avgCarrier,
        beat_period: beatPeriod,
        state_title: stateTitle,
        state_sub: stateSub,
        is_valid_envelope: isValidEnvelope,
        mod_freq: modFreq,
        env_amp: envAmp
      };
    },

    /**
     * Lab 2: Sampling, Aliasing & Nyquist Foldback DSP calculations.
     */
    calculateSamplingDSP: function (f, fs) {
      const nyquist = fs / 2.0;
      const ratio = fs / f;
      const signedFolded = ((f + nyquist) % fs) - nyquist;
      const aliasFreq = Math.abs(signedFolded);

      let status = 'SAFE';
      let statusSub = 'f < Fs/2 (No aliasing)';
      let statusClass = 'badge-safe';

      if (Math.abs(f - nyquist) < 0.5) {
        status = 'NYQUIST LIMIT';
        statusSub = 'f = Fs/2 (Boundary)';
        statusClass = 'badge-nyquist';
      } else if (f > nyquist) {
        status = 'ALIASING';
        statusSub = `f > Fs/2 (Folded to ${aliasFreq.toFixed(1)} Hz)`;
        statusClass = 'badge-aliasing';
      }

      return {
        nyquist: nyquist,
        ratio: ratio,
        alias_freq: aliasFreq,
        signed_folded: signedFolded,
        status: status,
        status_sub: statusSub,
        status_class: statusClass
      };
    },

    /**
     * Lab 3: Fourier Series harmonic expansion coefficients.
     */
    getHarmonicCoefficients: function (shape, nTerms, amp) {
      const coeffs = [];
      let highestHarmonic = 1;

      if (shape === 'square') {
        const factor = (4.0 * amp) / Math.PI;
        for (let k = 1; k <= nTerms; k++) {
          const n = 2 * k - 1;
          coeffs.push({ n: n, amp: factor / n });
          highestHarmonic = n;
        }
      } else if (shape === 'triangle') {
        const factor = (8.0 * amp) / (Math.PI * Math.PI);
        for (let k = 1; k <= nTerms; k++) {
          const n = 2 * k - 1;
          const sign = (k % 2 === 1) ? 1.0 : -1.0;
          coeffs.push({ n: n, amp: sign * factor / (n * n) });
          highestHarmonic = n;
        }
      } else if (shape === 'sawtooth') {
        const factor = (2.0 * amp) / Math.PI;
        for (let n = 1; n <= nTerms; n++) {
          const sign = (n % 2 === 1) ? 1.0 : -1.0;
          coeffs.push({ n: n, amp: sign * factor / n });
          highestHarmonic = n;
        }
      }
      return { coeffs, highestHarmonic };
    },

    /**
     * Lab 3: Fourier partial sum evaluation at time t.
     */
    evalFourierSum: function (t, coeffs, f0) {
      const omega0 = 2 * Math.PI * f0;
      let sum = 0.0;
      for (let i = 0; i < coeffs.length; i++) {
        sum += coeffs[i].amp * Math.sin(coeffs[i].n * omega0 * t);
      }
      return sum;
    },

    /**
     * Lab 3: Fourier error & Gibbs analysis.
     */
    calculateFourierMetrics: function (shape, nTerms, amp, f0) {
      const { coeffs, highestHarmonic } = this.getHarmonicCoefficients(shape, nTerms, amp);
      const latestHarmonic = coeffs[coeffs.length - 1] || { n: 1, amp: amp };

      const numSamples = 200;
      const periodSec = 1.0 / f0;
      let sumSqError = 0.0;

      for (let m = 0; m < numSamples; m++) {
        const t = (m / numSamples) * periodSec;
        const targetVal = amp * this.evalWaveform(2 * Math.PI * f0 * t, shape);
        const fourierVal = this.evalFourierSum(t, coeffs, f0);
        const err = targetVal - fourierVal;
        sumSqError += err * err;
      }

      const mse = sumSqError / numSamples;
      const rmse = Math.sqrt(mse);
      const rmsePercent = (rmse / amp) * 100.0;

      let status = 'Coarse Approximation';
      let statusSub = 'Low harmonic terms count';
      let statusColor = 'var(--trace-a)';

      if (shape === 'triangle') {
        status = 'Smooth Decay (1/n²)';
        statusSub = 'Rapid convergence, minimal ringing';
        statusColor = 'var(--ok)';
      } else if (nTerms >= 5) {
        status = 'Gibbs Ringing Active';
        statusSub = '~9% overshoot near jump discontinuity';
        statusColor = 'var(--warn)';
      }

      return {
        coeffs,
        highestHarmonic,
        latestHarmonic,
        mse,
        rmse,
        rmsePercent,
        status,
        statusSub,
        statusColor
      };
    },

    /**
     * Lab 4: Discrete linear convolution y[n] = sum_k x[k] * h[n-k].
     */
    computeDiscreteConvolution: function (xSeq, hSeq) {
      const Lx = xSeq.length;
      const Lh = hSeq.length;
      const Ly = Lx + Lh - 1;
      const ySeq = new Array(Ly).fill(0);

      for (let n = 0; n < Ly; n++) {
        let sum = 0;
        for (let k = 0; k < Lx; k++) {
          const hIdx = n - k;
          if (hIdx >= 0 && hIdx < Lh) {
            sum += xSeq[k] * hSeq[hIdx];
          }
        }
        ySeq[n] = Math.round(sum * 1000) / 1000;
      }
      return ySeq;
    },

    /**
     * Lab 4: Step-by-step mathematical derivation string.
     */
    computeStepMathString: function (xSeq, hSeq, nIndex) {
      const Lx = xSeq.length;
      const Lh = hSeq.length;
      const Ly = Lx + Lh - 1;

      if (nIndex < 0 || nIndex >= Ly) return `y[${nIndex}] = 0 (Outside output range)`;

      const terms = [];
      let totalSum = 0;

      for (let k = 0; k < Lx; k++) {
        const hIdx = nIndex - k;
        if (hIdx >= 0 && hIdx < Lh) {
          const valX = xSeq[k];
          const valH = hSeq[hIdx];
          const prod = valX * valH;
          totalSum += prod;
          terms.push({ k, hIdx, valX, valH, prod });
        }
      }

      if (terms.length === 0) {
        return `y[${nIndex}] = 0 (No overlapping samples)`;
      }

      const expStr = terms.map(t => `x[${t.k}]h[${nIndex - t.k}]`).join(' + ');
      const valStr = terms.map(t => `${t.valX}×${t.valH}`).join(' + ');
      const roundedSum = Math.round(totalSum * 1000) / 1000;

      return `y[${nIndex}] = ${expStr} = ${valStr} = ${roundedSum}`;
    },

    /**
     * Lab 4: Convolution full analysis metrics.
     */
    calculateConvolutionMetrics: function (xSeq, hSeq, nIndex) {
      const ySeq = this.computeDiscreteConvolution(xSeq, hSeq);
      const Lx = xSeq.length;
      const Lh = hSeq.length;
      const Ly = Lx + Lh - 1;
      const currentYVal = (nIndex >= 0 && nIndex < Ly) ? ySeq[nIndex] : 0;
      const mathStr = this.computeStepMathString(xSeq, hSeq, nIndex);

      let overlapCount = 0;
      for (let k = 0; k < Lx; k++) {
        const hIdx = nIndex - k;
        if (hIdx >= 0 && hIdx < Lh && xSeq[k] !== 0 && hSeq[hIdx] !== 0) {
          overlapCount++;
        }
      }

      return {
        x: xSeq,
        h: hSeq,
        y: ySeq,
        lx: Lx,
        lh: Lh,
        ly: Ly,
        current_y: currentYVal,
        math_str: mathStr,
        overlap_count: overlapCount
      };
    }
  };

  // =========================================================================
  // 2. BACKEND API COMMUNICATION LAYER (JSON / REST API)
  // =========================================================================
  const SignalLabsAPI = {
    baseUrl: '/api',

    /**
     * Generic helper for sending JSON POST requests to Python backend.
     */
    async postJson(endpoint, payload, fallbackFn) {
      try {
        const response = await fetch(`${this.baseUrl}${endpoint}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          const data = await response.json();
          return data;
        }
      } catch (err) {
        // Backend offline or endpoint not yet loaded — seamless fallback
      }

      // Return exact reference DSP calculation
      return fallbackFn();
    },

    /**
     * Asynchronously calculates beat metrics from backend API or DSP engine.
     */
    async calculateBeat(params) {
      return this.postJson('/labs/beat', params, () => {
        return PythonDSP.calculateBeatMetrics(
          params.f1, params.f2, params.a1, params.a2, params.shape1, params.shape2
        );
      });
    },

    /**
     * Asynchronously calculates sampling & aliasing metrics from backend API or DSP engine.
     */
    async calculateSampling(params) {
      return this.postJson('/labs/sampling', params, () => {
        return PythonDSP.calculateSamplingDSP(params.f, params.fs);
      });
    },

    /**
     * Asynchronously calculates Fourier series metrics from backend API or DSP engine.
     */
    async calculateFourier(params) {
      return this.postJson('/labs/fourier', params, () => {
        return PythonDSP.calculateFourierMetrics(
          params.shape, params.n_terms, params.amp, params.f0
        );
      });
    },

    /**
     * Asynchronously calculates convolution metrics from backend API or DSP engine.
     */
    async calculateConvolution(params) {
      return this.postJson('/labs/convolution', params, () => {
        return PythonDSP.calculateConvolutionMetrics(
          params.x, params.h, params.n_index
        );
      });
    }
  };

  // =========================================================================
  // 3. LAB SWITCHER CONTROLLER (4 LABS)
  // =========================================================================
  let activeLabId = 'beat-freq';

  function initLabSwitcher() {
    const cardBeat = document.getElementById('card-beat-freq');
    const cardSampling = document.getElementById('card-sampling');
    const cardFourier = document.getElementById('card-fourier');
    const cardConvolution = document.getElementById('card-convolution');

    if (cardBeat) cardBeat.addEventListener('click', () => switchLab('beat-freq'));
    if (cardSampling) cardSampling.addEventListener('click', () => switchLab('sampling'));
    if (cardFourier) cardFourier.addEventListener('click', () => switchLab('fourier'));
    if (cardConvolution) cardConvolution.addEventListener('click', () => switchLab('convolution'));
  }

  function switchLab(labId) {
    if (labId === activeLabId) return;

    activeLabId = labId;

    const cardBeat = document.getElementById('card-beat-freq');
    const cardSampling = document.getElementById('card-sampling');
    const cardFourier = document.getElementById('card-fourier');
    const cardConvolution = document.getElementById('card-convolution');

    const wsBeat = document.getElementById('workspace-beat-freq');
    const wsSampling = document.getElementById('workspace-sampling');
    const wsFourier = document.getElementById('workspace-fourier');
    const wsConvolution = document.getElementById('workspace-convolution');

    // Toggle Cards Active Class
    if (cardBeat) cardBeat.classList.toggle('active', labId === 'beat-freq');
    if (cardSampling) cardSampling.classList.toggle('active', labId === 'sampling');
    if (cardFourier) cardFourier.classList.toggle('active', labId === 'fourier');
    if (cardConvolution) cardConvolution.classList.toggle('active', labId === 'convolution');

    // Toggle Workspaces
    if (wsBeat) wsBeat.toggleAttribute('hidden', labId !== 'beat-freq');
    if (wsSampling) wsSampling.toggleAttribute('hidden', labId !== 'sampling');
    if (wsFourier) wsFourier.toggleAttribute('hidden', labId !== 'fourier');
    if (wsConvolution) wsConvolution.toggleAttribute('hidden', labId !== 'convolution');

    // Stop audio on hidden labs
    if (labId !== 'beat-freq') beatLab.stopAudio();
    if (labId !== 'sampling') samplingLab.stopAudio();
    if (labId !== 'fourier') fourierLab.stopAudio();
    if (labId !== 'convolution') convolutionLab.stopAudio();
  }

  // =========================================================================
  // 4. LAB 1: WAVE INTERFERENCE & BEAT FREQUENCY
  // =========================================================================
  const beatLab = (function () {
    const state = {
      f1: 440.0, a1: 0.8, shape1: 'sine',
      f2: 444.0, a2: 0.8, shape2: 'sine',
      masterVol: 0.5, timeWindowMs: 25.0, isPlaying: false,
      dsp: PythonDSP.calculateBeatMetrics(440.0, 444.0, 0.8, 0.8, 'sine', 'sine')
    };

    let audioCtx = null;
    let osc1 = null, osc2 = null;
    let gain1 = null, gain2 = null, masterGain = null;

    function initAudio() {
      if (audioCtx) return;
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      audioCtx = new AudioContextClass();

      masterGain = audioCtx.createGain();
      masterGain.gain.setValueAtTime(state.masterVol, audioCtx.currentTime);
      masterGain.connect(audioCtx.destination);
    }

    function startAudio() {
      initAudio();
      if (!audioCtx) return;
      if (audioCtx.state === 'suspended') audioCtx.resume();

      stopAudio();

      const now = audioCtx.currentTime;
      osc1 = audioCtx.createOscillator(); gain1 = audioCtx.createGain();
      osc1.type = state.shape1; osc1.frequency.setValueAtTime(state.f1, now);
      gain1.gain.setValueAtTime(state.a1 * 0.5, now);
      osc1.connect(gain1); gain1.connect(masterGain);

      osc2 = audioCtx.createOscillator(); gain2 = audioCtx.createGain();
      osc2.type = state.shape2; osc2.frequency.setValueAtTime(state.f2, now);
      gain2.gain.setValueAtTime(state.a2 * 0.5, now);
      osc2.connect(gain2); gain2.connect(masterGain);

      osc1.start(now); osc2.start(now);
      state.isPlaying = true;
      updatePlayStopButtons();
    }

    function stopAudio() {
      const now = audioCtx ? audioCtx.currentTime : 0;
      if (osc1) { try { osc1.stop(now); osc1.disconnect(); } catch (e) {} osc1 = null; }
      if (osc2) { try { osc2.stop(now); osc2.disconnect(); } catch (e) {} osc2 = null; }
      if (gain1) { try { gain1.disconnect(); } catch (e) {} gain1 = null; }
      if (gain2) { try { gain2.disconnect(); } catch (e) {} gain2 = null; }
      state.isPlaying = false;
      updatePlayStopButtons();
    }

    function updateAudioParams() {
      if (!audioCtx || !state.isPlaying) return;
      const now = audioCtx.currentTime;
      if (osc1) { osc1.frequency.setTargetAtTime(state.f1, now, 0.01); osc1.type = state.shape1; }
      if (gain1) gain1.gain.setTargetAtTime(state.a1 * 0.5, now, 0.01);
      if (osc2) { osc2.frequency.setTargetAtTime(state.f2, now, 0.01); osc2.type = state.shape2; }
      if (gain2) gain2.gain.setTargetAtTime(state.a2 * 0.5, now, 0.01);
      if (masterGain) masterGain.gain.setTargetAtTime(state.masterVol, now, 0.01);
    }

    function updatePlayStopButtons() {
      const btnPlay = document.getElementById('btn-lab-play');
      const btnStop = document.getElementById('btn-lab-stop');
      if (btnPlay) btnPlay.classList.toggle('active', state.isPlaying);
      if (btnStop) btnStop.classList.toggle('active', !state.isPlaying);
    }

    async function updateMathMetrics() {
      // Perform DSP calculation via API communication
      state.dsp = await SignalLabsAPI.calculateBeat({
        f1: state.f1,
        f2: state.f2,
        a1: state.a1,
        a2: state.a2,
        shape1: state.shape1,
        shape2: state.shape2,
        time_window_ms: state.timeWindowMs
      });

      const beatFreq = state.dsp.beat_freq;
      const avgCarrier = state.dsp.carrier_freq;
      const beatPeriod = state.dsp.beat_period;

      const elBeatFreq = document.getElementById('metric-beat-freq');
      const elCarrierFreq = document.getElementById('metric-carrier-freq');
      const elBeatPeriod = document.getElementById('metric-beat-period');
      const elState = document.getElementById('metric-state');
      const elStateSub = document.getElementById('metric-state-sub');

      if (elBeatFreq) elBeatFreq.textContent = `${beatFreq.toFixed(1)} Hz`;
      if (elCarrierFreq) elCarrierFreq.textContent = `${avgCarrier.toFixed(1)} Hz`;
      if (elBeatPeriod) elBeatPeriod.textContent = beatPeriod !== null ? `${beatPeriod.toFixed(3)} s` : '∞ (Unison)';

      if (elState && elStateSub) {
        elState.textContent = state.dsp.state_title;
        elStateSub.textContent = state.dsp.state_sub;
      }

      const elReadoutF1 = document.getElementById('readout-f1');
      const elReadoutF2 = document.getElementById('readout-f2');
      const elValF1 = document.getElementById('val-f1');
      const elValF2 = document.getElementById('val-f2');
      const elValA1 = document.getElementById('val-a1');
      const elValA2 = document.getElementById('val-a2');
      const elValVol = document.getElementById('val-master-vol');
      const elValWindow = document.getElementById('val-time-window');

      if (elReadoutF1) elReadoutF1.textContent = `${state.f1.toFixed(1)} Hz`;
      if (elReadoutF2) elReadoutF2.textContent = `${state.f2.toFixed(1)} Hz`;
      if (elValF1) elValF1.textContent = `${state.f1.toFixed(1)} Hz`;
      if (elValF2) elValF2.textContent = `${state.f2.toFixed(1)} Hz`;
      if (elValA1) elValA1.textContent = state.a1.toFixed(2);
      if (elValA2) elValA2.textContent = state.a2.toFixed(2);
      if (elValVol) elValVol.textContent = `${Math.round(state.masterVol * 100)}%`;
      if (elValWindow) elValWindow.textContent = `${state.timeWindowMs} ms`;

      const elScope1Sub = document.getElementById('scope1-sub');
      const elScope2Sub = document.getElementById('scope2-sub');
      const elScopeSumSub = document.getElementById('scope-sum-sub');

      if (elScope1Sub) elScope1Sub.textContent = `f₁ = ${state.f1.toFixed(1)} Hz · ${state.shape1}`;
      if (elScope2Sub) elScope2Sub.textContent = `f₂ = ${state.f2.toFixed(1)} Hz · ${state.shape2}`;
      if (elScopeSumSub) elScopeSumSub.textContent = `f_beat = ${beatFreq.toFixed(1)} Hz · y = y₁ + y₂`;
    }

    function render(now) {
      if (activeLabId !== 'beat-freq') return;

      const elapsedSec = (now - startTime) / 1000.0;
      const timeWinSec = state.timeWindowMs / 1000.0;

      drawSingleScope('canvas-wave1', (t) => state.a1 * PythonDSP.evalWaveform(2 * Math.PI * state.f1 * t, state.shape1), '#ffb454', elapsedSec, timeWinSec, 1.2);
      drawSingleScope('canvas-wave2', (t) => state.a2 * PythonDSP.evalWaveform(2 * Math.PI * state.f2 * t, state.shape2), '#9e7aff', elapsedSec, timeWinSec, 1.2);
      drawCombinedScope('canvas-wave-sum', elapsedSec, timeWinSec);
    }

    function drawSingleScope(canvasId, fnEval, color, tNow, tWindow, maxAmp) {
      const canvas = document.getElementById(canvasId);
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const width = canvas.parentElement.clientWidth;
      const height = canvas.parentElement.clientHeight;
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }

      ctx.clearRect(0, 0, width, height); drawGrid(ctx, width, height);

      const midY = height / 2;
      const scaleY = (height / 2 - 10) / maxAmp;

      ctx.beginPath();
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.shadowColor = color; ctx.shadowBlur = 8;
      for (let px = 0; px < width; px++) {
        const t = tNow + (px / width) * tWindow;
        const val = fnEval(t);
        const py = midY - val * scaleY;
        if (px === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke(); ctx.shadowBlur = 0;
    }

    function drawCombinedScope(canvasId, tNow, tWindow) {
      const canvas = document.getElementById(canvasId);
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const width = canvas.parentElement.clientWidth;
      const height = canvas.parentElement.clientHeight;
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }

      ctx.clearRect(0, 0, width, height); drawGrid(ctx, width, height);

      const maxAmp = Math.max(state.a1 + state.a2, 1.0);
      const midY = height / 2;
      const scaleY = (height / 2 - 12) / maxAmp;

      const dsp = state.dsp || PythonDSP.calculateBeatMetrics(state.f1, state.f2, state.a1, state.a2, state.shape1, state.shape2);

      if (dsp.is_valid_envelope) {
        const modFreq = dsp.mod_freq;
        const envAmp = dsp.env_amp;

        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;

        for (let px = 0; px < width; px++) {
          const t = tNow + (px / width) * tWindow;
          const envVal = envAmp * Math.abs(Math.cos(2 * Math.PI * modFreq * t));
          const py = midY - envVal * scaleY;
          if (px === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();

        ctx.beginPath();
        for (let px = 0; px < width; px++) {
          const t = tNow + (px / width) * tWindow;
          const envVal = -envAmp * Math.abs(Math.cos(2 * Math.PI * modFreq * t));
          const py = midY - envVal * scaleY;
          if (px === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke(); ctx.setLineDash([]);
      }

      ctx.beginPath();
      ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2.2; ctx.shadowColor = '#38bdf8'; ctx.shadowBlur = 10;
      for (let px = 0; px < width; px++) {
        const t = tNow + (px / width) * tWindow;
        const y1 = state.a1 * PythonDSP.evalWaveform(2 * Math.PI * state.f1 * t, state.shape1);
        const y2 = state.a2 * PythonDSP.evalWaveform(2 * Math.PI * state.f2 * t, state.shape2);
        const py = midY - (y1 + y2) * scaleY;
        if (px === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke(); ctx.shadowBlur = 0;
    }

    function bindEvents() {
      bindInput('input-f1', (val) => { state.f1 = parseFloat(val); updateAudioParams(); updateMathMetrics(); });
      bindInput('input-a1', (val) => { state.a1 = parseFloat(val); updateAudioParams(); updateMathMetrics(); });
      bindSelect('select-shape1', (val) => { state.shape1 = val; updateAudioParams(); updateMathMetrics(); });

      bindInput('input-f2', (val) => { state.f2 = parseFloat(val); updateAudioParams(); updateMathMetrics(); });
      bindInput('input-a2', (val) => { state.a2 = parseFloat(val); updateAudioParams(); updateMathMetrics(); });
      bindSelect('select-shape2', (val) => { state.shape2 = val; updateAudioParams(); updateMathMetrics(); });

      bindInput('input-master-vol', (val) => { state.masterVol = parseFloat(val); updateAudioParams(); updateMathMetrics(); });
      bindInput('input-time-window', (val) => { state.timeWindowMs = parseFloat(val); updateMathMetrics(); });

      const btnPlay = document.getElementById('btn-lab-play');
      const btnStop = document.getElementById('btn-lab-stop');
      if (btnPlay) btnPlay.addEventListener('click', startAudio);
      if (btnStop) btnStop.addEventListener('click', stopAudio);

      bindPreset('preset-4hz', 440.0, 444.0);
      bindPreset('preset-1hz', 440.0, 441.0);
      bindPreset('preset-8hz', 440.0, 448.0);
      bindPreset('preset-unison', 440.0, 440.0);
      bindPreset('preset-octave', 440.0, 880.0);
    }

    function bindPreset(id, f1Val, f2Val) {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.addEventListener('click', () => {
        state.f1 = f1Val; state.f2 = f2Val;
        const elF1 = document.getElementById('input-f1');
        const elF2 = document.getElementById('input-f2');
        if (elF1) elF1.value = f1Val; if (elF2) elF2.value = f2Val;
        updateAudioParams(); updateMathMetrics();
      });
    }

    return {
      init: function () { bindEvents(); updateMathMetrics(); },
      render: render,
      stopAudio: stopAudio,
      getDSP: function () { return state.dsp; }
    };
  })();

  // =========================================================================
  // 5. LAB 2: SAMPLING & ALIASING
  // =========================================================================
  const samplingLab = (function () {
    const state = {
      f: 700.0, fs: 1000.0, amp: 0.8, shape: 'sine',
      timeWindowMs: 15.0, playingMode: null,
      dsp: PythonDSP.calculateSamplingDSP(700.0, 1000.0)
    };

    let audioCtx = null, osc = null, gainNode = null;

    function initAudio() {
      if (audioCtx) return;
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      audioCtx = new AudioContextClass();
    }

    function playTone(freqToPlay, mode) {
      initAudio();
      if (!audioCtx) return;
      if (audioCtx.state === 'suspended') audioCtx.resume();
      stopAudio();

      const now = audioCtx.currentTime;
      osc = audioCtx.createOscillator(); gainNode = audioCtx.createGain();
      osc.type = state.shape; osc.frequency.setValueAtTime(freqToPlay, now);
      gainNode.gain.setValueAtTime(state.amp * 0.4, now);
      osc.connect(gainNode); gainNode.connect(audioCtx.destination);
      osc.start(now);
      state.playingMode = mode;
      updateAudioButtons();
    }

    function stopAudio() {
      if (osc) {
        try { const now = audioCtx ? audioCtx.currentTime : 0; osc.stop(now); osc.disconnect(); } catch (e) {}
        osc = null;
      }
      if (gainNode) { try { gainNode.disconnect(); } catch (e) {} gainNode = null; }
      state.playingMode = null;
      updateAudioButtons();
    }

    function updateAudioButtons() {
      const btnOrig = document.getElementById('s-btn-play-orig');
      const btnAlias = document.getElementById('s-btn-play-alias');
      const btnStop = document.getElementById('s-btn-stop');

      if (btnOrig) btnOrig.classList.toggle('active', state.playingMode === 'orig');
      if (btnAlias) btnAlias.classList.toggle('active', state.playingMode === 'alias');
      if (btnStop) btnStop.classList.toggle('active', state.playingMode === null);
    }

    async function updateMathMetrics() {
      // Calculate DSP via API service
      state.dsp = await SignalLabsAPI.calculateSampling({
        f: state.f,
        fs: state.fs,
        amp: state.amp,
        shape: state.shape,
        time_window_ms: state.timeWindowMs
      });

      const dsp = state.dsp;

      const elF = document.getElementById('s-metric-f');
      const elFs = document.getElementById('s-metric-fs');
      const elNyquist = document.getElementById('s-metric-nyquist');
      const elAlias = document.getElementById('s-metric-alias');
      const elRatio = document.getElementById('s-metric-ratio');
      const elStatus = document.getElementById('s-metric-status');
      const elStatusSub = document.getElementById('s-metric-status-sub');

      if (elF) elF.textContent = `${state.f.toFixed(1)} Hz`;
      if (elFs) elFs.textContent = `${state.fs.toFixed(1)} Hz`;
      if (elNyquist) elNyquist.textContent = `${dsp.nyquist.toFixed(1)} Hz`;
      if (elAlias) elAlias.textContent = `${dsp.alias_freq.toFixed(1)} Hz`;
      if (elRatio) elRatio.textContent = `Ratio Fs/f = ${dsp.ratio.toFixed(2)}`;

      if (elStatus) { elStatus.textContent = dsp.status; elStatus.className = `metric-value ${dsp.status_class}`; }
      if (elStatusSub) elStatusSub.textContent = dsp.status_sub;

      const elReadoutF = document.getElementById('s-readout-f');
      const elReadoutFs = document.getElementById('s-readout-fs');
      const elValF = document.getElementById('s-val-f');
      const elValA = document.getElementById('s-val-a');
      const elValFs = document.getElementById('s-val-fs');
      const elValWindow = document.getElementById('s-val-time-window');

      if (elReadoutF) elReadoutF.textContent = `${state.f.toFixed(1)} Hz`;
      if (elReadoutFs) elReadoutFs.textContent = `${state.fs.toFixed(1)} Hz`;
      if (elValF) elValF.textContent = `${state.f.toFixed(1)} Hz`;
      if (elValA) elValA.textContent = state.amp.toFixed(2);
      if (elValFs) elValFs.textContent = `${state.fs.toFixed(1)} Hz`;
      if (elValWindow) elValWindow.textContent = `${state.timeWindowMs} ms`;

      const elScope1Sub = document.getElementById('s-scope1-sub');
      const elScope2Sub = document.getElementById('s-scope2-sub');
      const elScopeAliasSub = document.getElementById('s-scope-alias-sub');

      if (elScope1Sub) elScope1Sub.textContent = `f = ${state.f.toFixed(1)} Hz · ${state.shape}`;
      if (elScope2Sub) elScope2Sub.textContent = `Fs = ${state.fs.toFixed(1)} Hz · Sample Stems (T_s = ${(1000/state.fs).toFixed(2)} ms)`;
      if (elScopeAliasSub) {
        if (dsp.status === 'ALIASING') {
          elScopeAliasSub.textContent = `Apparent Alias Frequency f_alias = ${dsp.alias_freq.toFixed(1)} Hz (Folded)`;
        } else {
          elScopeAliasSub.textContent = `Exact Reconstruction f = ${state.f.toFixed(1)} Hz (No Aliasing)`;
        }
      }
    }

    function render(now) {
      if (activeLabId !== 'sampling') return;

      const elapsedSec = (now - startTime) / 1000.0;
      const timeWinSec = state.timeWindowMs / 1000.0;
      const dsp = state.dsp || PythonDSP.calculateSamplingDSP(state.f, state.fs);

      drawContinuousScope('canvas-s-orig', elapsedSec, timeWinSec);
      drawSampledScope('canvas-s-sampled', elapsedSec, timeWinSec);
      drawReconstructedScope('canvas-s-alias', dsp, elapsedSec, timeWinSec);
    }

    function drawContinuousScope(canvasId, tNow, tWindow) {
      const canvas = document.getElementById(canvasId);
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const width = canvas.parentElement.clientWidth;
      const height = canvas.parentElement.clientHeight;
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }

      ctx.clearRect(0, 0, width, height); drawGrid(ctx, width, height);
      const midY = height / 2; const scaleY = (height / 2 - 10) / 1.2;

      ctx.beginPath(); ctx.strokeStyle = '#ffb454'; ctx.lineWidth = 2.2; ctx.shadowColor = '#ffb454'; ctx.shadowBlur = 8;
      for (let px = 0; px < width; px++) {
        const t = tNow + (px / width) * tWindow;
        const val = state.amp * PythonDSP.evalWaveform(2 * Math.PI * state.f * t, state.shape);
        const py = midY - val * scaleY;
        if (px === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke(); ctx.shadowBlur = 0;
    }

    function drawSampledScope(canvasId, tNow, tWindow) {
      const canvas = document.getElementById(canvasId);
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const width = canvas.parentElement.clientWidth;
      const height = canvas.parentElement.clientHeight;
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }

      ctx.clearRect(0, 0, width, height); drawGrid(ctx, width, height);
      const midY = height / 2; const scaleY = (height / 2 - 10) / 1.2;

      ctx.beginPath(); ctx.strokeStyle = 'rgba(255, 180, 84, 0.22)'; ctx.lineWidth = 1.5;
      for (let px = 0; px < width; px++) {
        const t = tNow + (px / width) * tWindow;
        const val = state.amp * PythonDSP.evalWaveform(2 * Math.PI * state.f * t, state.shape);
        const py = midY - val * scaleY;
        if (px === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();

      const sampleIntervalSec = 1.0 / state.fs;
      const kStart = Math.floor(tNow / sampleIntervalSec);
      const kEnd = Math.ceil((tNow + tWindow) / sampleIntervalSec);

      for (let k = kStart; k <= kEnd; k++) {
        const tSample = k * sampleIntervalSec;
        const px = ((tSample - tNow) / tWindow) * width;
        if (px < -5 || px > width + 5) continue;

        const val = state.amp * PythonDSP.evalWaveform(2 * Math.PI * state.f * tSample, state.shape);
        const py = midY - val * scaleY;

        ctx.beginPath(); ctx.strokeStyle = 'rgba(56, 189, 248, 0.6)'; ctx.lineWidth = 1.5;
        ctx.moveTo(px, midY); ctx.lineTo(px, py); ctx.stroke();

        ctx.beginPath(); ctx.fillStyle = '#38bdf8'; ctx.arc(px, py, 4, 0, 2 * Math.PI); ctx.fill();
      }
    }

    function drawReconstructedScope(canvasId, dsp, tNow, tWindow) {
      const canvas = document.getElementById(canvasId);
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const width = canvas.parentElement.clientWidth;
      const height = canvas.parentElement.clientHeight;
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }

      ctx.clearRect(0, 0, width, height); drawGrid(ctx, width, height);
      const midY = height / 2; const scaleY = (height / 2 - 10) / 1.2;

      ctx.beginPath(); ctx.strokeStyle = 'rgba(255, 180, 84, 0.18)'; ctx.lineWidth = 1.2;
      for (let px = 0; px < width; px++) {
        const t = tNow + (px / width) * tWindow;
        const val = state.amp * PythonDSP.evalWaveform(2 * Math.PI * state.f * t, state.shape);
        const py = midY - val * scaleY;
        if (px === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();

      const sampleIntervalSec = 1.0 / state.fs;
      const kStart = Math.floor(tNow / sampleIntervalSec);
      const kEnd = Math.ceil((tNow + tWindow) / sampleIntervalSec);

      for (let k = kStart; k <= kEnd; k++) {
        const tSample = k * sampleIntervalSec;
        const px = ((tSample - tNow) / tWindow) * width;
        if (px < -5 || px > width + 5) continue;

        const val = state.amp * PythonDSP.evalWaveform(2 * Math.PI * state.f * tSample, state.shape);
        const py = midY - val * scaleY;

        ctx.beginPath(); ctx.fillStyle = '#38bdf8'; ctx.arc(px, py, 3.5, 0, 2 * Math.PI); ctx.fill();
      }

      ctx.beginPath();
      ctx.strokeStyle = dsp.status === 'ALIASING' ? '#e879f9' : '#34d399';
      ctx.lineWidth = 2.4; ctx.shadowColor = dsp.status === 'ALIASING' ? '#e879f9' : '#34d399'; ctx.shadowBlur = 10;

      for (let px = 0; px < width; px++) {
        const t = tNow + (px / width) * tWindow;
        const val = state.amp * PythonDSP.evalWaveform(2 * Math.PI * (dsp.signed_folded ?? dsp.signedFolded) * t, state.shape);
        const py = midY - val * scaleY;
        if (px === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke(); ctx.shadowBlur = 0;
    }

    function bindEvents() {
      bindInput('s-input-f', (val) => { state.f = parseFloat(val); updateMathMetrics(); if (state.playingMode === 'orig') playTone(state.f, 'orig'); });
      bindInput('s-input-a', (val) => { state.amp = parseFloat(val); updateMathMetrics(); if (state.playingMode) playTone(state.playingMode === 'orig' ? state.f : state.dsp.alias_freq, state.playingMode); });
      bindSelect('s-select-shape', (val) => { state.shape = val; updateMathMetrics(); if (state.playingMode) playTone(state.playingMode === 'orig' ? state.f : state.dsp.alias_freq, state.playingMode); });

      bindInput('s-input-fs', (val) => { state.fs = parseFloat(val); updateMathMetrics(); if (state.playingMode === 'alias') playTone(state.dsp.alias_freq, 'alias'); });
      bindInput('s-input-time-window', (val) => { state.timeWindowMs = parseFloat(val); updateMathMetrics(); });

      const btnOrig = document.getElementById('s-btn-play-orig');
      const btnAlias = document.getElementById('s-btn-play-alias');
      const btnStop = document.getElementById('s-btn-stop');

      if (btnOrig) btnOrig.addEventListener('click', () => playTone(state.f, 'orig'));
      if (btnAlias) btnAlias.addEventListener('click', () => playTone(state.dsp.alias_freq, 'alias'));
      if (btnStop) btnStop.addEventListener('click', stopAudio);

      bindPreset('s-preset-safe', 100.0, 1000.0);
      bindPreset('s-preset-near', 400.0, 1000.0);
      bindPreset('s-preset-limit', 500.0, 1000.0);
      bindPreset('s-preset-alias', 700.0, 1000.0);
      bindPreset('s-preset-severe', 1800.0, 1000.0);
    }

    function bindPreset(id, fVal, fsVal) {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.addEventListener('click', () => {
        state.f = fVal; state.fs = fsVal;
        const elF = document.getElementById('s-input-f');
        const elFs = document.getElementById('s-input-fs');
        if (elF) elF.value = fVal; if (elFs) elFs.value = fsVal;
        updateMathMetrics();
        if (state.playingMode) playTone(state.playingMode === 'orig' ? state.f : state.dsp.alias_freq, state.playingMode);
      });
    }

    return {
      init: function () { bindEvents(); updateMathMetrics(); },
      render: render,
      stopAudio: stopAudio,
      getDSP: function () { return state.dsp; }
    };
  })();

  // =========================================================================
  // 6. LAB 3: FOURIER SERIES & HARMONICS SYNTHESIZER
  // =========================================================================
  const fourierLab = (function () {
    const state = {
      f0: 100.0, nTerms: 5, amp: 0.8, shape: 'square',
      timeWindowMs: 20.0, buildSpeed: 5, isAnimating: false, isPlayingAudio: false,
      dsp: PythonDSP.calculateFourierMetrics('square', 5, 0.8, 100.0)
    };

    let animBuildInterval = null, audioCtx = null, masterGain = null, oscArray = [];

    function initAudio() {
      if (audioCtx) return;
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      audioCtx = new AudioContextClass();
    }

    function startAudio() {
      initAudio();
      if (!audioCtx) return;
      if (audioCtx.state === 'suspended') audioCtx.resume();
      stopAudio();

      const now = audioCtx.currentTime;
      masterGain = audioCtx.createGain();
      masterGain.gain.setValueAtTime(0.4, now);
      masterGain.connect(audioCtx.destination);

      const coeffs = state.dsp.coeffs || PythonDSP.getHarmonicCoefficients(state.shape, state.nTerms, state.amp).coeffs;

      oscArray = coeffs.map(({ n, amp }) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(n * state.f0, now);
        gain.gain.setValueAtTime(amp * 0.3, now);
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(now);
        return { osc, gain };
      });

      state.isPlayingAudio = true;
      updateAudioButtons();
    }

    function stopAudio() {
      const now = audioCtx ? audioCtx.currentTime : 0;
      oscArray.forEach(({ osc, gain }) => {
        try { osc.stop(now); osc.disconnect(); gain.disconnect(); } catch (e) {}
      });
      oscArray = [];
      if (masterGain) { try { masterGain.disconnect(); } catch (e) {} masterGain = null; }
      state.isPlayingAudio = false;
      updateAudioButtons();
    }

    function updateAudioButtons() {
      const btn = document.getElementById('f-btn-play-audio');
      if (btn) btn.classList.toggle('active', state.isPlayingAudio);
    }

    async function updateMathMetrics() {
      // Calculate Fourier harmonic expansions via API service
      state.dsp = await SignalLabsAPI.calculateFourier({
        shape: state.shape,
        n_terms: state.nTerms,
        amp: state.amp,
        f0: state.f0,
        time_window_ms: state.timeWindowMs
      });

      const dsp = state.dsp;
      const highestHarmonic = dsp.highestHarmonic;
      const latestHarmonic = dsp.latestHarmonic;

      const elF0 = document.getElementById('f-metric-f0');
      const elN = document.getElementById('f-metric-n');
      const elHighestH = document.getElementById('f-metric-highest-h');
      const elLatestH = document.getElementById('f-metric-latest-h');
      const elLatestFreq = document.getElementById('f-metric-latest-freq');
      const elRmse = document.getElementById('f-metric-rmse');
      const elMse = document.getElementById('f-metric-mse');
      const elStatus = document.getElementById('f-metric-status');
      const elStatusSub = document.getElementById('f-metric-status-sub');

      if (elF0) elF0.textContent = `${state.f0.toFixed(1)} Hz`;
      if (elN) elN.textContent = `${state.nTerms} Terms`;
      if (elHighestH) elHighestH.textContent = `Highest Harmonic: n = ${highestHarmonic}`;
      if (elLatestH) elLatestH.textContent = `n = ${latestHarmonic.n}`;
      if (elLatestFreq) elLatestFreq.textContent = `Freq = ${(latestHarmonic.n * state.f0).toFixed(1)} Hz`;
      if (elRmse) elRmse.textContent = `${dsp.rmsePercent.toFixed(1)}%`;
      if (elMse) elMse.textContent = `MSE = ${dsp.mse.toFixed(4)}`;

      if (elStatus && elStatusSub) {
        elStatus.textContent = dsp.status;
        elStatus.style.color = dsp.statusColor;
        elStatusSub.textContent = dsp.statusSub;
      }

      const elReadoutShape = document.getElementById('f-readout-shape');
      const elReadoutN = document.getElementById('f-readout-n');
      const elValF0 = document.getElementById('f-val-f0');
      const elValAmp = document.getElementById('f-val-amp');
      const elValN = document.getElementById('f-val-n');
      const elValSpeed = document.getElementById('f-val-speed');
      const elValWindow = document.getElementById('f-val-time-window');

      const shapeNames = { square: 'Square Wave', sawtooth: 'Sawtooth Wave', triangle: 'Triangle Wave' };
      if (elReadoutShape) elReadoutShape.textContent = shapeNames[state.shape] || state.shape;
      if (elReadoutN) elReadoutN.textContent = `N = ${state.nTerms} Terms`;
      if (elValF0) elValF0.textContent = `${state.f0.toFixed(1)} Hz`;
      if (elValAmp) elValAmp.textContent = state.amp.toFixed(2);
      if (elValN) elValN.textContent = `${state.nTerms} Terms (n_max = ${highestHarmonic})`;
      if (elValSpeed) elValSpeed.textContent = `${state.buildSpeed}x`;
      if (elValWindow) elValWindow.textContent = `${state.timeWindowMs} ms`;

      const elScope1Sub = document.getElementById('f-scope1-sub');
      const elScope2Sub = document.getElementById('f-scope2-sub');
      const elScope3Sub = document.getElementById('f-scope3-sub');

      if (elScope1Sub) elScope1Sub.textContent = `Amber = Ideal Target · Cyan = Fourier Partial Sum (N = ${state.nTerms} Terms, n_max = ${highestHarmonic})`;
      if (elScope2Sub) elScope2Sub.textContent = `Latest Component n = ${latestHarmonic.n} · Amp = ${Math.abs(latestHarmonic.amp).toFixed(3)}`;
      if (elScope3Sub) elScope3Sub.textContent = `Stem Plot |c_n| vs Harmonic n (1 to ${highestHarmonic}) · Active: n = ${latestHarmonic.n}`;
    }

    function render(now) {
      if (activeLabId !== 'fourier') return;
      const elapsedSec = (now - startTime) / 1000.0;
      const timeWinSec = state.timeWindowMs / 1000.0;

      drawReconstructionScope('canvas-f-sum', elapsedSec, timeWinSec);
      drawComponentScope('canvas-f-component', elapsedSec, timeWinSec);
      drawSpectrumScope('canvas-f-spectrum');
    }

    function drawReconstructionScope(canvasId, tNow, tWindow) {
      const canvas = document.getElementById(canvasId);
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const width = canvas.parentElement.clientWidth;
      const height = canvas.parentElement.clientHeight;
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }

      ctx.clearRect(0, 0, width, height); drawGrid(ctx, width, height);
      const midY = height / 2; const scaleY = (height / 2 - 12) / 1.2;

      ctx.beginPath(); ctx.strokeStyle = 'rgba(255, 180, 84, 0.35)'; ctx.lineWidth = 1.8; ctx.setLineDash([3, 3]);
      for (let px = 0; px < width; px++) {
        const t = tNow + (px / width) * tWindow;
        const targetVal = state.amp * PythonDSP.evalWaveform(2 * Math.PI * state.f0 * t, state.shape);
        const py = midY - targetVal * scaleY;
        if (px === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke(); ctx.setLineDash([]);

      const coeffs = state.dsp?.coeffs || PythonDSP.getHarmonicCoefficients(state.shape, state.nTerms, state.amp).coeffs;

      ctx.beginPath(); ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2.4; ctx.shadowColor = '#38bdf8'; ctx.shadowBlur = 10;
      for (let px = 0; px < width; px++) {
        const t = tNow + (px / width) * tWindow;
        const fourierVal = PythonDSP.evalFourierSum(t, coeffs, state.f0);
        const py = midY - fourierVal * scaleY;
        if (px === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke(); ctx.shadowBlur = 0;
    }

    function drawComponentScope(canvasId, tNow, tWindow) {
      const canvas = document.getElementById(canvasId);
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const width = canvas.parentElement.clientWidth;
      const height = canvas.parentElement.clientHeight;
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }

      ctx.clearRect(0, 0, width, height); drawGrid(ctx, width, height);
      const midY = height / 2; const scaleY = (height / 2 - 10) / 1.2;

      const latestHarmonic = state.dsp?.latestHarmonic || { n: 1, amp: state.amp };
      const omega0 = 2 * Math.PI * state.f0;

      ctx.beginPath(); ctx.strokeStyle = '#34d399'; ctx.lineWidth = 2.0; ctx.shadowColor = '#34d399'; ctx.shadowBlur = 8;
      for (let px = 0; px < width; px++) {
        const t = tNow + (px / width) * tWindow;
        const compVal = latestHarmonic.amp * Math.sin(latestHarmonic.n * omega0 * t);
        const py = midY - compVal * scaleY;
        if (px === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke(); ctx.shadowBlur = 0;
    }

    function drawSpectrumScope(canvasId) {
      const canvas = document.getElementById(canvasId);
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const width = canvas.parentElement.clientWidth;
      const height = canvas.parentElement.clientHeight;
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }

      ctx.clearRect(0, 0, width, height); drawGrid(ctx, width, height);

      const dsp = state.dsp || PythonDSP.calculateFourierMetrics(state.shape, state.nTerms, state.amp, state.f0);
      const coeffs = dsp.coeffs;
      const highestHarmonic = dsp.highestHarmonic;
      const latestHarmonic = dsp.latestHarmonic;

      const maxHarmonicAxis = Math.max(highestHarmonic, 25);
      const coeffMap = new Array(maxHarmonicAxis + 1).fill(0.0);

      coeffs.forEach(({ n, amp }) => {
        if (n <= maxHarmonicAxis) coeffMap[n] = Math.abs(amp);
      });

      const paddingLeft = 35; const paddingBottom = 22;
      const plotWidth = width - paddingLeft - 15;
      const plotHeight = height - paddingBottom - 15;
      const maxY = state.amp * (4.0 / Math.PI) * 1.1;

      ctx.font = '9px var(--ff-mono)'; ctx.fillStyle = 'var(--text-dim)'; ctx.textAlign = 'right';
      ctx.fillText(maxY.toFixed(2), paddingLeft - 5, 15);
      ctx.fillText('0.0', paddingLeft - 5, height - paddingBottom);

      const numBars = maxHarmonicAxis;
      const barSpacing = plotWidth / numBars;
      const barWidth = Math.max(barSpacing * 0.4, 3);

      for (let n = 1; n <= numBars; n++) {
        const mag = coeffMap[n];
        const barHeight = (mag / maxY) * plotHeight;
        const px = paddingLeft + (n - 0.5) * barSpacing;
        const py = (height - paddingBottom) - barHeight;
        const isLatest = (n === latestHarmonic.n);

        ctx.beginPath();
        ctx.strokeStyle = isLatest ? '#34d399' : (mag > 0 ? 'rgba(158,122,255,0.7)' : 'rgba(255,255,255,0.08)');
        ctx.lineWidth = barWidth;
        ctx.moveTo(px, height - paddingBottom); ctx.lineTo(px, py); ctx.stroke();

        if (mag > 0) {
          ctx.beginPath(); ctx.fillStyle = isLatest ? '#34d399' : '#e879f9';
          ctx.arc(px, py, isLatest ? 4 : 2.5, 0, 2 * Math.PI); ctx.fill();
        }

        if (n === 1 || n % 5 === 0 || n === highestHarmonic) {
          ctx.font = '9px var(--ff-mono)'; ctx.fillStyle = isLatest ? '#34d399' : 'var(--text-dim)'; ctx.textAlign = 'center';
          ctx.fillText(`n=${n}`, px, height - 6);
        }
      }
    }

    function startBuildAnimation() {
      stopBuildAnimation();
      state.isAnimating = true;
      updateAnimButtons();
      const delayMs = Math.max(100, 1000 - state.buildSpeed * 90);

      animBuildInterval = setInterval(() => {
        if (state.nTerms < 25) {
          state.nTerms++;
          const elInputN = document.getElementById('f-input-n');
          if (elInputN) elInputN.value = state.nTerms;
          updateMathMetrics();
        } else { stopBuildAnimation(); }
      }, delayMs);
    }

    function stopBuildAnimation() {
      if (animBuildInterval) { clearInterval(animBuildInterval); animBuildInterval = null; }
      state.isAnimating = false;
      updateAnimButtons();
    }

    function updateAnimButtons() {
      const btnPlay = document.getElementById('f-btn-play-anim');
      const btnPause = document.getElementById('f-btn-pause-anim');
      if (btnPlay) btnPlay.classList.toggle('active', state.isAnimating);
      if (btnPause) btnPause.classList.toggle('active', !state.isAnimating);
    }

    function bindEvents() {
      bindSelect('f-select-shape', (val) => { state.shape = val; updateMathMetrics(); if (state.isPlayingAudio) startAudio(); });
      bindInput('f-input-f0', (val) => { state.f0 = parseFloat(val); updateMathMetrics(); if (state.isPlayingAudio) startAudio(); });
      bindInput('f-input-amp', (val) => { state.amp = parseFloat(val); updateMathMetrics(); if (state.isPlayingAudio) startAudio(); });
      bindInput('f-input-n', (val) => { state.nTerms = parseInt(val, 10); updateMathMetrics(); if (state.isPlayingAudio) startAudio(); });
      bindInput('f-input-speed', (val) => { state.buildSpeed = parseInt(val, 10); updateMathMetrics(); });
      bindInput('f-input-time-window', (val) => { state.timeWindowMs = parseFloat(val); updateMathMetrics(); });

      const btnPlayAnim = document.getElementById('f-btn-play-anim');
      const btnPauseAnim = document.getElementById('f-btn-pause-anim');
      const btnResetN = document.getElementById('f-btn-reset-n');
      const btnPlayAudio = document.getElementById('f-btn-play-audio');

      if (btnPlayAnim) btnPlayAnim.addEventListener('click', startBuildAnimation);
      if (btnPauseAnim) btnPauseAnim.addEventListener('click', stopBuildAnimation);
      if (btnResetN) {
        btnResetN.addEventListener('click', () => {
          stopBuildAnimation(); state.nTerms = 1;
          const elN = document.getElementById('f-input-n');
          if (elN) elN.value = 1;
          updateMathMetrics();
        });
      }
      if (btnPlayAudio) {
        btnPlayAudio.addEventListener('click', () => {
          if (state.isPlayingAudio) stopAudio(); else startAudio();
        });
      }

      bindPreset('f-preset-sq5', 'square', 100, 5);
      bindPreset('f-preset-sq15', 'square', 100, 15);
      bindPreset('f-preset-saw10', 'sawtooth', 100, 10);
      bindPreset('f-preset-tri10', 'triangle', 100, 10);
      bindPreset('f-preset-gibbs', 'square', 100, 25);
    }

    function bindPreset(id, shapeVal, f0Val, nVal) {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.addEventListener('click', () => {
        stopBuildAnimation();
        state.shape = shapeVal; state.f0 = f0Val; state.nTerms = nVal;
        const elShape = document.getElementById('f-select-shape');
        const elF0 = document.getElementById('f-input-f0');
        const elN = document.getElementById('f-input-n');
        if (elShape) elShape.value = shapeVal;
        if (elF0) elF0.value = f0Val;
        if (elN) elN.value = nVal;
        updateMathMetrics();
        if (state.isPlayingAudio) startAudio();
      });
    }

    return {
      init: function () { bindEvents(); updateMathMetrics(); },
      render: render,
      stopAudio: stopAudio,
      getDSP: function () { return state.dsp; }
    };
  })();

  // =========================================================================
  // 7. LAB 4: CONVOLUTION & FILTERING ENGINE
  // =========================================================================
  const convolutionLab = (function () {
    const state = {
      mode: 'discrete',    // 'discrete' | 'continuous' | 'filter'
      presetX: 'tri',      // 'tri' | 'rect' | 'step' | 'noisy'
      presetH: 'rect',     // 'rect' | 'ma' | 'delta' | 'delay'

      // Discrete sequences
      x: [1, 2, 1],
      h: [1, 1],
      nIndex: 2,           // Shift index n for discrete convolution
      showMathProcess: true,

      // Continuous params
      tValue: 0.0,
      tRange: 5.0,

      isAnimating: false,
      dsp: PythonDSP.calculateConvolutionMetrics([1, 2, 1], [1, 1], 2)
    };

    let animShiftInterval = null;

    // ── Sequences Presets Definition ─────────────────────────────────
    const xPresets = {
      tri: [1, 2, 1],
      rect: [1, 1, 1, 1],
      step: [1, 1, 1, 1, 1],
      noisy: [1, 4, 2, 5, 3, 6, 2],
      custom: [1, 2, 1]
    };

    const hPresets = {
      rect: [1, 1],
      ma: [0.33, 0.33, 0.33],
      delta: [1],
      delay: [0, 0, 1]
    };

    // ── Math & Metrics Update via API Service ────────────────────────
    async function updateMathMetrics() {
      state.x = xPresets[state.presetX] || xPresets.tri;
      state.h = hPresets[state.presetH] || hPresets.rect;

      const Lx = state.x.length;
      const Lh = state.h.length;
      const Ly = Lx + Lh - 1;

      // Ensure nIndex is within range [0, Ly - 1]
      const sliderN = document.getElementById('c-input-n');
      if (sliderN) {
        sliderN.max = Math.max(Ly - 1, 0);
        if (state.nIndex >= Ly) {
          state.nIndex = Math.max(Ly - 1, 0);
          sliderN.value = state.nIndex;
        }
      }

      // Compute convolution via API service
      state.dsp = await SignalLabsAPI.calculateConvolution({
        x: state.x,
        h: state.h,
        n_index: state.nIndex,
        mode: state.mode
      });

      const dsp = state.dsp;
      const currentYVal = dsp.current_y;
      const mathStr = dsp.math_str;

      // DOM Elements
      const elMode = document.getElementById('c-metric-mode');
      const elModeSub = document.getElementById('c-metric-mode-sub');
      const elN = document.getElementById('c-metric-n');
      const elNSub = document.getElementById('c-metric-n-sub');
      const elOverlap = document.getElementById('c-metric-overlap');
      const elYVal = document.getElementById('c-metric-yval');
      const elLength = document.getElementById('c-metric-length');
      const elEqText = document.getElementById('c-equation-text');

      if (elMode) elMode.textContent = state.mode === 'discrete' ? 'Discrete [n]' : (state.mode === 'continuous' ? 'Continuous (t)' : 'Filter Demo');
      if (elModeSub) elModeSub.textContent = state.mode === 'continuous' ? 'y(t) = ∫ x(τ)h(t-τ)dτ' : 'y[n] = Σ x[k]h[n-k]';

      if (elN) elN.textContent = state.mode === 'continuous' ? `t = ${state.tValue.toFixed(2)}` : `n = ${state.nIndex}`;
      if (elNSub) elNSub.textContent = state.mode === 'continuous' ? 'Shift time t' : 'Shift index n';

      if (elOverlap) elOverlap.textContent = `${dsp.overlap_count} Terms`;
      if (elYVal) elYVal.textContent = state.mode === 'continuous' ? `y(t) = ${currentYVal.toFixed(2)}` : `y[${state.nIndex}] = ${currentYVal}`;
      if (elLength) elLength.textContent = `Output Length L_y = ${Ly}`;
      if (elEqText) elEqText.textContent = mathStr;

      // Controls readouts
      const elReadoutMode = document.getElementById('c-readout-mode');
      const elValN = document.getElementById('c-val-n');
      if (elReadoutMode) elReadoutMode.textContent = state.mode === 'discrete' ? 'Discrete y[n]' : (state.mode === 'continuous' ? 'Continuous y(t)' : 'Filter Demo');
      if (elValN) elValN.textContent = state.mode === 'continuous' ? `t = ${state.tValue.toFixed(2)}` : `n = ${state.nIndex}`;

      // Subtitles
      const elScope1Sub = document.getElementById('c-scope1-sub');
      const elScope2Sub = document.getElementById('c-scope2-sub');
      const elScope3Sub = document.getElementById('c-scope3-sub');
      const elScope4Sub = document.getElementById('c-scope4-sub');

      if (elScope1Sub) elScope1Sub.textContent = `Input Signal x[k] · Length L_x = ${Lx} · x = [${state.x.join(', ')}]`;
      if (elScope2Sub) elScope2Sub.textContent = `Flipped & Shifted Filter h[${state.nIndex}−k] · Filter h = [${state.h.join(', ')}]`;
      if (elScope3Sub) elScope3Sub.textContent = `Overlap Products x[k] × h[${state.nIndex}−k] · Active Terms: ${dsp.overlap_count}`;
      if (elScope4Sub) elScope4Sub.textContent = `Convolution Output y[n] · Length L_y = ${Ly} · Active: y[${state.nIndex}] = ${currentYVal}`;
    }

    // ── Multi-View Oscilloscope Renderers ─────────────────────────────
    function render(now) {
      if (activeLabId !== 'convolution') return;

      const dspX = state.x;
      const dspH = state.h;
      const dspY = state.dsp?.y || PythonDSP.computeDiscreteConvolution(dspX, dspH);

      drawStemScope('canvas-c-x', dspX, 0, 'Input x[k]', '#ffb454');
      drawFlippedShiftedScope('canvas-c-hshift', dspH, dspX.length, state.nIndex, '#38bdf8');
      drawOverlapProductsScope('canvas-c-overlap', dspX, dspH, state.nIndex, '#34d399');
      drawStemScope('canvas-c-output', dspY, state.nIndex, 'Output y[n]', '#34d399');
    }

    function drawStemScope(canvasId, sequence, activeIdx, labelStr, strokeColor) {
      const canvas = document.getElementById(canvasId);
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const width = canvas.parentElement.clientWidth;
      const height = canvas.parentElement.clientHeight;
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }

      ctx.clearRect(0, 0, width, height);
      drawGrid(ctx, width, height);

      const midY = height / 2;
      const maxVal = Math.max(...sequence.map(v => Math.abs(v)), 1.0);
      const scaleY = (height / 2 - 15) / maxVal;

      const numSamples = Math.max(sequence.length, 6);
      const paddingLeft = 40;
      const paddingRight = 20;
      const plotWidth = width - paddingLeft - paddingRight;
      const spacing = plotWidth / (numSamples > 1 ? numSamples - 1 : 1);

      for (let k = 0; k < sequence.length; k++) {
        const val = sequence[k];
        const px = paddingLeft + k * spacing;
        const py = midY - val * scaleY;
        const isActive = (k === activeIdx);

        // Vertical stem line
        ctx.beginPath();
        ctx.strokeStyle = isActive ? '#34d399' : strokeColor;
        ctx.lineWidth = isActive ? 2.5 : 1.8;
        ctx.moveTo(px, midY);
        ctx.lineTo(px, py);
        ctx.stroke();

        // Sample Dot
        ctx.beginPath();
        ctx.fillStyle = isActive ? '#34d399' : strokeColor;
        ctx.arc(px, py, isActive ? 5 : 3.5, 0, 2 * Math.PI);
        ctx.fill();
        if (isActive) {
          ctx.shadowColor = '#34d399';
          ctx.shadowBlur = 10;
          ctx.stroke();
          ctx.shadowBlur = 0;
        }

        // Value label above dot
        ctx.font = isActive ? '700 10px var(--ff-mono)' : '9px var(--ff-mono)';
        ctx.fillStyle = isActive ? '#34d399' : 'var(--text-mid)';
        ctx.textAlign = 'center';
        ctx.fillText(val.toString(), px, py - (val >= 0 ? 8 : -14));

        // Index label under axis
        ctx.font = '9px var(--ff-mono)';
        ctx.fillStyle = 'var(--text-dim)';
        ctx.fillText(`k=${k}`, px, height - 6);
      }
    }

    function drawFlippedShiftedScope(canvasId, hSeq, Lx, nIndex, strokeColor) {
      const canvas = document.getElementById(canvasId);
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const width = canvas.parentElement.clientWidth;
      const height = canvas.parentElement.clientHeight;
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }

      ctx.clearRect(0, 0, width, height);
      drawGrid(ctx, width, height);

      const midY = height / 2;
      const maxVal = Math.max(...hSeq.map(v => Math.abs(v)), 1.0);
      const scaleY = (height / 2 - 15) / maxVal;

      const numSamples = Math.max(Lx + hSeq.length - 1, 6);
      const paddingLeft = 40;
      const paddingRight = 20;
      const plotWidth = width - paddingLeft - paddingRight;
      const spacing = plotWidth / (numSamples > 1 ? numSamples - 1 : 1);

      // Shifted flipped h[n-k] values for k in range [0, Lx-1]
      for (let k = 0; k < numSamples; k++) {
        const hIdx = nIndex - k;
        const val = (hIdx >= 0 && hIdx < hSeq.length) ? hSeq[hIdx] : 0;
        const px = paddingLeft + k * spacing;
        const py = midY - val * scaleY;
        const isOverlap = (hIdx >= 0 && hIdx < hSeq.length && k < Lx);

        ctx.beginPath();
        ctx.strokeStyle = isOverlap ? '#e879f9' : (val !== 0 ? strokeColor : 'rgba(255,255,255,0.08)');
        ctx.lineWidth = isOverlap ? 2.5 : 1.5;
        ctx.moveTo(px, midY);
        ctx.lineTo(px, py);
        ctx.stroke();

        if (val !== 0) {
          ctx.beginPath();
          ctx.fillStyle = isOverlap ? '#e879f9' : strokeColor;
          ctx.arc(px, py, isOverlap ? 4.5 : 3, 0, 2 * Math.PI);
          ctx.fill();

          ctx.font = '9px var(--ff-mono)';
          ctx.fillStyle = isOverlap ? '#e879f9' : 'var(--text-mid)';
          ctx.textAlign = 'center';
          ctx.fillText(`h[${hIdx}]=${val}`, px, py - (val >= 0 ? 8 : -14));
        }

        ctx.font = '9px var(--ff-mono)';
        ctx.fillStyle = 'var(--text-dim)';
        ctx.textAlign = 'center';
        ctx.fillText(`k=${k}`, px, height - 6);
      }
    }

    function drawOverlapProductsScope(canvasId, xSeq, hSeq, nIndex) {
      const canvas = document.getElementById(canvasId);
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const width = canvas.parentElement.clientWidth;
      const height = canvas.parentElement.clientHeight;
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }

      ctx.clearRect(0, 0, width, height);
      drawGrid(ctx, width, height);

      const midY = height / 2;
      const numSamples = Math.max(xSeq.length + hSeq.length - 1, 6);
      const paddingLeft = 40;
      const paddingRight = 20;
      const plotWidth = width - paddingLeft - paddingRight;
      const spacing = plotWidth / (numSamples > 1 ? numSamples - 1 : 1);

      let maxProd = 1.0;
      const prods = [];
      for (let k = 0; k < numSamples; k++) {
        const valX = k < xSeq.length ? xSeq[k] : 0;
        const hIdx = nIndex - k;
        const valH = (hIdx >= 0 && hIdx < hSeq.length) ? hSeq[hIdx] : 0;
        const p = valX * valH;
        prods.push(p);
        if (Math.abs(p) > maxProd) maxProd = Math.abs(p);
      }

      const scaleY = (height / 2 - 15) / maxProd;

      for (let k = 0; k < numSamples; k++) {
        const p = prods[k];
        const px = paddingLeft + k * spacing;
        const py = midY - p * scaleY;
        const isNonZero = Math.abs(p) > 0.0001;

        ctx.beginPath();
        ctx.strokeStyle = isNonZero ? '#34d399' : 'rgba(255,255,255,0.08)';
        ctx.lineWidth = isNonZero ? 2.5 : 1.0;
        ctx.moveTo(px, midY);
        ctx.lineTo(px, py);
        ctx.stroke();

        if (isNonZero) {
          ctx.beginPath();
          ctx.fillStyle = '#34d399';
          ctx.arc(px, py, 4.5, 0, 2 * Math.PI);
          ctx.fill();
          ctx.shadowColor = '#34d399';
          ctx.shadowBlur = 8;
          ctx.stroke();
          ctx.shadowBlur = 0;

          ctx.font = '700 9.5px var(--ff-mono)';
          ctx.fillStyle = '#34d399';
          ctx.textAlign = 'center';
          ctx.fillText(`+${p}`, px, py - (p >= 0 ? 8 : -14));
        }

        ctx.font = '9px var(--ff-mono)';
        ctx.fillStyle = 'var(--text-dim)';
        ctx.textAlign = 'center';
        ctx.fillText(`k=${k}`, px, height - 6);
      }
    }

    // ── Shift Animation Controls ─────────────────────────────────────
    function startShiftAnimation() {
      stopShiftAnimation();
      state.isAnimating = true;
      updateAnimButtons();

      const Ly = state.x.length + state.h.length - 1;

      animShiftInterval = setInterval(() => {
        if (state.nIndex < Ly - 1) {
          state.nIndex++;
        } else {
          state.nIndex = 0;
        }
        const elInputN = document.getElementById('c-input-n');
        if (elInputN) elInputN.value = state.nIndex;
        updateMathMetrics();
      }, 700);
    }

    function stopShiftAnimation() {
      if (animShiftInterval) {
        clearInterval(animShiftInterval);
        animShiftInterval = null;
      }
      state.isAnimating = false;
      updateAnimButtons();
    }

    function updateAnimButtons() {
      const btnPlay = document.getElementById('c-btn-play-anim');
      const btnPause = document.getElementById('c-btn-pause-anim');
      if (btnPlay) btnPlay.classList.toggle('active', state.isAnimating);
      if (btnPause) btnPause.classList.toggle('active', !state.isAnimating);
    }

    function bindEvents() {
      bindSelect('c-select-mode', (val) => { state.mode = val; updateMathMetrics(); });
      bindSelect('c-select-x', (val) => { state.presetX = val; updateMathMetrics(); });
      bindSelect('c-select-h', (val) => { state.presetH = val; updateMathMetrics(); });

      bindInput('c-input-n', (val) => { state.nIndex = parseInt(val, 10); updateMathMetrics(); });

      const btnPlayAnim = document.getElementById('c-btn-play-anim');
      const btnPauseAnim = document.getElementById('c-btn-pause-anim');
      const btnPrev = document.getElementById('c-btn-step-prev');
      const btnNext = document.getElementById('c-btn-step-next');

      if (btnPlayAnim) btnPlayAnim.addEventListener('click', startShiftAnimation);
      if (btnPauseAnim) btnPauseAnim.addEventListener('click', stopShiftAnimation);

      if (btnPrev) {
        btnPrev.addEventListener('click', () => {
          stopShiftAnimation();
          if (state.nIndex > 0) state.nIndex--;
          const elInputN = document.getElementById('c-input-n');
          if (elInputN) elInputN.value = state.nIndex;
          updateMathMetrics();
        });
      }

      if (btnNext) {
        btnNext.addEventListener('click', () => {
          stopShiftAnimation();
          const Ly = state.x.length + state.h.length - 1;
          if (state.nIndex < Ly - 1) state.nIndex++;
          const elInputN = document.getElementById('c-input-n');
          if (elInputN) elInputN.value = state.nIndex;
          updateMathMetrics();
        });
      }

      // Toggle Show Math Process
      const toggleProcess = document.getElementById('c-toggle-process');
      if (toggleProcess) {
        toggleProcess.addEventListener('change', (e) => {
          state.showMathProcess = e.target.checked;
          const scope2 = document.getElementById('canvas-c-hshift')?.parentElement?.parentElement;
          const scope3 = document.getElementById('canvas-c-overlap')?.parentElement?.parentElement;
          if (scope2) scope2.toggleAttribute('hidden', !state.showMathProcess);
          if (scope3) scope3.toggleAttribute('hidden', !state.showMathProcess);
        });
      }

      // Presets
      bindPreset('c-preset-pulse-tri', 'tri', 'rect', 2);
      bindPreset('c-preset-ma-smooth', 'noisy', 'ma', 3);
      bindPreset('c-preset-identity', 'tri', 'delta', 0);
      bindPreset('c-preset-rect-rect', 'rect', 'rect', 2);
      bindPreset('c-preset-step', 'step', 'rect', 2);
    }

    function bindPreset(id, xVal, hVal, defaultN) {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.addEventListener('click', () => {
        stopShiftAnimation();
        state.presetX = xVal; state.presetH = hVal; state.nIndex = defaultN;
        const elX = document.getElementById('c-select-x');
        const elH = document.getElementById('c-select-h');
        const elN = document.getElementById('c-input-n');
        if (elX) elX.value = xVal;
        if (elH) elH.value = hVal;
        if (elN) elN.value = defaultN;
        updateMathMetrics();
      });
    }

    return {
      init: function () { bindEvents(); updateMathMetrics(); },
      render: render,
      stopAudio: function () { stopShiftAnimation(); },
      getDSP: function () { return state.dsp; }
    };
  })();

  // =========================================================================
  // 8. COMMON UTILS & ANIMATION LOOP
  // =========================================================================
  function bindInput(id, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', (e) => fn(e.target.value));
  }

  function bindSelect(id, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', (e) => fn(e.target.value));
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

  let startTime = performance.now();
  let animFrameId = null;

  function globalLoop(now) {
    beatLab.render(now);
    samplingLab.render(now);
    fourierLab.render(now);
    convolutionLab.render(now);
    animFrameId = requestAnimationFrame(globalLoop);
  }

  // Init on DOM ready
  document.addEventListener('DOMContentLoaded', () => {
    initLabSwitcher();
    beatLab.init();
    samplingLab.init();
    fourierLab.init();
    convolutionLab.init();
    animFrameId = requestAnimationFrame(globalLoop);
  });

  window.addEventListener('beforeunload', () => {
    beatLab.stopAudio();
    samplingLab.stopAudio();
    fourierLab.stopAudio();
    convolutionLab.stopAudio();
    if (animFrameId) cancelAnimationFrame(animFrameId);
  });

})();
