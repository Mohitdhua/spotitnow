import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Download, Library, RefreshCcw, Trash2, Upload } from 'lucide-react';
import { ConfirmDialog } from '../app/components/ConfirmDialog';
import { TextPromptDialog } from '../app/components/TextPromptDialog';
import { GeneratedBackgroundCanvas } from './GeneratedBackgroundCanvas';
import {
  deleteGeneratedBackgroundPack,
  loadGeneratedBackgroundPacks,
  renameGeneratedBackgroundPack,
  replaceGeneratedBackgroundPacks,
  saveGeneratedBackgroundPack
} from '../services/backgroundPacks';
import {
  createGeneratedBackgroundPack,
  GENERATED_BACKGROUND_FAMILY_OPTIONS,
  GENERATED_BACKGROUND_PACK_SIZE,
  GENERATED_BACKGROUND_PALETTE_OPTIONS,
  resolveGeneratedBackgroundForIndex
} from '../services/generatedBackgrounds';
import type { GeneratedBackgroundMotifFamily, GeneratedBackgroundPaletteId, VideoSettings } from '../types';

interface BackgroundGeneratorModeProps {
  onBack: () => void;
  storageRefreshKey?: number;
  onLibraryChange?: () => void;
}

type MotifFocus = 'balanced' | 'party' | 'paper' | 'comic' | 'calm';
type PaletteFocus = 'mixed' | 'warm' | 'cool' | 'night';

const ASPECT_RATIOS: VideoSettings['aspectRatio'][] = ['16:9', '9:16', '1:1', '4:3'];

const MOTIF_FOCUS_OPTIONS: Array<{ value: MotifFocus; label: string; description: string }> = [
  { value: 'balanced', label: 'Balanced', description: 'A broad mix of decorative backdrops for general puzzle videos.' },
  { value: 'party', label: 'Party', description: 'Confetti, bursts, spark trails, and high-energy celebration motifs.' },
  { value: 'paper', label: 'Paper Cut', description: 'Layered collage, ribbons, blobs, and calmer handcrafted depth.' },
  { value: 'comic', label: 'Comic', description: 'Halftone dots, doodles, stickers, and more punchy editorial energy.' },
  { value: 'calm', label: 'Calm Motion', description: 'Waves, soft blobs, and lighter motion that stays quiet behind panels.' }
];

const PALETTE_FOCUS_OPTIONS: Array<{ value: PaletteFocus; label: string; description: string }> = [
  { value: 'mixed', label: 'Mixed', description: 'Uses the full color library.' },
  { value: 'warm', label: 'Warm', description: 'Sunrise, amber, and candy-led tones.' },
  { value: 'cool', label: 'Cool', description: 'Mint, ocean, and airy palettes.' },
  { value: 'night', label: 'Night', description: 'Midnight-heavy packs with neon contrast.' }
];

const downloadJson = (data: unknown, filename: string) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

const resolveFamilies = (focus: MotifFocus): GeneratedBackgroundMotifFamily[] => {
  switch (focus) {
    case 'party':
      return ['confetti_field', 'starburst', 'spark_trails', 'sticker_scatter'];
    case 'paper':
      return ['paper_cut', 'ribbon_swoop', 'blob_garden', 'layered_waves'];
    case 'comic':
      return ['comic_dots', 'doodle_parade', 'sticker_scatter', 'starburst'];
    case 'calm':
      return ['layered_waves', 'paper_cut', 'blob_garden', 'spark_trails'];
    case 'balanced':
    default:
      return GENERATED_BACKGROUND_FAMILY_OPTIONS.map((entry) => entry.value);
  }
};

const resolvePaletteIds = (focus: PaletteFocus): GeneratedBackgroundPaletteId[] => {
  switch (focus) {
    case 'warm':
      return ['sunrise', 'amber', 'candy'];
    case 'cool':
      return ['mint', 'ocean', 'sunrise'];
    case 'night':
      return ['midnight', 'candy', 'ocean'];
    case 'mixed':
    default:
      return GENERATED_BACKGROUND_PALETTE_OPTIONS.map((entry) => entry.value);
  }
};

