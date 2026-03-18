import React, { useId } from 'react';
import {
  resolveDesignerTimerPalette,
  resolveDesignerTimerState,
  type DesignerTimerProps
} from '../../utils/timerPackShared';

export const HollowTextDrainTimer: React.FC<DesignerTimerProps> = (props) => {
  const state = resolveDesignerTimerState('hollow_drain', props);
  const palette = props.palette ?? resolveDesignerTimerPalette(undefined, state.isEndingSoon, state.remainingRatio);
  const clipId = useId().replace(/:/g, '');
  const fontSize = state.height * 0.64;
  const fillWidth = state.width * state.remainingRatio;

  return (
    <svg
      viewBox={`0 0 ${state.width} ${state.height}`}
      className={props.className}
      style={{ width: state.width, height: state.height }}
    >
      <defs>
        <clipPath id={`hollow-drain-${clipId}`}>
          <text
            x={state.width / 2}
            y={state.height * 0.68}
            textAnchor="middle"
            fontSize={fontSize}
            fontWeight={900}
            letterSpacing="-0.04em"
            fontFamily='"Arial Black", "Segoe UI", sans-serif'
          >
            {state.secondsLabel}
          </text>
        </clipPath>
      </defs>

      <rect x="1.5" y="1.5" width={state.width - 3} height={state.height - 3} rx={state.height * 0.32} fill={palette.background} stroke={palette.shell} strokeWidth="3" />
      <rect
        x={state.width - fillWidth}
        y={0}
        width={fillWidth}
        height={state.height}
        fill={state.isEndingSoon ? palette.warning : palette.accent}
        clipPath={`url(#hollow-drain-${clipId})`}
      />
      <text
        x={state.width / 2}
        y={state.height * 0.68}
        textAnchor="middle"
        fontSize={fontSize}
        fontWeight={900}
        letterSpacing="-0.04em"
        fill="none"
        stroke={palette.empty}
        strokeWidth={Math.max(4, state.size * 0.08)}
        fontFamily='"Arial Black", "Segoe UI", sans-serif'
      >
        {state.secondsLabel}
      </text>
    </svg>
  );
};
