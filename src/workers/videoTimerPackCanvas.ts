import type { VisualTheme } from '../constants/videoThemes';
import {
  getEndingPulse,
  getTickPulse,
  polarToCartesian,
  resolveDesignerTimerPalette,
  resolveDesignerTimerState,
  type DesignerTimerStyleId
} from '../utils/timerPackShared';

export interface CanvasTimerRect {
  x: number;
  y: number;
  width: number;
  height: number;
  radius?: number;
}

interface DrawDesignerTimerPresetInput {
  ctx: CanvasRenderingContext2D;
  styleId: DesignerTimerStyleId;
  rect: CanvasTimerRect;
  durationSeconds: number;
  remainingSeconds: number;
  progress: number;
  isEndingSoon: boolean;
  visualTheme: VisualTheme;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const roundRectPath = (ctx: CanvasRenderingContext2D, rect: CanvasTimerRect) => {
  const radius = clamp(rect.radius ?? 0, 0, Math.min(rect.width, rect.height) / 2);
  ctx.beginPath();
  ctx.moveTo(rect.x + radius, rect.y);
  ctx.lineTo(rect.x + rect.width - radius, rect.y);
  ctx.quadraticCurveTo(rect.x + rect.width, rect.y, rect.x + rect.width, rect.y + radius);
  ctx.lineTo(rect.x + rect.width, rect.y + rect.height - radius);
  ctx.quadraticCurveTo(rect.x + rect.width, rect.y + rect.height, rect.x + rect.width - radius, rect.y + rect.height);
  ctx.lineTo(rect.x + radius, rect.y + rect.height);
  ctx.quadraticCurveTo(rect.x, rect.y + rect.height, rect.x, rect.y + rect.height - radius);
  ctx.lineTo(rect.x, rect.y + radius);
  ctx.quadraticCurveTo(rect.x, rect.y, rect.x + radius, rect.y);
  ctx.closePath();
};

const drawRoundRect = (
  ctx: CanvasRenderingContext2D,
  rect: CanvasTimerRect,
  options: {
    fill?: string;
    stroke?: string;
    lineWidth?: number;
  }
) => {
  roundRectPath(ctx, rect);
  if (options.fill) {
    ctx.fillStyle = options.fill;
    ctx.fill();
  }
  if (options.stroke && (options.lineWidth ?? 0) > 0) {
    ctx.lineWidth = options.lineWidth ?? 1;
    ctx.strokeStyle = options.stroke;
    ctx.stroke();
  }
};

const drawArc = (
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radius: number,
  ratio: number,
  color: string,
  lineWidth: number
) => {
  if (ratio <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio, false);
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
};

const fitTextSize = (
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  text: string,
  preferred: number,
  maxWidth: number,
  fontFamily: string,
  weight = 900
) => {
  let size = preferred;
  while (size > 8) {
    ctx.font = `${weight} ${size}px ${fontFamily}`;
    if (ctx.measureText(text).width <= maxWidth) {
      return size;
    }
    size -= 1;
  }
  return 8;
};

const drawCenteredText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  color: string,
  fontFamily: string,
  weight = 900
) => {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `${weight} ${fontSize}px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
  ctx.restore();
};

const drawCenteredStrokeText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  stroke: string,
  lineWidth: number,
  fontFamily: string,
  weight = 900
) => {
  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  ctx.font = `${weight} ${fontSize}px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeText(text, x, y);
  ctx.restore();
};

