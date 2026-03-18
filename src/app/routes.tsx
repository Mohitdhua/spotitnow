import { Suspense, lazy, type ReactNode } from 'react';
import { Navigate, createBrowserRouter } from 'react-router-dom';
import { AppShell } from './AppShell';
import { RouteErrorBoundary } from './components/RouteErrorBoundary';

const DashboardPage = lazy(() => import('../features/dashboard/DashboardPage'));
const CreateUploadPage = lazy(() => import('../features/create/CreateUploadPage'));
const CreateReviewPage = lazy(() => import('../features/create/CreateReviewPage'));
const CreateEditorPage = lazy(() => import('../features/create/CreateEditorPage'));
const PlayPage = lazy(() => import('../features/play/PlayPage'));
const VideoSetupPage = lazy(() => import('../features/video/VideoSetupPage'));
const VideoPreviewPage = lazy(() => import('../features/video/VideoPreviewPage'));
const VideoOverlayPage = lazy(() => import('../features/video/VideoOverlayPage'));
const SplitterPage = lazy(() => import('../features/tools/SplitterPage'));
const ExtractorPage = lazy(() => import('../features/tools/ExtractorPage'));
const UpscalerPage = lazy(() => import('../features/tools/UpscalerPage'));
const BackgroundsPage = lazy(() => import('../features/tools/BackgroundsPage'));
const TimersPage = lazy(() => import('../features/tools/TimersPage'));
const ProgressPage = lazy(() => import('../features/tools/ProgressPage'));
const WatermarkPage = lazy(() => import('../features/tools/WatermarkPage'));
const SettingsPage = lazy(() => import('../features/settings/SettingsPage'));

const RouteLoading = () => (
  <div className="flex min-h-[50vh] items-center justify-center">
    <div className="max-w-md rounded-[28px] border-4 border-black bg-white p-8 text-center shadow-[10px_10px_0px_0px_rgba(0,0,0,1)]">
      <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#2563EB]">Lazy Route</div>
      <h2 className="mt-3 text-2xl font-black uppercase tracking-tight text-slate-900">Loading tool</h2>
      <p className="mt-3 text-sm font-semibold text-slate-600">
        Pulling in the route bundle so the dashboard can stay fast while heavier tools load on demand.
      </p>
    </div>
  </div>
);

const withSuspense = (node: ReactNode) => <Suspense fallback={<RouteLoading />}>{node}</Suspense>;

export const appRouter = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, element: withSuspense(<DashboardPage />) },
      { path: 'create/upload', element: withSuspense(<CreateUploadPage />) },
      { path: 'create/review', element: withSuspense(<CreateReviewPage />) },
      { path: 'create/editor', element: withSuspense(<CreateEditorPage />) },
      { path: 'editor', element: withSuspense(<VideoOverlayPage />) },
      { path: 'play', element: withSuspense(<PlayPage />) },
      { path: 'video/setup', element: withSuspense(<VideoSetupPage />) },
      { path: 'video/preview', element: withSuspense(<VideoPreviewPage />) },
      { path: 'video/overlay', element: <Navigate to="/editor" replace /> },
      { path: 'tools/splitter', element: withSuspense(<SplitterPage />) },
      { path: 'tools/extractor', element: withSuspense(<ExtractorPage />) },
      { path: 'tools/upscaler', element: withSuspense(<UpscalerPage />) },
      { path: 'tools/backgrounds', element: withSuspense(<BackgroundsPage />) },
      { path: 'tools/timers', element: withSuspense(<TimersPage />) },
      { path: 'tools/progress', element: withSuspense(<ProgressPage />) },
      { path: 'tools/watermark', element: withSuspense(<WatermarkPage />) },
      { path: 'settings', element: withSuspense(<SettingsPage />) }
    ]
  }
]);
