import React from 'react';
import {
  polarToCartesian,
  resolveDesignerTimerPalette,
  resolveDesignerTimerState,
  type DesignerTimerProps
} from '../../utils/timerPackShared';

export const SegmentedTimer: React.FC<DesignerTimerProps> = (props) => {
  const state = resolveDesignerTimerState('segmented_timer', props);
  const palette = props.palette ?? resolveDesignerTimerPalette(undefined, state.isEndingSoon, state.remainingRatio);
  const segmentCount = 12;
  const activeSegments = Math.ceil(state.remainingRatio * segmentCount);
  const center = state.width / 2;
  const outerRadius = center - state.size * 0.08;
  const innerRadius = outerRadius - state.size * 0.16;

  return (
    <svg viewBox={`0 0 ${state.width} ${state.height}`} className={props.className} style={{ width: state.width, height: state.height }}>
      <circle cx={center} cy={center} r={outerRadius + state.size * 0.04} fill={palette.background} stroke={palette.shell} strokeWidth="3" />
      {Array.from({ length: segmentCount }, (_, index) => {
        const angle = -90 + (360 / segmentCount) * index;
        const start = polarToCartesian(center, center, innerRadius, angle);
        const end = polarToCartesian(center, center, outerRadius, angle);
        const isActive = index < activeSegments;
        return (
          <line
            key={index}
            x1={start.x}
            y1={start.y}
            x2={end.x}
            y2={end.y}
            stroke={isActive ? (state.isEndingSoon ? palette.warning : palette.accent) : palette.track}
            strokeWidth={Math.max(6, state.size * 0.08)}
            strokeLinecap="round"
          />
        );
      })}
      <circle cx={center} cy={center} r={innerRadius - state.size * 0.14} fill={palette.panel} stroke={palette.shellSoft} strokeWidth="2" />
      <text x={center} y={center + state.size * 0.04} textAnchor="middle" fontSize={state.size * 0.32} fontWeight={900} fill={palette.text} fontFamily='"Arial Black", "Segoe UI", sans-serif'>
        {state.numericLabel}
      </text>
    </svg>
  );
};
