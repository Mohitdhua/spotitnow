import React from 'react';
import {
  getEndingPulse,
  resolveDesignerTimerPalette,
  resolveDesignerTimerState,
  type DesignerTimerProps
} from '../../utils/timerPackShared';

export const WarningModeTimer: React.FC<DesignerTimerProps> = (props) => {
  const state = resolveDesignerTimerState('warning_mode', props);
  const palette = props.palette ?? resolveDesignerTimerPalette(undefined, state.isEndingSoon, state.remainingRatio);
  const fillWidth = (state.width - 6) * state.remainingRatio;
  const pulseScale = state.isEndingSoon ? getEndingPulse(state.remainingTime, 0.75) : 1;
  const warningTone = state.isEndingSoon ? palette.warning : palette.accent;

  return (
    <svg
      viewBox={`0 0 ${state.width} ${state.height}`}
      className={props.className}
      style={{ width: state.width, height: state.height, transform: `scale(${pulseScale})` }}
    >
      <rect x="1.5" y="1.5" width={state.width - 3} height={state.height - 3} rx={state.height * 0.2} fill={palette.background} stroke={palette.shell} strokeWidth={state.isEndingSoon ? 4 : 3} />
      <rect x="3" y={state.height - state.height * 0.2 - 3} width={fillWidth} height={state.height * 0.2} rx={state.height * 0.1} fill={warningTone} />
      <text x={state.width * 0.08} y={state.height * 0.28} textAnchor="start" fontSize={state.height * 0.13} fontWeight={900} fill={palette.mutedText} letterSpacing="0.18em" fontFamily='"Segoe UI", Arial, sans-serif'>
        TIME LEFT
      </text>
      <text x={state.width / 2} y={state.height * 0.68} textAnchor="middle" fontSize={state.height * 0.42} fontWeight={900} fill={palette.text} fontFamily='"Arial Black", "Segoe UI", sans-serif'>
        {state.secondsLabel}
      </text>
    </svg>
  );
};
