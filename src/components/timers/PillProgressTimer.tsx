import React from 'react';
import {
  getEndingPulse,
  resolveDesignerTimerPalette,
  resolveDesignerTimerState,
  type DesignerTimerProps
} from '../../utils/timerPackShared';

export const PillProgressTimer: React.FC<DesignerTimerProps> = (props) => {
  const state = resolveDesignerTimerState('pill_progress', props);
  const palette = props.palette ?? resolveDesignerTimerPalette(undefined, state.isEndingSoon, state.remainingRatio);
  const pad = state.height * 0.08;
  const innerHeight = state.height - pad * 2;
  const fillWidth = Math.max(innerHeight, (state.width - pad * 2) * state.remainingRatio);
  const pulseScale = state.isEndingSoon ? getEndingPulse(state.remainingTime, 0.45) : 1;

  return (
    <svg
      viewBox={`0 0 ${state.width} ${state.height}`}
      className={props.className}
      style={{ width: state.width, height: state.height, transform: `scale(${pulseScale})` }}
    >
      <rect x="1.5" y="1.5" width={state.width - 3} height={state.height - 3} rx={state.height / 2} fill={palette.background} stroke={palette.shell} strokeWidth="3" />
      <rect x={pad} y={pad} width={state.width - pad * 2} height={innerHeight} rx={innerHeight / 2} fill={palette.track} />
      {!state.isFinished && (
        <rect
          x={pad}
          y={pad}
          width={fillWidth}
          height={innerHeight}
          rx={innerHeight / 2}
          fill={state.isEndingSoon ? palette.warning : palette.accent}
        />
      )}
      <text x={state.width / 2} y={state.height * 0.61} textAnchor="middle" fontSize={state.height * 0.46} fontWeight={900} fill={palette.text} fontFamily='"Arial Black", "Segoe UI", sans-serif'>
        {state.secondsLabel}
      </text>
    </svg>
  );
};
