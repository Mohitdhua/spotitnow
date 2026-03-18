import { useEffect, type ReactNode } from 'react';
import type { AppRoute, ProjectRecord } from '../../types';
import {
  createProjectRecord,
  getActiveProjectId,
  listProjects,
  loadProject,
  saveProject
} from '../../services/projects/projectStore';
import { getCurrentVideoSnapshot, getCurrentWorkspaceSnapshot, useAppStore } from '../../store/appStore';
import { installAlertShim, notifyError, restoreAlertShim } from '../../services/notifications';

interface ProjectBootstrapProps {
  children: ReactNode;
}

const createProjectSnapshot = (
  existing: ProjectRecord | null,
  params: {
    activeProjectId: string;
    activeProjectName: string;
    lastRoute: AppRoute;
  }
): ProjectRecord => ({
  ...(existing ?? createProjectRecord(params.activeProjectName, getCurrentVideoSnapshot().settings, params.lastRoute)),
  id: params.activeProjectId,
  name: params.activeProjectName,
  lastOpenedAt: Date.now(),
  workspace: getCurrentWorkspaceSnapshot(),
  video: getCurrentVideoSnapshot(),
  uiSnapshot: {
    lastRoute: params.lastRoute
  }
});

export function ProjectBootstrap({ children }: ProjectBootstrapProps) {
  const hydrated = useAppStore((state) => state.projects.hydrated);
  const lastRoute = useAppStore((state) => state.ui.lastRoute);
  const activeProjectId = useAppStore((state) => state.projects.activeProjectId);
  const activeProjectName = useAppStore((state) => state.projects.activeProjectName);
  const workspace = useAppStore((state) => state.workspace);
  const videoSettings = useAppStore((state) => state.video.videoSettings);
  const setHydrated = useAppStore((state) => state.setHydrated);
  const hydrateProject = useAppStore((state) => state.hydrateProject);
  const setRecentProjects = useAppStore((state) => state.setRecentProjects);
  const setActiveProjectMeta = useAppStore((state) => state.setActiveProjectMeta);

  useEffect(() => {
    installAlertShim();

    let canceled = false;
    const run = async () => {
      try {
        const recent = await listProjects();
        if (canceled) return;
        setRecentProjects(recent);

        const requestedProjectId = getActiveProjectId();
        let activeProject =
          (requestedProjectId ? await loadProject(requestedProjectId) : null) ??
          recent[0] ??
          null;

        if (!activeProject) {
          activeProject = await saveProject(
            createProjectRecord('Starter Project', getCurrentVideoSnapshot().settings)
          );
        }

        if (canceled) return;
        hydrateProject(activeProject);
        setActiveProjectMeta(activeProject.id, activeProject.name);
        setRecentProjects(await listProjects());
        setHydrated(true);
      } catch (error) {
        notifyError(error instanceof Error ? error.message : 'Failed to load projects.');
        setHydrated(true);
      }
    };

    void run();

    return () => {
      canceled = true;
      restoreAlertShim();
    };
  }, [hydrateProject, setActiveProjectMeta, setHydrated, setRecentProjects]);

  useEffect(() => {
    if (!hydrated || !activeProjectId) return;

    let canceled = false;
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        const existing = await loadProject(activeProjectId);
        if (canceled) return;
        const saved = await saveProject(
          createProjectSnapshot(existing, {
            activeProjectId,
            activeProjectName,
            lastRoute
          })
        );
        if (canceled) return;
        setActiveProjectMeta(saved.id, saved.name);
        setRecentProjects(await listProjects());
      })().catch((error) => {
        if (!canceled) {
          notifyError(error instanceof Error ? error.message : 'Autosave failed.');
        }
      });
    }, 500);

    return () => {
      canceled = true;
      window.clearTimeout(timeoutId);
    };
  }, [
    hydrated,
    activeProjectId,
    activeProjectName,
    lastRoute,
    workspace,
    videoSettings,
    setActiveProjectMeta,
    setRecentProjects
  ]);

  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FFFDF5] p-6 text-slate-900">
        <div className="max-w-xl rounded-[28px] border-4 border-black bg-white p-8 text-center shadow-[12px_12px_0px_0px_rgba(0,0,0,1)]">
          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#2563EB]">SpotItNow Studio</div>
          <h1 className="mt-3 text-3xl font-black uppercase tracking-tight">Loading your workspace</h1>
          <p className="mt-3 text-sm font-semibold text-slate-600">
            Rebuilding the project dashboard, restoring the latest project state, and reconnecting your creator tools.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
