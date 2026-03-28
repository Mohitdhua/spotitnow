import type { TextProgressEffectFrame } from './textProgressEffects';

type ProgressCanvasContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export const drawTextProgressCanvasEffects = (
  ctx: ProgressCanvasContext,
  frame: TextProgressEffectFrame,
  fillX: number,
  fillWidth: number,
  height: number,
  baseAccentColor?: string | null
) => {
  if (fillWidth > 0 && height > 0 && baseAccentColor) {
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = baseAccentColor;
    ctx.fillRect(fillX, 0, fillWidth, height);
    ctx.restore();
  }

  frame.bands.forEach((band) => {
    if (band.opacity <= 0 || band.width <= 0 || band.height <= 0) return;
    ctx.save();
    ctx.translate(band.x, band.y);
    ctx.rotate((band.angle * Math.PI) / 180);
    ctx.globalAlpha = band.opacity;
    ctx.fillStyle = band.color;
    ctx.fillRect(-band.width / 2, -band.height / 2, band.width, band.height);
    ctx.restore();
  });

  frame.orbs.forEach((orb) => {
    if (orb.opacity <= 0 || orb.rx <= 0 || orb.ry <= 0) return;
    ctx.save();
    ctx.globalAlpha = orb.opacity;
    ctx.fillStyle = orb.color;
    ctx.beginPath();
    ctx.ellipse(orb.cx, orb.cy, orb.rx, orb.ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
};
