import { useState } from 'react';
import { Download, Settings as SettingsIcon, SlidersHorizontal } from 'lucide-react';
import { AppSettingsModal } from '../../components/AppSettingsModal';
import { applyAppSettingsTransferBundle, createAppSettingsTransferBundle } from '../../services/settingsTransfer';
import { downloadJsonFile } from '../../services/jsonTransfer';
import { notifyError, notifySuccess } from '../../services/notifications';
import { applyVideoUserPackageToSettings, resolveActiveVideoUserPackage } from '../../services/videoUserPackages';
import { useAppStore } from '../../store/appStore';

export default function SettingsPage() {
  const [isModalOpen, setIsModalOpen] = useState(true);
  const appDefaults = useAppStore((state) => state.video.appDefaults);
  const videoPackageLibrary = useAppStore((state) => state.video.videoPackageLibrary);
  const activeProjectName = useAppStore((state) => state.projects.activeProjectName);
  const setAppDefaults = useAppStore((state) => state.setAppDefaults);
  const resetAppDefaults = useAppStore((state) => state.resetAppDefaults);
  const applyVideoPackageLibraryState = useAppStore((state) => state.applyVideoPackageLibraryState);
  const bumpFrameDefaultsSession = useAppStore((state) => state.bumpFrameDefaultsSession);
  const bumpSplitterDefaultsSession = useAppStore((state) => state.bumpSplitterDefaultsSession);
  const bumpBackgroundPacksSession = useAppStore((state) => state.bumpBackgroundPacksSession);

  const handleQuickExport = async () => {
    try {
      const bundle = await createAppSettingsTransferBundle({
        appSettings: appDefaults
      });
      const timestamp = bundle.exportedAt.replace(/[:.]/g, '-');
      downloadJsonFile(bundle, `spotitnow-settings-${timestamp}.json`);
      notifySuccess('Settings backup downloaded.');
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Settings export failed.');
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border-4 border-black bg-white p-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#2563EB]">System Settings</div>
            <h1 className="mt-3 text-3xl font-black uppercase tracking-tight text-slate-900">Shared defaults and backup tools</h1>
            <p className="mt-3 text-sm font-semibold text-slate-600">
              Global defaults stay shared across projects, while puzzle batches and current workflow state are project-scoped. This page keeps those responsibilities separate.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border-2 border-black bg-[#FFF7ED] px-4 py-3">
              <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Project</div>
              <div className="mt-2 text-sm font-black uppercase text-slate-900">{activeProjectName}</div>
            </div>
            <div className="rounded-2xl border-2 border-black bg-[#F0FDF4] px-4 py-3">
              <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Packages</div>
              <div className="mt-2 text-3xl font-black text-slate-900">{videoPackageLibrary.packages.length}</div>
            </div>
            <div className="rounded-2xl border-2 border-black bg-[#EFF6FF] px-4 py-3">
              <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Default Aspect</div>
              <div className="mt-2 text-sm font-black uppercase text-slate-900">{appDefaults.videoDefaults.aspectRatio}</div>
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl border-2 border-black bg-[#DBEAFE] px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-900 hover:bg-[#BFDBFE]"
          >
            <SlidersHorizontal size={14} strokeWidth={2.5} />
            Open Defaults Panel
          </button>
          <button
            type="button"
            onClick={() => {
              void handleQuickExport();
            }}
            className="inline-flex items-center gap-2 rounded-xl border-2 border-black bg-white px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-700 hover:bg-slate-100"
          >
            <Download size={14} strokeWidth={2.5} />
            Export Settings
          </button>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-[24px] border-4 border-black bg-white p-5 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border-2 border-black bg-[#FDE68A]">
            <SettingsIcon size={20} strokeWidth={2.6} />
          </div>
          <h2 className="mt-4 text-2xl font-black uppercase tracking-tight text-slate-900">Global defaults</h2>
          <p className="mt-2 text-sm font-semibold text-slate-600">
            Default package settings, extractor output defaults, background generator defaults, splitter defaults, and related shared tools stay here.
          </p>
        </div>

        <div className="rounded-[24px] border-4 border-black bg-white p-5 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border-2 border-black bg-[#DCFCE7]">
            <Download size={20} strokeWidth={2.6} />
          </div>
          <h2 className="mt-4 text-2xl font-black uppercase tracking-tight text-slate-900">Portable backups</h2>
          <p className="mt-2 text-sm font-semibold text-slate-600">
            Export shared settings for safe migration between devices. Project data stays on the dashboard and uses the separate project backup format.
          </p>
        </div>
      </section>

      <AppSettingsModal
        isOpen={isModalOpen}
        settings={appDefaults}
        onClose={() => setIsModalOpen(false)}
        onSave={(nextSettings, options) => {
          setAppDefaults(nextSettings, options);
          notifySuccess('App defaults saved.');
          setIsModalOpen(false);
        }}
        onExportSettings={async (nextSettings, options) => {
          const bundle = await createAppSettingsTransferBundle({
            appSettings: nextSettings,
            gameAudioMuted: options?.gameAudioMuted
          });
          const timestamp = bundle.exportedAt.replace(/[:.]/g, '-');
          downloadJsonFile(bundle, `spotitnow-settings-${timestamp}.json`);
          return 'Settings backup downloaded.';
        }}
        onImportSettings={async (file) => {
          const raw = await file.text();
          const result = await applyAppSettingsTransferBundle(raw);
          setAppDefaults(result.appSettings, { gameAudioMuted: result.gameAudioMuted });
          applyVideoPackageLibraryState(
            {
              packages: result.videoPackages,
              activePackageId: result.lastSelectedVideoPackageId
            },
            applyVideoUserPackageToSettings(
              resolveActiveVideoUserPackage({
                packages: result.videoPackages,
                activePackageId: result.lastSelectedVideoPackageId
              }),
              result.appSettings.videoDefaults
            )
          );
          bumpFrameDefaultsSession();
          bumpSplitterDefaultsSession();
          bumpBackgroundPacksSession();

          const layoutSummary = result.hasSavedVideoLayout ? 'saved layout included' : 'no saved layout';
          return {
            gameAudioMuted: result.gameAudioMuted,
            message: `Imported settings, ${result.splitterPresetCount} splitter presets, ${result.timestampPresetCount} timestamp presets, ${result.watermarkPresetCount} watermark presets, ${result.videoPackageCount} video packages, ${result.backgroundPackCount} background packs, ${layoutSummary}.${result.migratedLegacyStyleLabPresetCount > 0 ? ` Migrated ${result.migratedLegacyStyleLabPresetCount} legacy video presets into packages.` : ''}`
          };
        }}
        onResetDefaults={() => {
          resetAppDefaults();
          notifySuccess('Global defaults reset.');
        }}
      />
    </div>
  );
}
