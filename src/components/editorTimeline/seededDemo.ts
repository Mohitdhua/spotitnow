import type { EditorTimelineState } from './types';
import { createWaveformSeed } from './utils';

export const createSeededEditorTimeline = (): EditorTimelineState => ({
  duration: 42,
  markers: [
    { id: 'marker-intro', time: 4, label: 'Intro', color: '#60A5FA' },
    { id: 'marker-hook', time: 11.5, label: 'Hook', color: '#F97316' },
    { id: 'marker-reveal', time: 27, label: 'Reveal', color: '#34D399' }
  ],
  transitions: [
    { id: 'transition-1', trackId: 'video-main', at: 8.8, duration: 0.4, kind: 'crossfade', label: 'Crossfade' },
    { id: 'transition-2', trackId: 'video-broll', at: 15.6, duration: 0.25, kind: 'wipe', label: 'Wipe' },
    { id: 'transition-3', trackId: 'text-main', at: 19.5, duration: 0.2, kind: 'cut', label: 'Cut' }
  ],
  tracks: [
    {
      id: 'video-main',
      label: 'Video A',
      kind: 'video',
      order: 0,
      accepts: ['video'],
      clips: [
        {
          id: 'clip-video-main-1',
          trackId: 'video-main',
          type: 'video',
          label: 'Opening Puzzle Wide',
          subtitle: '1080p / 24fps',
          start: 0.5,
          duration: 8.3,
          sourceIn: 0,
          sourceOut: 8.3,
          color: '#2563EB',
          effects: [{ id: 'fx-main-color', label: 'Color Boost', tone: '#93C5FD' }],
          editable: true
        },
        {
          id: 'clip-video-main-2',
          trackId: 'video-main',
          type: 'video',
          label: 'Reveal Push-In',
          subtitle: '2 camera moves',
          start: 9.2,
          duration: 9.6,
          sourceIn: 1.4,
          sourceOut: 11,
          color: '#1D4ED8',
          editable: true
        }
      ]
    },
    {
      id: 'video-broll',
      label: 'Video B',
      kind: 'video',
      order: 1,
      accepts: ['video', 'overlay'],
      clips: [
        {
          id: 'clip-video-broll-1',
          trackId: 'video-broll',
          type: 'video',
          label: 'Phone Capture Insert',
          subtitle: 'B-roll',
          start: 5.5,
          duration: 10.1,
          sourceIn: 0.8,
          sourceOut: 10.9,
          color: '#0F766E',
          editable: true
        },
        {
          id: 'clip-overlay-broll-2',
          trackId: 'video-broll',
          type: 'overlay',
          label: 'Sticker Burst',
          subtitle: 'PNG overlay',
          start: 20.2,
          duration: 6,
          sourceIn: 0,
          sourceOut: 6,
          color: '#DB2777',
          editable: true
        }
      ]
    },
    {
      id: 'audio-music',
      label: 'Music',
      kind: 'audio',
      order: 2,
      accepts: ['audio'],
      allowOverlap: true,
      clips: [
        {
          id: 'clip-audio-music-1',
          trackId: 'audio-music',
          type: 'audio',
          label: 'Main Score',
          subtitle: 'Lo-fi pulse',
          start: 0,
          duration: 24,
          sourceIn: 0,
          sourceOut: 24,
          color: '#0EA5E9',
          waveform: createWaveformSeed('Main Score', 54),
          editable: true,
          allowOverlap: true
        }
      ]
    },
    {
      id: 'audio-voiceover',
      label: 'Voiceover',
      kind: 'audio',
      order: 3,
      accepts: ['audio'],
      allowOverlap: true,
      clips: [
        {
          id: 'clip-audio-voice-1',
          trackId: 'audio-voiceover',
          type: 'audio',
          label: 'Intro VO',
          subtitle: 'Hook line',
          start: 1.2,
          duration: 7,
          sourceIn: 0,
          sourceOut: 7,
          color: '#6366F1',
          waveform: createWaveformSeed('Intro VO', 30),
          editable: true,
          allowOverlap: true
        },
        {
          id: 'clip-audio-voice-2',
          trackId: 'audio-voiceover',
          type: 'audio',
          label: 'Reveal VO',
          subtitle: 'Call to action',
          start: 17.4,
          duration: 6.2,
          sourceIn: 0,
          sourceOut: 6.2,
          color: '#4F46E5',
          waveform: createWaveformSeed('Reveal VO', 28),
          editable: true,
          allowOverlap: true
        }
      ]
    },
    {
      id: 'text-main',
      label: 'Titles',
      kind: 'text',
      order: 4,
      accepts: ['text'],
      clips: [
        {
          id: 'clip-text-1',
          trackId: 'text-main',
          type: 'text',
          label: 'Find 3 Differences',
          subtitle: 'Main title',
          start: 0.8,
          duration: 6.5,
          sourceIn: 0,
          sourceOut: 6.5,
          color: '#F59E0B',
          editable: true
        },
        {
          id: 'clip-text-2',
          trackId: 'text-main',
          type: 'text',
          label: 'Replay + Subscribe',
          subtitle: 'Outro card',
          start: 28.4,
          duration: 8.5,
          sourceIn: 0,
          sourceOut: 8.5,
          color: '#FB7185',
          editable: true
        }
      ]
    },
    {
      id: 'effects-main',
      label: 'Effects',
      kind: 'effects',
      order: 5,
      accepts: ['effect'],
      clips: [
        {
          id: 'clip-effect-1',
          trackId: 'effects-main',
          type: 'effect',
          label: 'Punch Zoom',
          subtitle: 'Transform',
          start: 4.2,
          duration: 2.4,
          sourceIn: 0,
          sourceOut: 2.4,
          color: '#8B5CF6',
          editable: true
        },
        {
          id: 'clip-effect-2',
          trackId: 'effects-main',
          type: 'effect',
          label: 'Glow Badge',
          subtitle: 'Highlight',
          start: 13.8,
          duration: 4.1,
          sourceIn: 0,
          sourceOut: 4.1,
          color: '#A855F7',
          editable: true
        }
      ]
    }
  ]
});
