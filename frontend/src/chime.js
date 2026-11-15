/** Alarm chime for new work orders, synthesised with Web Audio (no audio asset). Browsers need one user gesture first. */
let ctx;

export function unlockSound() {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  } catch { return false; }
}

export function chime() {
  if (!ctx || ctx.state !== 'running') return false;
  const start = ctx.currentTime;
  [[880, 0], [1318.5, 0.18], [880, 0.5], [1318.5, 0.68]].forEach(([freq, at]) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, start + at);
    gain.gain.exponentialRampToValueAtTime(0.25, start + at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + at + 0.45);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start + at);
    osc.stop(start + at + 0.5);
  });
  navigator.vibrate?.([200, 100, 200]);
  return true;
}