const drawCircularCountdownRing = (ctx: CanvasRenderingContext2D, rect: CanvasTimerRect, input: DrawDesignerTimerPresetInput) => {
  const state = resolveDesignerTimerState('countdown_ring', {
    duration: input.durationSeconds,
    remainingTime: input.remainingSeconds,
    progress: input.progress,
    isEndingSoon: input.isEndingSoon,
    size: Math.min(rect.width, rect.height)
  });
  const palette = resolveDesignerTimerPalette(input.visualTheme, state.isEndingSoon, state.remainingRatio);
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  const strokeWidth = Math.max(8, rect.height * 0.12);
  const radius = Math.min(rect.width, rect.height) / 2 - strokeWidth * 0.8;
  const pulse = state.isEndingSoon ? getEndingPulse(state.remainingTime, 0.8) : 1;
  const ringRadius = radius * pulse;
  ctx.save();
  ctx.shadowColor = palette.glow;
  ctx.shadowBlur = state.isEndingSoon ? 18 : 10;
  ctx.beginPath();
  ctx.arc(centerX, centerY, ringRadius + strokeWidth * 0.34, 0, Math.PI * 2);
  ctx.fillStyle = palette.background;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = palette.shell;
  ctx.stroke();
  ctx.restore();
  ctx.beginPath();
  ctx.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
  ctx.strokeStyle = palette.track;
  ctx.lineWidth = strokeWidth;
  ctx.stroke();
  drawArc(ctx, centerX, centerY, ringRadius, state.remainingRatio, state.isEndingSoon ? palette.warning : palette.accent, strokeWidth);
  ctx.beginPath();
  ctx.arc(centerX, centerY, ringRadius - strokeWidth * 0.82, 0, Math.PI * 2);
  ctx.fillStyle = palette.background;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = palette.shellSoft;
  ctx.stroke();
  drawCenteredText(ctx, state.numericLabel, centerX, centerY + rect.height * 0.03, rect.height * 0.34, palette.text, '"Arial Black", "Segoe UI", sans-serif');
  drawCenteredText(ctx, 'SECONDS', centerX, centerY + rect.height * 0.23, rect.height * 0.11, palette.mutedText, '"Segoe UI", Arial, sans-serif', 800);
};

const drawHollowTextDrain = (ctx: CanvasRenderingContext2D, rect: CanvasTimerRect, input: DrawDesignerTimerPresetInput) => {
  const state = resolveDesignerTimerState('hollow_drain', {
    duration: input.durationSeconds,
    remainingTime: input.remainingSeconds,
    progress: input.progress,
    isEndingSoon: input.isEndingSoon,
    size: rect.height
  });
  const palette = resolveDesignerTimerPalette(input.visualTheme, state.isEndingSoon, state.remainingRatio);
  drawRoundRect(ctx, { ...rect, radius: rect.height * 0.32 }, { fill: palette.background, stroke: palette.shell, lineWidth: 3 });
  const offscreen = new OffscreenCanvas(Math.max(1, Math.ceil(rect.width)), Math.max(1, Math.ceil(rect.height)));
  const offscreenCtx = offscreen.getContext('2d');
  if (!offscreenCtx) return;
  const fontSize = fitTextSize(offscreenCtx, state.secondsLabel, rect.height * 0.64, rect.width * 0.84, '"Arial Black", "Segoe UI", sans-serif');
  offscreenCtx.clearRect(0, 0, rect.width, rect.height);
  offscreenCtx.fillStyle = palette.empty;
  offscreenCtx.font = `900 ${fontSize}px "Arial Black", "Segoe UI", sans-serif`;
  offscreenCtx.textAlign = 'center';
  offscreenCtx.textBaseline = 'middle';
  offscreenCtx.fillText(state.secondsLabel, rect.width / 2, rect.height * 0.58);
  offscreenCtx.globalCompositeOperation = 'source-in';
  offscreenCtx.fillStyle = state.isEndingSoon ? palette.warning : palette.accent;
  offscreenCtx.fillRect(rect.width - rect.width * state.remainingRatio, 0, rect.width * state.remainingRatio, rect.height);
  ctx.drawImage(offscreen, rect.x, rect.y);
  drawCenteredStrokeText(
    ctx,
    state.secondsLabel,
    rect.x + rect.width / 2,
    rect.y + rect.height * 0.58,
    fontSize,
    palette.empty,
    Math.max(4, rect.height * 0.08),
    '"Arial Black", "Segoe UI", sans-serif'
  );
};

