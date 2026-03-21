import React from 'react';
import {
  getEndingPulse,
  getTickPulse,
  resolveDesignerTimerPalette,
  resolveDesignerTimerState,
  type DesignerTimerProps
} from '../../utils/timerPackShared';

export const BadgePopTimer: React.FC<DesignerTimerProps> = (props) => {
  const state = resolveDesignerTimerState('badge_pop', props);
  const palette = props.palette ?? resolveDesignerTimerPalette(undefined, state.isEndingSoon, state.remainingRatio);
  const popScale = state.isEndingSoon
    ? getEndingPulse(state.remainingTime, 0.9)
    : getTickPulse(state.remainingTime, 0.9);

  return (
    <svg
      viewBox={`0 0 ${state.width} ${state.height}`}
      className={props.className}
      style={{ width: state.width, height: state.height, overflow: 'visible', transform: `scale(${popScale})` }}
    >
      <rect x="3" y="7" width={state.width - 6} height={state.height - 14} rx={state.height * 0.26} fill={state.isEndingSoon ? palette.warning : palette.accent} stroke={palette.shell} strokeWidth="4" />
      <rect x={state.width * 0.17} y="0" width={state.width * 0.66} height={state.height * 0.24} rx={state.height * 0.1} fill={palette.empty} stroke={palette.shell} strokeWidth="3" />
      <text
        x={state.width / 2}
        y={state.height * 0.14}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={state.height * 0.16}
        fontWeight={900}
        fill={palette.shell}
        fontFamily='"Segoe UI", Arial, sans-serif'
      >
        TIMER
      </text>
      <text
        x={state.width / 2}
        y={state.height * 0.6}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={state.height * 0.42}
        fontWeight={900}
        fill={palette.text}
        fontFamily='"Arial Black", "Segoe UI", sans-serif'
      >
        {state.secondsLabel}
      </text>
    </svg>
  );
};
