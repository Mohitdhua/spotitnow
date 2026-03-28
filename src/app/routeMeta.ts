import type { LucideIcon } from 'lucide-react';
import {
  Camera,
  FolderKanban,
  Gamepad2,
  Home,
  Image,
  ImagePlus,
  Layers,
  Palette,
  PlaySquare,
  Scissors,
  Settings,
  Sparkles,
  TimerReset,
  Upload,
  Video
} from 'lucide-react';
import type { AppRoute } from '../types';

export interface AppRouteMeta {
  path: AppRoute;
  label: string;
  description: string;
  icon: LucideIcon;
  group: 'workflow' | 'tools' | 'system';
}

export const APP_ROUTE_META: AppRouteMeta[] = [
  { path: '/', label: 'Home', description: 'Project dashboard and workflow launcher.', icon: Home, group: 'workflow' },
  { path: '/create/upload', label: 'Create', description: 'Upload and detect puzzle pairs.', icon: Upload, group: 'workflow' },
  { path: '/create/review', label: 'Review', description: 'Review detected puzzles and choose the next step.', icon: Layers, group: 'workflow' },
  { path: '/create/editor', label: 'Puzzle Editor', description: 'Manually refine puzzle regions.', icon: ImagePlus, group: 'workflow' },
  { path: '/editor', label: 'Editor Studio', description: 'Compose layered media and linked-pair exports from anywhere.', icon: FolderKanban, group: 'tools' },
  { path: '/play', label: 'Play', description: 'Play the current puzzle batch.', icon: Gamepad2, group: 'workflow' },
  { path: '/video/setup', label: 'Video Setup', description: 'Configure puzzle video exports.', icon: Video, group: 'workflow' },
  { path: '/video/preview', label: 'Video Preview', description: 'Preview the current video package.', icon: PlaySquare, group: 'workflow' },
  { path: '/video/overlay', label: 'Editor Studio', description: 'Compose layered media and linked-pair exports from anywhere.', icon: FolderKanban, group: 'tools' },
  { path: '/tools/thumbnail', label: 'Thumbnails', description: 'Generate bold puzzle thumbnails from puzzle and diff images.', icon: Image, group: 'tools' },
  { path: '/tools/splitter', label: 'Splitter', description: 'Split combined source images into pairs.', icon: Scissors, group: 'tools' },
  { path: '/tools/extractor', label: 'Frame Extractor', description: 'Extract timed frames from videos.', icon: Camera, group: 'tools' },
  { path: '/tools/upscaler', label: 'Upscaler', description: 'Upscale and enhance images.', icon: Sparkles, group: 'tools' },
  { path: '/tools/backgrounds', label: 'Backgrounds', description: 'Build generated background packs.', icon: Palette, group: 'tools' },
  { path: '/tools/timers', label: 'Timers', description: 'Preview and apply timer styles.', icon: TimerReset, group: 'tools' },
  { path: '/tools/progress', label: 'Progress Bars', description: 'Generate animated progress bar exports.', icon: Layers, group: 'tools' },
  { path: '/tools/watermark', label: 'Watermark', description: 'Clean paired images using saved presets.', icon: ImagePlus, group: 'tools' },
  { path: '/settings', label: 'Settings', description: 'Manage shared defaults, backups, and presets.', icon: Settings, group: 'system' }
];

export const PRIMARY_NAV_ROUTES = APP_ROUTE_META.filter(
  (route) => route.path === '/create/upload' || route.path === '/video/setup' || route.path === '/tools/extractor'
);

export const TOOL_NAV_ROUTES = APP_ROUTE_META.filter(
  (route) => route.group === 'tools' && route.path !== '/video/overlay'
);

export const getRouteMeta = (pathname: string) =>
  APP_ROUTE_META.find((route) => route.path === pathname) ?? APP_ROUTE_META[0];
