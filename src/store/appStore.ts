import type { SetStateAction } from 'react';
import { create } from 'zustand';
import type {
  AppRoute,
  ExportJob,
  ProjectRecord,
  Puzzle,
  ProcessingMode,
  VideoModeTransferFrame,
  VideoSettings
} from '../types';
import type { AppGlobalSettings } from '../services/appSettings';
import {
  loadAppGlobalSettings,
  resetAppGlobalSettings,
  saveAppGlobalSettings,
  saveSplitterMode
} from '../services/appSettings';
import { saveGameAudioMuted } from '../services/gameAudio';
import type { VideoUserPackageLibraryState } from '../services/videoUserPackages';
import {
  DEFAULT_VIDEO_USER_PACKAGE_ID,
  applyVideoUserPackageToAspectRatio,
  applyVideoUserPackageToSettings,
  createVideoUserPackageFromSettings,
  deleteVideoUserPackageFromLibrary,
  loadVideoUserPackageLibrary,
  persistVideoSettingsToVideoUserPackage,
  resolveActiveVideoUserPackage,
  saveVideoUserPackageLibrary,
  setActiveVideoUserPackage,
  upsertVideoUserPackageInLibrary
} from '../services/videoUserPackages';

export interface WorkspaceState {
  puzzle: Puzzle | null;
  batch: Puzzle[];
  playIndex: number;
  incomingVideoFrames: VideoModeTransferFrame[];
  incomingVideoFramesSessionId: number;
  injectedUploadFiles: File[] | null;
  injectedUploadProcessingMode: ProcessingMode | null;
  injectedUploadFilesSessionId: number;
}

export interface VideoState {
  appDefaults: AppGlobalSettings;
  videoPackageLibrary: VideoUserPackageLibraryState;
  videoSettings: VideoSettings;
  frameDefaultsSessionId: number;
  splitterDefaultsSessionId: number;
  backgroundPacksSessionId: number;
}

export interface ExportJobsState {
  jobs: ExportJob[];
}

export interface UiState {
  lastRoute: AppRoute;
  jobCenterOpen: boolean;
  backgroundGeneratorReturnTo: AppRoute;
}

export interface ProjectsState {
  hydrated: boolean;
  activeProjectId: string | null;
  activeProjectName: string;
  recentProjects: ProjectRecord[];
}

interface AppStoreState {
  workspace: WorkspaceState;
  video: VideoState;
  exports: ExportJobsState;
  ui: UiState;
  projects: ProjectsState;
  setLastRoute: (route: AppRoute) => void;
  setJobCenterOpen: (isOpen: boolean) => void;
  setBackgroundGeneratorReturnTo: (route: AppRoute) => void;
  replaceWorkspace: (workspace: Partial<WorkspaceState>) => void;
  resetWorkspace: () => void;
  setPuzzle: (puzzle: Puzzle | null) => void;
  setBatch: (batch: Puzzle[]) => void;
  addPuzzleToBatch: (puzzle: Puzzle) => void;
  setBatchAndPuzzle: (batch: Puzzle[], puzzle?: Puzzle | null) => void;
  replaceBatchPuzzle: (index: number, puzzle: Puzzle) => void;
  setPlayIndex: (index: number) => void;
  goToNextPuzzle: () => void;
  setIncomingVideoFrames: (frames: VideoModeTransferFrame[]) => void;
  queueInjectedUpload: (files: File[], mode?: ProcessingMode | null) => void;
  clearInjectedUpload: () => void;
  setAppDefaults: (settings: AppGlobalSettings, options?: { gameAudioMuted?: boolean }) => void;
  resetAppDefaults: () => void;
  setVideoSettings: (next: SetStateAction<VideoSettings>) => void;
  applyVideoPackageLibraryState: (library: VideoUserPackageLibraryState, settings?: VideoSettings) => void;
  selectVideoPackage: (packageId: string) => void;
  createVideoPackage: (name: string) => void;
  duplicateActiveVideoPackage: (name: string) => void;
  renameVideoPackage: (packageId: string, name: string) => void;
  deleteVideoPackage: (packageId: string) => void;
  changeVideoAspectRatio: (aspectRatio: VideoSettings['aspectRatio']) => void;
  bumpBackgroundPacksSession: () => void;
  bumpFrameDefaultsSession: () => void;
  bumpSplitterDefaultsSession: () => void;
  upsertExportJob: (job: ExportJob) => void;
  clearFinishedExportJobs: () => void;
  removeExportJob: (jobId: string) => void;
  hydrateProject: (project: ProjectRecord) => void;
  setRecentProjects: (projects: ProjectRecord[]) => void;
  setActiveProjectMeta: (projectId: string, name: string) => void;
  setHydrated: (hydrated: boolean) => void;
}

