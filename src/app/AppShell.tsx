import { Suspense, useEffect, useMemo, useState } from 'react';
import { FolderKanban, Layers, ListTodo, Settings, Video, Wrench } from 'lucide-react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { MediaDiagnosticsDrawer } from '../components/MediaDiagnosticsDrawer';
import { useAppStore } from '../store/appStore';
import { JobCenterDrawer } from './components/JobCenterDrawer';
import { RouteWorkspaceLoading } from './components/RouteWorkspaceLoading';
import { APP_ROUTE_META, TOOL_NAV_ROUTES, getRouteMeta } from './routeMeta';

const isKnownRoute = (value: string) => APP_ROUTE_META.some((route) => route.path === value);

const workflowRoutes = APP_ROUTE_META.filter(
  (route) => route.group === 'workflow' && route.path !== '/video/overlay'
);
const utilityRoutes = TOOL_NAV_ROUTES.filter((route) => route.path !== '/tools/extractor');
const mobileToolRoutes = TOOL_NAV_ROUTES.filter((route) => route.path !== '/editor');

interface SidebarContentProps {
  currentPath: string;
  projectName: string;
  runningJobs: number;
  onOpenJobs: () => void;
  onNavigate?: () => void;
}

const isRouteActive = (pathname: string, targetPath: string) => pathname === targetPath;

function SidebarContent({
  currentPath,
  projectName,
  runningJobs,
  onOpenJobs,
  onNavigate
}: SidebarContentProps) {
  const currentRoute = getRouteMeta(currentPath);

  const renderNavLink = (
    path: string,
    label: string,
    Icon: (typeof APP_ROUTE_META)[number]['icon'],
    description: string
  ) => {
    const isActive = isRouteActive(currentPath, path);
    return (
      <Link
        key={path}
        to={path}
        flushSync
        onClick={() => onNavigate?.()}
        className={`group flex items-start gap-2 rounded-2xl border-2 px-2.5 py-2 text-left transition-colors ${
          isActive
            ? 'border-black bg-black text-white'
            : 'border-black bg-white text-slate-800 hover:bg-[#FFF7ED]'
        }`}
      >
        <div
          className={`mt-0.5 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-xl border-2 border-black ${
            isActive ? 'bg-[#FDE68A] text-slate-900' : 'bg-[#FFF7ED] text-slate-700'
          }`}
        >
          <Icon size={14} strokeWidth={2.5} />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-wide">{label}</div>
          <div className={`mt-0.5 text-[9px] font-semibold leading-4 ${isActive ? 'text-white/80' : 'text-slate-600'}`}>
            {description}
          </div>
        </div>
      </Link>
    );
  };

  return (
    <div className="flex h-full flex-col gap-3.5 overflow-y-auto p-2.5">
      <div className="rounded-[26px] border-4 border-black bg-white p-2.5 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
        <div className="flex items-start gap-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border-2 border-black bg-black text-white">
            <FolderKanban size={17} strokeWidth={2.6} />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#2563EB]">SpotItNow</div>
            <div className="truncate text-[17px] font-black uppercase tracking-tight text-slate-900">{projectName}</div>
          </div>
        </div>

        <div className="mt-2.5 rounded-2xl border-2 border-black bg-[#FFF7ED] p-2.5">
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Current Screen</div>
          <div className="mt-1 text-sm font-black uppercase text-slate-900">{currentRoute.label}</div>
          <div className="mt-1 text-[9px] font-semibold leading-4 text-slate-600">{currentRoute.description}</div>
        </div>

        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onOpenJobs}
            className="relative inline-flex min-h-[38px] items-center justify-center rounded-2xl border-2 border-black bg-[#DBEAFE] px-2.5 text-[9px] font-black uppercase tracking-wide text-slate-900"
          >
            Jobs
            {runningJobs > 0 ? (
              <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-black bg-white px-1 text-[10px]">
                {runningJobs}
              </span>
            ) : null}
          </button>
          <Link
            to="/settings"
            flushSync
            onClick={() => onNavigate?.()}
            className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-2xl border-2 border-black bg-white px-2.5 text-[9px] font-black uppercase tracking-wide text-slate-700 hover:bg-slate-100"
          >
            <Settings size={13} strokeWidth={2.5} />
            Settings
          </Link>
        </div>
      </div>

      <div className="space-y-2">
        <div className="px-1 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Workflow</div>
        <div className="space-y-2">
          {workflowRoutes.map((route) => renderNavLink(route.path, route.label, route.icon, route.description))}
        </div>
      </div>

      <div className="space-y-2">
        <div className="px-1 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Tools</div>
        <div className="space-y-2">
          {TOOL_NAV_ROUTES.map((route) => renderNavLink(route.path, route.label, route.icon, route.description))}
        </div>
      </div>

      {utilityRoutes.length > 0 ? (
        <div className="rounded-2xl border-2 border-black bg-[#F8FAFC] p-2 text-[9px] font-semibold leading-4 text-slate-600">
          The sidebar replaces the large app header. Pages now stay focused on their own controls instead of repeating route chrome.
        </div>
      ) : null}
    </div>
  );
}

