const fs = require('fs');

const html = fs.readFileSync('static/labs.html', 'utf8');
const js = fs.readFileSync('static/labs.js', 'utf8');

// Extract all IDs from HTML
const idRegex = /id=["']([^"']+)["']/g;
const allIds = new Set();
let match;
while ((match = idRegex.exec(html)) !== null) {
  allIds.add(match[1]);
}

console.log(`Found ${allIds.size} IDs in labs.html`);

// Create mock DOM
const elements = {};
allIds.forEach(id => {
  elements[id] = {
    id: id,
    value: '0',
    textContent: '',
    innerHTML: '',
    style: {},
    hidden: false,
    classList: {
      _classes: new Set(),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      toggle(c, force) {
        if (force === undefined) {
          if (this._classes.has(c)) this._classes.delete(c);
          else this._classes.add(c);
        } else if (force) {
          this._classes.add(c);
        } else {
          this._classes.delete(c);
        }
      },
      contains(c) { return this._classes.has(c); }
    },
    parentElement: {
      clientWidth: 800,
      clientHeight: 200
    },
    clientWidth: 800,
    clientHeight: 200,
    width: 800,
    height: 200,
    getContext(type) {
      return {
        clearRect() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        stroke() {},
        fill() {},
        arc() {},
        fillText() {},
        setLineDash() {},
        save() {},
        restore() {},
        translate() {},
        rotate() {},
        scale() {},
        createLinearGradient() {
          return {
            addColorStop() {}
          };
        },
        shadowColor: '',
        shadowBlur: 0,
        strokeStyle: '',
        fillStyle: '',
        lineWidth: 1
      };
    },
    querySelectorAll(selector) {
      if (selector === 'canvas') {
        const found = [];
        if (id.includes('canvas') || id.startsWith('fe-canvas') || id.startsWith('canvas-')) {
          found.push(this);
        }
        return found;
      }
      return [];
    },
    addEventListener(evt, fn) {
      this._listeners = this._listeners || {};
      this._listeners[evt] = this._listeners[evt] || [];
      this._listeners[evt].push(fn);
    },
    dispatchEvent(evt, data) {
      if (this._listeners && this._listeners[evt]) {
        this._listeners[evt].forEach(fn => fn(data || { target: this }));
      }
    },
    toggleAttribute(attr, force) {
      if (attr === 'hidden') this.hidden = force;
    }
  };
});

const eventListeners = {};

global.document = {
  getElementById(id) {
    if (!elements[id]) {
      console.warn('Unknown element ID requested:', id);
    }
    return elements[id] || null;
  },
  querySelectorAll(selector) {
    if (selector === '.lab-card') {
      return [
        elements['card-beat-freq'],
        elements['card-sampling'],
        elements['card-fourier'],
        elements['card-convolution'],
        elements['card-freq-explorer']
      ].filter(Boolean);
    }
    if (selector === '.lab-workspace') {
      return [
        elements['workspace-beat-freq'],
        elements['workspace-sampling'],
        elements['workspace-fourier'],
        elements['workspace-convolution'],
        elements['workspace-freq-explorer']
      ].filter(Boolean);
    }
    return [];
  },
  addEventListener(evt, fn) {
    eventListeners[evt] = eventListeners[evt] || [];
    eventListeners[evt].push(fn);
  }
};

global.window = {
  addEventListener(evt, fn) {
    eventListeners[evt] = eventListeners[evt] || [];
    eventListeners[evt].push(fn);
  },
  AudioContext: function() {
    return {
      currentTime: 0,
      state: 'running',
      createGain() { return { gain: { setValueAtTime() {}, setTargetAtTime() {} }, connect() {}, disconnect() {} }; },
      createOscillator() { return { frequency: { setValueAtTime() {}, setTargetAtTime() {} }, start() {}, stop() {}, connect() {}, disconnect() {} }; },
      createBuffer(channels, length, sampleRate) {
        return {
          length: length,
          sampleRate: sampleRate,
          numberOfChannels: channels,
          getChannelData() { return new Float32Array(length); }
        };
      },
      destination: {}
    };
  }
};

global.performance = {
  now() { return Date.now(); }
};

let rafCallbacks = [];
global.requestAnimationFrame = function(cb) {
  rafCallbacks.push(cb);
  return rafCallbacks.length;
};

global.cancelAnimationFrame = function() {};

global.fetch = async function() {
  return { ok: false };
};

try {
  console.log('Evaluating labs.js...');
  eval(js);
  console.log('labs.js evaluated successfully without syntax or immediate execution errors.');

  console.log('Firing DOMContentLoaded...');
  if (eventListeners['DOMContentLoaded']) {
    eventListeners['DOMContentLoaded'].forEach(fn => fn());
  }
  console.log('DOMContentLoaded executed successfully.');

  console.log('Processing RAF callbacks...');
  for (let i = 0; i < 5; i++) {
    const cbs = [...rafCallbacks];
    rafCallbacks = [];
    cbs.forEach(cb => cb(performance.now()));
  }

  console.log('Simulating card clicks...');
  ['card-sampling', 'card-fourier', 'card-convolution', 'card-freq-explorer', 'card-beat-freq'].forEach(cardId => {
    console.log(`Clicking ${cardId}...`);
    elements[cardId].dispatchEvent('click');
    // Run RAF
    const cbs = [...rafCallbacks];
    rafCallbacks = [];
    cbs.forEach(cb => cb(performance.now()));
  });

  console.log('ALL SIMULATION TESTS COMPLETED CLEANLY WITH NO ERRORS!');
} catch (err) {
  console.error('SIMULATION ERROR DETECTED:', err);
}