const drawPillProgress = (ctx: CanvasRenderingContext2D, rect: CanvasTimerRect, input: DrawDesignerTimerPresetInput) => {
  const state = resolveDesignerTimerState('pill_progress', {
    duration: input.durationSeconds,
    remainingTime: input.remainingSeconds,
    progress: input.progress,
    isEndingSoon: input.isEndingSoon,
    size: rect.height
  });
  const palette = resolveDesignerTimerPalette(input.visualTheme, state.isEndingSoon, state.remainingRatio);
  const pad = rect.height * 0.08;
  const innerHeight = rect.height - pad * 2;
  const fillWidth = Math.max(innerHeight, (rect.width - pad * 2) * state.remainingRatio);
  drawRoundRect(ctx, { ...rect, radius: rect.height / 2 }, { fill: palette.background, stroke: palette.shell, lineWidth: 3 });
  drawRoundRect(
    ctx,
    { x: rect.x + pad, y: rect.y + pad, width: rect.width - pad * 2, height: innerHeight, radius: innerHeight / 2 },
    { fill: palette.track }
  );
  if (!state.isFinished) {
    drawRoundRect(
      ctx,
      { x: rect.x + pad, y: rect.y + pad, width: fillWidth, height: innerHeight, radius: innerHeight / 2 },
      { fill: state.isEndingSoon ? palette.warning : palette.accent }
    );
  }
  const fontSize = fitTextSize(ctx, state.secondsLabel, rect.height * 0.46, rect.width * 0.72, '"Arial Black", "Segoe UI", sans-serif');
  drawCenteredText(ctx, state.secondsLabel, rect.x + rect.width / 2, rect.y + rect.height * 0.58, fontSize, palette.text, '"Arial Black", "Segoe UI", sans-serif');
};

const drawMagnifyTimer = (ctx: CanvasRenderingContext2D, rect: CanvasTimerRect, input: DrawDesignerTimerPresetInput) => {
  const state = resolveDesignerTimerState('magnify_timer', {
    duration: input.durationSeconds,
    remainingTime: input.remainingSeconds,
    progress: input.progress,
    isEndingSoon: input.isEndingSoon,
    size: rect.height
  });
  const palette = resolveDesignerTimerPalette(input.visualTheme, state.isEndingSoon, state.remainingRatio);
  const lensSize = rect.height * 0.82;
  const centerX = rect.x + lensSize / 2 + rect.height * 0.08;
  const centerY = rect.y + lensSize / 2 + rect.height * 0.08;
  const ringWidth = Math.max(8, rect.height * 0.11);
  const radius = lensSize * 0.34;
  ctx.save();
  ctx.translate(rect.x + rect.width - rect.height * 0.42, rect.y + rect.height - rect.height * 0.24);
  ctx.rotate((42 * Math.PI) / 180);
  drawRoundRect(
    ctx,
    { x: 0, y: 0, width: rect.height * 0.16, height: rect.height * 0.34, radius: rect.height * 0.08 },
    { fill: palette.accentAlt, stroke: palette.shell, lineWidth: 3 }
  );
  ctx.restore();
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius + ringWidth * 0.5, 0, Math.PI * 2);
  ctx.fillStyle = palette.background;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = palette.shell;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.strokeStyle = palette.track;
  ctx.lineWidth = ringWidth;
  ctx.stroke();
  drawArc(ctx, centerX, centerY, radius, state.remainingRatio, state.isEndingSoon ? palette.warning : palette.accent, ringWidth);
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius - ringWidth * 0.85, 0, Math.PI * 2);
  ctx.fillStyle = palette.panel;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = palette.shellSoft;
  ctx.stroke();
  drawCenteredText(ctx, state.numericLabel, centerX, centerY + rect.height * 0.03, rect.height * 0.26, palette.text, '"Arial Black", "Segoe UI", sans-serif');
};

const drawRadarSweep = (ctx: CanvasRenderingContext2D, rect: CanvasTimerRect, input: DrawDesignerTimerPresetInput) => {
  const state = resolveDesignerTimerState('radar_sweep', {
    duration: input.durationSeconds,
    remainingTime: input.remainingSeconds,
    progress: input.progress,
    isEndingSoon: input.isEndingSoon,
    size: Math.min(rect.width, rect.height)
  });
  const palette = resolveDesignerTimerPalette(input.visualTheme, state.isEndingSoon, state.remainingRatio);
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  const ringWidth = Math.max(7, rect.height * 0.11);
  const radius = Math.min(rect.width, rect.height) / 2 - ringWidth * 0.9;
  const sweepAngle = state.elapsedRatio * 360;
  const sweepEnd = polarToCartesian(centerX, centerY, radius - ringWidth * 0.2, sweepAngle);
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius + ringWidth * 0.4, 0, Math.PI * 2);
  ctx.fillStyle = palette.background;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = palette.shell;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.strokeStyle = palette.track;
  ctx.lineWidth = ringWidth;
  ctx.stroke();
  drawArc(ctx, centerX, centerY, radius, state.remainingRatio, palette.accent, ringWidth);
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius - ringWidth * 1.15, 0, Math.PI * 2);
  ctx.fillStyle = palette.panel;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = palette.shellSoft;
  ctx.stroke();
  ctx.save();
  ctx.strokeStyle = state.isEndingSoon ? palette.warning : palette.accentAlt;
  ctx.lineWidth = Math.max(3, rect.height * 0.04);
  ctx.beginPath();
  ctx.moveTo(centerX, centerY);
  ctx.lineTo(sweepEnd.x, sweepEnd.y);
  ctx.stroke();
  ctx.restore();
  ctx.beginPath();
  ctx.arc(centerX, centerY, Math.max(4, rect.height * 0.05), 0, Math.PI * 2);
  ctx.fillStyle = palette.accentAlt;
  ctx.fill();
  drawCenteredText(ctx, state.numericLabel, centerX, centerY + rect.height * 0.03, rect.height * 0.25, palette.text, '"Arial Black", "Segoe UI", sans-serif');
};

