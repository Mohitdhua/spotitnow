import type {
  GeneratedBackgroundDetailStyle,
  GeneratedBackgroundMotifFamily,
  GeneratedBackgroundPack,
  GeneratedBackgroundPaletteId,
  GeneratedBackgroundRecipe,
  VideoSettings
} from '../types';
import {
  createRuntimeCanvas,
  getRuntimeCanvasContext,
  type RuntimeCanvas,
  type RuntimeCanvasContext
} from './canvasRuntime';

type GeneratedPalette = {
  backdropTop: string;
  backdropBottom: string;
  surface: string;
  surfaceSoft: string;
  accent: string;
  accentSoft: string;
  sparkle: string;
  quiet: string;
  ink: string;
  outline: string;
};

interface GeneratedBackgroundPackOptions {
  name: string;
  description?: string;
  aspectRatio?: VideoSettings['aspectRatio'];
  count?: number;
  baseSeed?: number;
  families?: GeneratedBackgroundMotifFamily[];
  paletteIds?: GeneratedBackgroundPaletteId[];
}

interface DrawRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

const DEFAULT_ASPECT_RATIO: VideoSettings['aspectRatio'] = '16:9';
export const GENERATED_BACKGROUND_PACK_SIZE = 100;

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
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
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

const shuffle = <T,>(items: readonly T[], rng: () => number): T[] => {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
};

const createBalancedSequence = <T,>(items: readonly T[], count: number, seed: number): T[] => {
  const rng = createSeededRandom(seed);
  const sequence: T[] = [];
  while (sequence.length < count) {
    sequence.push(...shuffle(items, rng));
  }
  return sequence.slice(0, count);
};

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

const wave = (seed: number, timeSeconds: number, speed: number, amplitude: number) =>
  Math.sin(seed * 0.73 + timeSeconds * (speed * 1.18 + 0.08)) * amplitude * 1.18;

const wave2 = (seed: number, timeSeconds: number, speed: number, amplitude: number) =>
  Math.cos(seed * 0.51 + timeSeconds * (speed * 1.16 + 0.07)) * amplitude * 1.14;

const tuneRecipeForRender = (spec: GeneratedBackgroundRecipe): GeneratedBackgroundRecipe => ({
  ...spec,
  accentScale: clamp(spec.accentScale * 1.08 + 0.05, 0.32, 1),
  contrast: clamp(spec.contrast + 0.03, 0.18, 0.82),
  motionSpeed: clamp(spec.motionSpeed * 1.42 + 0.24, 0.48, 1.95)
});

const applySquishTransform = (
  ctx: RuntimeCanvasContext,
  seed: number,
  timeSeconds: number,
  motionSpeed: number,
  amount = 0.12
) => {
  const scaleX = clamp(1 + wave(seed, timeSeconds, motionSpeed * 0.9, amount), 0.82, 1.32);
  const scaleY = clamp(1 + wave2(seed + 41, timeSeconds, motionSpeed * 0.84, amount * 0.82), 0.84, 1.28);
  ctx.scale(scaleX, scaleY);
};

const GENERATED_PALETTES: Record<GeneratedBackgroundPaletteId, GeneratedPalette> = {
  sunrise: {
    backdropTop: '#FFE8A3',
    backdropBottom: '#FFB5A7',
    surface: '#FFC56A',
    surfaceSoft: '#FFF0C6',
    accent: '#FF6B6B',
    accentSoft: '#FFD7A2',
    sparkle: '#FFF9E8',
    quiet: '#FFF6DA',
    ink: '#7A3A1B',
    outline: '#4A2612'
  },
  mint: {
    backdropTop: '#DFFBF1',
    backdropBottom: '#A2ECCB',
    surface: '#7AD9A8',
    surfaceSoft: '#EEFFF6',
    accent: '#34D399',
    accentSoft: '#A7F3D0',
    sparkle: '#F7FFF9',
    quiet: '#F5FFFB',
    ink: '#166534',
    outline: '#0E3B2B'
  },
  midnight: {
    backdropTop: '#172554',
    backdropBottom: '#1E3A8A',
    surface: '#2DD4BF',
    surfaceSoft: '#C4B5FD',
    accent: '#38BDF8',
    accentSoft: '#93C5FD',
    sparkle: '#E0F2FE',
    quiet: '#20355F',
    ink: '#E2E8F0',
    outline: '#0F172A'
  },
  candy: {
    backdropTop: '#FFE4F2',
    backdropBottom: '#D8C6FF',
    surface: '#FF9BC2',
    surfaceSoft: '#FFF1F8',
    accent: '#8B5CF6',
    accentSoft: '#FDB4DA',
    sparkle: '#FFF7FD',
    quiet: '#FFF3FB',
    ink: '#6D28D9',
    outline: '#4C1D95'
  },
  ocean: {
    backdropTop: '#D8F4FF',
    backdropBottom: '#87D6F8',
    surface: '#38BDF8',
    surfaceSoft: '#E0F7FF',
    accent: '#14B8A6',
    accentSoft: '#BAE6FD',
    sparkle: '#F0FBFF',
    quiet: '#F3FCFF',
    ink: '#0F4C6B',
    outline: '#0C3554'
  },
  amber: {
    backdropTop: '#FFE4A8',
    backdropBottom: '#FFB16A',
    surface: '#FF9F4A',
    surfaceSoft: '#FFF3D1',
    accent: '#F97316',
    accentSoft: '#FED7AA',
    sparkle: '#FFF7E3',
    quiet: '#FFF8E8',
    ink: '#7C2D12',
    outline: '#4A1C09'
  }
};

const DEFAULT_FAMILIES: GeneratedBackgroundMotifFamily[] = [
  'confetti_field',
  'paper_cut',
  'comic_dots',
  'ribbon_swoop',
  'blob_garden',
  'starburst',
  'doodle_parade',
  'spark_trails',
  'layered_waves',
  'sticker_scatter'
];

const DEFAULT_PALETTE_IDS: GeneratedBackgroundPaletteId[] = [
  'sunrise',
  'mint',
  'midnight',
  'candy',
  'ocean',
  'amber'
];

const DEFAULT_DETAIL_POOL: GeneratedBackgroundDetailStyle[] = [
  'sprinkles',
  'halftone',
  'sparkle',
  'sticker',
  'streamers'
];