export function BackgroundGeneratorMode({
  onBack,
  storageRefreshKey = 0,
  onLibraryChange
}: BackgroundGeneratorModeProps) {
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [packs, setPacks] = useState(() => loadGeneratedBackgroundPacks());
  const [selectedPackId, setSelectedPackId] = useState(() => loadGeneratedBackgroundPacks()[0]?.id ?? '');
  const [previewIndex, setPreviewIndex] = useState(0);
  const [packName, setPackName] = useState(`Spotitnow Pack ${new Date().toLocaleDateString()}`);
  const [aspectRatio, setAspectRatio] = useState<VideoSettings['aspectRatio']>('16:9');
  const [motifFocus, setMotifFocus] = useState<MotifFocus>('balanced');
  const [paletteFocus, setPaletteFocus] = useState<PaletteFocus>('mixed');
  const [baseSeed, setBaseSeed] = useState(() => Math.max(1, Math.floor(Date.now() % 100000)));
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  useEffect(() => {
    const nextPacks = loadGeneratedBackgroundPacks();
    setPacks(nextPacks);
    setSelectedPackId((current) => {
      if (current && nextPacks.some((pack) => pack.id === current)) {
        return current;
      }
      return nextPacks[0]?.id ?? '';
    });
  }, [storageRefreshKey]);

  const selectedPack = useMemo(
    () => packs.find((pack) => pack.id === selectedPackId) ?? packs[0] ?? null,
    [packs, selectedPackId]
  );

  const selectedPreview = useMemo(
    () => resolveGeneratedBackgroundForIndex(selectedPack, previewIndex, 1),
    [previewIndex, selectedPack]
  );

  useEffect(() => {
    setPreviewIndex(0);
  }, [selectedPackId]);

  const refreshPacks = (nextSelectedPackId?: string) => {
    const nextPacks = loadGeneratedBackgroundPacks();
    setPacks(nextPacks);
    setSelectedPackId(nextSelectedPackId ?? nextPacks[0]?.id ?? '');
    onLibraryChange?.();
  };

  const handleGeneratePack = () => {
    const pack = createGeneratedBackgroundPack({
      name: packName,
      count: GENERATED_BACKGROUND_PACK_SIZE,
      aspectRatio,
      baseSeed,
      families: resolveFamilies(motifFocus),
      paletteIds: resolvePaletteIds(paletteFocus)
    });
    saveGeneratedBackgroundPack(pack);
    setBaseSeed((current) => current + 17);
    refreshPacks(pack.id);
  };

  const handleDeleteSelectedPack = () => {
    if (!selectedPack) return;
    setIsDeleteDialogOpen(true);
  };

  const confirmDeleteSelectedPack = () => {
    if (!selectedPack) return;
    const nextPacks = deleteGeneratedBackgroundPack(selectedPack.id);
    setPacks(nextPacks);
    setSelectedPackId(nextPacks[0]?.id ?? '');
    setPreviewIndex(0);
    setIsDeleteDialogOpen(false);
    onLibraryChange?.();
  };

  const handleExportSelectedPack = () => {
    if (!selectedPack) return;
    downloadJson(selectedPack, `${selectedPack.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'background-pack'}.json`);
  };

  const handleRenameSelectedPack = () => {
    if (!selectedPack) return;
    setIsRenameDialogOpen(true);
  };

  const confirmRenameSelectedPack = (nextName: string) => {
    if (!selectedPack || nextName.trim() === selectedPack.name) {
      setIsRenameDialogOpen(false);
      return;
    }
    const nextPacks = renameGeneratedBackgroundPack(selectedPack.id, nextName.trim());
    setPacks(nextPacks);
    setSelectedPackId(selectedPack.id);
    setIsRenameDialogOpen(false);
    onLibraryChange?.();
  };

  const handleImportPack = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw);
      const nextPacks = replaceGeneratedBackgroundPacks(
        Array.isArray(parsed) ? [...packs, ...parsed] : [...packs, parsed]
      );
      setPacks(nextPacks);
      setSelectedPackId(nextPacks[0]?.id ?? '');
      onLibraryChange?.();
    } catch {
      alert('That file could not be imported as a background pack.');
    } finally {
      if (event.target) {
        event.target.value = '';
      }
    }
  };

  const aspectLabel = selectedPack ? `${selectedPack.aspectRatio} pack` : `${aspectRatio} pack`;
  const starterThumbnails = selectedPack ? selectedPack.backgrounds.slice(0, 8) : [];

  return (
    <div className="mx-auto w-full max-w-7xl p-3 sm:p-4 md:p-6">
      <div className="overflow-hidden rounded-[28px] border-4 border-black bg-[#FFFDF8] shadow-[10px_10px_0px_0px_rgba(0,0,0,1)]">
        <div className="border-b-4 border-black bg-[linear-gradient(135deg,#D9E7FF_0%,#FFF1AE_45%,#FFC7D9_100%)] p-4 sm:p-6 md:p-7">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-start gap-3 sm:gap-4">
              <button
                onClick={onBack}
                className="shrink-0 rounded-xl border-2 border-black bg-white p-2.5 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] transition-all hover:-translate-y-0.5 hover:bg-black hover:text-white"
              >
                <ArrowLeft size={22} strokeWidth={3} />
              </button>
              <div>
                <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-700">Background Generator</div>
                <h2 className="mt-1 text-2xl font-black uppercase tracking-tight text-slate-900 sm:text-3xl">
                  Build reusable game-area packs
                </h2>
                <p className="mt-2 max-w-2xl text-sm font-semibold text-slate-700">
                  Create engaging scene-background packs for spot-the-difference videos, preview the motion live, and use them in video setup and export.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap">
              <button
                type="button"
                onClick={handleGeneratePack}
                className="rounded-xl border-2 border-black bg-black px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-white transition-transform hover:-translate-y-0.5"
              >
                Generate Pack
              </button>
              <button
                type="button"
                onClick={() => setBaseSeed((current) => current + 97)}
                className="rounded-xl border-2 border-black bg-white px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-slate-900 hover:bg-slate-100"
              >
                <span className="inline-flex items-center gap-2">
                  <RefreshCcw size={14} />
                  New Seed
                </span>
              </button>
              <button
                type="button"
                onClick={handleExportSelectedPack}
                disabled={!selectedPack}
                className="rounded-xl border-2 border-black bg-[#FFF5CC] px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="inline-flex items-center gap-2">
                  <Download size={14} />
                  Export Pack
                </span>
              </button>
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                className="rounded-xl border-2 border-black bg-[#DBEAFE] px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-slate-900"
              >
                <span className="inline-flex items-center gap-2">
                  <Upload size={14} />
                  Import Pack
                </span>
              </button>
              <input ref={importInputRef} type="file" accept=".json,application/json" onChange={handleImportPack} className="hidden" />
            </div>
          </div>
        </div>

        <div className="grid gap-6 p-4 md:grid-cols-[1.05fr_0.95fr] md:p-6">
          <div className="space-y-6">
            <div className="rounded-2xl border-4 border-black bg-white p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] md:p-5">
              <div className="flex items-center gap-2">
                <Library size={18} strokeWidth={3} />
                <h3 className="text-lg font-black uppercase">Pack Builder</h3>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-700">Pack Name</span>
                  <input
                    value={packName}
                    onChange={(event) => setPackName(event.target.value)}
                    className="w-full rounded-xl border-2 border-black bg-[#FFFDF5] px-3 py-3 text-sm font-semibold text-slate-900 outline-none focus:bg-white"
                    placeholder="Spotitnow Pack"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-700">Aspect Ratio</span>
                  <select
                    value={aspectRatio}
                    onChange={(event) => setAspectRatio(event.target.value as VideoSettings['aspectRatio'])}
                    className="w-full rounded-xl border-2 border-black bg-[#FFFDF5] px-3 py-3 text-sm font-semibold text-slate-900 outline-none"
                  >
                    {ASPECT_RATIOS.map((ratio) => (
                      <option key={ratio} value={ratio}>
                        {ratio}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <div className="rounded-2xl border-2 border-black bg-[#F8FDFF] p-4">
                  <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-700">Pack Size</div>
                  <div className="mt-2 text-3xl font-black text-slate-900">{GENERATED_BACKGROUND_PACK_SIZE}</div>
                  <div className="mt-2 text-[10px] font-bold uppercase text-slate-500">
                    Every saved pack always contains exactly 100 recipes.
                  </div>
                </div>

                <label className="space-y-2">
                  <span className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-700">Motif Blend</span>
                  <select
                    value={motifFocus}
                    onChange={(event) => setMotifFocus(event.target.value as MotifFocus)}
                    className="w-full rounded-xl border-2 border-black bg-[#FFFDF5] px-3 py-3 text-sm font-semibold text-slate-900 outline-none"
                  >
                    {MOTIF_FOCUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <div className="text-[10px] font-bold uppercase text-slate-500">
                    {MOTIF_FOCUS_OPTIONS.find((option) => option.value === motifFocus)?.description}
                  </div>
                </label>

                <label className="space-y-2">
                  <span className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-700">Palette Focus</span>
                  <select
                    value={paletteFocus}
                    onChange={(event) => setPaletteFocus(event.target.value as PaletteFocus)}
                    className="w-full rounded-xl border-2 border-black bg-[#FFFDF5] px-3 py-3 text-sm font-semibold text-slate-900 outline-none"
                  >
                    {PALETTE_FOCUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <div className="text-[10px] font-bold uppercase text-slate-500">
                    {PALETTE_FOCUS_OPTIONS.find((option) => option.value === paletteFocus)?.description}
                  </div>
                </label>
              </div>

              <div className="mt-4 rounded-2xl border-2 border-black bg-[#F8FDFF] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-700">Seed</div>
                    <div className="mt-1 text-2xl font-black text-slate-900">{baseSeed}</div>
                  </div>
                  <div className="text-right text-[10px] font-bold uppercase text-slate-600">
                    Deterministic pack build
                    <div className="mt-1 text-slate-500">Use New Seed to branch another version.</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border-4 border-black bg-white p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] md:p-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-black uppercase">Pack Library</h3>
                <span className="rounded-full border-2 border-black bg-[#FFF5CC] px-3 py-1 text-[10px] font-black uppercase">
                  {packs.length} pack{packs.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="mt-4 space-y-3">
                {packs.map((pack) => {
                  const preview = resolveGeneratedBackgroundForIndex(pack, 0, 1);
                  return (
                    <button
                      key={pack.id}
                      type="button"
                      onClick={() => setSelectedPackId(pack.id)}
                      className={`grid w-full gap-3 rounded-2xl border-2 border-black p-3 text-left transition-transform hover:-translate-y-0.5 md:grid-cols-[140px_1fr] ${
                        selectedPackId === pack.id ? 'bg-[#FFF8D8]' : 'bg-[#FFFDF5]'
                      }`}
                    >
                      <div className="aspect-video overflow-hidden rounded-xl border-2 border-black bg-slate-100">
                        {preview ? <GeneratedBackgroundCanvas spec={preview} className="h-full w-full" /> : null}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-black uppercase text-slate-900">{pack.name}</span>
                          <span className="rounded-full border border-black bg-white px-2 py-0.5 text-[10px] font-black uppercase">
                            {pack.aspectRatio}
                          </span>
                        </div>
                        <div className="mt-2 text-xs font-semibold text-slate-700">
                          {pack.backgrounds.length} scenes • {pack.description || 'Reusable generated pack'}
                        </div>
                        <div className="mt-2 text-[10px] font-bold uppercase text-slate-500">
                          Updated {new Date(pack.updatedAt).toLocaleString()}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl border-4 border-black bg-white p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] md:p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-black uppercase">{selectedPack?.name ?? 'No pack selected'}</h3>
                  <div className="mt-1 text-[10px] font-bold uppercase text-slate-600">
                    {selectedPack ? `${selectedPack.backgrounds.length} backgrounds • ${aspectLabel}` : 'Create or import a pack to preview it here.'}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleRenameSelectedPack}
                    disabled={!selectedPack}
                    className="rounded-xl border-2 border-black bg-white px-3 py-2 text-[10px] font-black uppercase text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteSelectedPack}
                    disabled={!selectedPack}
                    className="rounded-xl border-2 border-black bg-white p-2.5 text-slate-800 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>

              <div className="mt-4 aspect-video overflow-hidden rounded-[22px] border-4 border-black bg-slate-100">
                {selectedPreview ? (
                  <GeneratedBackgroundCanvas spec={selectedPreview} className="h-full w-full" showSafeArea animate />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm font-black uppercase text-slate-500">
                    No preview available
                  </div>
                )}
              </div>

              <div className="mt-4 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setPreviewIndex((current) => Math.max(0, current - 1))}
                  className="rounded-xl border-2 border-black bg-white px-4 py-2 text-xs font-black uppercase hover:bg-slate-100"
                >
                  Previous
                </button>
                <div className="text-center">
                  <div className="text-xs font-black uppercase text-slate-900">{selectedPreview?.name ?? 'Preview'}</div>
                  <div className="mt-1 text-[10px] font-bold uppercase text-slate-500">
                    {selectedPack ? `${Math.min(previewIndex + 1, selectedPack.backgrounds.length)} / ${selectedPack.backgrounds.length}` : '--'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setPreviewIndex((current) =>
                      selectedPack ? Math.min(selectedPack.backgrounds.length - 1, current + 1) : current
                    )
                  }
                  className="rounded-xl border-2 border-black bg-white px-4 py-2 text-xs font-black uppercase hover:bg-slate-100"
                >
                  Next
                </button>
              </div>
            </div>

            <div className="rounded-2xl border-4 border-black bg-white p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] md:p-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-black uppercase">Preview Strip</h3>
                <span className="text-[10px] font-bold uppercase text-slate-500">First eight recipes</span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {starterThumbnails.map((background, index) => (
                  <button
                    key={background.id}
                    type="button"
                    onClick={() => setPreviewIndex(index)}
                    className={`overflow-hidden rounded-xl border-2 border-black ${
                      previewIndex === index ? 'bg-[#FFF5CC]' : 'bg-white'
                    }`}
                  >
                    <div className="aspect-video">
                      <GeneratedBackgroundCanvas spec={background} className="h-full w-full" />
                    </div>
                    <div className="border-t-2 border-black px-2 py-2 text-[10px] font-black uppercase text-slate-700">
                      {background.name}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <TextPromptDialog
        open={isRenameDialogOpen}
        title="Rename Background Pack"
        description="Update the pack name without changing any generated backgrounds."
        label="Pack name"
        placeholder="Background pack"
        initialValue={selectedPack?.name ?? ''}
        confirmLabel="Rename"
        onOpenChange={setIsRenameDialogOpen}
        onConfirm={confirmRenameSelectedPack}
      />

      <ConfirmDialog
        open={isDeleteDialogOpen}
        title="Delete Background Pack?"
        description={selectedPack ? `Delete "${selectedPack.name}" from your generated background library?` : ''}
        confirmLabel="Delete"
        tone="danger"
        onOpenChange={setIsDeleteDialogOpen}
        onConfirm={confirmDeleteSelectedPack}
      />
    </div>
  );
}