const buildInitialWorkspace = (): WorkspaceState => ({
  puzzle: null,
  batch: [],
  playIndex: 0,
  incomingVideoFrames: [],
  incomingVideoFramesSessionId: 0,
  injectedUploadFiles: null,
  injectedUploadProcessingMode: null,
  injectedUploadFilesSessionId: 0
});

const buildInitialVideoState = (): VideoState => {
  const appDefaults = loadAppGlobalSettings();
  const videoPackageLibrary = loadVideoUserPackageLibrary(appDefaults.videoDefaults);
  return {
    appDefaults,
    videoPackageLibrary,
    videoSettings: applyVideoUserPackageToSettings(
      resolveActiveVideoUserPackage(videoPackageLibrary),
      appDefaults.videoDefaults
    ),
    frameDefaultsSessionId: 0,
    splitterDefaultsSessionId: 0,
    backgroundPacksSessionId: 0
  };
};

const updateVideoPackageState = (
  state: AppStoreState,
  nextLibrary: VideoUserPackageLibraryState,
  nextSettings?: VideoSettings
) => {
  const safeLibrary = saveVideoUserPackageLibrary(nextLibrary, state.video.appDefaults.videoDefaults);
  const resolvedSettings =
    nextSettings ??
    applyVideoUserPackageToSettings(
      resolveActiveVideoUserPackage(safeLibrary),
      state.video.appDefaults.videoDefaults
    );

  return {
    ...state.video,
    videoPackageLibrary: safeLibrary,
    videoSettings: resolvedSettings
  };
};

