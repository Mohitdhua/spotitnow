import type {
  GeneratedBackgroundPack,
  GeneratedBackgroundPaletteId,
  GeneratedBackgroundPattern,
  GeneratedBackgroundSceneKind,
  GeneratedBackgroundSpec,
  VideoSettings
} from '../types';
import { createRuntimeCanvas, getRuntimeCanvasContext, type RuntimeCanvas, type RuntimeCanvasContext } from './canvasRuntime';

type GeneratedPalette = {
  skyTop: string;
  skyBottom: string;
  glow: string;
  horizon: string;
  foreground: string;
  accent: string;
  accentSoft: string;
  detail: string;
  line: string;
};

interface GeneratedBackgroundPackOptions {
  name: string;
  description?: string;
  aspectRatio?: VideoSettings['aspectRatio'];
  count?: number;
  baseSeed?: number;
  sceneKinds?: GeneratedBackgroundSceneKind[];
  paletteIds?: GeneratedBackgroundPaletteId[];
}

interface DrawRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const DEFAULT_ASPECT_RATIO: VideoSettings['aspectRatio'] = '16:9';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const parseHex = (hex: string) => {
  const normalized =
    hex.length === 4
      ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
      : hex;
  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  return { r, g, b };
};

const toRgba = (hex: string, alpha: number) => {
  const { r, g, b } = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const createSeededRandom = (seed: number) => {
  let value = (Math.floor(seed) || 1) >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = Math.imul(value ^ (value >>> 15), value | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
};

const pick = <T,>(items: readonly T[], rng: () => number): T =>
  items[Math.floor(rng() * items.length) % items.length];

const gcd = (left: number, right: number): number => {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a || 1;
};

const stableHash = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const GENERATED_PALETTES: Record<GeneratedBackgroundPaletteId, GeneratedPalette> = {
  sunrise: {
    skyTop: '#FFD166',
    skyBottom: '#F77F99',
    glow: '#FFF1B0',
    horizon: '#F8C55F',
    foreground: '#E76F51',
    accent: '#4ECDC4',
    accentSoft: '#FFE8A3',
    detail: '#7A3B2E',
    line: '#432818'
  },
  mint: {
    skyTop: '#B8F2E6',
    skyBottom: '#7BD389',
    glow: '#E8FFF8',
    horizon: '#86EFAC',
    foreground: '#34D399',
    accent: '#0EA5E9',
    accentSoft: '#D1FAE5',
    detail: '#166534',
    line: '#0F3D2E'
  },
  midnight: {
    skyTop: '#0F172A',
    skyBottom: '#1D4ED8',
    glow: '#8B5CF6',
    horizon: '#172554',
    foreground: '#1E293B',
    accent: '#22D3EE',
    accentSoft: '#93C5FD',
    detail: '#E0F2FE',
    line: '#020617'
  },
  candy: {
    skyTop: '#FBCFE8',
    skyBottom: '#C4B5FD',
    glow: '#FFF0FA',
    horizon: '#F9A8D4',
    foreground: '#FB7185',
    accent: '#60A5FA',
    accentSoft: '#FCE7F3',
    detail: '#7C3AED',
    line: '#3B0764'
  },
  ocean: {
    skyTop: '#7DD3FC',
    skyBottom: '#38BDF8',
    glow: '#E0F2FE',
    horizon: '#0EA5E9',
    foreground: '#155E75',
    accent: '#22D3EE',
    accentSoft: '#BAE6FD',
    detail: '#083344',
    line: '#082F49'
  },
  amber: {
    skyTop: '#FDE68A',
    skyBottom: '#FB923C',
    glow: '#FFF7CC',
    horizon: '#F59E0B',
    foreground: '#B45309',
    accent: '#FEF3C7',
    accentSoft: '#FED7AA',
    detail: '#7C2D12',
    line: '#451A03'
  }
};

const DEFAULT_SCENE_KINDS: GeneratedBackgroundSceneKind[] = [
  'arcade',
  'studio',
  'forest',
  'city',
  'seaside',
  'dreamscape'
];

const DEFAULT_PALETTE_IDS: GeneratedBackgroundPaletteId[] = [
  'sunrise',
  'mint',
  'midnight',
  'candy',
  'ocean',
  'amber'
];

export const GENERATED_BACKGROUND_SCENE_OPTIONS: Array<{
  value: GeneratedBackgroundSceneKind;
  label: string;
  description: string;
}> = [
  { value: 'arcade', label: 'Arcade', description: 'Cabinet silhouettes, neon accents, and playful floor grids.' },
  { value: 'studio', label: 'Studio', description: 'Stage lights, clean panels, and production-floor geometry.' },
  { value: 'forest', label: 'Forest', description: 'Layered hills, trees, and airy outdoor color stacks.' },
  { value: 'city', label: 'City', description: 'Billboards, skyline blocks, and urban cartoon depth.' },
  { value: 'seaside', label: 'Seaside', description: 'Waves, boardwalk rhythm, and sunny vacation shapes.' },
  { value: 'dreamscape', label: 'Dreamscape', description: 'Floating islands, stars, and surreal playground color.' }
];

export const GENERATED_BACKGROUND_PALETTE_OPTIONS: Array<{
  value: GeneratedBackgroundPaletteId;
  label: string;
}> = [
  { value: 'sunrise', label: 'Sunrise' },
  { value: 'mint', label: 'Mint' },
  { value: 'midnight', label: 'Midnight' },
  { value: 'candy', label: 'Candy' },
  { value: 'ocean', label: 'Ocean' },
  { value: 'amber', label: 'Amber' }
];

const safePackCount = (count: number | undefined) => clamp(Math.floor(count || 100), 1, 100);

const createBackgroundId = (packName: string, index: number, seed: number) =>
  `${packName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'background-pack'}-${index + 1}-${seed}`;

const buildSpecName = (sceneKind: GeneratedBackgroundSceneKind, index: number) =>
  `${sceneKind.charAt(0).toUpperCase()}${sceneKind.slice(1)} ${String(index + 1).padStart(2, '0')}`;

const drawRoundedRect = (
  ctx: RuntimeCanvasContext,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) => {
  const safeRadius = clamp(radius, 0, Math.min(width, height) / 2);
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.lineTo(x + width - safeRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  ctx.lineTo(x + width, y + height - safeRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  ctx.lineTo(x + safeRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  ctx.lineTo(x, y + safeRadius);
  ctx.quadraticCurveTo(x, y, x + safeRadius, y);
  ctx.closePath();
};

const drawPatternOverlay = (
  ctx: RuntimeCanvasContext,
  spec: GeneratedBackgroundSpec,
  rect: DrawRect,
  palette: GeneratedPalette,
  rng: () => number
) => {
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = palette.line;
  const size = Math.max(12, Math.round(rect.width * 0.04));
  if (spec.pattern === 'grid') {
    for (let x = 0; x < rect.width; x += size) {
      ctx.fillRect(x, 0, 1, rect.height);
    }
    for (let y = 0; y < rect.height; y += size) {
      ctx.fillRect(0, y, rect.width, 1);
    }
  } else if (spec.pattern === 'waves') {
    ctx.lineWidth = Math.max(2, rect.width * 0.004);
    ctx.strokeStyle = toRgba(palette.accentSoft, 0.55);
    for (let row = 0; row < 5; row += 1) {
      const y = rect.height * (0.14 + row * 0.16);
      ctx.beginPath();
      for (let x = 0; x <= rect.width; x += 18) {
        const offset = Math.sin((x / rect.width) * Math.PI * 4 + row + spec.seed * 0.01) * size * 0.16;
        if (x === 0) {
          ctx.moveTo(x, y + offset);
        } else {
          ctx.lineTo(x, y + offset);
        }
      }
      ctx.stroke();
    }
  } else if (spec.pattern === 'sparkle') {
    for (let index = 0; index < 36; index += 1) {
      const x = rng() * rect.width;
      const y = rng() * rect.height * 0.72;
      const radius = 1 + rng() * 2.5;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    for (let y = size * 0.5; y < rect.height; y += size) {
      for (let x = size * 0.5; x < rect.width; x += size) {
        ctx.beginPath();
        ctx.arc(x, y, 1.2 + rng() * 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
};

const drawFloatingClouds = (
  ctx: RuntimeCanvasContext,
  rect: DrawRect,
  palette: GeneratedPalette,
  rng: () => number,
  count: number
) => {
  for (let index = 0; index < count; index += 1) {
    const x = rect.width * (0.08 + rng() * 0.84);
    const y = rect.height * (0.08 + rng() * 0.3);
    const width = rect.width * (0.1 + rng() * 0.12);
    const height = width * (0.34 + rng() * 0.22);
    ctx.fillStyle = toRgba(palette.glow, 0.85);
    ctx.beginPath();
    ctx.arc(x, y, height * 0.8, 0, Math.PI * 2);
    ctx.arc(x + width * 0.22, y - height * 0.2, height, 0, Math.PI * 2);
    ctx.arc(x + width * 0.48, y + height * 0.05, height * 0.9, 0, Math.PI * 2);
    ctx.arc(x + width * 0.74, y - height * 0.15, height * 0.72, 0, Math.PI * 2);
    ctx.fill();
  }
};

const drawLayeredHills = (
  ctx: RuntimeCanvasContext,
  rect: DrawRect,
  palette: GeneratedPalette,
  rng: () => number,
  layerCount: number
) => {
  for (let layer = 0; layer < layerCount; layer += 1) {
    const yBase = rect.height * (0.48 + layer * 0.13);
    const hillHeight = rect.height * (0.18 + rng() * 0.08);
    const color = layer === layerCount - 1 ? palette.foreground : toRgba(palette.horizon, 0.86 - layer * 0.14);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, rect.height);
    ctx.lineTo(0, yBase);
    for (let step = 0; step <= 8; step += 1) {
      const x = (rect.width / 8) * step;
      const peak = yBase - Math.sin((step / 8) * Math.PI) * hillHeight * (0.45 + rng() * 0.55);
      ctx.lineTo(x, peak);
    }
    ctx.lineTo(rect.width, rect.height);
    ctx.closePath();
    ctx.fill();
  }
};

const drawForestScene = (
  ctx: RuntimeCanvasContext,
  rect: DrawRect,
  palette: GeneratedPalette,
  rng: () => number
) => {
  drawLayeredHills(ctx, rect, palette, rng, 3);
  const treeCount = Math.floor(7 + rng() * 8);
  for (let index = 0; index < treeCount; index += 1) {
    const x = rect.width * (index / Math.max(1, treeCount - 1)) + (rng() - 0.5) * rect.width * 0.08;
    const trunkWidth = rect.width * (0.012 + rng() * 0.01);
    const trunkHeight = rect.height * (0.12 + rng() * 0.1);
    const baseY = rect.height * (0.72 + rng() * 0.13);
    const crownWidth = trunkWidth * (4 + rng() * 3);
    const crownHeight = trunkHeight * (1.2 + rng() * 0.6);
    ctx.fillStyle = palette.detail;
    ctx.fillRect(x, baseY - trunkHeight, trunkWidth, trunkHeight);
    ctx.fillStyle = index % 2 === 0 ? palette.accent : palette.horizon;
    ctx.beginPath();
    ctx.moveTo(x - crownWidth * 0.4, baseY - trunkHeight * 0.2);
    ctx.lineTo(x + trunkWidth / 2, baseY - trunkHeight - crownHeight);
    ctx.lineTo(x + crownWidth * 0.55, baseY - trunkHeight * 0.15);
    ctx.closePath();
    ctx.fill();
  }
};

const drawCityScene = (
  ctx: RuntimeCanvasContext,
  rect: DrawRect,
  palette: GeneratedPalette,
  rng: () => number
) => {
  drawLayeredHills(ctx, rect, palette, rng, 2);
  const buildingCount = Math.floor(8 + rng() * 8);
  const baseY = rect.height * 0.78;
  for (let index = 0; index < buildingCount; index += 1) {
    const width = rect.width * (0.05 + rng() * 0.06);
    const height = rect.height * (0.18 + rng() * 0.3);
    const x = (rect.width / buildingCount) * index + rng() * rect.width * 0.02;
    const y = baseY - height;
    ctx.fillStyle = index % 2 === 0 ? palette.foreground : palette.detail;
    drawRoundedRect(ctx, x, y, width, height, width * 0.08);
    ctx.fill();
    const windowRows = Math.max(2, Math.floor(height / Math.max(18, rect.height * 0.05)));
    const windowCols = Math.max(2, Math.floor(width / Math.max(12, rect.width * 0.02)));
    ctx.fillStyle = toRgba(palette.glow, 0.72);
    for (let row = 0; row < windowRows; row += 1) {
      for (let col = 0; col < windowCols; col += 1) {
        if (rng() < 0.25) continue;
        const cellWidth = width / (windowCols + 1);
        const cellHeight = height / (windowRows + 1);
        ctx.fillRect(
          x + cellWidth * (col + 0.65),
          y + cellHeight * (row + 0.55),
          Math.max(2, cellWidth * 0.34),
          Math.max(3, cellHeight * 0.32)
        );
      }
    }
  }
};

const drawArcadeScene = (
  ctx: RuntimeCanvasContext,
  rect: DrawRect,
  palette: GeneratedPalette,
  rng: () => number
) => {
  const floorTop = rect.height * 0.68;
  ctx.fillStyle = toRgba(palette.foreground, 0.82);
  ctx.fillRect(0, floorTop, rect.width, rect.height - floorTop);
  ctx.strokeStyle = toRgba(palette.glow, 0.4);
  ctx.lineWidth = Math.max(1.5, rect.width * 0.004);
  for (let column = -2; column < 12; column += 1) {
    ctx.beginPath();
    ctx.moveTo((rect.width / 10) * column, rect.height);
    ctx.lineTo(rect.width / 2, floorTop);
    ctx.stroke();
  }
  for (let row = 0; row < 7; row += 1) {
    ctx.beginPath();
    const y = floorTop + ((rect.height - floorTop) / 7) * row;
    ctx.moveTo(0, y);
    ctx.lineTo(rect.width, y);
    ctx.stroke();
  }
  const cabinetCount = Math.floor(4 + rng() * 3);
  for (let index = 0; index < cabinetCount; index += 1) {
    const width = rect.width * (0.12 + rng() * 0.05);
    const height = rect.height * (0.2 + rng() * 0.13);
    const x = rect.width * (0.06 + index * 0.18) + (rng() - 0.5) * rect.width * 0.04;
    const y = floorTop - height + rect.height * 0.05;
    ctx.fillStyle = index % 2 === 0 ? palette.detail : palette.foreground;
    drawRoundedRect(ctx, x, y, width, height, width * 0.08);
    ctx.fill();
    ctx.fillStyle = palette.accent;
    ctx.fillRect(x + width * 0.14, y + height * 0.16, width * 0.72, height * 0.34);
    ctx.fillStyle = toRgba(palette.glow, 0.95);
    ctx.fillRect(x + width * 0.22, y + height * 0.24, width * 0.56, height * 0.18);
    ctx.fillStyle = palette.accentSoft;
    ctx.beginPath();
    ctx.arc(x + width * 0.33, y + height * 0.7, width * 0.06, 0, Math.PI * 2);
    ctx.arc(x + width * 0.52, y + height * 0.7, width * 0.06, 0, Math.PI * 2);
    ctx.arc(x + width * 0.7, y + height * 0.7, width * 0.06, 0, Math.PI * 2);
    ctx.fill();
  }
};

const drawStudioScene = (
  ctx: RuntimeCanvasContext,
  rect: DrawRect,
  palette: GeneratedPalette,
  rng: () => number
) => {
  ctx.fillStyle = toRgba(palette.foreground, 0.9);
  ctx.fillRect(0, rect.height * 0.73, rect.width, rect.height * 0.27);
  for (let index = 0; index < 3; index += 1) {
    const centerX = rect.width * (0.22 + index * 0.28);
    const coneWidth = rect.width * (0.18 + rng() * 0.06);
    const gradient = ctx.createRadialGradient(centerX, rect.height * 0.15, 0, centerX, rect.height * 0.62, coneWidth);
    gradient.addColorStop(0, toRgba(palette.glow, 0.62));
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(centerX - coneWidth * 0.22, rect.height * 0.17);
    ctx.lineTo(centerX + coneWidth * 0.22, rect.height * 0.17);
    ctx.lineTo(centerX + coneWidth, rect.height * 0.78);
    ctx.lineTo(centerX - coneWidth, rect.height * 0.78);
    ctx.closePath();
    ctx.fill();
  }
  const panelCount = 5;
  for (let index = 0; index < panelCount; index += 1) {
    const width = rect.width * 0.15;
    const height = rect.height * (0.2 + rng() * 0.08);
    const x = rect.width * 0.05 + index * rect.width * 0.18;
    const y = rect.height * 0.42 + rng() * rect.height * 0.08;
    ctx.fillStyle = index % 2 === 0 ? palette.detail : palette.foreground;
    drawRoundedRect(ctx, x, y, width, height, width * 0.1);
    ctx.fill();
    ctx.fillStyle = toRgba(palette.accent, 0.78);
    ctx.fillRect(x + width * 0.12, y + height * 0.18, width * 0.76, height * 0.14);
  }
};

const drawSeasideScene = (
  ctx: RuntimeCanvasContext,
  rect: DrawRect,
  palette: GeneratedPalette,
  rng: () => number
) => {
  const seaTop = rect.height * 0.58;
  ctx.fillStyle = toRgba(palette.accent, 0.9);
  ctx.fillRect(0, seaTop, rect.width, rect.height - seaTop);
  ctx.fillStyle = toRgba(palette.accentSoft, 0.72);
  for (let wave = 0; wave < 5; wave += 1) {
    const y = seaTop + wave * rect.height * 0.055;
    ctx.beginPath();
    for (let x = 0; x <= rect.width; x += 20) {
      const offset = Math.sin((x / rect.width) * Math.PI * 6 + wave * 0.75 + specSeedOffset(rng)) * rect.height * 0.01;
      if (x === 0) {
        ctx.moveTo(x, y + offset);
      } else {
        ctx.lineTo(x, y + offset);
      }
    }
    ctx.lineWidth = Math.max(2, rect.height * 0.006);
    ctx.strokeStyle = toRgba(palette.glow, 0.65);
    ctx.stroke();
  }
  const islandWidth = rect.width * (0.22 + rng() * 0.1);
  const islandHeight = rect.height * 0.08;
  ctx.fillStyle = palette.foreground;
  ctx.beginPath();
  ctx.ellipse(rect.width * 0.72, seaTop - islandHeight * 0.3, islandWidth, islandHeight, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = palette.detail;
  ctx.fillRect(rect.width * 0.2, rect.height * 0.56, rect.width * 0.16, rect.height * 0.03);
  ctx.strokeStyle = palette.detail;
  ctx.lineWidth = Math.max(2, rect.width * 0.004);
  ctx.beginPath();
  ctx.moveTo(rect.width * 0.28, rect.height * 0.56);
  ctx.lineTo(rect.width * 0.24, rect.height * 0.38);
  ctx.stroke();
  ctx.fillStyle = palette.accentSoft;
  ctx.beginPath();
  ctx.moveTo(rect.width * 0.24, rect.height * 0.38);
  ctx.lineTo(rect.width * 0.33, rect.height * 0.42);
  ctx.lineTo(rect.width * 0.24, rect.height * 0.47);
  ctx.closePath();
  ctx.fill();
};

const drawDreamscapeScene = (
  ctx: RuntimeCanvasContext,
  rect: DrawRect,
  palette: GeneratedPalette,
  rng: () => number
) => {
  for (let star = 0; star < 28; star += 1) {
    const x = rng() * rect.width;
    const y = rect.height * (0.04 + rng() * 0.38);
    const radius = 1 + rng() * 2.6;
    ctx.fillStyle = toRgba(palette.glow, 0.95);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  const islandCount = 5;
  for (let index = 0; index < islandCount; index += 1) {
    const width = rect.width * (0.14 + rng() * 0.08);
    const height = rect.height * (0.05 + rng() * 0.03);
    const x = rect.width * (0.08 + index * 0.18) + (rng() - 0.5) * rect.width * 0.04;
    const y = rect.height * (0.4 + rng() * 0.28);
    ctx.fillStyle = index % 2 === 0 ? palette.accent : palette.foreground;
    ctx.beginPath();
    ctx.ellipse(x, y, width, height, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = toRgba(palette.detail, 0.72);
    ctx.beginPath();
    ctx.moveTo(x - width * 0.22, y);
    ctx.lineTo(x - width * 0.05, y + height * 1.7);
    ctx.lineTo(x + width * 0.09, y + height * 0.18);
    ctx.closePath();
    ctx.fill();
  }
};

const specSeedOffset = (rng: () => number) => rng() * Math.PI * 2;

export const drawGeneratedBackground = (
  ctx: RuntimeCanvasContext,
  spec: GeneratedBackgroundSpec,
  rect: DrawRect
) => {
  const palette = GENERATED_PALETTES[spec.paletteId];
  const rng = createSeededRandom(spec.seed);

  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.clip();
  ctx.translate(rect.x, rect.y);

  const gradient = ctx.createLinearGradient(0, 0, 0, rect.height);
  gradient.addColorStop(0, palette.skyTop);
  gradient.addColorStop(1, palette.skyBottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, rect.width, rect.height);

  const sunX = rect.width * (0.16 + rng() * 0.68);
  const sunY = rect.height * (0.12 + rng() * 0.18);
  const sunRadius = rect.width * (0.08 + spec.accentScale * 0.06);
  const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunRadius * 2.2);
  glow.addColorStop(0, toRgba(palette.glow, 0.95));
  glow.addColorStop(0.55, toRgba(palette.accentSoft, 0.4));
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(sunX, sunY, sunRadius * 2.2, 0, Math.PI * 2);
  ctx.fill();

  drawPatternOverlay(ctx, spec, rect, palette, rng);
  drawFloatingClouds(ctx, rect, palette, rng, Math.floor(2 + spec.density * 5));

  switch (spec.sceneKind) {
    case 'forest':
      drawForestScene(ctx, rect, palette, rng);
      break;
    case 'city':
      drawCityScene(ctx, rect, palette, rng);
      break;
    case 'arcade':
      drawArcadeScene(ctx, rect, palette, rng);
      break;
    case 'studio':
      drawStudioScene(ctx, rect, palette, rng);
      break;
    case 'seaside':
      drawSeasideScene(ctx, rect, palette, rng);
      break;
    case 'dreamscape':
    default:
      drawDreamscapeScene(ctx, rect, palette, rng);
      break;
  }

  const horizonY = rect.height * clamp(spec.horizon, 0.34, 0.82);
  ctx.fillStyle = toRgba(palette.horizon, 0.2);
  ctx.fillRect(0, horizonY, rect.width, rect.height - horizonY);
  ctx.restore();
};

export const renderGeneratedBackgroundToCanvas = (
  spec: GeneratedBackgroundSpec,
  width: number,
  height: number,
  existing?: RuntimeCanvas
) => {
  const canvas = createRuntimeCanvas(width, height, existing);
  const ctx = getRuntimeCanvasContext(canvas);
  drawGeneratedBackground(ctx, spec, { x: 0, y: 0, width, height });
  return canvas;
};

export const createGeneratedBackgroundPack = ({
  name,
  description,
  aspectRatio = DEFAULT_ASPECT_RATIO,
  count = 100,
  baseSeed = Date.now(),
  sceneKinds = DEFAULT_SCENE_KINDS,
  paletteIds = DEFAULT_PALETTE_IDS
}: GeneratedBackgroundPackOptions): GeneratedBackgroundPack => {
  const safeCount = safePackCount(count);
  const safeName = name.trim() || `Background Pack ${new Date().toLocaleString()}`;
  const safeDescription =
    description?.trim() || 'Auto-generated Spotitnow background pack for video previews and exports.';
  const now = Date.now();
  const safeSceneKinds = sceneKinds.length ? sceneKinds : DEFAULT_SCENE_KINDS;
  const safePaletteIds = paletteIds.length ? paletteIds : DEFAULT_PALETTE_IDS;
  const rng = createSeededRandom(baseSeed);
  const backgrounds: GeneratedBackgroundSpec[] = Array.from({ length: safeCount }, (_entry, index) => {
    const sceneKind = pick(safeSceneKinds, rng);
    const paletteId = pick(safePaletteIds, rng);
    const seed = Math.floor((baseSeed + 1) * (index + 17) * (1 + rng() * 0.3));
    const patternPool: GeneratedBackgroundPattern[] =
      sceneKind === 'arcade'
        ? ['grid', 'sparkle', 'dots']
        : sceneKind === 'seaside'
        ? ['waves', 'dots']
        : ['dots', 'grid', 'sparkle', 'waves'];
    return {
      id: createBackgroundId(safeName, index, seed),
      name: buildSpecName(sceneKind, index),
      seed,
      sceneKind,
      paletteId,
      horizon: 0.46 + rng() * 0.24,
      density: clamp(0.22 + rng() * 0.62, 0.1, 1),
      accentScale: clamp(0.25 + rng() * 0.65, 0.15, 1),
      pattern: pick(patternPool, rng)
    };
  });

  const packId = `${safeName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'background-pack'}-${now}`;

  return {
    id: packId,
    name: safeName,
    description: safeDescription,
    aspectRatio,
    createdAt: now,
    updatedAt: now,
    backgrounds,
    coverBackgroundId: backgrounds[0]?.id ?? `${packId}-cover`
  };
};

export const createStarterGeneratedBackgroundPack = () => {
  const pack = createGeneratedBackgroundPack({
    name: 'Spotitnow Starter Pack',
    description: 'Balanced mix of playful editorial backgrounds for quick video setup.',
    count: 100,
    baseSeed: 24031990,
    aspectRatio: '16:9'
  });
  return {
    ...pack,
    id: 'spotitnow-starter-pack'
  };
};

export const resolveGeneratedBackgroundForIndex = (
  pack: GeneratedBackgroundPack | null | undefined,
  puzzleIndex: number,
  shuffleSeed = 1
): GeneratedBackgroundSpec | null => {
  if (!pack || !pack.backgrounds.length) return null;
  const safeIndex = Math.max(0, Math.floor(puzzleIndex));
  const size = pack.backgrounds.length;
  const start = stableHash(`${pack.id}:${shuffleSeed}`) % size;
  let step = (stableHash(`${pack.id}:step:${shuffleSeed}`) % size) || 1;
  while (gcd(step, size) !== 1) {
    step = (step + 1) % size || 1;
  }
  return pack.backgrounds[(start + safeIndex * step) % size] ?? pack.backgrounds[0] ?? null;
};
