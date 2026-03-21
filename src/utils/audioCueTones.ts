export type AudioCueKind =
  | 'countdown'
  | 'reveal'
  | 'marker'
  | 'blink'
  | 'typewriter'
  | 'play'
  | 'intro'
  | 'transition'
  | 'outro';

export type AudioCueWaveform = 'sine' | 'triangle' | 'square' | 'sawtooth';

export interface AudioCueTone {
  startOffset: number;
  duration: number;
  frequency: number;
  endFrequency?: number;
  volume: number;
  type: AudioCueWaveform;
  attack?: number;
  release?: number;
  detune?: number;
}

export const buildCueTones = (kind: AudioCueKind): AudioCueTone[] => {
  switch (kind) {
    case 'reveal':
      return [
        {
          startOffset: 0,
          duration: 0.11,
          frequency: 392,
          endFrequency: 523.25,
          volume: 0.14,
          type: 'triangle',
          attack: 0.008,
          release: 0.08
        },
        {
          startOffset: 0.08,
          duration: 0.18,
          frequency: 659.25,
          endFrequency: 932.33,
          volume: 0.18,
          type: 'triangle',
          attack: 0.01,
          release: 0.12
        }
      ];
    case 'marker':
      return [
        {
          startOffset: 0,
          duration: 0.045,
          frequency: 1400,
          endFrequency: 1100,
          volume: 0.11,
          type: 'square',
          attack: 0.003,
          release: 0.035
        }
      ];
    case 'blink':
      return [
        {
          startOffset: 0,
          duration: 0.03,
          frequency: 980,
          endFrequency: 820,
          volume: 0.08,
          type: 'triangle',
          attack: 0.002,
          release: 0.02
        }
      ];
    case 'typewriter':
      return [
        {
          startOffset: 0,
          duration: 0.026,
          frequency: 1680,
          endFrequency: 1240,
          volume: 0.05,
          type: 'square',
          attack: 0.001,
          release: 0.022
        }
      ];
    case 'play':
      return [
        {
          startOffset: 0,
          duration: 0.09,
          frequency: 520,
          endFrequency: 720,
          volume: 0.14,
          type: 'triangle',
          attack: 0.006,
          release: 0.06
        }
      ];
    case 'intro':
      return [
        {
          startOffset: 0,
          duration: 0.12,
          frequency: 480,
          endFrequency: 620,
          volume: 0.16,
          type: 'triangle',
          attack: 0.01,
          release: 0.08
        }
      ];
    case 'transition':
      return [
        {
          startOffset: 0,
          duration: 0.06,
          frequency: 280,
          endFrequency: 180,
          volume: 0.08,
          type: 'sine',
          attack: 0.002,
          release: 0.05
        },
        {
          startOffset: 0.012,
          duration: 0.13,
          frequency: 420,
          endFrequency: 690,
          volume: 0.12,
          type: 'triangle',
          attack: 0.004,
          release: 0.1
        },
        {
          startOffset: 0.024,
          duration: 0.075,
          frequency: 860,
          endFrequency: 560,
          volume: 0.035,
          type: 'sine',
          attack: 0.003,
          release: 0.06
        }
      ];
    case 'outro':
      return [
        {
          startOffset: 0,
          duration: 0.14,
          frequency: 420,
          endFrequency: 300,
          volume: 0.15,
          type: 'triangle',
          attack: 0.01,
          release: 0.1
        }
      ];
    case 'countdown':
    default:
      return [
        {
          startOffset: 0,
          duration: 0.055,
          frequency: 1180,
          endFrequency: 960,
          volume: 0.12,
          type: 'square',
          attack: 0.004,
          release: 0.045
        }
      ];
  }
};
