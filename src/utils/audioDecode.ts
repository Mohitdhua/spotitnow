import { isStoredAudioAssetSource, loadAudioAssetBlob } from '../services/audioAssetStore';

export interface DecodedAudioAsset {
  sampleRate: number;
  channels: number;
  data: Float32Array;
  duration: number;
}

let decodeContext: AudioContext | null = null;

const getAudioContextConstructor = (): typeof AudioContext | null => {
  if (typeof window === 'undefined') return null;
  const legacyWindow = window as Window & { webkitAudioContext?: typeof AudioContext };
  return window.AudioContext ?? legacyWindow.webkitAudioContext ?? null;
};

const getDecodeContext = () => {
  if (decodeContext) return decodeContext;
  const AudioContextCtor = getAudioContextConstructor();
  if (!AudioContextCtor) return null;
  decodeContext = new AudioContextCtor({ sampleRate: 48_000 });
  return decodeContext;
};

const interleaveAudioBuffer = (buffer: AudioBuffer) => {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const interleaved = new Float32Array(frames * channels);
  for (let channel = 0; channel < channels; channel += 1) {
    const channelData = buffer.getChannelData(channel);
    for (let frame = 0; frame < frames; frame += 1) {
      interleaved[frame * channels + channel] = channelData[frame];
    }
  }
  return interleaved;
};

export const decodeAudioBufferFromSource = async (source: string): Promise<AudioBuffer | null> => {
  const context = getDecodeContext();
  if (!context) return null;

  try {
    let arrayBuffer: ArrayBuffer;
    if (isStoredAudioAssetSource(source)) {
      const blob = await loadAudioAssetBlob(source);
      if (!blob) return null;
      arrayBuffer = await blob.arrayBuffer();
    } else {
      const response = await fetch(source);
      arrayBuffer = await response.arrayBuffer();
    }
    return await context.decodeAudioData(arrayBuffer.slice(0));
  } catch {
    return null;
  }
};

export const decodeAudioAssetFromSource = async (source: string): Promise<DecodedAudioAsset | null> => {
  const buffer = await decodeAudioBufferFromSource(source);
  if (!buffer) return null;
  return {
    sampleRate: buffer.sampleRate,
    channels: buffer.numberOfChannels,
    data: interleaveAudioBuffer(buffer),
    duration: buffer.duration
  };
};

export const releaseDecodeContext = () => {
  if (decodeContext) {
    decodeContext.close();
    decodeContext = null;
  }
};