interface MobileToolsSheetProps {
  currentPath: string;
  open: boolean;
  onClose: () => void;
}

function MobileToolsSheet({ currentPath, open, onClose }: MobileToolsSheetProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <button
        type="button"
        aria-label="Close tools"
        onClick={onClose}
        className="absolute inset-0 bg-black/45 backdrop-blur-sm"
      />

      <div className="absolute inset-x-0 bottom-0 rounded-t-[24px] border-4 border-black bg-[#FFFDF5] p-2.5 shadow-[0px_-6px_0px_0px_rgba(0,0,0,1)]">
        <div className="mx-auto h-1 w-12 rounded-full bg-black/15" />

        <div className="mt-2.5 flex items-center justify-between gap-2">
          <div>
            <div className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Toolbox</div>
            <div className="mt-0.5 text-base font-black uppercase tracking-tight text-slate-900">Tools</div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 items-center justify-center rounded-xl border-2 border-black bg-white px-2.5 text-[9px] font-black uppercase tracking-wide text-slate-700"
          >
            Close
          </button>
        </div>

        <div className="mt-2.5 grid max-h-[54vh] grid-cols-3 gap-2 overflow-y-auto pr-0.5">
          {mobileToolRoutes.map((route) => {
            const Icon = route.icon;
            const isActive = currentPath === route.path;

            return (
              <Link
                key={route.path}
                to={route.path}
                flushSync
                onClick={onClose}
                className={`rounded-[18px] border-2 px-2 py-2 text-center transition-colors ${
                  isActive
                    ? 'border-black bg-black text-white'
                    : 'border-black bg-white text-slate-900 hover:bg-[#FFF7ED]'
                }`}
              >
                <div
                  className={`mx-auto flex h-8 w-8 items-center justify-center rounded-2xl border-2 border-black ${
                    isActive ? 'bg-[#FDE68A] text-slate-900' : 'bg-[#FFF7ED] text-slate-700'
                  }`}
                >
                  <Icon size={15} strokeWidth={2.6} />
                </div>
                <div className="mt-2 text-[9px] font-black uppercase leading-3">{route.label}</div>
              </Link>
            );
          })}
        </div>

        <div className="h-[env(safe-area-inset-bottom,0px)]" />
      </div>
    </div>
  );
}

interface MobileBottomNavProps {
  currentPath: string;
  editorPath: string;
  isJobsOpen: boolean;
  onOpenJobs: () => void;
  onOpenTools: () => void;
  runningJobs: number;
}

function MobileBottomNav({
  currentPath,
  editorPath,
  isJobsOpen,
  onOpenJobs,
  onOpenTools,
  runningJobs
}: MobileBottomNavProps) {
  const currentRoute = getRouteMeta(currentPath);
  const isEditorRoute =
    currentPath === '/create/editor' || currentPath === '/editor' || currentPath === '/video/overlay';
  const isStudioRoute =
    currentPath === '/' ||
    currentPath === '/create/upload' ||
    currentPath === '/create/review' ||
    currentPath === '/play';
  const isVideoRoute = currentPath.startsWith('/video');
  const isToolRoute = currentRoute.group === 'tools' && !isEditorRoute;

  const items = [
    { key: 'studio', label: 'Studio', icon: FolderKanban, to: '/' },
    { key: 'video', label: 'Video', icon: Video, to: '/video/setup' },
    { key: 'editor', label: 'Editor', icon: Layers, to: editorPath },
    { key: 'tools', label: 'Tools', icon: Wrench, onClick: onOpenTools },
    { key: 'jobs', label: 'Jobs', icon: ListTodo, onClick: onOpenJobs },
    { key: 'settings', label: 'Settings', icon: Settings, to: '/settings' }
  ] as const;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t-4 border-black bg-white/96 px-1 pb-0.5 pt-1 backdrop-blur lg:hidden">
      <div className="mx-auto grid max-w-xl grid-cols-6 gap-0">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive =
            item.key === 'studio'
              ? isStudioRoute
              : item.key === 'video'
                ? isVideoRoute
                : item.key === 'editor'
                  ? isEditorRoute
                  : item.key === 'tools'
                    ? isToolRoute
                    : item.key === 'jobs'
                      ? isJobsOpen
                      : currentPath === item.to;

          const content = (
            <>
              <span
                className={`relative flex h-7 w-7 items-center justify-center rounded-2xl border-2 border-black transition-colors ${
                  isActive ? 'bg-[#FDE68A] text-slate-900' : 'bg-white text-slate-700'
                }`}
              >
                <Icon size={14} strokeWidth={2.7} />
                {item.key === 'jobs' && runningJobs > 0 ? (
                  <span className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full border border-black bg-[#DBEAFE] px-1 text-[8px] font-black leading-none text-slate-900">
                    {runningJobs}
                  </span>
                ) : null}
              </span>
              <span className="leading-none">{item.label}</span>
            </>
          );

          const className = `flex min-w-0 flex-col items-center gap-0.5 rounded-2xl px-0.5 py-1 text-[8px] font-black uppercase tracking-tight transition-colors ${
            isActive ? 'text-slate-900' : 'text-slate-500'
          }`;

          if ('to' in item) {
            return (
              <Link key={item.key} to={item.to} flushSync className={className}>
                {content}
              </Link>
            );
          }

          return (
            <button key={item.key} type="button" onClick={item.onClick} className={className}>
              {content}
            </button>
          );
        })}
      </div>

      <div className="h-[env(safe-area-inset-bottom,0px)]" />
    </nav>
  );
}