export const GENERATED_BACKGROUND_FAMILY_OPTIONS: Array<{
  value: GeneratedBackgroundMotifFamily;
  label: string;
  description: string;
}> = [
  { value: 'confetti_field', label: 'Confetti Field', description: 'Celebration sprinkles and party energy around the board edges.' },
  { value: 'paper_cut', label: 'Paper Cut', description: 'Layered paper-shape collages with soft handcrafted depth.' },
  { value: 'comic_dots', label: 'Comic Dots', description: 'Halftone pops and editorial comic-book rhythm.' },
  { value: 'ribbon_swoop', label: 'Ribbon Swoop', description: 'Broad looping ribbons that frame the game area.' },
  { value: 'blob_garden', label: 'Blob Garden', description: 'Organic blobs and soft sticker-like forms with calm motion.' },
  { value: 'starburst', label: 'Starburst', description: 'Corner bursts and spotlight accents for high-energy reveals.' },
  { value: 'doodle_parade', label: 'Doodle Parade', description: 'Hand-drawn loops, zigs, stars, and playful sketch details.' },
  { value: 'spark_trails', label: 'Spark Trails', description: 'Curved motion trails with tiny sparks and glints.' },
  { value: 'layered_waves', label: 'Layered Waves', description: 'Rolling layered bands that feel lively but stay clean.' },
  { value: 'sticker_scatter', label: 'Sticker Scatter', description: 'Floating sticker-shapes with white outlines and friendly charm.' }
];

export const GENERATED_BACKGROUND_SCENE_OPTIONS = GENERATED_BACKGROUND_FAMILY_OPTIONS;

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

export const GENERATED_BACKGROUND_DETAIL_OPTIONS: Array<{
  value: GeneratedBackgroundDetailStyle;
  label: string;
}> = [
  { value: 'sprinkles', label: 'Sprinkles' },
  { value: 'halftone', label: 'Halftone' },
  { value: 'sparkle', label: 'Sparkle' },
  { value: 'sticker', label: 'Sticker' },
  { value: 'streamers', label: 'Streamers' }
];

const FAMILY_LABEL_BY_VALUE = Object.fromEntries(
  GENERATED_BACKGROUND_FAMILY_OPTIONS.map((option) => [option.value, option.label])
) as Record<GeneratedBackgroundMotifFamily, string>;

const createBackgroundId = (packName: string, index: number, seed: number) =>
  `${packName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'background-pack'}-${index + 1}-${seed}`;

const buildRecipeName = (family: GeneratedBackgroundMotifFamily, index: number) =>
  `${FAMILY_LABEL_BY_VALUE[family]} ${String(index + 1).padStart(2, '0')}`;

const normalizePackCount = () => GENERATED_BACKGROUND_PACK_SIZE;

const resolveDetailPool = (family: GeneratedBackgroundMotifFamily): GeneratedBackgroundDetailStyle[] => {
  switch (family) {
    case 'confetti_field':
      return ['sprinkles', 'sparkle', 'streamers'];
    case 'paper_cut':
      return ['sticker', 'streamers', 'sprinkles'];
    case 'comic_dots':
      return ['halftone', 'sparkle'];
    case 'ribbon_swoop':
      return ['streamers', 'sparkle'];
    case 'blob_garden':
      return ['sticker', 'sprinkles', 'sparkle'];
    case 'starburst':
      return ['sparkle', 'halftone', 'streamers'];
    case 'doodle_parade':
      return ['sprinkles', 'sticker'];
    case 'spark_trails':
      return ['sparkle', 'streamers'];
    case 'layered_waves':
      return ['streamers', 'sprinkles'];
    case 'sticker_scatter':
    default:
      return ['sticker', 'sparkle', 'sprinkles'];
  }
};

const resolveLegacyFamily = (value: unknown): GeneratedBackgroundMotifFamily | null => {
  switch (value) {
    case 'confetti_field':
    case 'paper_cut':
    case 'comic_dots':
    case 'ribbon_swoop':
    case 'blob_garden':
    case 'starburst':
    case 'doodle_parade':
    case 'spark_trails':
    case 'layered_waves':
    case 'sticker_scatter':
      return value;
    case 'arcade':
      return 'confetti_field';
    case 'studio':
      return 'paper_cut';
    case 'forest':
      return 'blob_garden';
    case 'city':
      return 'comic_dots';
    case 'seaside':
      return 'layered_waves';
    case 'dreamscape':
      return 'sticker_scatter';
    default:
      return null;
  }
};

const resolveLegacyDetailStyle = (value: unknown): GeneratedBackgroundDetailStyle | null => {
  switch (value) {
    case 'sprinkles':
    case 'halftone':
    case 'sparkle':
    case 'sticker':
    case 'streamers':
      return value;
    case 'dots':
      return 'sprinkles';
    case 'grid':
      return 'halftone';
    case 'waves':
      return 'streamers';
    default:
      return null;
  }
};

