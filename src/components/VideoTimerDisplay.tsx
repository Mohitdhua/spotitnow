import React from 'react';
import {
  buildTimerBackground,
  measureResolvedTimerBox,
  resolveTimerRenderProfile,
  type ResolvedVideoTimerStyle
} from '../constants/videoStyleModules';
import type { VisualTheme } from '../constants/videoThemes';
import { DESIGNER_TIMER_COMPONENTS } from './timers';
import {
  isDesignerTimerStyle,
  resolveDesignerTimerPalette
} from '../utils/timerPackShared';

interface VideoTimerDisplayProps {
  style: ResolvedVideoTimerStyle;
  visualTheme: VisualTheme;
  valueText: string;
  fontSize: number;
  padX: number;
  padY: number;
  dotSize: number;
  gap: number;
  minWidth: number;
  justifyContent?: React.CSSProperties['justifyContent'];
  isAlert?: boolean;
  className?: string;
  durationSeconds?: number;
  remainingSeconds?: number;
  progress?: number;
  surfaceTone?: 'default' | 'studio';
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const renderIndicator = (
  style: ResolvedVideoTimerStyle,
  color: string,
  dotSize: number
) => {
  if (style.dotKind === 'none') return null;
  if (style.dotKind === 'bar') {
    return (
      <span
        className="inline-block rounded-full"
        style={{
          width: `${Math.round(dotSize * 1.45)}px`,
          height: `${Math.max(4, Math.round(dotSize * 0.45))}px`,
          backgroundColor: color
        }}
      />
    );
  }
  if (style.dotKind === 'spark') {
    return (
      <span
        className="inline-block rounded-sm"
        style={{
          width: `${dotSize}px`,
          height: `${dotSize}px`,
          backgroundColor: color,
          transform: 'rotate(45deg)'
        }}
      />
    );
  }
  return (
    <span
      className="inline-block rounded-full"
      style={{
        width: `${dotSize}px`,
        height: `${dotSize}px`,
        backgroundColor: color
      }}
    />
  );
};

const buildShadow = (profileShadow: ReturnType<typeof resolveTimerRenderProfile>['shadow'], accent: string) => {
  if (profileShadow === 'glow') {
    return `0 0 0 2px rgba(0,0,0,0.9), 0 0 18px ${accent}`;
  }
  if (profileShadow === 'offset') {
    return '3px 3px 0 rgba(0,0,0,1)';
  }
  return 'none';
};

export const VideoTimerDisplay: React.FC<VideoTimerDisplayProps> = ({
  style,
  visualTheme,
  valueText,
  fontSize,
  padX,
  padY,
  dotSize,
  gap,
  minWidth,
  justifyContent = 'center',
  isAlert = false,
  className = '',
  durationSeconds,
  remainingSeconds,
  progress,
  surfaceTone = 'default'
}) => {
  const isStudioTone = surfaceTone === 'studio';
  if (isDesignerTimerStyle(style.id)) {
    const TimerComponent = DESIGNER_TIMER_COMPONENTS[style.id];
    const safeProgress =
      typeof progress === 'number' && Number.isFinite(progress)
        ? clamp(progress, 0, 1)
        : undefined;
    const safeRemaining =
      typeof remainingSeconds === 'number' && Number.isFinite(remainingSeconds)
        ? Math.max(0, remainingSeconds)
        : undefined;
    const safeDuration =
      typeof durationSeconds === 'number' && Number.isFinite(durationSeconds)
        ? Math.max(0.5, durationSeconds)
        : undefined;
    const endingSoon =
      isAlert || (typeof safeProgress === 'number' ? safeProgress <= 0.2 : false);
    const size = Math.max(
      48,
      Math.round(
        Math.max(
          fontSize * 2.15,
          dotSize * 4.5,
          padY * 2 + fontSize + 18
        )
      )
    );

    return (
      <div className={className} style={{ display: 'flex', justifyContent }}>
        <TimerComponent
          duration={safeDuration}
          remainingTime={safeRemaining}
          progress={safeProgress}
          isEndingSoon={endingSoon}
          size={size}
          palette={resolveDesignerTimerPalette(
            visualTheme,
            endingSoon,
            typeof safeProgress === 'number' ? safeProgress : 1
          )}
        />
      </div>
    );
  }

  const profile = resolveTimerRenderProfile(style);
  const accentColor = isAlert ? '#FF6B6B' : visualTheme.timerDot;
  const textColor = isAlert ? '#FF6B6B' : visualTheme.timerText;
  const timerBackground = buildTimerBackground(style, visualTheme);
  const shellBorderColor = isStudioTone ? 'rgba(193, 248, 255, 0.42)' : visualTheme.timerBorder;
  const resolvedTextColor = isStudioTone ? '#EEF6FF' : textColor;
  const studioShellBackground = 'linear-gradient(180deg, rgba(9,18,29,0.98) 0%, rgba(17,30,45,0.98) 100%)';
  const studioPanelBackground = 'linear-gradient(180deg, rgba(10,18,30,0.96) 0%, rgba(18,31,47,0.92) 100%)';
  const studioGlassBackground = 'linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(101,217,255,0.08) 100%)';
  const badgeBackground = isStudioTone ? 'rgba(8,16,26,0.92)' : '#FFFFFF';
  const badgeBorderColor = isStudioTone ? 'rgba(193, 248, 255, 0.28)' : '#000000';
  const badgeTextColor = isStudioTone ? '#EEF6FF' : accentColor;
  const labelPanelTextColor = isStudioTone ? '#EEF6FF' : '#111827';
  const indicatorNeutral = isStudioTone ? 'rgba(238,246,255,0.74)' : '#FFFFFF';
  const estimatedTextWidth = Math.round(valueText.length * fontSize * 0.62);
  const metrics = measureResolvedTimerBox(style, {
    textWidth: estimatedTextWidth,
    fontSize,
    padX,
    padY,
    dotSize,
    gap,
    minWidth
  });
  const shellClass = profile.family === 'ring' ? 'rounded-full' : style.shapeClass;
  const shellStyle: React.CSSProperties = {
    width: `${metrics.width}px`,
    minWidth: `${metrics.width}px`,
    height: `${metrics.height}px`,
    background: isStudioTone ? studioShellBackground : timerBackground,
    borderColor: shellBorderColor,
    color: resolvedTextColor,
    boxShadow: buildShadow(profile.shadow, accentColor),
    transform: profile.tiltDeg === 0 ? undefined : `rotate(${profile.tiltDeg}deg)`
  };
  const textStyle: React.CSSProperties = {
    color: resolvedTextColor,
    fontSize: `${fontSize}px`
  };
  const label = profile.labelText ? (
    <span
      className="pointer-events-none absolute left-1/2 top-1.5 -translate-x-1/2 whitespace-nowrap rounded-full border border-black px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.18em]"
      style={{
        backgroundColor: badgeBackground,
        borderColor: badgeBorderColor,
        color: badgeTextColor
      }}
    >
      {profile.labelText}
    </span>
  ) : null;

  if (profile.family === 'ring') {
    const ringInset = Math.max(8, Math.round(metrics.width * 0.18));
    const innerInset = clamp(ringInset + 6, 10, Math.round(metrics.width * 0.28));
    return (
      <div className={`relative inline-flex items-center justify-center ${className}`} style={shellStyle}>
        <div className="absolute inset-0 rounded-full border-2 border-black" style={{ borderColor: shellBorderColor }} />
        <div
          className="absolute rounded-full border-[3px]"
          style={{
            inset: `${ringInset}px`,
            borderColor: accentColor
          }}
        />
        {profile.ornament === 'double' && (
          <div
            className="absolute rounded-full border border-black/70"
            style={{
              inset: `${innerInset}px`
            }}
          />
        )}
        {label}
        <span className={`${style.textClass} relative leading-none`} style={textStyle}>
          {valueText}
        </span>
      </div>
    );
  }

  if (profile.family === 'screen') {
    const labelWidth = profile.labelMode === 'left' ? Math.max(28, Math.round(fontSize * 1.28)) : 0;
    const indicator = renderIndicator(style, accentColor, dotSize);
    return (
      <div
        className={`relative inline-flex items-center overflow-hidden border-2 ${shellClass} ${className}`}
        style={shellStyle}
      >
        {profile.labelMode === 'left' && (
          <div
            className="flex h-full shrink-0 items-center justify-center border-r-2 border-black px-2"
            style={{ width: `${labelWidth}px`, backgroundColor: accentColor, color: labelPanelTextColor }}
          >
            <span className="text-[8px] font-black uppercase tracking-[0.2em]">{profile.labelText}</span>
          </div>
        )}
        <div
          className="relative m-1 flex flex-1 items-center justify-center gap-2 rounded-md border border-black/80 px-3"
          style={{
            height: `${Math.max(24, metrics.height - 8)}px`,
            background:
              profile.ornament === 'double'
                ? studioPanelBackground
                : isStudioTone
                  ? studioGlassBackground
                  : 'linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(0,0,0,0.16) 100%)'
          }}
        >
          <div className="absolute left-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
            {profile.ornament === 'double' ? (
              <>
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accentColor }} />
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accentColor, opacity: 0.7 }} />
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accentColor, opacity: 0.45 }} />
              </>
            ) : null}
          </div>
          {indicator}
          <span className={`${style.textClass} leading-none`} style={textStyle}>
            {valueText}
          </span>
        </div>
      </div>
    );
  }

  if (profile.family === 'split') {
    const labelWidth = Math.max(30, Math.round(fontSize * 1.45));
    const labelPanelStyle: React.CSSProperties =
      profile.ornament === 'chevron'
        ? {
            width: `${labelWidth + 8}px`,
            clipPath: 'polygon(0 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 0 100%)'
          }
        : { width: `${labelWidth}px` };

    return (
      <div
        className={`relative inline-flex items-center overflow-hidden border-2 ${shellClass} ${className}`}
        style={shellStyle}
      >
        {profile.labelMode === 'top' && label}
        {profile.labelMode === 'left' && (
          <div
            className="flex h-full shrink-0 items-center justify-center border-r-2 border-black px-2"
            style={{
              ...labelPanelStyle,
              backgroundColor: accentColor,
              color: labelPanelTextColor
            }}
          >
            <span className="text-[8px] font-black uppercase tracking-[0.18em]">{profile.labelText}</span>
          </div>
        )}
        <div
          className="relative flex flex-1 items-center justify-center gap-2 px-3"
          style={{
            height: '100%',
            paddingTop: profile.labelMode === 'top' ? '12px' : undefined,
            background: isStudioTone
              ? studioGlassBackground
              : 'linear-gradient(180deg, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0.06) 100%)'
          }}
        >
          {profile.ornament === 'panel' && (
            <div className="absolute inset-1 rounded-lg border border-black/60" />
          )}
          {renderIndicator(style, accentColor, dotSize)}
          <span className={`${style.textClass} relative leading-none`} style={textStyle}>
            {valueText}
          </span>
        </div>
      </div>
    );
  }

  if (profile.family === 'ticket') {
    return (
      <div
        className={`relative inline-flex items-center overflow-hidden border-2 ${shellClass} ${className}`}
        style={shellStyle}
      >
        <span
          className="absolute left-0 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-black"
          style={{ backgroundColor: isStudioTone ? 'rgba(8,16,26,0.94)' : visualTheme.headerBg }}
        />
        <span
          className="absolute right-0 top-1/2 h-4 w-4 translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-black"
          style={{ backgroundColor: isStudioTone ? 'rgba(8,16,26,0.94)' : visualTheme.headerBg }}
        />
        <div className="flex h-full shrink-0 items-center border-r-2 border-dashed border-black px-3">
          <span className="text-[8px] font-black uppercase tracking-[0.18em]" style={{ color: accentColor }}>
            {profile.labelText}
          </span>
        </div>
        <div className="flex flex-1 items-center justify-center gap-2 px-3">
          {renderIndicator(style, accentColor, dotSize)}
          <span className={`${style.textClass} leading-none`} style={textStyle}>
            {valueText}
          </span>
        </div>
      </div>
    );
  }

  if (profile.family === 'flip') {
    return (
      <div
        className={`relative inline-flex items-center justify-center overflow-hidden border-2 rounded-md ${className}`}
        style={{
          ...shellStyle,
          background: 'linear-gradient(180deg, rgba(15,23,42,0.98) 0%, rgba(30,41,59,0.98) 100%)'
        }}
      >
        {label}
        <div className="absolute inset-x-0 top-0 h-1/2 bg-white/10" />
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-black/16" />
        <div className="absolute inset-x-0 top-1/2 h-px bg-white/30" />
        <span className="absolute left-2 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-white/70" />
        <span className="absolute right-2 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-white/70" />
        <span className={`${style.textClass} relative leading-none`} style={textStyle}>
          {valueText}
        </span>
      </div>
    );
  }

  if (profile.family === 'sticker') {
    return (
      <div
        className={`relative inline-flex items-center justify-center gap-2 border-2 border-black px-3 ${shellClass} ${className}`}
        style={shellStyle}
      >
        {label}
        {(profile.ornament === 'burst' || profile.ornament === 'double') && (
          <>
            <span className="absolute left-2 top-2 h-2 w-2 rounded-full bg-white/60" />
            <span className="absolute right-3 bottom-2 h-1.5 w-1.5 rounded-full bg-white/60" />
            <span className="absolute right-2 top-3 h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accentColor }} />
          </>
        )}
        {profile.ornament === 'double' && (
          <div className="absolute inset-1 rounded-[inherit] border border-dashed border-black/60" />
        )}
        {renderIndicator(style, accentColor, dotSize)}
        <span className={`${style.textClass} relative leading-none`} style={textStyle}>
          {valueText}
        </span>
      </div>
    );
  }

  if (profile.family === 'marquee') {
    const bulbs = Array.from({ length: 7 }, (_, index) => index);
    return (
      <div
        className={`relative inline-flex items-center justify-center overflow-hidden border-2 rounded-xl ${className}`}
        style={{
          ...shellStyle,
          background: 'linear-gradient(180deg, rgba(15,23,42,0.98) 0%, rgba(17,24,39,0.98) 100%)'
        }}
      >
        {label}
        <div className="absolute inset-[6px] rounded-lg border border-black/70 bg-white/10" />
        <div className="absolute left-2 right-2 top-1 flex items-center justify-between">
          {bulbs.map((bulb) => (
            <span
            key={`top-${bulb}`}
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: bulb % 2 === 0 ? accentColor : indicatorNeutral }}
          />
        ))}
      </div>
        <div className="absolute bottom-1 left-2 right-2 flex items-center justify-between">
          {bulbs.map((bulb) => (
            <span
            key={`bottom-${bulb}`}
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: bulb % 2 === 0 ? indicatorNeutral : accentColor }}
          />
        ))}
      </div>
        <span className={`${style.textClass} relative leading-none`} style={textStyle}>
          {valueText}
        </span>
      </div>
    );
  }

  if (profile.family === 'frame') {
    return (
      <div
        className={`relative inline-flex items-center justify-center gap-2 border-2 ${shellClass} ${className}`}
        style={shellStyle}
      >
        {profile.labelMode === 'left' && (
          <span
            className="border-r-2 border-black pr-2 text-[8px] font-black uppercase tracking-[0.2em]"
            style={{ color: accentColor }}
          >
            {profile.labelText}
          </span>
        )}
        {profile.ornament === 'double' && (
          <div className="absolute inset-1 rounded-[inherit] border border-black/50" />
        )}
        {profile.ornament === 'brackets' && (
          <>
            <span className="absolute left-1 top-1 h-2 w-2 border-l-2 border-t-2 border-black" />
            <span className="absolute right-1 top-1 h-2 w-2 border-r-2 border-t-2 border-black" />
            <span className="absolute bottom-1 left-1 h-2 w-2 border-b-2 border-l-2 border-black" />
            <span className="absolute bottom-1 right-1 h-2 w-2 border-b-2 border-r-2 border-black" />
          </>
        )}
        <span className={`${style.textClass} relative leading-none`} style={textStyle}>
          {valueText}
        </span>
      </div>
    );
  }

  if (profile.family === 'dual') {
    return (
      <div
        className={`relative inline-flex items-center gap-2 border-2 ${shellClass} ${className}`}
        style={shellStyle}
      >
        {profile.labelMode === 'left' && (
          <span
            className="ml-1 rounded-full border border-black px-2 py-1 text-[8px] font-black uppercase tracking-[0.18em]"
            style={{ backgroundColor: accentColor, color: labelPanelTextColor }}
          >
            {profile.labelText}
          </span>
        )}
        <div
          className="m-1 flex flex-1 items-center justify-center rounded-full border border-black/80 px-3"
          style={{
            height: `${Math.max(22, metrics.height - 8)}px`,
            background: isStudioTone
              ? studioGlassBackground
              : 'linear-gradient(180deg, rgba(255,255,255,0.34) 0%, rgba(255,255,255,0.12) 100%)'
          }}
        >
          <span className={`${style.textClass} leading-none`} style={textStyle}>
            {valueText}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`inline-flex items-center gap-2 border-2 ${shellClass} ${className}`}
      style={{
        ...shellStyle,
        justifyContent
      }}
    >
      {renderIndicator(style, accentColor, dotSize)}
      <span className={`${style.textClass} leading-none`} style={textStyle}>
        {valueText}
      </span>
    </div>
  );
};
