export type GameSoundCue = 'success' | 'error' | 'countdown' | 'win' | 'lose';

const STORAGE_KEY = 'spotdiff.game-audio-muted.v1';
const SILENT_GAIN = 0.0001;

type AudioContextConstructor = typeof AudioContext;

let audioContext: AudioContext | null = null;
let mutedCache: boolean | null = null;

const getAudioContextConstructor = (): AudioContextConstructor | null => {
  if (typeof window === 'undefined') return null;

  const legacyWindow = window as Window & {
    webkitAudioContext?: AudioContextConstructor;
  };
  const candidate = window.AudioContext ?? legacyWindow.webkitAudioContext;

  return candidate ?? null;
};

const getAudioContext = (): AudioContext | null => {
  if (typeof window === 'undefined') return null;

  if (audioContext && audioContext.state !== 'closed') {
    return audioContext;
  }

  const AudioContextCtor = getAudioContextConstructor();
  if (!AudioContextCtor) return null;

  audioContext = new AudioContextCtor();
  return audioContext;
};

const getMutedState = () => {
  if (mutedCache !== null) return mutedCache;
  if (typeof window === 'undefined') return false;

  mutedCache = window.localStorage.getItem(STORAGE_KEY) === '1';
  return mutedCache;
};

export const loadGameAudioMuted = () => getMutedState();

export const saveGameAudioMuted = (muted: boolean) => {
  mutedCache = muted;

  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, muted ? '1' : '0');
};

export const primeGameAudio = async () => {
  const context = getAudioContext();
  if (!context) return;

  if (context.state === 'suspended') {
    await context.resume();
  }
};

interface ToneOptions {
  startTime: number;
  duration: number;
  frequency: number;
  endFrequency?: number;
  volume?: number;
  type?: OscillatorType;
  attack?: number;
  detune?: number;
}

const playTone = (context: AudioContext, options: ToneOptions) => {
  const oscillator = context.createOscillator();
  const gainNode = context.createGain();
  const endFrequency = Math.max(1, options.endFrequency ?? options.frequency);
  const attack = Math.min(Math.max(options.attack ?? 0.012, 0.005), options.duration * 0.45);
  const peakGain = Math.max(SILENT_GAIN, options.volume ?? 0.06);

  oscillator.type = options.type ?? 'sine';
  oscillator.frequency.setValueAtTime(Math.max(1, options.frequency), options.startTime);
  oscillator.detune.setValueAtTime(options.detune ?? 0, options.startTime);

  if (endFrequency !== options.frequency) {
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, options.startTime + options.duration);
  }

  gainNode.gain.setValueAtTime(SILENT_GAIN, options.startTime);
  gainNode.gain.exponentialRampToValueAtTime(peakGain, options.startTime + attack);
  gainNode.gain.exponentialRampToValueAtTime(SILENT_GAIN, options.startTime + options.duration);

  oscillator.connect(gainNode);
  gainNode.connect(context.destination);

  oscillator.start(options.startTime);
  oscillator.stop(options.startTime + options.duration + 0.05);
};

const playSuccess = (context: AudioContext, startTime: number) => {
  playTone(context, { startTime, duration: 0.09, frequency: 660, endFrequency: 720, volume: 0.045, type: 'triangle' });
  playTone(context, { startTime: startTime + 0.08, duration: 0.14, frequency: 880, endFrequency: 1040, volume: 0.06, type: 'triangle' });
};

const playError = (context: AudioContext, startTime: number) => {
  playTone(context, { startTime, duration: 0.12, frequency: 230, endFrequency: 150, volume: 0.06, type: 'sawtooth', attack: 0.01 });
  playTone(context, { startTime: startTime + 0.04, duration: 0.1, frequency: 180, endFrequency: 110, volume: 0.035, type: 'square', attack: 0.008 });
};

const playCountdown = (context: AudioContext, startTime: number) => {
  playTone(context, { startTime, duration: 0.055, frequency: 1180, endFrequency: 960, volume: 0.028, type: 'square', attack: 0.006 });
};

const playWin = (context: AudioContext, startTime: number) => {
  playTone(context, { startTime, duration: 0.12, frequency: 523.25, volume: 0.04, type: 'triangle' });
  playTone(context, { startTime: startTime + 0.11, duration: 0.12, frequency: 659.25, volume: 0.045, type: 'triangle' });
  playTone(context, { startTime: startTime + 0.22, duration: 0.14, frequency: 783.99, volume: 0.05, type: 'triangle' });
  playTone(context, { startTime: startTime + 0.34, duration: 0.28, frequency: 1046.5, volume: 0.06, type: 'triangle' });
};

const playLose = (context: AudioContext, startTime: number) => {
  playTone(context, { startTime, duration: 0.14, frequency: 392, volume: 0.05, type: 'sawtooth' });
  playTone(context, { startTime: startTime + 0.12, duration: 0.16, frequency: 311.13, volume: 0.05, type: 'sawtooth' });
  playTone(context, { startTime: startTime + 0.26, duration: 0.24, frequency: 220, endFrequency: 164.81, volume: 0.055, type: 'sawtooth' });
};

const scheduleCue = (context: AudioContext, cue: GameSoundCue) => {
  const startTime = context.currentTime + 0.01;

  switch (cue) {
    case 'success':
      playSuccess(context, startTime);
      break;
    case 'error':
      playError(context, startTime);
      break;
    case 'countdown':
      playCountdown(context, startTime);
      break;
    case 'win':
      playWin(context, startTime);
      break;
    case 'lose':
      playLose(context, startTime);
      break;
  }
};

export const playGameSound = (cue: GameSoundCue) => {
  if (getMutedState()) return;

  const context = getAudioContext();
  if (!context) return;

  if (context.state === 'suspended') {
    void context.resume().then(() => {
      scheduleCue(context, cue);
    }).catch(() => {});
    return;
  }

  scheduleCue(context, cue);
};
