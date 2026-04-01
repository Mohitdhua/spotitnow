import { useRef } from 'react';
import { Camera, FolderOpen, Layers, PlaySquare, Upload, Video } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import type { ProjectRecord } from '../../types';
import { notifyError, notifySuccess } from '../../services/notifications';
import { downloadJsonFile, parsePuzzleJsonText } from '../../services/jsonTransfer';
import {
  createProjectExport,
  listProjects,
  loadProject,
  parseImportedProject,
  saveProject
} from '../../services/projects/projectStore';
import { getCurrentVideoSnapshot, getCurrentWorkspaceSnapshot, useAppStore } from '../../store/appStore';

const cardClass =
  'rounded-[28px] border-4 border-black bg-white p-4 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] sm:p-6';

const actionCardClass =
  'rounded-[26px] border-4 border-black p-4 text-left transition-transform hover:-translate-y-1 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] sm:p-6';

const buildLiveProjectRecord = (
  projectId: string,
  projectName: string,
  lastRoute: ProjectRecord['uiSnapshot']['lastRoute']
): ProjectRecord => {
  const now = Date.now();
  return {
    kind: 'spotitnow-project',
    version: 1,
    id: projectId,
    name: projectName,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    workspace: getCurrentWorkspaceSnapshot(),
    video: getCurrentVideoSnapshot(),
    uiSnapshot: {
      lastRoute
    }
  };
};

