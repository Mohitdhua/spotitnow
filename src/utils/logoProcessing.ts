export interface LogoChromaKeyOptions {
  enabled: boolean;
  color: string;
  tolerance: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const hexToRgb = (hex: string) => {
  const normalized =
    hex.length === 4
      ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
      : hex;
  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return { r: 0, g: 255, b: 0 };
  }
  return { r, g, b };
};

export const clampLogoZoom = (value: number) => clamp(Number(value) || 1, 0.5, 4);

export const clampLogoChromaTolerance = (value: number) =>
  clamp(Number(value) || 0, 0, 255);

export const applyLogoChromaKey = (
  imageData: ImageData,
  options: LogoChromaKeyOptions
) => {
  if (!options.enabled) return imageData;

  const { r: keyR, g: keyG, b: keyB } = hexToRgb(options.color);
  const tolerance = clampLogoChromaTolerance(options.tolerance);
  const feather = Math.max(12, tolerance * 0.35);
  const data = imageData.data;

  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3];
    if (alpha === 0) continue;

    const dr = data[index] - keyR;
    const dg = data[index + 1] - keyG;
    const db = data[index + 2] - keyB;
    const distance = Math.sqrt(dr * dr + dg * dg + db * db);

    if (distance <= tolerance) {
      data[index + 3] = 0;
      continue;
    }

    if (distance <= tolerance + feather) {
      const keepRatio = (distance - tolerance) / feather;
      data[index + 3] = Math.round(alpha * keepRatio);
    }
  }

  return imageData;
};
