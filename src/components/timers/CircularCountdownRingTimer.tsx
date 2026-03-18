import React from 'react';
import {
  describeArc,
  getEndingPulse,
  resolveDesignerTimerPalette,
  resolveDesignerTimerState,
  type DesignerTimerProps
} from '../../utils/timerPackShared';

export const CircularCountdownRingTimer: React.FC<DesignerTimerProps> = (props) => {
  const state = resolveDesignerTimerState('countdown_ring', props);
  const palette = props.palette ?? resolveDesignerTimerPalette(undefined, state.isEndingSoon, state.remainingRatio);
  const strokeWidth = Math.max(10, state.size * 0.13);
  const center = state.width / 2;
  const radius = center - strokeWidth * 0.9;
  const progressArc = describeArc(center, center, radius, 0, 360 * state.remainingRatio || 0.001);
  const pulseScale = state.isEndingSoon ? getEndingPulse(state.remainingTime, 0.8) : 1;

  return (
    <svg
      viewBox={`0 0 ${state.width} ${state.height}`}
      className={props.className}
      style={{ width: state.width, height: state.height, overflow: 'visible', transform: `scale(${pulseScale})` }}
    >
      <circle cx={center} cy={center} r={radius + strokeWidth * 0.32} fill={palette.background} stroke={palette.shell} strokeWidth={3} />
      <circle cx={center} cy={center} r={radius} fill="none" stroke={palette.track} strokeWidth={strokeWidth} />
      {!state.isFinished && (
        <path d={progressArc} fill="none" stroke={palette.accent} strokeWidth={strokeWidth} strokeLinecap="round" />
      )}
      <circle cx={center} cy={center} r={radius - strokeWidth * 0.82} fill={palette.background} stroke={palette.shellSoft} strokeWidth={2} />
      <text x={center} y={center + state.size * 0.04} textAnchor="middle" fontSize={state.size * 0.44} fontWeight={900} fill={palette.text} fontFamily='"Arial Black", "Segoe UI", sans-serif'>
        {state.numericLabel}
      </text>
      <text x={center} y={center + state.size * 0.28} textAnchor="middle" fontSize={state.size * 0.14} fontWeight={800} fill={palette.mutedText} letterSpacing="0.22em" fontFamily='"Segoe UI", Arial, sans-serif'>
        SECONDS
      </text>
    </svg>
  );
};
