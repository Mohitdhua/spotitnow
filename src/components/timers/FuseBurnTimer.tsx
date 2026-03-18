import React from 'react';
import {
  getEndingPulse,
  resolveDesignerTimerPalette,
  resolveDesignerTimerState,
  type DesignerTimerProps
} from '../../utils/timerPackShared';

export const FuseBurnTimer: React.FC<DesignerTimerProps> = (props) => {
  const state = resolveDesignerTimerState('fuse_burn', props);
  const palette = props.palette ?? resolveDesignerTimerPalette(undefined, state.isEndingSoon, state.remainingRatio);
  const lineStart = state.height * 0.95;
  const lineEnd = state.width - state.height * 0.3;
  const sparkX = lineStart + (lineEnd - lineStart) * state.elapsedRatio;
  const pulseScale = state.isEndingSoon ? getEndingPulse(state.remainingTime, 0.4) : 1;

  return (
    <svg viewBox={`0 0 ${state.width} ${state.height}`} className={props.className} style={{ width: state.width, height: state.height, transform: `scale(${pulseScale})` }}>
      <rect x="1.5" y="1.5" width={state.width - 3} height={state.height - 3} rx={state.height * 0.48} fill={palette.background} stroke={palette.shell} strokeWidth="3" />
      <rect x={state.height * 0.18} y={state.height * 0.16} width={state.height * 0.95} height={state.height * 0.68} rx={state.height * 0.2} fill={palette.panel} stroke={palette.shellSoft} strokeWidth="2" />
      <text x={state.height * 0.66} y={state.height * 0.58} textAnchor="middle" fontSize={state.height * 0.38} fontWeight={900} fill={palette.text} fontFamily='"Arial Black", "Segoe UI", sans-serif'>
        {state.numericLabel}
      </text>
      <line x1={lineStart} y1={state.height / 2} x2={sparkX} y2={state.height / 2} stroke="#312E81" strokeWidth={Math.max(4, state.height * 0.08)} strokeLinecap="round" />
      {!state.isFinished && <line x1={sparkX} y1={state.height / 2} x2={lineEnd} y2={state.height / 2} stroke={palette.accentAlt} strokeWidth={Math.max(4, state.height * 0.08)} strokeLinecap="round" />}
      <circle cx={sparkX} cy={state.height / 2} r={Math.max(7, state.height * 0.11)} fill={state.isEndingSoon ? palette.warning : palette.spark} stroke={palette.shell} strokeWidth="2" />
      <line x1={sparkX} y1={state.height / 2 - state.height * 0.22} x2={sparkX} y2={state.height / 2 + state.height * 0.22} stroke={palette.warningAlt} strokeWidth="2" />
      <line x1={sparkX - state.height * 0.16} y1={state.height / 2} x2={sparkX + state.height * 0.16} y2={state.height / 2} stroke={palette.warningAlt} strokeWidth="2" />
    </svg>
  );
};