const drawFuseBurn = (ctx: CanvasRenderingContext2D, rect: CanvasTimerRect, input: DrawDesignerTimerPresetInput) => {
  const state = resolveDesignerTimerState('fuse_burn', {
    duration: input.durationSeconds,
    remainingTime: input.remainingSeconds,
    progress: input.progress,
    isEndingSoon: input.isEndingSoon,
    size: rect.height
  });
  const palette = resolveDesignerTimerPalette(input.visualTheme, state.isEndingSoon, state.remainingRatio);
  const lineStart = rect.x + rect.height * 0.95;
  const lineEnd = rect.x + rect.width - rect.height * 0.3;
  const sparkX = lineStart + (lineEnd - lineStart) * state.elapsedRatio;
  drawRoundRect(ctx, { ...rect, radius: rect.height * 0.48 }, { fill: palette.background, stroke: palette.shell, lineWidth: 3 });
  drawRoundRect(
    ctx,
    {
      x: rect.x + rect.height * 0.18,
      y: rect.y + rect.height * 0.16,
      width: rect.height * 0.95,
      height: rect.height * 0.68,
      radius: rect.height * 0.2
    },
    { fill: palette.panel, stroke: palette.shellSoft, lineWidth: 2 }
  );
  drawCenteredText(ctx, state.numericLabel, rect.x + rect.height * 0.66, rect.y + rect.height * 0.52, rect.height * 0.34, palette.text, '"Arial Black", "Segoe UI", sans-serif');
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(4, rect.height * 0.08);
  ctx.strokeStyle = '#312E81';
  ctx.beginPath();
  ctx.moveTo(lineStart, rect.y + rect.height / 2);
  ctx.lineTo(sparkX, rect.y + rect.height / 2);
  ctx.stroke();
  if (!state.isFinished) {
    ctx.strokeStyle = palette.accentAlt;
    ctx.beginPath();
    ctx.moveTo(sparkX, rect.y + rect.height / 2);
    ctx.lineTo(lineEnd, rect.y + rect.height / 2);
    ctx.stroke();
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(sparkX, rect.y + rect.height / 2, Math.max(7, rect.height * 0.11), 0, Math.PI * 2);
  ctx.fillStyle = state.isEndingSoon ? palette.warning : palette.spark;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = palette.shell;
  ctx.stroke();
  ctx.strokeStyle = palette.warningAlt;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(sparkX, rect.y + rect.height / 2 - rect.height * 0.22);
  ctx.lineTo(sparkX, rect.y + rect.height / 2 + rect.height * 0.22);
  ctx.moveTo(sparkX - rect.height * 0.16, rect.y + rect.height / 2);
  ctx.lineTo(sparkX + rect.height * 0.16, rect.y + rect.height / 2);
  ctx.stroke();
};

const drawBadgePop = (ctx: CanvasRenderingContext2D, rect: CanvasTimerRect, input: DrawDesignerTimerPresetInput) => {
  const state = resolveDesignerTimerState('badge_pop', {
    duration: input.durationSeconds,
    remainingTime: input.remainingSeconds,
    progress: input.progress,
    isEndingSoon: input.isEndingSoon,
    size: rect.height
  });
  const palette = resolveDesignerTimerPalette(input.visualTheme, state.isEndingSoon, state.remainingRatio);
  const scale = state.isEndingSoon ? getEndingPulse(state.remainingTime, 0.9) : getTickPulse(state.remainingTime, 0.9);
  ctx.save();
  ctx.translate(rect.x + rect.width / 2, rect.y + rect.height / 2);
  ctx.scale(scale, scale);
  ctx.translate(-(rect.x + rect.width / 2), -(rect.y + rect.height / 2));
  drawRoundRect(
    ctx,
    { x: rect.x + 3, y: rect.y + 7, width: rect.width - 6, height: rect.height - 14, radius: rect.height * 0.26 },
    { fill: state.isEndingSoon ? palette.warning : palette.accent, stroke: palette.shell, lineWidth: 4 }
  );
  drawRoundRect(
    ctx,
    { x: rect.x + rect.width * 0.17, y: rect.y, width: rect.width * 0.66, height: rect.height * 0.24, radius: rect.height * 0.1 },
    { fill: palette.empty, stroke: palette.shell, lineWidth: 3 }
  );
  drawCenteredText(ctx, 'TIMER', rect.x + rect.width / 2, rect.y + rect.height * 0.14, rect.height * 0.14, palette.shell, '"Segoe UI", Arial, sans-serif', 900);
  drawCenteredText(ctx, state.secondsLabel, rect.x + rect.width / 2, rect.y + rect.height * 0.62, rect.height * 0.34, palette.text, '"Arial Black", "Segoe UI", sans-serif');
  ctx.restore();
};

const drawDualRingPro = (ctx: CanvasRenderingContext2D, rect: CanvasTimerRect, input: DrawDesignerTimerPresetInput) => {
  const state = resolveDesignerTimerState('dual_ring_pro', {
    duration: input.durationSeconds,
    remainingTime: input.remainingSeconds,
    progress: input.progress,
    isEndingSoon: input.isEndingSoon,
    size: Math.min(rect.width, rect.height)
  });
  const palette = resolveDesignerTimerPalette(input.visualTheme, state.isEndingSoon, state.remainingRatio);
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  const outerRadius = Math.min(rect.width, rect.height) / 2 - rect.height * 0.08;
  const innerRadius = outerRadius - rect.height * 0.14;
  ctx.beginPath();
  ctx.arc(centerX, centerY, outerRadius, 0, Math.PI * 2);
  ctx.fillStyle = palette.background;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = palette.shell;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(centerX, centerY, outerRadius - rect.height * 0.03, 0, Math.PI * 2);
  ctx.strokeStyle = palette.glow;
  ctx.lineWidth = Math.max(4, rect.height * 0.06);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(centerX, centerY, innerRadius, 0, Math.PI * 2);
  ctx.strokeStyle = palette.track;
  ctx.lineWidth = Math.max(8, rect.height * 0.11);
  ctx.stroke();
  drawArc(ctx, centerX, centerY, innerRadius, state.remainingRatio, state.isEndingSoon ? palette.warning : palette.accent, Math.max(8, rect.height * 0.11));
  ctx.beginPath();
  ctx.arc(centerX, centerY, innerRadius - rect.height * 0.18, 0, Math.PI * 2);
  ctx.fillStyle = palette.panel;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = palette.shellSoft;
  ctx.stroke();
  drawCenteredText(ctx, state.numericLabel, centerX, centerY + rect.height * 0.03, rect.height * 0.26, palette.text, '"Arial Black", "Segoe UI", sans-serif');
};

const drawSegmentedTimer = (ctx: CanvasRenderingContext2D, rect: CanvasTimerRect, input: DrawDesignerTimerPresetInput) => {
  const state = resolveDesignerTimerState('segmented_timer', {
    duration: input.durationSeconds,
    remainingTime: input.remainingSeconds,
    progress: input.progress,
    isEndingSoon: input.isEndingSoon,
    size: Math.min(rect.width, rect.height)
  });
  const palette = resolveDesignerTimerPalette(input.visualTheme, state.isEndingSoon, state.remainingRatio);
  const segmentCount = 12;
  const activeSegments = Math.ceil(state.remainingRatio * segmentCount);
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  const outerRadius = Math.min(rect.width, rect.height) / 2 - rect.height * 0.08;
  const innerRadius = outerRadius - rect.height * 0.16;
  ctx.beginPath();
  ctx.arc(centerX, centerY, outerRadius + rect.height * 0.04, 0, Math.PI * 2);
  ctx.fillStyle = palette.background;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = palette.shell;
  ctx.stroke();
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(6, rect.height * 0.08);
  for (let index = 0; index < segmentCount; index += 1) {
    const angle = -90 + (360 / segmentCount) * index;
    const start = polarToCartesian(centerX, centerY, innerRadius, angle);
    const end = polarToCartesian(centerX, centerY, outerRadius, angle);
    ctx.strokeStyle = index < activeSegments
      ? (state.isEndingSoon ? palette.warning : palette.accent)
      : palette.track;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(centerX, centerY, innerRadius - rect.height * 0.14, 0, Math.PI * 2);
  ctx.fillStyle = palette.panel;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = palette.shellSoft;
  ctx.stroke();
  drawCenteredText(ctx, state.numericLabel, centerX, centerY + rect.height * 0.03, rect.height * 0.25, palette.text, '"Arial Black", "Segoe UI", sans-serif');
};

const drawWarningMode = (ctx: CanvasRenderingContext2D, rect: CanvasTimerRect, input: DrawDesignerTimerPresetInput) => {
  const state = resolveDesignerTimerState('warning_mode', {
    duration: input.durationSeconds,
    remainingTime: input.remainingSeconds,
    progress: input.progress,
    isEndingSoon: input.isEndingSoon,
    size: rect.height
  });
  const palette = resolveDesignerTimerPalette(input.visualTheme, state.isEndingSoon, state.remainingRatio);
  const warningTone = state.isEndingSoon ? palette.warning : palette.accent;
  const fillWidth = (rect.width - 6) * state.remainingRatio;
  const pulse = state.isEndingSoon ? getEndingPulse(state.remainingTime, 0.75) : 1;
  ctx.save();
  ctx.translate(rect.x + rect.width / 2, rect.y + rect.height / 2);
  ctx.scale(pulse, pulse);
  ctx.translate(-(rect.x + rect.width / 2), -(rect.y + rect.height / 2));
  drawRoundRect(
    ctx,
    { ...rect, radius: rect.height * 0.2 },
    { fill: palette.background, stroke: palette.shell, lineWidth: state.isEndingSoon ? 4 : 3 }
  );
  drawRoundRect(
    ctx,
    { x: rect.x + 3, y: rect.y + rect.height - rect.height * 0.2 - 3, width: fillWidth, height: rect.height * 0.2, radius: rect.height * 0.1 },
    { fill: warningTone }
  );
  ctx.restore();
  ctx.save();
  ctx.fillStyle = palette.mutedText;
  ctx.font = `900 ${Math.max(8, rect.height * 0.12)}px "Segoe UI", Arial, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('TIME LEFT', rect.x + rect.width * 0.08, rect.y + rect.height * 0.22);
  ctx.restore();
  drawCenteredText(ctx, state.secondsLabel, rect.x + rect.width / 2, rect.y + rect.height * 0.6, rect.height * 0.36, palette.text, '"Arial Black", "Segoe UI", sans-serif');
};

export const drawDesignerTimerPreset = ({
  ctx,
  styleId,
  rect,
  durationSeconds,
  remainingSeconds,
  progress,
  isEndingSoon,
  visualTheme
}: DrawDesignerTimerPresetInput) => {
  const input: DrawDesignerTimerPresetInput = {
    ctx,
    styleId,
    rect,
    durationSeconds,
    remainingSeconds,
    progress,
    isEndingSoon,
    visualTheme
  };

  switch (styleId) {
    case 'countdown_ring':
      drawCircularCountdownRing(ctx, rect, input);
      break;
    case 'hollow_drain':
      drawHollowTextDrain(ctx, rect, input);
      break;
    case 'pill_progress':
      drawPillProgress(ctx, rect, input);
      break;
    case 'magnify_timer':
      drawMagnifyTimer(ctx, rect, input);
      break;
    case 'radar_sweep':
      drawRadarSweep(ctx, rect, input);
      break;
    case 'fuse_burn':
      drawFuseBurn(ctx, rect, input);
      break;
    case 'badge_pop':
      drawBadgePop(ctx, rect, input);
      break;
    case 'dual_ring_pro':
      drawDualRingPro(ctx, rect, input);
      break;
    case 'segmented_timer':
      drawSegmentedTimer(ctx, rect, input);
      break;
    case 'warning_mode':
      drawWarningMode(ctx, rect, input);
      break;
    default:
      break;
  }
};
