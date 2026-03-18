import React from 'react';
import {
  describeArc,
  getEndingPulse,
  resolveDesignerTimerPalette,
  resolveDesignerTimerState,
  type DesignerTimerProps
} from '../../utils/timerPackShared';

export const MagnifyingGlassTimer: React.FC<DesignerTimerProps> = (props) => {
  const state = resolveDesignerTimerState('magnify_timer', props);
  const palette = props.palette ?? resolveDesignerTimerPalette(undefined, state.isEndingSoon, state.remainingRatio);
  const lensSize = state.height * 0.82;
  const cx = lensSize / 2 + state.size * 0.04;
  const cy = lensSize / 2 + state.size * 0.06;
  const ringRadius = lensSize * 0.34;
  const ringWidth = Math.max(8, state.size * 0.11);
  const arc = describeArc(cx, cy, ringRadius, 0, 360 * state.remainingRatio || 0.001);
  const handleWidth = Math.max(14, state.size * 0.16);
  const handleHeight = Math.max(22, state.size * 0.34);
  const pulseScale = state.isEndingSoon ? getEndingPulse(state.remainingTime, 0.55) : 1;

  return (
    <svg
      viewBox={`0 0 ${state.width} ${state.height}`}
      className={props.className}
      style={{ width: state.width, height: state.height, overflow: 'visible', transform: `scale(${pulseScale})` }}
    >
      <g transform={`translate(${state.width - handleWidth * 2.3}, ${state.height - handleHeight * 1.35}) rotate(42)`}>
        <rect x="0" y="0" width={handleWidth} height={handleHeight} rx={handleWidth / 2} fill={palette.accentAlt} stroke={palette.shell} strokeWidth="3" />
      </g>
      <circle cx={cx} cy={cy} r={ringRadius + ringWidth * 0.5} fill={palette.background} stroke={palette.shell} strokeWidth="3" />
      <circle cx={cx} cy={cy} r={ringRadius} fill="none" stroke={palette.track} strokeWidth={ringWidth} />
      {!state.isFinished && <path d={arc} fill="none" stroke={state.isEndingSoon ? palette.warning : palette.accent} strokeWidth={ringWidth} strokeLinecap="round" />}
      <circle cx={cx} cy={cy} r={ringRadius - ringWidth * 0.85} fill={palette.panel} stroke={palette.shellSoft} strokeWidth="2" />
      <text x={cx} y={cy + state.size * 0.06} textAnchor="middle" fontSize={state.size * 0.34} fontWeight={900} fill={palette.text} fontFamily='"Arial Black", "Segoe UI", sans-serif'>
        {state.numericLabel}
      </text>
    </svg>
  );
};
