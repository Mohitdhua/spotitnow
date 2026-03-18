import { useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { FolderKanban, Menu, Settings, X } from 'lucide-react';
import { MediaDiagnosticsDrawer } from '../components/MediaDiagnosticsDrawer';
import { useAppStore } from '../store/appStore';
import { JobCenterDrawer } from './components/JobCenterDrawer';
import { APP_ROUTE_META, TOOL_NAV_ROUTES, getRouteMeta } from './routeMeta';

const isKnownRoute = (value: string) => APP_ROUTE_META.some((route) => route.path === value);

const workflowRoutes = APP_ROUTE_META.filter(
  (route) => route.group === 'workflow' && route.path !== '/video/overlay'
);
const utilityRoutes = TOOL_NAV_ROUTES.filter((route) => route.path !== '/tools/extractor');

interface SidebarContentProps {
  currentPath: string;
  projectName: string;
  runningJobs: number;
  onOpenJobs: () => void;
  onNavigate?: () => void;
  onCloseMobile?: () => void;
}

const isRouteActive = (pathname: string, targetPath: string) => pathname === targetPath;

function SidebarContent({
  currentPath,
  projectName,
  runningJobs,
  onOpenJobs,
  onNavigate,
  onCloseMobile
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
        onClick={() => {
          onNavigate?.();
          onCloseMobile?.();
        }}
        className={`group flex items-start gap-3 rounded-2xl border-2 px-3 py-3 text-left transition-colors ${
          isActive
            ? 'border-black bg-black text-white'
            : 'border-black bg-white text-slate-800 hover:bg-[#FFF7ED]'
        }`}
      >
        <div
          className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border-2 border-black ${
            isActive ? 'bg-[#FDE68A] text-slate-900' : 'bg-[#FFF7ED] text-slate-700'
          }`}
        >
          <Icon size={16} strokeWidth={2.5} />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-black uppercase tracking-wide">{label}</div>
          <div className={`mt-1 text-[11px] font-semibold leading-4 ${isActive ? 'text-white/80' : 'text-slate-600'}`}>
            {description}
          </div>
        </div>
      </Link>
    );
  };

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-4">
      <div className="rounded-[28px] border-4 border-black bg-white p-4 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border-2 border-black bg-black text-white">
            <FolderKanban size={20} strokeWidth={2.6} />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#2563EB]">SpotItNow</div>
            <div className="truncate text-xl font-black uppercase tracking-tight text-slate-900">{projectName}</div>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border-2 border-black bg-[#FFF7ED] p-3">
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Current Screen</div>
          <div className="mt-1 text-base font-black uppercase text-slate-900">{currentRoute.label}</div>
          <div className="mt-1 text-[11px] font-semibold leading-4 text-slate-600">{currentRoute.description}</div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onOpenJobs}
            className="relative inline-flex min-h-[46px] items-center justify-center rounded-2xl border-2 border-black bg-[#DBEAFE] px-3 text-[11px] font-black uppercase tracking-wide text-slate-900"
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
            onClick={() => {
              onNavigate?.();
              onCloseMobile?.();
            }}
            className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-2xl border-2 border-black bg-white px-3 text-[11px] font-black uppercase tracking-wide text-slate-700 hover:bg-slate-100"
          >
            <Settings size={14} strokeWidth={2.5} />
            Settings
          </Link>
        </div>
      </div>

      <div className="space-y-3">
        <div className="px-1 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Workflow</div>
        <div className="space-y-2">
          {workflowRoutes.map((route) =>
            renderNavLink(route.path, route.label, route.icon, route.description)
          )}
        </div>
      </div>

      <div className="space-y-3">
        <div className="px-1 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Tools</div>
        <div className="space-y-2">
          {TOOL_NAV_ROUTES.map((route) =>
            renderNavLink(route.path, route.label, route.icon, route.description)
          )}
        </div>
      </div>

      {utilityRoutes.length > 0 ? (
        <div className="rounded-2xl border-2 border-black bg-[#F8FAFC] p-3 text-[11px] font-semibold leading-4 text-slate-600">
          The sidebar replaces the large app header. Pages now stay focused on their own controls instead of repeating route chrome.
        </div>
      ) : null}
    </div>
  );
}

export function AppShell() {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const projectName = useAppStore((state) => state.projects.activeProjectName);
  const jobs = useAppStore((state) => state.exports.jobs);
  const setLastRoute = useAppStore((state) => state.setLastRoute);
  const setJobCenterOpen = useAppStore((state) => state.setJobCenterOpen);

  useEffect(() => {
    if (isKnownRoute(location.pathname)) {
      setLastRoute(location.pathname as (typeof APP_ROUTE_META)[number]['path']);
    }
    setSidebarOpen(false);
  }, [location.pathname, setLastRoute]);

  useEffect(() => {
    if (!sidebarOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [sidebarOpen]);

  const currentRoute = getRouteMeta(location.pathname);
  const runningJobs = useMemo(
    () => jobs.filter((job) => job.state === 'running').length,
    [jobs]
  );

  return (
    <div className="min-h-screen bg-[#FFFDF5] text-slate-900 selection:bg-black selection:text-white">
      <JobCenterDrawer />

      <div className="flex min-h-screen">
        <aside className="hidden w-[310px] shrink-0 border-r-4 border-black bg-[radial-gradient(circle_at_top_left,#DBEAFE_0%,#FFFDF8_38%,#FFF7ED_100%)] lg:block">
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
          <header className="sticky top-0 z-30 border-b-4 border-black bg-white/95 backdrop-blur lg:hidden">
            <div className="flex items-center justify-between gap-3 px-3 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() => setSidebarOpen(true)}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border-2 border-black bg-white text-slate-900"
                  aria-label="Open sidebar"
                >
                  <Menu size={18} strokeWidth={2.8} />
                </button>
                <div className="min-w-0">
                  <div className="truncate text-[10px] font-black uppercase tracking-[0.2em] text-[#2563EB]">
                    {projectName}
                  </div>
                  <div className="truncate text-lg font-black uppercase tracking-tight text-slate-900">
                    {currentRoute.label}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setJobCenterOpen(true)}
                className="relative inline-flex min-h-11 items-center justify-center rounded-2xl border-2 border-black bg-[#DBEAFE] px-3 text-[11px] font-black uppercase tracking-wide text-slate-900"
              >
                Jobs
                {runningJobs > 0 ? (
                  <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-black bg-white px-1 text-[10px]">
                    {runningJobs}
                  </span>
                ) : null}
              </button>
            </div>
          </header>

          <main className="min-w-0 flex-1 overflow-x-hidden px-3 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
            <Outlet />
          </main>
        </div>
      </div>

      {sidebarOpen ? (
        <div
          className="fixed inset-0 z-[58] bg-black/35 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        >
          <aside
            className="absolute inset-y-0 left-0 w-[min(22rem,88vw)] border-r-4 border-black bg-[radial-gradient(circle_at_top_left,#DBEAFE_0%,#FFFDF8_38%,#FFF7ED_100%)] shadow-[12px_0px_0px_0px_rgba(0,0,0,1)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b-4 border-black px-4 py-4">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Navigation</div>
                <div className="mt-1 text-2xl font-black uppercase text-slate-900">Sidebar</div>
              </div>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border-2 border-black bg-white text-slate-900"
                aria-label="Close sidebar"
              >
                <X size={18} strokeWidth={3} />
              </button>
            </div>

            <SidebarContent
              currentPath={location.pathname}
              projectName={projectName}
              runningJobs={runningJobs}
              onOpenJobs={() => {
                setSidebarOpen(false);
                setJobCenterOpen(true);
              }}
              onCloseMobile={() => setSidebarOpen(false)}
            />
          </aside>
        </div>
      ) : null}

      {import.meta.env.DEV ? <MediaDiagnosticsDrawer /> : null}
    </div>
  );
}