const drawRoundedRectPath = (
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

const createPeripheralPoint = (rng: () => number, rect: DrawRect, safeZone: number): Point => {
  const safeBand = clamp(safeZone, 0.42, 0.78);
  const centerMinX = 0.5 - safeBand * 0.22;
  const centerMaxX = 0.5 + safeBand * 0.22;
  const centerMinY = 0.5 - safeBand * 0.18;
  const centerMaxY = 0.5 + safeBand * 0.18;
  const zone = Math.floor(rng() * 8);
  let nx = 0.5;
  let ny = 0.5;

  switch (zone) {
    case 0:
      nx = 0.05 + rng() * 0.22;
      ny = 0.06 + rng() * 0.18;
      break;
    case 1:
      nx = 0.74 + rng() * 0.2;
      ny = 0.06 + rng() * 0.18;
      break;
    case 2:
      nx = 0.08 + rng() * 0.18;
      ny = 0.72 + rng() * 0.2;
      break;
    case 3:
      nx = 0.74 + rng() * 0.18;
      ny = 0.72 + rng() * 0.2;
      break;
    case 4:
      nx = 0.03 + rng() * 0.14;
      ny = 0.22 + rng() * 0.52;
      break;
    case 5:
      nx = 0.83 + rng() * 0.14;
      ny = 0.22 + rng() * 0.52;
      break;
    case 6:
      nx = 0.28 + rng() * 0.44;
      ny = 0.03 + rng() * 0.12;
      break;
    default:
      nx = 0.28 + rng() * 0.44;
      ny = 0.85 + rng() * 0.1;
      break;
  }

  if (nx > centerMinX && nx < centerMaxX) {
    nx = nx < 0.5 ? centerMinX - rng() * 0.12 : centerMaxX + rng() * 0.12;
  }
  if (ny > centerMinY && ny < centerMaxY) {
    ny = ny < 0.5 ? centerMinY - rng() * 0.1 : centerMaxY + rng() * 0.1;
  }

  return {
    x: rect.width * clamp(nx, 0.02, 0.98),
    y: rect.height * clamp(ny, 0.02, 0.98)
  };
};

const drawStarPath = (
  ctx: RuntimeCanvasContext,
  x: number,
  y: number,
  outerRadius: number,
  innerRadius: number,
  points = 5
) => {
  ctx.beginPath();
  for (let index = 0; index < points * 2; index += 1) {
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    const angle = -Math.PI / 2 + (Math.PI / points) * index;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (index === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.closePath();
};

const drawBurstPath = (
  ctx: RuntimeCanvasContext,
  x: number,
  y: number,
  radius: number,
  points: number,
  seed: number,
  timeSeconds: number,
  speed: number
) => {
  ctx.beginPath();
  for (let index = 0; index < points * 2; index += 1) {
    const baseRadius = index % 2 === 0 ? radius : radius * 0.42;
    const animatedRadius = baseRadius + wave(seed + index, timeSeconds, speed, radius * 0.08);
    const angle = -Math.PI / 2 + (Math.PI / points) * index;
    const px = x + Math.cos(angle) * animatedRadius;
    const py = y + Math.sin(angle) * animatedRadius;
    if (index === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.closePath();
};

const drawOrganicBlobPath = (
  ctx: RuntimeCanvasContext,
  x: number,
  y: number,
  radiusX: number,
  radiusY: number,
  seed: number,
  timeSeconds: number,
  speed: number
) => {
  const points = 8;
  const anchors: Point[] = [];
  for (let index = 0; index < points; index += 1) {
    const angle = (Math.PI * 2 * index) / points;
    const distortion =
      0.7 +
      ((Math.sin(seed * 0.31 + index * 1.17 + timeSeconds * speed) + 1) * 0.2) +
      Math.cos(seed * 0.13 + index * 0.91 + timeSeconds * speed * 0.82) * 0.06;
    anchors.push({
      x: x + Math.cos(angle) * radiusX * distortion,
      y: y + Math.sin(angle) * radiusY * distortion
    });
  }
  ctx.beginPath();
  ctx.moveTo(anchors[0].x, anchors[0].y);
  for (let index = 0; index < anchors.length; index += 1) {
    const current = anchors[index];
    const next = anchors[(index + 1) % anchors.length];
    const midX = (current.x + next.x) / 2;
    const midY = (current.y + next.y) / 2;
    ctx.quadraticCurveTo(current.x, current.y, midX, midY);
  }
  ctx.closePath();
};

const drawBaseBackdrop = (
  ctx: RuntimeCanvasContext,
  rect: DrawRect,
  palette: GeneratedPalette,
  spec: GeneratedBackgroundRecipe,
  timeSeconds: number
) => {
  const rng = createSeededRandom(spec.seed);
  const backdrop = ctx.createLinearGradient(0, 0, 0, rect.height);
  backdrop.addColorStop(0, palette.backdropTop);
  backdrop.addColorStop(1, palette.backdropBottom);
  ctx.fillStyle = backdrop;
  ctx.fillRect(0, 0, rect.width, rect.height);

  for (let index = 0; index < 4; index += 1) {
    const point = createPeripheralPoint(rng, rect, spec.safeZone);
    const radius = rect.width * (0.16 + rng() * 0.16) * (0.7 + spec.accentScale * 0.45);
    const animatedX = point.x + wave(spec.seed + index * 11, timeSeconds, spec.motionSpeed * 0.22, rect.width * 0.025);
    const animatedY = point.y + wave2(spec.seed + index * 13, timeSeconds, spec.motionSpeed * 0.18, rect.height * 0.02);
    const glow = ctx.createRadialGradient(animatedX, animatedY, 0, animatedX, animatedY, radius);
    glow.addColorStop(0, toRgba(index % 2 === 0 ? palette.sparkle : palette.accentSoft, 0.34 + spec.contrast * 0.18));
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(animatedX, animatedY, radius, 0, Math.PI * 2);
    ctx.fill();
  }
};

const drawCenterQuietZone = (
  ctx: RuntimeCanvasContext,
  rect: DrawRect,
  palette: GeneratedPalette,
  spec: GeneratedBackgroundRecipe
) => {
  const centerX = rect.width * 0.5;
  const centerY = rect.height * 0.54;
  const radius = rect.width * (0.34 + spec.safeZone * 0.16);
  const gradient = ctx.createRadialGradient(centerX, centerY, radius * 0.18, centerX, centerY, radius);
  gradient.addColorStop(0, toRgba(palette.quiet, 0.36 - spec.contrast * 0.12));
  gradient.addColorStop(0.55, toRgba(palette.quiet, 0.14 - spec.contrast * 0.05));
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.fill();
};

const drawDetailTexture = (
  ctx: RuntimeCanvasContext,
  rect: DrawRect,
  palette: GeneratedPalette,
  spec: GeneratedBackgroundRecipe,
  timeSeconds: number
) => {
  const rng = createSeededRandom(spec.seed + 404);
  ctx.save();
  ctx.globalAlpha = clamp(0.12 + spec.contrast * 0.1, 0.08, 0.22);

  if (spec.detailStyle === 'halftone') {
    const clusterCount = 3;
    for (let cluster = 0; cluster < clusterCount; cluster += 1) {
      const anchor = createPeripheralPoint(rng, rect, spec.safeZone);
      const dotStep = Math.max(12, rect.width * 0.025);
      const rows = 5 + Math.floor(rng() * 3);
      const cols = 6 + Math.floor(rng() * 3);
      ctx.fillStyle = toRgba(palette.outline, 0.4);
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const distance = Math.sqrt(row * row + col * col);
          const radius = Math.max(1.5, (dotStep * 0.22) - distance * 0.35);
          if (radius <= 1.6) continue;
          ctx.beginPath();
          ctx.arc(
            anchor.x + col * dotStep,
            anchor.y + row * dotStep + wave(cluster + row + col, timeSeconds, spec.motionSpeed * 0.35, rect.height * 0.004),
            radius,
            0,
            Math.PI * 2
          );
          ctx.fill();
        }
      }
    }
  } else if (spec.detailStyle === 'streamers') {
    ctx.lineCap = 'round';
    for (let index = 0; index < 6; index += 1) {
      const start = createPeripheralPoint(rng, rect, spec.safeZone);
      const end = createPeripheralPoint(rng, rect, spec.safeZone);
      const controlY = rect.height * (0.22 + rng() * 0.56);
      ctx.lineWidth = Math.max(2, rect.width * (0.008 + rng() * 0.004));
      ctx.strokeStyle = toRgba(index % 2 === 0 ? palette.accentSoft : palette.sparkle, 0.5);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.bezierCurveTo(
        start.x + rect.width * 0.12,
        controlY + wave(index + 1, timeSeconds, spec.motionSpeed * 0.4, rect.height * 0.02),
        end.x - rect.width * 0.12,
        controlY + wave2(index + 8, timeSeconds, spec.motionSpeed * 0.36, rect.height * 0.02),
        end.x,
        end.y
      );
      ctx.stroke();
    }
  } else if (spec.detailStyle === 'sparkle') {
    const sparkCount = Math.floor(14 + spec.density * 18);
    ctx.fillStyle = toRgba(palette.sparkle, 0.72);
    for (let index = 0; index < sparkCount; index += 1) {
      const point = createPeripheralPoint(rng, rect, spec.safeZone);
      const size = rect.width * (0.004 + rng() * 0.004);
      const pulse = 0.75 + (Math.sin(timeSeconds * (0.9 + spec.motionSpeed * 0.45) + index) + 1) * 0.12;
      ctx.beginPath();
      ctx.arc(point.x, point.y, size * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = toRgba(palette.sparkle, 0.62);
      ctx.lineWidth = Math.max(1, rect.width * 0.0018);
      ctx.beginPath();
      ctx.moveTo(point.x - size * 2.2, point.y);
      ctx.lineTo(point.x + size * 2.2, point.y);
      ctx.moveTo(point.x, point.y - size * 2.2);
      ctx.lineTo(point.x, point.y + size * 2.2);
      ctx.stroke();
    }
  } else if (spec.detailStyle === 'sticker') {
    const count = 8;
    for (let index = 0; index < count; index += 1) {
      const point = createPeripheralPoint(rng, rect, spec.safeZone);
      const size = rect.width * (0.018 + rng() * 0.012);
      ctx.save();
      ctx.translate(point.x, point.y);
      ctx.rotate(rng() * Math.PI + timeSeconds * spec.motionSpeed * 0.08);
      ctx.fillStyle = toRgba(palette.sparkle, 0.65);
      ctx.strokeStyle = toRgba(palette.outline, 0.26);
      ctx.lineWidth = Math.max(1, rect.width * 0.0018);
      drawStarPath(ctx, 0, 0, size, size * 0.48, 4);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  } else {
    const sprinkleCount = Math.floor(20 + spec.density * 18);
    for (let index = 0; index < sprinkleCount; index += 1) {
      const point = createPeripheralPoint(rng, rect, spec.safeZone);
      const width = rect.width * (0.01 + rng() * 0.01);
      const height = width * (0.28 + rng() * 0.3);
      ctx.save();
      ctx.translate(point.x, point.y);
      ctx.rotate(rng() * Math.PI + wave(index + 1, timeSeconds, spec.motionSpeed * 0.6, 0.28));
      ctx.fillStyle = toRgba(index % 3 === 0 ? palette.accent : palette.surfaceSoft, 0.55);
      drawRoundedRectPath(ctx, -width / 2, -height / 2, width, height, height / 2);
      ctx.fill();
      ctx.restore();
    }
  }

  ctx.restore();
};

const drawConfettiField = (
  ctx: RuntimeCanvasContext,
  rect: DrawRect,
  palette: GeneratedPalette,
  spec: GeneratedBackgroundRecipe,
  timeSeconds: number
) => {
  const rng = createSeededRandom(spec.seed + 111);
  const count = Math.floor(24 + spec.density * 28);
  for (let index = 0; index < count; index += 1) {
    const point = createPeripheralPoint(rng, rect, spec.safeZone);
    const size = rect.width * (0.012 + rng() * 0.02) * (0.82 + spec.accentScale * 0.54);
    const wobbleX = wave(spec.seed + index, timeSeconds, spec.motionSpeed * 0.84, rect.width * 0.012);
    const wobbleY = wave2(spec.seed + index * 3, timeSeconds, spec.motionSpeed * 0.72, rect.height * 0.018);
    const kind = Math.floor(rng() * 4);
    ctx.save();
    ctx.translate(point.x + wobbleX, point.y + wobbleY);
    ctx.rotate(rng() * Math.PI + timeSeconds * spec.motionSpeed * 0.34);
    applySquishTransform(ctx, spec.seed + index * 17, timeSeconds, spec.motionSpeed, 0.16);
    ctx.fillStyle = toRgba(
      pick([palette.accent, palette.accentSoft, palette.surface, palette.sparkle], rng),
      0.54 + spec.contrast * 0.16
    );
    if (kind === 0) {
      drawRoundedRectPath(ctx, -size * 0.66, -size * 0.28, size * 1.32, size * 0.56, size * 0.3);
      ctx.fill();
    } else if (kind === 1) {
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.46, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === 2) {
      drawOrganicBlobPath(ctx, 0, 0, size * 0.56, size * 0.42, spec.seed + index * 31, timeSeconds, spec.motionSpeed * 0.7);
      ctx.fill();
    } else {
      ctx.lineWidth = Math.max(2.4, rect.width * 0.0022);
      ctx.strokeStyle = toRgba(palette.outline, 0.22);
      ctx.beginPath();
      ctx.moveTo(-size * 0.62, 0);
      ctx.bezierCurveTo(-size * 0.18, -size * 0.56, size * 0.18, size * 0.56, size * 0.62, 0);
      ctx.stroke();
    }
    ctx.strokeStyle = toRgba(palette.sparkle, 0.34);
    ctx.lineWidth = Math.max(1.4, rect.width * 0.0016);
    ctx.stroke();
    ctx.restore();
  }
};

const drawPaperCut = (
  ctx: RuntimeCanvasContext,
  rect: DrawRect,
  palette: GeneratedPalette,
  spec: GeneratedBackgroundRecipe,
  timeSeconds: number
) => {
  const rng = createSeededRandom(spec.seed + 222);
  const count = Math.floor(5 + spec.density * 4);
  for (let index = 0; index < count; index += 1) {
    const point = createPeripheralPoint(rng, rect, spec.safeZone);
    const radiusX = rect.width * (0.13 + rng() * 0.11) * (0.88 + spec.accentScale * 0.42);
    const radiusY = rect.height * (0.11 + rng() * 0.09) * (0.86 + spec.accentScale * 0.35);
    const offsetX = wave(index + spec.seed, timeSeconds, spec.motionSpeed * 0.26, rect.width * 0.02);
    const offsetY = wave2(index + spec.seed, timeSeconds, spec.motionSpeed * 0.22, rect.height * 0.017);
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.fillStyle = toRgba(palette.outline, 0.11);
    drawOrganicBlobPath(ctx, point.x + radiusX * 0.1, point.y + radiusY * 0.15, radiusX, radiusY, spec.seed + index, timeSeconds, spec.motionSpeed * 0.34);
    ctx.fill();
    applySquishTransform(ctx, spec.seed + index * 29, timeSeconds, spec.motionSpeed, 0.12);
    ctx.fillStyle = toRgba(index % 2 === 0 ? palette.surfaceSoft : palette.accentSoft, 0.66);
    drawOrganicBlobPath(ctx, point.x, point.y, radiusX, radiusY, spec.seed + index, timeSeconds, spec.motionSpeed * 0.34);
    ctx.fill();
    ctx.strokeStyle = toRgba(palette.sparkle, 0.5);
    ctx.lineWidth = Math.max(2.4, rect.width * 0.0025);
    drawOrganicBlobPath(ctx, point.x, point.y, radiusX * 0.93, radiusY * 0.93, spec.seed + index + 41, timeSeconds, spec.motionSpeed * 0.28);
    ctx.stroke();
    ctx.fillStyle = toRgba(palette.sparkle, 0.14);
    drawOrganicBlobPath(ctx, point.x - radiusX * 0.08, point.y - radiusY * 0.12, radiusX * 0.52, radiusY * 0.34, spec.seed + index + 67, timeSeconds, spec.motionSpeed * 0.3);
    ctx.fill();
    ctx.restore();
  }
};

const drawComicDots = (
  ctx: RuntimeCanvasContext,
  rect: DrawRect,
  palette: GeneratedPalette,
  spec: GeneratedBackgroundRecipe,
  timeSeconds: number
) => {
  const rng = createSeededRandom(spec.seed + 333);
  const clusters = 3;
  for (let cluster = 0; cluster < clusters; cluster += 1) {
    const anchor = createPeripheralPoint(rng, rect, spec.safeZone);
    const dotStep = rect.width * (0.024 + rng() * 0.008);
    const rows = 5 + Math.floor(rng() * 3);
    const cols = 6 + Math.floor(rng() * 3);
    ctx.fillStyle = toRgba(cluster % 2 === 0 ? palette.accent : palette.outline, 0.22 + spec.contrast * 0.18);
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const distance = Math.sqrt(row * row + col * col);
        const radius = Math.max(1.2, dotStep * 0.22 - distance * 0.38);
        if (radius <= 1.25) continue;
        ctx.beginPath();
        ctx.arc(
          anchor.x + col * dotStep + wave(cluster + col, timeSeconds, spec.motionSpeed * 0.25, rect.width * 0.004),
          anchor.y + row * dotStep + wave2(cluster + row, timeSeconds, spec.motionSpeed * 0.22, rect.height * 0.004),
          radius,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
    }
    const burstRadius = rect.width * (0.07 + rng() * 0.03);
    ctx.fillStyle = toRgba(palette.sparkle, 0.24);
    drawBurstPath(ctx, anchor.x, anchor.y, burstRadius, 8, spec.seed + cluster, timeSeconds, spec.motionSpeed * 0.4);
    ctx.fill();
  }
};

const drawRibbonSwoop = (
  ctx: RuntimeCanvasContext,
  rect: DrawRect,
  palette: GeneratedPalette,
  spec: GeneratedBackgroundRecipe,
  timeSeconds: number
) => {
  const rng = createSeededRandom(spec.seed + 444);
  ctx.lineCap = 'round';
  const ribbonCount = 4;
  for (let index = 0; index < ribbonCount; index += 1) {
    const start = createPeripheralPoint(rng, rect, spec.safeZone);
    const end = createPeripheralPoint(rng, rect, spec.safeZone);
    const lineWidth = rect.width * (0.02 + rng() * 0.012) * (0.72 + spec.accentScale * 0.36);
    const bend = rect.height * (0.18 + rng() * 0.18);
    const drift = wave(index + spec.seed, timeSeconds, spec.motionSpeed * 0.22, rect.height * 0.025);
    ctx.strokeStyle = toRgba(index % 2 === 0 ? palette.accentSoft : palette.surfaceSoft, 0.52);
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.bezierCurveTo(
      start.x + rect.width * 0.14,
      clamp(start.y + bend + drift, 0, rect.height),
      end.x - rect.width * 0.14,
      clamp(end.y - bend + drift, 0, rect.height),
      end.x,
      end.y
    );
    ctx.stroke();
    ctx.strokeStyle = toRgba(palette.sparkle, 0.42);
    ctx.lineWidth = Math.max(2, lineWidth * 0.22);
    ctx.stroke();
  }
};

const drawBlobGarden = (
  ctx: RuntimeCanvasContext,
  rect: DrawRect,
  palette: GeneratedPalette,
  spec: GeneratedBackgroundRecipe,
  timeSeconds: number
) => {
  const rng = createSeededRandom(spec.seed + 555);
  const count = Math.floor(6 + spec.density * 5);
  for (let index = 0; index < count; index += 1) {
    const point = createPeripheralPoint(rng, rect, spec.safeZone);
    const radiusX = rect.width * (0.09 + rng() * 0.08) * (0.9 + spec.accentScale * 0.34);
    const radiusY = rect.height * (0.08 + rng() * 0.06) * (0.92 + spec.accentScale * 0.18);
    const offsetX = wave(index + 3, timeSeconds, spec.motionSpeed * 0.28, rect.width * 0.01);
    const offsetY = wave(index + 9, timeSeconds, spec.motionSpeed * 0.3, rect.height * 0.018);
    ctx.save();
    ctx.translate(point.x + offsetX, point.y + offsetY);
    applySquishTransform(ctx, spec.seed + index * 13, timeSeconds, spec.motionSpeed, 0.18);
    ctx.fillStyle = toRgba(palette.outline, 0.08);
    drawOrganicBlobPath(ctx, radiusX * 0.08, radiusY * 0.1, radiusX, radiusY, spec.seed + index * 7, timeSeconds, spec.motionSpeed * 0.26);
    ctx.fill();
    ctx.fillStyle = toRgba(index % 2 === 0 ? palette.surface : palette.accentSoft, 0.46 + spec.contrast * 0.16);
    drawOrganicBlobPath(ctx, 0, 0, radiusX, radiusY, spec.seed + index * 7, timeSeconds, spec.motionSpeed * 0.26);
    ctx.fill();
    ctx.strokeStyle = toRgba(palette.sparkle, 0.34);
    ctx.lineWidth = Math.max(2, rect.width * 0.0022);
    drawOrganicBlobPath(ctx, 0, 0, radiusX * 0.86, radiusY * 0.86, spec.seed + index * 7 + 31, timeSeconds, spec.motionSpeed * 0.22);
    ctx.stroke();
    ctx.fillStyle = toRgba(palette.sparkle, 0.18);
    drawOrganicBlobPath(ctx, -radiusX * 0.12, -radiusY * 0.16, radiusX * 0.42, radiusY * 0.3, spec.seed + index * 7 + 57, timeSeconds, spec.motionSpeed * 0.24);
    ctx.fill();
    ctx.restore();
  }
};

const drawStarburst = (
  ctx: RuntimeCanvasContext,
  rect: DrawRect,
  palette: GeneratedPalette,
  spec: GeneratedBackgroundRecipe,
  timeSeconds: number
) => {
  const rng = createSeededRandom(spec.seed + 666);
  const count = 3;
  for (let index = 0; index < count; index += 1) {
    const point = createPeripheralPoint(rng, rect, spec.safeZone);
    const radius = rect.width * (0.06 + rng() * 0.04) * (0.84 + spec.accentScale * 0.34);
    const pulse = 0.92 + (Math.sin(timeSeconds * (0.8 + spec.motionSpeed * 0.45) + index * 1.7) + 1) * 0.09;
    ctx.fillStyle = toRgba(index % 2 === 0 ? palette.accent : palette.sparkle, 0.34 + spec.contrast * 0.18);
    drawBurstPath(ctx, point.x, point.y, radius * pulse, 8, spec.seed + index * 3, timeSeconds, spec.motionSpeed * 0.42);
    ctx.fill();
    ctx.strokeStyle = toRgba(palette.outline, 0.18);
    ctx.lineWidth = Math.max(2, rect.width * 0.0024);
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius * 0.32, 0, Math.PI * 2);
    ctx.stroke();
  }
};

const drawDoodleGlyph = (
  ctx: RuntimeCanvasContext,
  glyph: number,
  size: number
) => {
  if (glyph === 0) {
    ctx.beginPath();
    ctx.moveTo(-size, 0);
    ctx.bezierCurveTo(-size * 0.2, -size, size * 0.2, size, size, 0);
    ctx.stroke();
    return;
  }
  if (glyph === 1) {
    ctx.beginPath();
    ctx.moveTo(-size, -size * 0.25);
    ctx.lineTo(-size * 0.2, -size * 0.8);
    ctx.lineTo(size * 0.1, size * 0.1);
    ctx.lineTo(size, -size * 0.55);
    ctx.stroke();
    return;
  }
  if (glyph === 2) {
    drawStarPath(ctx, 0, 0, size, size * 0.45, 4);
    ctx.stroke();
    return;
  }
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.75, 0.1 * Math.PI, 1.9 * Math.PI);
  ctx.stroke();
};

const drawDoodleParade = (
  ctx: RuntimeCanvasContext,
  rect: DrawRect,
  palette: GeneratedPalette,
  spec: GeneratedBackgroundRecipe,
  timeSeconds: number
) => {
  const rng = createSeededRandom(spec.seed + 777);
  const count = Math.floor(14 + spec.density * 8);
  ctx.strokeStyle = toRgba(palette.outline, 0.3 + spec.contrast * 0.16);
  ctx.lineWidth = Math.max(2, rect.width * 0.0023);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let index = 0; index < count; index += 1) {
    const point = createPeripheralPoint(rng, rect, spec.safeZone);
    const size = rect.width * (0.016 + rng() * 0.012);
    ctx.save();
    ctx.translate(
      point.x + wave(index + 1, timeSeconds, spec.motionSpeed * 0.3, rect.width * 0.005),
      point.y + wave2(index + 4, timeSeconds, spec.motionSpeed * 0.26, rect.height * 0.006)
    );
    ctx.rotate(rng() * Math.PI * 2);
    drawDoodleGlyph(ctx, Math.floor(rng() * 4), size);
    ctx.restore();
  }
};

const drawSparkTrails = (
  ctx: RuntimeCanvasContext,
  rect: DrawRect,
  palette: GeneratedPalette,
  spec: GeneratedBackgroundRecipe,
  timeSeconds: number
) => {
  const rng = createSeededRandom(spec.seed + 888);
  const trailCount = 5;
  ctx.lineCap = 'round';
  for (let index = 0; index < trailCount; index += 1) {
    const start = createPeripheralPoint(rng, rect, spec.safeZone);
    const end = createPeripheralPoint(rng, rect, spec.safeZone);
    const control = {
      x: rect.width * (0.28 + rng() * 0.44),
      y: rect.height * (0.16 + rng() * 0.68)
    };
    ctx.strokeStyle = toRgba(index % 2 === 0 ? palette.sparkle : palette.accentSoft, 0.42);
    ctx.lineWidth = Math.max(2, rect.width * (0.004 + rng() * 0.002));
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.quadraticCurveTo(
      control.x + wave(index + 2, timeSeconds, spec.motionSpeed * 0.4, rect.width * 0.03),
      control.y + wave2(index + 5, timeSeconds, spec.motionSpeed * 0.36, rect.height * 0.03),
      end.x,
      end.y
    );
    ctx.stroke();
    for (let spark = 0; spark < 4; spark += 1) {
      const t = (spark + 1) / 5;
      const x =
        (1 - t) * (1 - t) * start.x +
        2 * (1 - t) * t * control.x +
        t * t * end.x;
      const y =
        (1 - t) * (1 - t) * start.y +
        2 * (1 - t) * t * control.y +
        t * t * end.y;
      const sparkleSize = rect.width * (0.006 + rng() * 0.003);
      ctx.fillStyle = toRgba(palette.sparkle, 0.68);
      ctx.beginPath();
      ctx.arc(
        x + wave(index + spark, timeSeconds, spec.motionSpeed * 0.5, rect.width * 0.004),
        y + wave2(index + spark, timeSeconds, spec.motionSpeed * 0.46, rect.height * 0.004),
        sparkleSize,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
  }
};

const drawLayeredWaveBand = (
  ctx: RuntimeCanvasContext,
  rect: DrawRect,
  yBase: number,
  amplitude: number,
  bandHeight: number,
  color: string,
  seed: number,
  timeSeconds: number,
  speed: number
) => {
  ctx.beginPath();
  ctx.moveTo(0, rect.height);
  ctx.lineTo(0, yBase);
  for (let step = 0; step <= 18; step += 1) {
    const x = (rect.width / 18) * step;
    const y =
      yBase +
      Math.sin((step / 18) * Math.PI * 2 + seed * 0.27 + timeSeconds * speed) * amplitude +
      Math.cos((step / 18) * Math.PI * 3 + seed * 0.11) * amplitude * 0.3;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(rect.width, rect.height);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(0, yBase - bandHeight * 0.12, rect.width, bandHeight * 0.16);
};

const drawLayeredWaves = (
  ctx: RuntimeCanvasContext,
  rect: DrawRect,
  palette: GeneratedPalette,
  spec: GeneratedBackgroundRecipe,
  timeSeconds: number
) => {
  const layers = 5;
  for (let layer = 0; layer < layers; layer += 1) {
    const yBase = rect.height * (0.28 + layer * 0.12);
    const amplitude = rect.height * (0.014 + layer * 0.003 + spec.accentScale * 0.004);
    const bandHeight = rect.height * (0.18 + layer * 0.02);
    const color =
      layer % 2 === 0
        ? toRgba(palette.surfaceSoft, 0.28 + layer * 0.06)
        : toRgba(palette.accentSoft, 0.22 + layer * 0.06);
    drawLayeredWaveBand(
      ctx,
      rect,
      yBase,
      amplitude,
      bandHeight,
      color,
      spec.seed + layer * 17,
      timeSeconds,
      spec.motionSpeed * (0.28 + layer * 0.04)
    );
  }
};

const drawStickerShape = (
  ctx: RuntimeCanvasContext,
  shapeIndex: number,
  size: number
) => {
  if (shapeIndex === 0) {
    drawStarPath(ctx, 0, 0, size, size * 0.48, 5);
    return;
  }
  if (shapeIndex === 1) {
    drawRoundedRectPath(ctx, -size, -size * 0.72, size * 2, size * 1.44, size * 0.42);
    return;
  }
  if (shapeIndex === 2) {
    ctx.beginPath();
    ctx.arc(0, 0, size, 0, Math.PI * 2);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(-size * 0.7, -size * 0.2);
  ctx.lineTo(-size * 0.1, -size);
  ctx.lineTo(size * 0.25, -size * 0.28);
  ctx.lineTo(size * 0.82, -size * 0.58);
  ctx.lineTo(size * 0.22, size);
  ctx.lineTo(-size * 0.18, size * 0.24);
  ctx.closePath();
};

const drawStickerScatter = (
  ctx: RuntimeCanvasContext,
  rect: DrawRect,
  palette: GeneratedPalette,
  spec: GeneratedBackgroundRecipe,
  timeSeconds: number
) => {
  const rng = createSeededRandom(spec.seed + 999);
  const count = Math.floor(8 + spec.density * 7);
  for (let index = 0; index < count; index += 1) {
    const point = createPeripheralPoint(rng, rect, spec.safeZone);
    const size = rect.width * (0.022 + rng() * 0.016) * (0.84 + spec.accentScale * 0.38);
    ctx.save();
    ctx.translate(
      point.x + wave(index + 11, timeSeconds, spec.motionSpeed * 0.32, rect.width * 0.012),
      point.y + wave2(index + 14, timeSeconds, spec.motionSpeed * 0.28, rect.height * 0.016)
    );
    ctx.rotate(rng() * Math.PI * 2 + timeSeconds * spec.motionSpeed * 0.14);
    applySquishTransform(ctx, spec.seed + index * 23, timeSeconds, spec.motionSpeed, 0.18);
    ctx.fillStyle = toRgba(index % 2 === 0 ? palette.surfaceSoft : palette.accent, 0.68);
    ctx.shadowColor = toRgba(palette.outline, 0.14);
    ctx.shadowBlur = rect.width * 0.016;
    ctx.shadowOffsetY = rect.height * 0.01;
    ctx.strokeStyle = toRgba(palette.sparkle, 0.95);
    ctx.lineWidth = Math.max(3.5, rect.width * 0.0038);
    drawStickerShape(ctx, Math.floor(rng() * 4), size);
    ctx.fill();
    ctx.stroke();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = toRgba(palette.outline, 0.16);
    ctx.lineWidth = Math.max(1, rect.width * 0.0018);
    ctx.stroke();
    ctx.restore();
  }
};

export const drawGeneratedBackground = (
  ctx: RuntimeCanvasContext,
  spec: GeneratedBackgroundRecipe,
  rect: DrawRect,
  timeSeconds = 0
) => {
  const playfulSpec = tuneRecipeForRender(spec);
  const palette = GENERATED_PALETTES[playfulSpec.paletteId];

  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.clip();
  ctx.translate(rect.x, rect.y);

  drawBaseBackdrop(ctx, rect, palette, playfulSpec, timeSeconds);

  switch (playfulSpec.family) {
    case 'confetti_field':
      drawConfettiField(ctx, rect, palette, playfulSpec, timeSeconds);
      break;
    case 'paper_cut':
      drawPaperCut(ctx, rect, palette, playfulSpec, timeSeconds);
      break;
    case 'comic_dots':
      drawComicDots(ctx, rect, palette, playfulSpec, timeSeconds);
      break;
    case 'ribbon_swoop':
      drawRibbonSwoop(ctx, rect, palette, playfulSpec, timeSeconds);
      break;
    case 'blob_garden':
      drawBlobGarden(ctx, rect, palette, playfulSpec, timeSeconds);
      break;
    case 'starburst':
      drawStarburst(ctx, rect, palette, playfulSpec, timeSeconds);
      break;
    case 'doodle_parade':
      drawDoodleParade(ctx, rect, palette, playfulSpec, timeSeconds);
      break;
    case 'spark_trails':
      drawSparkTrails(ctx, rect, palette, playfulSpec, timeSeconds);
      break;
    case 'layered_waves':
      drawLayeredWaves(ctx, rect, palette, playfulSpec, timeSeconds);
      break;
    case 'sticker_scatter':
    default:
      drawStickerScatter(ctx, rect, palette, playfulSpec, timeSeconds);
      break;
  }

  drawDetailTexture(ctx, rect, palette, playfulSpec, timeSeconds);
  drawCenterQuietZone(ctx, rect, palette, playfulSpec);

  const vignette = ctx.createLinearGradient(0, 0, 0, rect.height);
  vignette.addColorStop(0, toRgba(palette.outline, 0.04));
  vignette.addColorStop(0.5, 'rgba(255,255,255,0)');
  vignette.addColorStop(1, toRgba(palette.outline, 0.06));
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, rect.width, rect.height);

  ctx.restore();
};

export const renderGeneratedBackgroundToCanvas = (
  spec: GeneratedBackgroundRecipe,
  width: number,
  height: number,
  existing?: RuntimeCanvas,
  timeSeconds = 0
) => {
  const canvas = createRuntimeCanvas(width, height, existing);
  const ctx = getRuntimeCanvasContext(canvas);
  drawGeneratedBackground(ctx, spec, { x: 0, y: 0, width, height }, timeSeconds);
  return canvas;
};

export const coerceGeneratedBackgroundRecipe = (
  value: unknown,
  fallbackSeed: number,
  fallbackFamily: GeneratedBackgroundMotifFamily = 'confetti_field',
  fallbackPaletteId: GeneratedBackgroundPaletteId = 'sunrise'
): GeneratedBackgroundRecipe | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const family = resolveLegacyFamily(candidate.family ?? candidate.sceneKind) ?? fallbackFamily;
  const paletteId = DEFAULT_PALETTE_IDS.includes(candidate.paletteId as GeneratedBackgroundPaletteId)
    ? (candidate.paletteId as GeneratedBackgroundPaletteId)
    : fallbackPaletteId;
  const detailStyle =
    resolveLegacyDetailStyle(candidate.detailStyle ?? candidate.pattern) ??
    pick(resolveDetailPool(family), createSeededRandom(fallbackSeed));

  return {
    id:
      typeof candidate.id === 'string' && candidate.id.trim()
        ? candidate.id.trim()
        : `generated-background-${fallbackSeed}`,
    name:
      typeof candidate.name === 'string' && candidate.name.trim()
        ? candidate.name.trim()
        : buildRecipeName(family, Math.max(0, fallbackSeed - 1)),
    seed: Math.max(1, Math.floor(Number(candidate.seed) || fallbackSeed)),
    family,
    paletteId,
    density: clamp(Number(candidate.density) || 0.5, 0.18, 1),
    accentScale: clamp(Number(candidate.accentScale) || 0.5, 0.25, 1),
    contrast: clamp(Number(candidate.contrast) || 0.4, 0.18, 0.78),
    safeZone: clamp(Number(candidate.safeZone) || Number(candidate.horizon) || 0.62, 0.45, 0.82),
    motionSpeed: clamp(Number(candidate.motionSpeed) || 0.78, 0.35, 1.55),
    detailStyle
  };
};

export const createGeneratedBackgroundPack = ({
  name,
  description,
  aspectRatio = DEFAULT_ASPECT_RATIO,
  count,
  baseSeed = Date.now(),
  families = DEFAULT_FAMILIES,
  paletteIds = DEFAULT_PALETTE_IDS
}: GeneratedBackgroundPackOptions): GeneratedBackgroundPack => {
  void count;
  const safeCount = normalizePackCount();
  const safeName = name.trim() || `Background Pack ${new Date().toLocaleString()}`;
  const safeDescription =
    description?.trim() ||
    'Motion-ready video scene backgrounds tuned to stay playful behind the puzzle panels.';
  const now = Date.now();
  const safeFamilies = families.length ? families : DEFAULT_FAMILIES;
  const safePaletteIds = paletteIds.length ? paletteIds : DEFAULT_PALETTE_IDS;
  const familySequence = createBalancedSequence(safeFamilies, safeCount, baseSeed + 11);
  const paletteSequence = createBalancedSequence(safePaletteIds, safeCount, baseSeed + 23);
  const detailSequence = createBalancedSequence(DEFAULT_DETAIL_POOL, safeCount, baseSeed + 47);
  const rng = createSeededRandom(baseSeed + 71);
  const backgrounds: GeneratedBackgroundRecipe[] = Array.from({ length: safeCount }, (_entry, index) => {
    const family = familySequence[index];
    const paletteId = paletteSequence[index];
    const familyDetailPool = resolveDetailPool(family);
    const detailStyle = familyDetailPool.includes(detailSequence[index])
      ? detailSequence[index]
      : pick(familyDetailPool, rng);
    const seed = Math.floor((baseSeed + 1) * (index + 19) * (1.05 + rng() * 0.35));
    return {
      id: createBackgroundId(safeName, index, seed),
      name: buildRecipeName(family, index),
      seed,
      family,
      paletteId,
      density: clamp(0.4 + rng() * 0.48, 0.24, 1),
      accentScale: clamp(0.56 + rng() * 0.36, 0.42, 1),
      contrast: clamp(0.28 + rng() * 0.24, 0.24, 0.68),
      safeZone: clamp(0.56 + rng() * 0.18, 0.48, 0.8),
      motionSpeed: clamp(0.62 + rng() * 0.56, 0.48, 1.42),
      detailStyle
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
    description: 'A balanced 100-background set of playful video-scene backdrops for puzzle playback.',
    count: GENERATED_BACKGROUND_PACK_SIZE,
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
): GeneratedBackgroundRecipe | null => {
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
