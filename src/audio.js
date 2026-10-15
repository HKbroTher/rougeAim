// 极简 WebAudio 音效，不依赖任何素材文件。
let ctx = null;
let master = null;

export function initAudio(volume) {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  setVolume(volume);
}

export function setVolume(v) {
  if (master) master.gain.value = v;
}

function tone({ freq, freqEnd = freq, dur = 0.08, type = 'square', gain = 0.2, delay = 0 }) {
  if (!ctx) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export const sfx = {
  shot: () => tone({ freq: 180, freqEnd: 60, dur: 0.07, type: 'sawtooth', gain: 0.12 }),
  hit: () => tone({ freq: 900, dur: 0.04, type: 'square', gain: 0.08 }),
  headshot: () => {
    tone({ freq: 1400, dur: 0.05, type: 'square', gain: 0.1 });
    tone({ freq: 2000, dur: 0.06, type: 'triangle', gain: 0.08, delay: 0.03 });
  },
  kill: () => tone({ freq: 500, freqEnd: 1200, dur: 0.1, type: 'triangle', gain: 0.12 }),
  miss: () => tone({ freq: 120, freqEnd: 80, dur: 0.12, type: 'triangle', gain: 0.1 }),
  comboBreak: () => tone({ freq: 300, freqEnd: 90, dur: 0.25, type: 'sawtooth', gain: 0.12 }),
  hurt: () => tone({ freq: 140, freqEnd: 40, dur: 0.3, type: 'sawtooth', gain: 0.25 }),
  shield: () => tone({ freq: 700, freqEnd: 300, dur: 0.2, type: 'sine', gain: 0.2 }),
  focus: () => {
    tone({ freq: 400, freqEnd: 1600, dur: 0.35, type: 'sine', gain: 0.18 });
  },
  coin: () => tone({ freq: 1200, freqEnd: 1800, dur: 0.06, type: 'sine', gain: 0.1 }),
  buy: () => {
    tone({ freq: 800, dur: 0.06, type: 'sine', gain: 0.15 });
    tone({ freq: 1200, dur: 0.08, type: 'sine', gain: 0.15, delay: 0.06 });
  },
  deny: () => tone({ freq: 200, dur: 0.12, type: 'square', gain: 0.1 }),
};
