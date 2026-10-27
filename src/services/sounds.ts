// Aoze's sounds: synthesized with Web Audio (no files) except the welcome voice.
// Every function fails silently: a missing file or a blocked audio device must
// never get in the way of the app.
import { api, fileUrl } from "./api";

const WELCOME_URL = "/sounds/welcome.ogg";
/** Two completions closer than this make one sound. */
const COMPLETION_GAP_MS = 4000;

let ctx: AudioContext | null = null;
let reverb: ConvolverNode | null = null;
let lastCompletion = 0;

function audio(): AudioContext {
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Soft synthetic room: decaying stereo noise, built once. */
function room(c: AudioContext): ConvolverNode {
  if (reverb) return reverb;
  const seconds = 2.4;
  const buffer = c.createBuffer(2, Math.floor(c.sampleRate * seconds), c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3.2);
  }
  reverb = c.createConvolver();
  reverb.buffer = buffer;
  reverb.connect(c.destination);
  return reverb;
}

/** Linear 0-100 setting to a gentle gain curve. */
function gainOf(volume: number): number {
  const v = Math.max(0, Math.min(100, volume)) / 100;
  return v * v;
}

interface Note {
  freq: number;
  at: number;
  length: number;
  level: number;
  type?: OscillatorType;
}

function play(notes: Note[], volume: number, wet: number) {
  const c = audio();
  const out = c.createGain();
  out.gain.value = gainOf(volume);
  const tone = c.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 5200;
  tone.connect(out);
  out.connect(c.destination);
  const send = c.createGain();
  send.gain.value = wet;
  out.connect(send).connect(room(c));
  const now = c.currentTime + 0.02;
  let end = 0;
  for (const n of notes) {
    const osc = c.createOscillator();
    const env = c.createGain();
    osc.type = n.type ?? "sine";
    osc.frequency.value = n.freq;
    const t0 = now + n.at;
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(n.level, t0 + 0.025);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + n.length);
    osc.connect(env).connect(tone);
    osc.start(t0);
    osc.stop(t0 + n.length + 0.05);
    end = Math.max(end, n.at + n.length);
  }
  // Release the per-sound nodes after the reverb tail.
  setTimeout(() => out.disconnect(), (end + 3) * 1000);
}

/** Launch chime: two soft notes as the logo appears. */
export function playChime(volume: number) {
  try {
    play(
      [
        { freq: 880, at: 0, length: 1.0, level: 0.28 },
        { freq: 1318.5, at: 0.13, length: 1.3, level: 0.2 },
      ],
      volume,
      0.35,
    );
  } catch {
    /* no audio device */
  }
}

/**
 * End of a run: a slow, airy major-seventh arpeggio over a warm low note,
 * mostly reverb. At most one per few seconds, whatever the number of files.
 */
export function playCompletion(volume: number) {
  const now = Date.now();
  if (now - lastCompletion < COMPLETION_GAP_MS) return;
  lastCompletion = now;
  try {
    play(
      [
        { freq: 329.63, at: 0, length: 1.8, level: 0.12, type: "triangle" },
        { freq: 659.25, at: 0, length: 1.2, level: 0.22 },
        { freq: 830.61, at: 0.09, length: 1.2, level: 0.18 },
        { freq: 987.77, at: 0.18, length: 1.4, level: 0.16 },
        { freq: 1244.51, at: 0.3, length: 1.8, level: 0.1 },
      ],
      volume,
      0.6,
    );
  } catch {
    /* no audio device */
  }
}

/** In the bundled file, the voice stops here; the soft pad fades out just after. */
const WELCOME_VOICE_END_S = 3.72;

/**
 * "Welcome to Aoze… For aoxy, by zero." Resolves `leadS` seconds before the
 * spoken part is over (the end of the file for a custom sound), so a fade of
 * that length ends with the voice. Rejects if it cannot play. A
 * startup-sound.(mp3|ogg|wav) in the settings folder replaces it.
 */
export async function playWelcome(volume: number, leadS = 0): Promise<void> {
  const custom = await api.startupSound().catch(() => null);
  const el = new Audio(custom ? fileUrl(custom) : WELCOME_URL);
  el.volume = Math.min(1, gainOf(volume) * 1.6);
  await el.play();
  // A timer from the actual position: `timeupdate` only fires every ~250 ms.
  const end = custom ? (Number.isFinite(el.duration) ? el.duration : 0) : WELCOME_VOICE_END_S;
  await new Promise<void>((resolve) => {
    el.addEventListener("ended", () => resolve());
    el.addEventListener("error", () => resolve());
    if (end > 0) setTimeout(resolve, Math.max(0, (end - leadS - el.currentTime) * 1000));
  });
}

let tourVoice: HTMLAudioElement | null = null;

/**
 * The tutorial's chapter announcement ("Tutorial of clips"…), same voice as the
 * welcome. Replaces one still playing.
 */
export function playTourVoice(chapter: string, volume: number) {
  try {
    tourVoice?.pause();
    const el = new Audio(`/sounds/tour/${chapter}.ogg`);
    el.volume = Math.min(1, gainOf(volume) * 1.6);
    tourVoice = el;
    void el.play().catch(() => undefined);
  } catch {
    /* no audio device */
  }
}

export function stopTourVoice() {
  tourVoice?.pause();
  tourVoice = null;
}
