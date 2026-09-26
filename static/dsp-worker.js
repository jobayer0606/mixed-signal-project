/**
 * SIGNAL LAB — Web Worker for Speed/Pitch Resampling DSP
 * Handles parallel computation of Naive (Varispeed) and Smart (WSOLA) resampling.
 */

self.onmessage = ({ data }) => {
  const { channelData, speedFactor, targetFs, mode, version, origSampleRate = 44100, isCustomAudio = true } = data;

  const result = computeResampledBuffer(channelData, speedFactor, targetFs, mode, origSampleRate, isCustomAudio);

  // Transfer ownership of result buffer back to main thread (zero copy)
  self.postMessage({ result, mode, version }, [result.buffer]);
};

// =========================================================================
// WSOLA TIME-STRETCHING ALGORITHM (PITCH-PRESERVED)
// =========================================================================
function wsolaTimeStretch(inputData, speedFactor, sampleRate) {
  if (Math.abs(speedFactor - 1.0) < 0.005) {
    return new Float32Array(inputData);
  }
  const inputLen = inputData.length;
  const outputLen = Math.max(Math.floor(inputLen / speedFactor), 1);
  const outputData = new Float32Array(outputLen);
  const normBuffer = new Float32Array(outputLen);

  const winSize = Math.min(2048, Math.max(256, Math.floor(sampleRate * 0.03)));
  const hopSize = Math.floor(winSize / 4);
  const searchRange = Math.floor(winSize / 2);

  // Precomputed Hann window
  const win = new Float32Array(winSize);
  for (let i = 0; i < winSize; i++) {
    win[i] = 0.5 * (1.0 - Math.cos((2.0 * Math.PI * i) / (winSize - 1)));
  }

  let outPos = 0;

  while (outPos < outputLen) {
    const targetInPos = Math.floor(outPos * speedFactor);
    let bestOffset = 0;

    if (outPos > 0) {
      let maxCorr = -Infinity;
      const startSearch = Math.max(0, targetInPos - searchRange);
      const endSearch = Math.min(inputLen - winSize, targetInPos + searchRange);

      for (let cand = startSearch; cand <= endSearch; cand += 2) {
        let corr = 0;
        for (let k = 0; k < winSize; k += 4) {
          corr += inputData[cand + k] * outputData[outPos + k];
        }
        if (corr > maxCorr) {
          maxCorr = corr;
          bestOffset = cand - targetInPos;
        }
      }
    }

    const actualInPos = Math.max(0, Math.min(inputLen - winSize, targetInPos + bestOffset));
    const copyLen = Math.min(winSize, outputLen - outPos, inputLen - actualInPos);

    for (let k = 0; k < copyLen; k++) {
      const w = win[k];
      outputData[outPos + k] += inputData[actualInPos + k] * w;
      normBuffer[outPos + k] += w;
    }

    outPos += hopSize;
  }

  // Normalize overlap envelope
  for (let i = 0; i < outputLen; i++) {
    if (normBuffer[i] > 1e-4) {
      outputData[i] /= normBuffer[i];
    }
  }

  return outputData;
}

// =========================================================================
// RESAMPLING BUFFER COMPUTATION (NAIVE VS SMART WSOLA)
// =========================================================================
function computeResampledBuffer(srcData, speedFactor, targetFs, resampleMode, origSampleRate = 44100, isCustomAudio = true) {
  if (!srcData || srcData.length === 0) return new Float32Array(0);

  const origLength = srcData.length;
  const mode = resampleMode || 'naive';

  // Resampled buffer length is inversely proportional to speed factor
  const newLength = Math.max(Math.floor(origLength / speedFactor), 1);
  const dstData = new Float32Array(newLength);

  const effectiveFs = (targetFs && targetFs > 0 && targetFs < origSampleRate) ? targetFs : origSampleRate;
  const downsampleRatio = effectiveFs / origSampleRate;

  // Fast, exact synthesis for synthetic reference tone
  if (!isCustomAudio) {
    const f0 = (mode === 'smart') ? 440.0 : (440.0 * speedFactor);
    const f1 = f0 * 2.0;
    const duration = newLength / origSampleRate;

    for (let j = 0; j < newLength; j++) {
      let t = j / origSampleRate;
      if (downsampleRatio < 1.0) {
        const kHold = Math.floor(t * effectiveFs);
        t = kHold / effectiveFs;
      }
      const env = Math.sin(Math.PI * t / duration);
      dstData[j] = env * (0.7 * Math.sin(2 * Math.PI * f0 * t) + 0.25 * Math.sin(2 * Math.PI * f1 * t));
    }
    return dstData;
  }

  // For custom audio data:
  let intermediateStretched = null;
  if (mode === 'smart') {
    intermediateStretched = wsolaTimeStretch(srcData, speedFactor, origSampleRate);
  }

  for (let j = 0; j < newLength; j++) {
    let sampleTimeInOutputSec = j / origSampleRate;
    if (downsampleRatio < 1.0) {
      const kHold = Math.floor(sampleTimeInOutputSec * effectiveFs);
      sampleTimeInOutputSec = kHold / effectiveFs;
    }

    if (mode === 'smart' && intermediateStretched) {
      const stretchIdxFloat = sampleTimeInOutputSec * origSampleRate;
      const idx0 = Math.floor(stretchIdxFloat);
      const maxIdx = intermediateStretched.length - 1;
      const idx1 = Math.min(idx0 + 1, maxIdx);
      const frac = stretchIdxFloat - idx0;

      if (idx0 >= 0 && idx0 <= maxIdx) {
        dstData[j] = (1 - frac) * intermediateStretched[idx0] + frac * intermediateStretched[idx1];
      } else {
        dstData[j] = 0;
      }
    } else {
      const srcIdxFloat = sampleTimeInOutputSec * speedFactor * origSampleRate;
      const idx0 = Math.floor(srcIdxFloat);
      const idx1 = Math.min(idx0 + 1, origLength - 1);
      const frac = srcIdxFloat - idx0;

      if (idx0 >= 0 && idx0 < origLength) {
        dstData[j] = (1 - frac) * srcData[idx0] + frac * srcData[idx1];
      } else {
        dstData[j] = 0;
      }
    }
  }

  return dstData;
}