export function AppShell() {
  const location = useLocation();
  const isFlushWorkspace = location.pathname === '/video/setup';
  const [isMobile, setIsMobile] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const projectName = useAppStore((state) => state.projects.activeProjectName);
  const jobs = useAppStore((state) => state.exports.jobs);
  const batchCount = useAppStore((state) => state.workspace.batch.length);
  const hasPuzzle = useAppStore((state) => state.workspace.puzzle !== null);
  const isJobCenterOpen = useAppStore((state) => state.ui.jobCenterOpen);
  const setLastRoute = useAppStore((state) => state.setLastRoute);
  const setJobCenterOpen = useAppStore((state) => state.setJobCenterOpen);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const mediaQuery = window.matchMedia('(max-width: 768px)');
    const syncMobileState = () => setIsMobile(mediaQuery.matches);

    syncMobileState();
    mediaQuery.addEventListener('change', syncMobileState);

    return () => mediaQuery.removeEventListener('change', syncMobileState);
  }, []);

  useEffect(() => {
    document.body.dataset.mobile = isMobile ? 'true' : 'false';
    return () => {
      document.body.dataset.mobile = 'false';
    };
  }, [isMobile]);

  useEffect(() => {
    if (isKnownRoute(location.pathname)) {
      setLastRoute(location.pathname as (typeof APP_ROUTE_META)[number]['path']);
    }
  }, [location.pathname, setLastRoute]);

  useEffect(() => {
    setToolsOpen(false);
  }, [location.pathname]);

  const runningJobs = useMemo(
    () => jobs.filter((job) => job.state === 'running').length,
    [jobs]
  );
  const editorPath = batchCount > 0 || hasPuzzle ? '/create/editor' : '/editor';
  const currentRouteMeta = isKnownRoute(location.pathname)
    ? getRouteMeta(location.pathname as (typeof APP_ROUTE_META)[number]['path'])
    : null;

  return (
    <div className="min-h-screen bg-[#FFFDF5] text-slate-900 selection:bg-black selection:text-white">
      <JobCenterDrawer />

      <div className="flex min-h-screen">
        <aside className="hidden w-[244px] shrink-0 border-r-4 border-black bg-[radial-gradient(circle_at_top_left,#DBEAFE_0%,#FFFDF8_38%,#FFF7ED_100%)] xl:w-[256px] lg:block">
          <div className="sticky top-0 h-screen">
            <SidebarContent
              currentPath={location.pathname}
              projectName={projectName}
              runningJobs={runningJobs}
              onOpenJobs={() => setJobCenterOpen(true)}
            />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <main
            className={
              isFlushWorkspace
                ? 'relative min-w-0 flex-1 overflow-x-hidden p-0 pb-[4.5rem] sm:pb-24 lg:pb-0'
                : 'relative min-w-0 flex-1 overflow-x-hidden px-1.5 py-1.5 pb-[4.5rem] sm:px-4 sm:py-4 sm:pb-24 lg:px-4 lg:py-4 lg:pb-4 xl:px-5 xl:py-5'
            }
          >
            <Suspense
              key={location.pathname}
              fallback={
                !isJobCenterOpen && currentRouteMeta ? (
                  <RouteWorkspaceLoading
                    eyebrow="Switching Modes"
                    title={`Opening ${currentRouteMeta.label}`}
                    description={currentRouteMeta.description}
                  />
                ) : null
              }
            >
              <div key={location.pathname}>
                <Outlet />
              </div>
            </Suspense>
          </main>
        </div>
      </div>

      <MobileBottomNav
        currentPath={location.pathname}
        editorPath={editorPath}
        isJobsOpen={isJobCenterOpen}
        runningJobs={runningJobs}
        onOpenJobs={() => {
          setToolsOpen(false);
          setJobCenterOpen(true);
        }}
        onOpenTools={() => setToolsOpen(true)}
      />

      <MobileToolsSheet currentPath={location.pathname} open={toolsOpen} onClose={() => setToolsOpen(false)} />

      {import.meta.env.DEV && !isMobile ? <MediaDiagnosticsDrawer /> : null}
    </div>
  );
}
