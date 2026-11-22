"use strict";
/* Web Audio API によるレトロ風シンセSE（外部音声ファイル不要） */
const Sound = (() => {
  let ctx = null;
  let muted = localStorage.getItem("commandRpg_muted") === "1";
  function ac() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }
  function tone(freq, dur, type, vol, when = 0, slideTo = null) {
    if (muted) return;
    const a = ac(), t = a.currentTime + when;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(a.destination);
    o.start(t); o.stop(t + dur);
  }
  function noise(dur, vol, when = 0) {
    if (muted) return;
    const a = ac(), t = a.currentTime + when;
    const len = Math.max(1, Math.floor(a.sampleRate * dur));
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = a.createBufferSource(); src.buffer = buf;
    const g = a.createGain(); g.gain.value = vol;
    const f = a.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 1200;
    src.connect(f); f.connect(g); g.connect(a.destination);
    src.start(t);
  }
  const se = {
    cursor() { tone(880, 0.05, "square", 0.06); },
    confirm() { tone(660, 0.06, "square", 0.08); tone(990, 0.09, "square", 0.08, 0.06); },
    cancel() { tone(330, 0.08, "square", 0.07, 0, 220); },
    hit() { noise(0.12, 0.25); tone(180, 0.12, "sawtooth", 0.15, 0, 60); },
    critical() { noise(0.2, 0.3); [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.1, "square", 0.12, i * 0.05)); },
    playerHit() { tone(140, 0.15, "sawtooth", 0.15, 0, 70); noise(0.08, 0.15); },
    heal() { [523, 659, 784].forEach((f, i) => tone(f, 0.12, "triangle", 0.12, i * 0.08)); },
    flee() { tone(500, 0.2, "square", 0.08, 0, 1000); },
    victory() { [523, 523, 523, 659, 784, 1046].forEach((f, i) => tone(f, 0.14, "square", 0.1, i * 0.11)); },
    levelup() { [392, 523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.13, "square", 0.1, i * 0.09)); },
    save() { tone(784, 0.08, "triangle", 0.1); tone(1174, 0.12, "triangle", 0.1, 0.08); },
    encounter() { tone(110, 0.3, "sawtooth", 0.14, 0, 440); },
    spring() { [659, 784, 988].forEach((f, i) => tone(f, 0.15, "sine", 0.12, i * 0.1)); },
  };
  function blip(freq) {
    // キャラボイス風の短い音（文字送りに合わせて鳴らす）
    tone(freq * (0.94 + Math.random() * 0.12), 0.045, "triangle", 0.055);
  }
  return {
    se,
    blip,
    isMuted: () => muted,
    toggleMute() {
      muted = !muted;
      localStorage.setItem("commandRpg_muted", muted ? "1" : "0");
      return muted;
    },
    unlock() { if (!muted) ac(); },
  };
})();