export const useAppStore = create<AppStoreState>((set, get) => ({
  workspace: buildInitialWorkspace(),
  video: buildInitialVideoState(),
  exports: {
    jobs: []
  },
  ui: {
    lastRoute: '/',
    jobCenterOpen: false,
    backgroundGeneratorReturnTo: '/'
  },
  projects: {
    hydrated: false,
    activeProjectId: null,
    activeProjectName: 'Untitled Project',
    recentProjects: []
  },
  setLastRoute: (route) =>
    set((state) => ({
      ui: {
        ...state.ui,
        lastRoute: route
      }
    })),
  setJobCenterOpen: (isOpen) =>
    set((state) => ({
      ui: {
        ...state.ui,
        jobCenterOpen: isOpen
      }
    })),
  setBackgroundGeneratorReturnTo: (route) =>
    set((state) => ({
      ui: {
        ...state.ui,
        backgroundGeneratorReturnTo: route
      }
    })),
  replaceWorkspace: (workspace) =>
    set((state) => ({
      workspace: {
        ...state.workspace,
        ...workspace
      }
    })),
  resetWorkspace: () =>
    set({
      workspace: buildInitialWorkspace()
    }),
  setPuzzle: (puzzle) =>
    set((state) => ({
      workspace: {
        ...state.workspace,
        puzzle
      }
    })),
  setBatch: (batch) =>
    set((state) => ({
      workspace: {
        ...state.workspace,
        batch,
        playIndex: 0,
        puzzle: batch[0] ?? state.workspace.puzzle ?? null
      }
    })),
  addPuzzleToBatch: (puzzle) =>
    set((state) => ({
      workspace: {
        ...state.workspace,
        batch: [...state.workspace.batch, puzzle]
      }
    })),
  setBatchAndPuzzle: (batch, puzzle = batch[0] ?? null) =>
    set((state) => ({
      workspace: {
        ...state.workspace,
        batch,
        puzzle,
        playIndex: 0
      }
    })),
  replaceBatchPuzzle: (index, puzzle) =>
    set((state) => {
      const nextBatch =
        index >= 0 && index < state.workspace.batch.length
          ? state.workspace.batch.map((item, itemIndex) => (itemIndex === index ? puzzle : item))
          : [...state.workspace.batch, puzzle];
      return {
        workspace: {
          ...state.workspace,
          batch: nextBatch,
          puzzle,
          playIndex: index >= 0 && index < nextBatch.length ? index : state.workspace.playIndex
        }
      };
    }),
  setPlayIndex: (index) =>
    set((state) => ({
      workspace: {
        ...state.workspace,
        playIndex: index,
        puzzle: state.workspace.batch[index] ?? state.workspace.puzzle
      }
    })),
  goToNextPuzzle: () =>
    set((state) => {
      const nextIndex = state.workspace.playIndex + 1;
      return {
        workspace: {
          ...state.workspace,
          playIndex: nextIndex,
          puzzle: state.workspace.batch[nextIndex] ?? state.workspace.puzzle
        }
      };
    }),
  setIncomingVideoFrames: (frames) =>
    set((state) => ({
      workspace: {
        ...state.workspace,
        incomingVideoFrames: frames,
        incomingVideoFramesSessionId: state.workspace.incomingVideoFramesSessionId + 1
      }
    })),
  queueInjectedUpload: (files, mode = null) =>
    set((state) => ({
      workspace: {
        ...state.workspace,
        injectedUploadFiles: files,
        injectedUploadProcessingMode: mode,
        injectedUploadFilesSessionId: state.workspace.injectedUploadFilesSessionId + 1
      }
    })),
  clearInjectedUpload: () =>
    set((state) => ({
      workspace: {
        ...state.workspace,
        injectedUploadFiles: null,
        injectedUploadProcessingMode: null
      }
    })),
  setAppDefaults: (settings, options) =>
    set((state) => {
      saveAppGlobalSettings(settings);
      saveSplitterMode(settings.splitterDefaults.defaultMode);
      saveGameAudioMuted(options?.gameAudioMuted ?? false);
      const nextVideoPackageLibrary = saveVideoUserPackageLibrary(
        state.video.videoPackageLibrary,
        settings.videoDefaults
      );
      const nextVideoSettings = applyVideoUserPackageToSettings(
        resolveActiveVideoUserPackage(nextVideoPackageLibrary),
        settings.videoDefaults
      );
      return {
        video: {
          ...state.video,
          appDefaults: settings,
          videoPackageLibrary: nextVideoPackageLibrary,
          videoSettings: nextVideoSettings,
          frameDefaultsSessionId: state.video.frameDefaultsSessionId + 1,
          splitterDefaultsSessionId: state.video.splitterDefaultsSessionId + 1
        }
      };
    }),
  resetAppDefaults: () =>
    set((state) => {
      const resetSettings = resetAppGlobalSettings();
      saveSplitterMode(resetSettings.splitterDefaults.defaultMode);
      saveGameAudioMuted(false);
      const nextVideoPackageLibrary = saveVideoUserPackageLibrary(
        state.video.videoPackageLibrary,
        resetSettings.videoDefaults
      );
      const nextVideoSettings = applyVideoUserPackageToSettings(
        resolveActiveVideoUserPackage(nextVideoPackageLibrary),
        resetSettings.videoDefaults
      );
      return {
        video: {
          ...state.video,
          appDefaults: resetSettings,
          videoPackageLibrary: nextVideoPackageLibrary,
          videoSettings: nextVideoSettings,
          frameDefaultsSessionId: state.video.frameDefaultsSessionId + 1,
          splitterDefaultsSessionId: state.video.splitterDefaultsSessionId + 1
        }
      };
    }),
  setVideoSettings: (next) =>
    set((state) => {
      const nextSettings =
        typeof next === 'function'
          ? next(state.video.videoSettings)
          : next;
      const currentLibrary = state.video.videoPackageLibrary;
      const activeVideoPackage = resolveActiveVideoUserPackage(currentLibrary);
      const nextActiveVideoPackage = persistVideoSettingsToVideoUserPackage(
        activeVideoPackage,
        nextSettings,
        state.video.appDefaults.videoDefaults
      );

      return {
        video: updateVideoPackageState(
          state,
          upsertVideoUserPackageInLibrary(currentLibrary, nextActiveVideoPackage),
          nextSettings
        )
      };
    }),
  applyVideoPackageLibraryState: (library, settings) =>
    set((state) => ({
      video: updateVideoPackageState(state, library, settings)
    })),
  selectVideoPackage: (packageId) =>
    set((state) => {
      const nextLibrary = setActiveVideoUserPackage(state.video.videoPackageLibrary, packageId);
      const nextSettings = applyVideoUserPackageToSettings(
        resolveActiveVideoUserPackage(nextLibrary),
        state.video.appDefaults.videoDefaults
      );

      return {
        video: updateVideoPackageState(state, nextLibrary, nextSettings)
      };
    }),
  createVideoPackage: (name) =>
    set((state) => {
      const nextVideoPackage = createVideoUserPackageFromSettings(
        name,
        state.video.videoSettings
      );

      return {
        video: updateVideoPackageState(
          state,
          {
            packages: [...state.video.videoPackageLibrary.packages, nextVideoPackage],
            activePackageId: nextVideoPackage.id
          },
          state.video.videoSettings
        )
      };
    }),
  duplicateActiveVideoPackage: (name) =>
    set((state) => {
      const nextVideoPackage = createVideoUserPackageFromSettings(
        name,
        state.video.videoSettings
      );

      return {
        video: updateVideoPackageState(
          state,
          {
            packages: [...state.video.videoPackageLibrary.packages, nextVideoPackage],
            activePackageId: nextVideoPackage.id
          },
          state.video.videoSettings
        )
      };
    }),
  renameVideoPackage: (packageId, name) =>
    set((state) => ({
      video: updateVideoPackageState(
        state,
        {
          packages: state.video.videoPackageLibrary.packages.map((entry) =>
            entry.id === packageId
              ? {
                  ...entry,
                  name: name.trim(),
                  updatedAt: Date.now()
                }
              : entry
          ),
          activePackageId: state.video.videoPackageLibrary.activePackageId
        },
        state.video.videoSettings
      )
    })),
  deleteVideoPackage: (packageId) =>
    set((state) => {
      if (packageId === DEFAULT_VIDEO_USER_PACKAGE_ID) {
        return state;
      }

      const nextLibrary = deleteVideoUserPackageFromLibrary(
        state.video.videoPackageLibrary,
        packageId,
        state.video.appDefaults.videoDefaults
      );
      const nextSettings = applyVideoUserPackageToSettings(
        resolveActiveVideoUserPackage(nextLibrary),
        state.video.appDefaults.videoDefaults
      );

      return {
        video: updateVideoPackageState(state, nextLibrary, nextSettings)
      };
    }),
  changeVideoAspectRatio: (aspectRatio) =>
    set((state) => {
      const currentLibrary = state.video.videoPackageLibrary;
      const activeVideoPackage = resolveActiveVideoUserPackage(currentLibrary);
      const syncedActivePackage = persistVideoSettingsToVideoUserPackage(
        activeVideoPackage,
        state.video.videoSettings,
        state.video.appDefaults.videoDefaults
      );
      const syncedLibrary = upsertVideoUserPackageInLibrary(
        currentLibrary,
        syncedActivePackage
      );
      const nextSettings = applyVideoUserPackageToAspectRatio(
        syncedActivePackage,
        aspectRatio,
        state.video.appDefaults.videoDefaults
      );
      const nextActivePackage = persistVideoSettingsToVideoUserPackage(
        syncedActivePackage,
        nextSettings,
        state.video.appDefaults.videoDefaults
      );

      return {
        video: updateVideoPackageState(
          state,
          upsertVideoUserPackageInLibrary(syncedLibrary, nextActivePackage),
          nextSettings
        )
      };
    }),
  bumpBackgroundPacksSession: () =>
    set((state) => ({
      video: {
        ...state.video,
        backgroundPacksSessionId: state.video.backgroundPacksSessionId + 1
      }
    })),
  bumpFrameDefaultsSession: () =>
    set((state) => ({
      video: {
        ...state.video,
        frameDefaultsSessionId: state.video.frameDefaultsSessionId + 1
      }
    })),
  bumpSplitterDefaultsSession: () =>
    set((state) => ({
      video: {
        ...state.video,
        splitterDefaultsSessionId: state.video.splitterDefaultsSessionId + 1
      }
    })),
  upsertExportJob: (job) =>
    set((state) => ({
      exports: {
        jobs: [
          job,
          ...state.exports.jobs.filter((entry) => entry.id !== job.id)
        ].sort((left, right) => right.startedAt - left.startedAt)
      }
    })),
  clearFinishedExportJobs: () =>
    set((state) => ({
      exports: {
        jobs: state.exports.jobs.filter((job) => job.state === 'running')
      }
    })),
  removeExportJob: (jobId) =>
    set((state) => ({
      exports: {
        jobs: state.exports.jobs.filter((job) => job.id !== jobId)
      }
    })),
  hydrateProject: (project) =>
    set((state) => ({
      workspace: {
        ...buildInitialWorkspace(),
        puzzle: project.workspace.puzzle,
        batch: project.workspace.batch,
        playIndex: project.workspace.playIndex,
        incomingVideoFrames: project.workspace.incomingVideoFrames
      },
      video: {
        ...state.video,
        videoSettings: project.video.settings
      },
      ui: {
        ...state.ui,
        lastRoute: project.uiSnapshot.lastRoute
      },
      projects: {
        ...state.projects,
        activeProjectId: project.id,
        activeProjectName: project.name
      }
    })),
  setRecentProjects: (projects) =>
    set((state) => ({
      projects: {
        ...state.projects,
        recentProjects: projects
      }
    })),
  setActiveProjectMeta: (projectId, name) =>
    set((state) => ({
      projects: {
        ...state.projects,
        activeProjectId: projectId,
        activeProjectName: name
      }
    })),
  setHydrated: (hydrated) =>
    set((state) => ({
      projects: {
        ...state.projects,
        hydrated
      }
    }))
}));

export const createExportJobId = (kind: ExportJob['kind']) =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `${kind}-${crypto.randomUUID()}`
    : `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const getCurrentWorkspaceSnapshot = () => {
  const { workspace } = useAppStore.getState();
  return {
    puzzle: workspace.puzzle,
    batch: workspace.batch,
    playIndex: workspace.playIndex,
    incomingVideoFrames: workspace.incomingVideoFrames
  };
};

export const getCurrentVideoSnapshot = () => {
  const { video } = useAppStore.getState();
  return {
    settings: video.videoSettings
  };
};
