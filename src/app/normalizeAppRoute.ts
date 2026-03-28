import type { AppRoute } from '../types';

export const normalizeAppRoute = (value: string | null | undefined): AppRoute => {
  switch (value) {
    case '/':
    case '/create/upload':
    case '/create/review':
    case '/create/editor':
    case '/editor':
    case '/play':
    case '/video/setup':
    case '/video/preview':
    case '/video/overlay':
    case '/tools/thumbnail':
    case '/tools/splitter':
    case '/tools/extractor':
    case '/tools/upscaler':
    case '/tools/vector':
    case '/tools/backgrounds':
    case '/tools/timers':
    case '/tools/progress':
    case '/tools/watermark':
    case '/settings':
      return value;
    default:
      return '/';
  }
};
