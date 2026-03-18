import React from 'react';
import {
  describeArc,
  resolveDesignerTimerPalette,
  resolveDesignerTimerState,
  type DesignerTimerProps
} from '../../utils/timerPackShared';

export const DualRingProTimer: React.FC<DesignerTimerProps> = (props) => {
  const state = resolveDesignerTimerState('dual_ring_pro', props);
  const palette = props.palette ?? resolveDesignerTimerPalette(undefined, state.isEndingSoon, state.remainingRatio);
  const center = state.width / 2;
  const outerRadius = center - state.size * 0.08;
  const innerRadius = outerRadius - state.size * 0.14;
  const progressArc = describeArc(center, center, innerRadius, 0, 360 * state.remainingRatio || 0.001);

  return (
    <svg viewBox={`0 0 ${state.width} ${state.height}`} className={props.className} style={{ width: state.width, height: state.height }}>
      <circle cx={center} cy={center} r={outerRadius} fill={palette.background} stroke={palette.shell} strokeWidth="3" />
      <circle cx={center} cy={center} r={outerRadius - state.size * 0.03} fill="none" stroke={palette.glow} strokeWidth={Math.max(4, state.size * 0.06)} />
      <circle cx={center} cy={center} r={innerRadius} fill="none" stroke={palette.track} strokeWidth={Math.max(8, state.size * 0.11)} />
      {!state.isFinished && (
        <path d={progressArc} fill="none" stroke={state.isEndingSoon ? palette.warning : palette.accent} strokeWidth={Math.max(8, state.size * 0.11)} strokeLinecap="round" />
      )}
      <circle cx={center} cy={center} r={innerRadius - state.size * 0.18} fill={palette.panel} stroke={palette.shellSoft} strokeWidth="2" />
      <text x={center} y={center + state.size * 0.04} textAnchor="middle" fontSize={state.size * 0.34} fontWeight={900} fill={palette.text} fontFamily='"Arial Black", "Segoe UI", sans-serif'>
        {state.numericLabel}
      </text>
    </svg>
  );
};
