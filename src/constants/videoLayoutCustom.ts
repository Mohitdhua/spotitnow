import { CustomVideoLayout, VideoSettings } from '../types';
import { BASE_STAGE_SIZE } from './videoLayoutSpec';
import { HudAnchorSpec, HudLayoutSpec } from './videoHudLayoutSpec';
import { VIDEO_PACKAGE_PRESETS } from './videoPackages';

export interface ResolvedVideoLayoutSettings {
  hud: HudLayoutSpec;
  frame: {
    headerHeight: number;
    contentPadding: number;
    panelGap: number;
    panelRadius: number;
    gamePadding: number;
  };
  logo: {
    top: number;
    left: number;
    size: number;
  };
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const resolveAnchorLeft = (
  anchor: HudAnchorSpec,
  stageWidth: number,
  elementWidth: number,
  fallback: number
) => {
  if (anchor.left !== undefined) return anchor.left;
  if (anchor.right !== undefined) return Math.max(0, stageWidth - anchor.right - elementWidth);
  if (anchor.centerX) return Math.max(0, stageWidth / 2 - elementWidth / 2);
  return fallback;
};

const resolveAnchorTop = (
  anchor: HudAnchorSpec,
  headerHeight: number,
  elementHeight: number,
  fallback: number
) => {
  if (anchor.top !== undefined) return anchor.top;
  if (anchor.bottom !== undefined) return Math.max(0, headerHeight - anchor.bottom - elementHeight);
  if (anchor.centerY) return Math.max(0, headerHeight / 2 - elementHeight / 2);
  return fallback;
};

const buildDefaultFrameLayout = (
  videoPackagePreset: VideoSettings['videoPackagePreset'],
  aspectRatio: VideoSettings['aspectRatio']
) => {
  const stage = BASE_STAGE_SIZE[aspectRatio];
  const baseUiScale = Math.min(stage.width, stage.height) / 1080;
  const packagePreset =
    VIDEO_PACKAGE_PRESETS[videoPackagePreset] ?? VIDEO_PACKAGE_PRESETS.gameshow;
  const isStorybook =
    packagePreset.surfaceStyle === 'storybook' && aspectRatio === '16:9';
  return {
    headerHeight: packagePreset.hudLayout.headerHeight,
    contentPadding: Math.max(4, Math.round(packagePreset.frameDefaults.contentPadding * baseUiScale)),
    panelGap: Math.max(4, Math.round(packagePreset.frameDefaults.panelGap * baseUiScale)),
    panelRadius: Math.max(4, Math.round(packagePreset.frameDefaults.panelRadius * baseUiScale)),
    gamePadding: Math.max(0, Math.round(packagePreset.frameDefaults.gamePadding * baseUiScale))
  };
};

export const buildDefaultCustomVideoLayout = (
  videoPackagePreset: VideoSettings['videoPackagePreset'],
  aspectRatio: VideoSettings['aspectRatio']
): CustomVideoLayout => {
  const packagePreset =
    VIDEO_PACKAGE_PRESETS[videoPackagePreset] ?? VIDEO_PACKAGE_PRESETS.gameshow;
  const spec = packagePreset.hudLayout;
  const stage = BASE_STAGE_SIZE[aspectRatio];
  const defaults = buildDefaultFrameLayout(videoPackagePreset, aspectRatio);

  const titleHeight = spec.title.fontSize + spec.title.subtitleSize + spec.title.subtitleGap;
  const timerHeight = Math.max(
    spec.timer.dotSize + spec.timer.padY * 2 + 2,
    spec.timer.fontSize + spec.timer.padY * 2 + 2
  );
  const logoSize = packagePreset.chrome.logoSize;
  const titleTop = resolveAnchorTop(spec.title, spec.headerHeight, titleHeight, 8);
  const titleLeft = resolveAnchorLeft(spec.title, stage.width, 340, 16);
  const logoTop = resolveAnchorTop(spec.title, spec.headerHeight, logoSize, 8);
  const logoLeft =
    spec.title.align === 'left'
      ? titleLeft
      : Math.max(0, titleLeft - logoSize - packagePreset.chrome.titleGap);
  const adjustedTitleLeft =
    spec.title.align === 'left'
      ? Math.min(stage.width, titleLeft + logoSize + packagePreset.chrome.titleGap)
      : titleLeft;

  return {
    headerHeight: defaults.headerHeight,
    contentPadding: defaults.contentPadding,
    panelGap: defaults.panelGap,
    panelRadius: defaults.panelRadius,
    gamePadding: defaults.gamePadding,
    logoTop,
    logoLeft,
    logoSize,
    titleTop,
    titleLeft: adjustedTitleLeft,
    titleAlign: spec.title.align,
    titleFontSize: spec.title.fontSize,
    subtitleSize: spec.title.subtitleSize,
    subtitleGap: spec.title.subtitleGap,
    timerTop: resolveAnchorTop(spec.timer, spec.headerHeight, timerHeight, 8),
    timerLeft: resolveAnchorLeft(spec.timer, stage.width, spec.timer.minWidth, 16),
    timerPadX: spec.timer.padX,
    timerPadY: spec.timer.padY,
    timerDotSize: spec.timer.dotSize,
    timerGap: spec.timer.gap,
    timerFontSize: spec.timer.fontSize,
    timerMinWidth: spec.timer.minWidth,
    progressTop: resolveAnchorTop(spec.progress, spec.headerHeight, spec.progress.height, 40),
    progressLeft: resolveAnchorLeft(spec.progress, stage.width, spec.progress.width, 16),
    progressWidth: spec.progress.width,
    progressHeight: spec.progress.height,
    progressRadius: spec.progress.radius,
    progressOrientation: spec.progress.orientation
  };
};

export const resolveVideoLayoutSettings = (
  videoPackagePreset: VideoSettings['videoPackagePreset'],
  aspectRatio: VideoSettings['aspectRatio'],
  settings: Pick<VideoSettings, 'useCustomLayout' | 'customLayout'>
): ResolvedVideoLayoutSettings => {
  const packagePreset =
    VIDEO_PACKAGE_PRESETS[videoPackagePreset] ?? VIDEO_PACKAGE_PRESETS.gameshow;
  const baseHud = packagePreset.hudLayout;
  const baseFrame = buildDefaultFrameLayout(videoPackagePreset, aspectRatio);
  const stage = BASE_STAGE_SIZE[aspectRatio];

  if (!settings.useCustomLayout) {
    const fallback = buildDefaultCustomVideoLayout(videoPackagePreset, aspectRatio);
    return {
      hud: baseHud,
      frame: baseFrame,
      logo: {
        top: fallback.logoTop,
        left: fallback.logoLeft,
        size: fallback.logoSize
      }
    };
  }

  const fallback = buildDefaultCustomVideoLayout(videoPackagePreset, aspectRatio);
  const custom = settings.customLayout ?? fallback;
  const maxHeaderHeight = Math.max(40, Math.round(stage.height * 0.45));
  const headerHeight = clamp(Math.round(custom.headerHeight), 36, maxHeaderHeight);

  const hud: HudLayoutSpec = {
    headerHeight,
    title: {
      top: clamp(Math.round(custom.titleTop), 0, Math.max(0, headerHeight - 4)),
      left: clamp(Math.round(custom.titleLeft), 0, stage.width),
      align: custom.titleAlign,
      fontSize: clamp(Math.round(custom.titleFontSize), 10, 96),
      subtitleSize: clamp(Math.round(custom.subtitleSize), 8, 72),
      subtitleGap: clamp(Math.round(custom.subtitleGap), 0, 24)
    },
    timer: {
      top: clamp(Math.round(custom.timerTop), 0, Math.max(0, headerHeight - 4)),
      left: clamp(Math.round(custom.timerLeft), 0, stage.width),
      padX: clamp(Math.round(custom.timerPadX), 2, 80),
      padY: clamp(Math.round(custom.timerPadY), 1, 40),
      dotSize: clamp(Math.round(custom.timerDotSize), 2, 64),
      gap: clamp(Math.round(custom.timerGap), 2, 40),
      fontSize: clamp(Math.round(custom.timerFontSize), 0, 96),
      minWidth: clamp(Math.round(custom.timerMinWidth), 24, stage.width)
    },
    progress: {
      top: clamp(Math.round(custom.progressTop), 0, Math.max(0, headerHeight - 4)),
      left: clamp(Math.round(custom.progressLeft), 0, stage.width),
      width: clamp(Math.round(custom.progressWidth), 4, stage.width),
      height: clamp(Math.round(custom.progressHeight), 4, Math.max(4, headerHeight)),
      radius: clamp(Math.round(custom.progressRadius), 0, 999),
      orientation: custom.progressOrientation
    }
  };

  return {
    hud,
    frame: {
      headerHeight,
      contentPadding: clamp(Math.round(custom.contentPadding), 0, Math.round(stage.height * 0.24)),
      panelGap: clamp(Math.round(custom.panelGap), 0, Math.round(stage.width * 0.2)),
      panelRadius: clamp(Math.round(custom.panelRadius), 0, 360),
      gamePadding: clamp(Math.round(custom.gamePadding), 0, 160)
    },
    logo: {
      top: clamp(Math.round(custom.logoTop), 0, Math.max(0, headerHeight - 4)),
      left: clamp(Math.round(custom.logoLeft), 0, stage.width),
      size: clamp(Math.round(custom.logoSize), 12, 240)
    }
  };
};