export default function DashboardPage() {
  const navigate = useNavigate();
  const puzzleImportRef = useRef<HTMLInputElement | null>(null);
  const projectImportRef = useRef<HTMLInputElement | null>(null);
  const batch = useAppStore((state) => state.workspace.batch);
  const videoSettings = useAppStore((state) => state.video.videoSettings);
  const activeProjectId = useAppStore((state) => state.projects.activeProjectId);
  const activeProjectName = useAppStore((state) => state.projects.activeProjectName);
  const recentProjects = useAppStore((state) => state.projects.recentProjects);
  const hydrateProject = useAppStore((state) => state.hydrateProject);
  const setActiveProjectMeta = useAppStore((state) => state.setActiveProjectMeta);
  const setRecentProjects = useAppStore((state) => state.setRecentProjects);
  const setBatchAndPuzzle = useAppStore((state) => state.setBatchAndPuzzle);
  const puzzleCount = batch.length;
  const totalRegions = batch.reduce((sum, item) => sum + item.regions.length, 0);
  const primaryFlowPath = puzzleCount > 0 ? '/create/review' : '/create/upload';
  const playPath = puzzleCount > 0 ? '/play' : '/create/upload';

  const handleImportPuzzleJson = async (file: File) => {
    try {
      const puzzles = parsePuzzleJsonText(await file.text());
      setBatchAndPuzzle(puzzles);
      notifySuccess(`Loaded ${puzzles.length} puzzle${puzzles.length === 1 ? '' : 's'} into the review workflow.`);
      navigate('/create/review');
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Could not import that puzzle JSON.');
    }
  };

  const handleImportProject = async (file: File) => {
    try {
      const importedProject = await parseImportedProject(await file.text());
      const savedProject = await saveProject(importedProject);
      hydrateProject(savedProject);
      setActiveProjectMeta(savedProject.id, savedProject.name);
      setRecentProjects(await listProjects());
      notifySuccess(`Imported project "${savedProject.name}".`);
      navigate(savedProject.uiSnapshot.lastRoute);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Could not import that project.');
    }
  };

  const handleOpenProject = async (projectId: string) => {
    try {
      const project = await loadProject(projectId);
      if (!project) {
        notifyError('That project could not be loaded.');
        return;
      }
      hydrateProject(project);
      setActiveProjectMeta(project.id, project.name);
      notifySuccess(`Opened "${project.name}".`);
      navigate(project.uiSnapshot.lastRoute);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Failed to open the selected project.');
    }
  };

  const handleExportProject = async () => {
    if (!activeProjectId) {
      notifyError('No active project is ready to export yet.');
      return;
    }

    const project = (await loadProject(activeProjectId)) ?? buildLiveProjectRecord(activeProjectId, activeProjectName, '/');
    downloadJsonFile(
      await createProjectExport(project),
      `${project.name.replace(/\s+/g, '-').toLowerCase()}-project.json`
    );
    notifySuccess('Project backup downloaded.');
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <section className="space-y-2.5 sm:hidden">
        <section className="rounded-[24px] border-4 border-black bg-[linear-gradient(140deg,#FDE68A_0%,#FED7AA_38%,#DBEAFE_100%)] p-3 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[9px] font-black uppercase tracking-[0.18em] text-[#1D4ED8]">Studio Home</p>
              <h1 className="mt-1 text-[20px] font-black uppercase leading-none tracking-tight text-slate-900">
                {activeProjectName}
              </h1>
            </div>

            <div className="rounded-2xl border-2 border-black bg-white px-2.5 py-1.5 text-right shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
              <div className="text-[8px] font-black uppercase tracking-[0.16em] text-slate-500">Puzzles</div>
              <div className="mt-1 text-xl font-black text-slate-900">{puzzleCount}</div>
            </div>
          </div>

          <div className="mt-2 grid grid-cols-3 gap-1.5">
            <div className="rounded-2xl border-2 border-black bg-white px-2 py-2">
              <div className="text-[8px] font-black uppercase tracking-[0.16em] text-slate-500">Regions</div>
              <div className="mt-0.5 text-base font-black text-slate-900">{totalRegions}</div>
            </div>
            <div className="rounded-2xl border-2 border-black bg-white px-2 py-2">
              <div className="text-[8px] font-black uppercase tracking-[0.16em] text-slate-500">Package</div>
              <div className="mt-0.5 truncate text-[11px] font-black uppercase text-slate-900">
                {videoSettings.videoPackagePreset}
              </div>
            </div>
            <div className="rounded-2xl border-2 border-black bg-white px-2 py-2">
              <div className="text-[8px] font-black uppercase tracking-[0.16em] text-slate-500">Project</div>
              <div className="mt-0.5 text-[11px] font-black uppercase text-slate-900">
                {activeProjectId ? 'Saved' : 'Live'}
              </div>
            </div>
          </div>

          <div className="mt-2 rounded-[20px] border-2 border-black bg-white p-2.5">
            <Link
              to={primaryFlowPath}
              className="flex min-h-[48px] items-center justify-between gap-3 rounded-[18px] border-2 border-black bg-black px-3 py-2.5 text-white"
            >
              <div>
                <div className="text-[8px] font-black uppercase tracking-[0.16em] text-white/70">Primary Flow</div>
                <div className="mt-0.5 text-sm font-black uppercase">
                  {puzzleCount > 0 ? 'Resume Create Flow' : 'Start New Puzzle'}
                </div>
              </div>
              <Upload size={16} strokeWidth={2.8} />
            </Link>

            <div className="mt-2 grid grid-cols-4 gap-1.5">
              <Link to="/create/upload" className="rounded-[16px] border-2 border-black bg-[#FFD93D] px-2 py-2 text-left">
                <Upload size={14} strokeWidth={2.6} />
                <div className="mt-2 text-[10px] font-black uppercase leading-3 text-slate-900">Upload</div>
              </Link>

              <Link to="/video/setup" className="rounded-[16px] border-2 border-black bg-[#DBEAFE] px-2 py-2 text-left">
                <Video size={14} strokeWidth={2.6} />
                <div className="mt-2 text-[10px] font-black uppercase leading-3 text-slate-900">Video</div>
              </Link>

              <Link to={playPath} className="rounded-[16px] border-2 border-black bg-[#DCFCE7] px-2 py-2 text-left">
                <PlaySquare size={14} strokeWidth={2.6} />
                <div className="mt-2 text-[10px] font-black uppercase leading-3 text-slate-900">Play</div>
              </Link>

              <button
                type="button"
                onClick={() => puzzleImportRef.current?.click()}
                className="rounded-[16px] border-2 border-black bg-white px-2 py-2 text-left"
              >
                <FolderOpen size={14} strokeWidth={2.6} />
                <div className="mt-2 text-[10px] font-black uppercase leading-3 text-slate-900">Import</div>
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-[24px] border-4 border-black bg-white p-3 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Project Controls</p>
              <h2 className="mt-1 text-lg font-black uppercase tracking-tight text-slate-900">Backup &amp; Resume</h2>
            </div>

            <button
              type="button"
              onClick={handleExportProject}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border-2 border-black bg-white px-2.5 text-[10px] font-black uppercase tracking-wide text-slate-700 hover:bg-slate-100"
            >
              <FolderOpen size={13} />
              Export
            </button>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => projectImportRef.current?.click()}
              className="inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-2xl border-2 border-black bg-white px-2.5 py-2 text-[10px] font-black uppercase tracking-wide text-slate-700"
            >
              <FolderOpen size={13} />
              Import
            </button>

            <Link
              to={primaryFlowPath}
              className="inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-2xl border-2 border-black bg-[#FFF7ED] px-2.5 py-2 text-[10px] font-black uppercase tracking-wide text-slate-700"
            >
              <PlaySquare size={13} />
              {puzzleCount > 0 ? 'Resume' : 'Create'}
            </Link>
          </div>
        </section>

        <section className="rounded-[24px] border-4 border-black bg-white p-3 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Recent Projects</p>
              <h2 className="mt-1 text-lg font-black uppercase tracking-tight text-slate-900">Quick Resume</h2>
            </div>

            <div className="rounded-full border border-black bg-[#FFF7ED] px-2 py-1 text-[9px] font-black uppercase text-slate-700">
              {recentProjects.length}
            </div>
          </div>

          <div className="mt-2 space-y-1.5">
            {recentProjects.length ? (
              recentProjects.slice(0, 4).map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => void handleOpenProject(project.id)}
                  className="w-full rounded-2xl border-2 border-black bg-[#FFFDF5] px-2.5 py-2 text-left"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-black uppercase text-slate-900">{project.name}</div>
                      <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500">
                        {project.workspace.batch.length} puzzle{project.workspace.batch.length === 1 ? '' : 's'}
                      </div>
                    </div>

                    <div className="rounded-full border border-black bg-white px-1.5 py-0.5 text-[8px] font-black uppercase text-slate-600">
                      {new Date(project.lastOpenedAt).toLocaleDateString()}
                    </div>
                  </div>
                </button>
              ))
            ) : (
              <div className="rounded-2xl border-2 border-dashed border-black bg-[#FFFDF5] px-3 py-4 text-center text-xs font-semibold text-slate-600">
                Recent projects will show up here once you start creating.
              </div>
            )}
          </div>
        </section>
      </section>

      <section className={`${cardClass} hidden sm:block`}>
        <p className="text-xs font-black uppercase tracking-[0.2em] text-[#2563EB]">Workflow Dashboard</p>
        <h1 className="mt-3 text-3xl font-black uppercase tracking-tight text-slate-900 sm:text-4xl">
          Create, review, and export spot-the-difference content without losing your place
        </h1>
        <p className="mt-3 max-w-3xl text-sm font-semibold text-slate-600 sm:text-base">
          The current app already has strong creator tooling. This new shell organizes that power into guided workflows,
          keeps recent projects visible, and sends the heavy tools into lazy-loaded routes instead of one giant screen.
        </p>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <Link to="/create/upload" className={`${actionCardClass} bg-[#FFD93D] text-slate-900`}>
            <Upload size={24} strokeWidth={2.6} />
            <h2 className="mt-4 text-xl font-black uppercase">Create Puzzle</h2>
            <p className="mt-2 text-sm font-semibold text-slate-700">
              Upload pairs, choose manual or assisted detection, review the results, and send the best puzzle into edit, play, or video.
            </p>
          </Link>

          <Link to="/video/setup" className={`${actionCardClass} bg-[#DBEAFE] text-slate-900`}>
            <Video size={24} strokeWidth={2.6} />
            <h2 className="mt-4 text-xl font-black uppercase">Build Video</h2>
            <p className="mt-2 text-sm font-semibold text-slate-700">
              Start from the current batch, tune the package, preview playback, and move straight into the overlay editor when needed.
            </p>
          </Link>

          <Link to="/tools/extractor" className={`${actionCardClass} bg-[#DCFCE7] text-slate-900`}>
            <Camera size={24} strokeWidth={2.6} />
            <h2 className="mt-4 text-xl font-black uppercase">Extract From Video</h2>
            <p className="mt-2 text-sm font-semibold text-slate-700">
              Pull frames from source footage, batch them into auto-detected puzzles, and feed the create workflow without re-uploading.
            </p>
          </Link>
        </div>
      </section>

      <section className="hidden gap-6 sm:grid xl:grid-cols-[1.2fr_0.8fr]">
        <div className={`${cardClass} space-y-4`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Current Workspace</p>
              <h2 className="mt-2 text-2xl font-black uppercase tracking-tight text-slate-900">Live Project Snapshot</h2>
            </div>
            <button
              type="button"
              onClick={handleExportProject}
              className="inline-flex items-center gap-2 rounded-xl border-2 border-black bg-white px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-700 hover:bg-slate-100"
            >
              <FolderOpen size={14} />
              Export Project
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border-2 border-black bg-[#FFF7ED] p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Puzzles</div>
              <div className="mt-2 text-3xl font-black text-slate-900">{puzzleCount}</div>
            </div>
            <div className="rounded-2xl border-2 border-black bg-[#F0FDF4] p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Total Regions</div>
              <div className="mt-2 text-3xl font-black text-slate-900">{totalRegions}</div>
            </div>
            <div className="rounded-2xl border-2 border-black bg-[#EFF6FF] p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Video Package</div>
              <div className="mt-2 text-base font-black uppercase text-slate-900">{videoSettings.videoPackagePreset}</div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => puzzleImportRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-xl border-2 border-black bg-[#FDE68A] px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-900 hover:bg-[#FCD34D]"
            >
              <Layers size={14} />
              Load Puzzle JSON
            </button>
            <button
              type="button"
              onClick={() => projectImportRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-xl border-2 border-black bg-white px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-700 hover:bg-slate-100"
            >
              <FolderOpen size={14} />
              Import Project
            </button>
            <Link
              to={primaryFlowPath}
              className="inline-flex items-center gap-2 rounded-xl border-2 border-black bg-white px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-700 hover:bg-slate-100"
            >
              <PlaySquare size={14} />
              {puzzleCount > 0 ? 'Resume Workflow' : 'Start Workflow'}
            </Link>
          </div>
        </div>

        <div className={`${cardClass} space-y-4`}>
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Recent Projects</p>
            <h2 className="mt-2 text-2xl font-black uppercase tracking-tight text-slate-900">Quick Resume</h2>
          </div>

          {recentProjects.length ? (
            <div className="space-y-3">
              {recentProjects.slice(0, 5).map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => void handleOpenProject(project.id)}
                  className="w-full rounded-2xl border-2 border-black bg-[#FFFDF5] p-4 text-left hover:bg-slate-50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black uppercase text-slate-900">{project.name}</div>
                      <div className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {project.workspace.batch.length} puzzle{project.workspace.batch.length === 1 ? '' : 's'} / {project.uiSnapshot.lastRoute}
                      </div>
                    </div>
                    <div className="rounded-full border border-black bg-white px-2 py-1 text-[10px] font-black uppercase text-slate-600">
                      {new Date(project.lastOpenedAt).toLocaleDateString()}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border-2 border-dashed border-black bg-[#FFFDF5] px-4 py-8 text-center text-sm font-semibold text-slate-600">
              Your recent autosaved projects will show up here once you start using the new workflow shell.
            </div>
          )}
        </div>
      </section>

      <input
        ref={puzzleImportRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            void handleImportPuzzleJson(file);
          }
          event.currentTarget.value = '';
        }}
      />
      <input
        ref={projectImportRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            void handleImportProject(file);
          }
          event.currentTarget.value = '';
        }}
      />
    </div>
  );
}
