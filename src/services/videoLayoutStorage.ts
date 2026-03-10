import type { CustomVideoLayout } from '../types';

const STORAGE_KEY = 'spotitnow.video-layout-custom.v2';

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isCustomLayout = (value: unknown): value is CustomVideoLayout => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as CustomVideoLayout;
  return (
    isFiniteNumber(candidate.headerHeight) &&
    isFiniteNumber(candidate.contentPadding) &&
    isFiniteNumber(candidate.panelGap) &&
    isFiniteNumber(candidate.panelRadius) &&
    isFiniteNumber(candidate.gamePadding) &&
    isFiniteNumber(candidate.logoTop) &&
    isFiniteNumber(candidate.logoLeft) &&
    isFiniteNumber(candidate.logoSize) &&
    isFiniteNumber(candidate.titleTop) &&
    isFiniteNumber(candidate.titleLeft) &&
    (candidate.titleAlign === 'left' || candidate.titleAlign === 'center' || candidate.titleAlign === 'right') &&
    isFiniteNumber(candidate.titleFontSize) &&
    isFiniteNumber(candidate.subtitleSize) &&
    isFiniteNumber(candidate.subtitleGap) &&
    isFiniteNumber(candidate.timerTop) &&
    isFiniteNumber(candidate.timerLeft) &&
    isFiniteNumber(candidate.timerPadX) &&
    isFiniteNumber(candidate.timerPadY) &&
    isFiniteNumber(candidate.timerDotSize) &&
    isFiniteNumber(candidate.timerGap) &&
    isFiniteNumber(candidate.timerFontSize) &&
    isFiniteNumber(candidate.timerMinWidth) &&
    isFiniteNumber(candidate.progressTop) &&
    isFiniteNumber(candidate.progressLeft) &&
    isFiniteNumber(candidate.progressWidth) &&
    isFiniteNumber(candidate.progressHeight) &&
    isFiniteNumber(candidate.progressRadius) &&
    (candidate.progressOrientation === 'horizontal' || candidate.progressOrientation === 'vertical')
  );
};

export const sanitizeVideoCustomLayout = (value: unknown): CustomVideoLayout | null => {
  if (!isCustomLayout(value)) {
    return null;
  }

  return {
    ...value
  };
};

export const loadSavedVideoCustomLayout = (): CustomVideoLayout | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    return sanitizeVideoCustomLayout(parsed);
  } catch {
    return null;
  }
};

export const saveVideoCustomLayout = (layout: CustomVideoLayout): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    return true;
  } catch {
    return false;
  }
};

export const clearSavedVideoCustomLayout = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    window.localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
};

export const replaceSavedVideoCustomLayout = (layout: unknown): CustomVideoLayout | null => {
  const safeLayout = sanitizeVideoCustomLayout(layout);

  if (safeLayout) {
    saveVideoCustomLayout(safeLayout);
    return safeLayout;
  }

  clearSavedVideoCustomLayout();
  return null;
};
