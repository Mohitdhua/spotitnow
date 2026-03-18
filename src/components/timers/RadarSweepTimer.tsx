import React from 'react';
import {
  describeArc,
  polarToCartesian,
  resolveDesignerTimerPalette,
  resolveDesignerTimerState,
  type DesignerTimerProps
} from '../../utils/timerPackShared';

export const RadarSweepTimer: React.FC<DesignerTimerProps> = (props) => {
  const state = resolveDesignerTimerState('radar_sweep', props);
  const palette = props.palette ?? resolveDesignerTimerPalette(undefined, state.isEndingSoon, state.remainingRatio);
  const center = state.width / 2;
  const ringWidth = Math.max(8, state.size * 0.11);
  const radius = center - ringWidth * 0.9;
  const arc = describeArc(center, center, radius, 0, 360 * state.remainingRatio || 0.001);
  const sweepAngle = state.elapsedRatio * 360;
  const sweepEnd = polarToCartesian(center, center, radius - ringWidth * 0.25, sweepAngle);

  return (
    <svg viewBox={`0 0 ${state.width} ${state.height}`} className={props.className} style={{ width: state.width, height: state.height }}>
      <circle cx={center} cy={center} r={radius + ringWidth * 0.4} fill={palette.background} stroke={palette.shell} strokeWidth="3" />
      <circle cx={center} cy={center} r={radius} fill="none" stroke={palette.track} strokeWidth={ringWidth} />
      {!state.isFinished && <path d={arc} fill="none" stroke={palette.accent} strokeWidth={ringWidth} strokeLinecap="round" />}
      <circle cx={center} cy={center} r={radius - ringWidth * 1.15} fill={palette.panel} stroke={palette.shellSoft} strokeWidth="2" />
      <line x1={center} y1={center} x2={sweepEnd.x} y2={sweepEnd.y} stroke={state.isEndingSoon ? palette.warning : palette.accentAlt} strokeWidth={Math.max(3, state.size * 0.05)} strokeLinecap="round" />
      <circle cx={center} cy={center} r={Math.max(4, state.size * 0.05)} fill={palette.accentAlt} />
      <text x={center} y={center + state.size * 0.05} textAnchor="middle" fontSize={state.size * 0.33} fontWeight={900} fill={palette.text} fontFamily='"Arial Black", "Segoe UI", sans-serif'>
        {state.numericLabel}
      </text>
    </svg>
  );
};
