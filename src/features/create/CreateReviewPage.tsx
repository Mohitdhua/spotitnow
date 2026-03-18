import { Download, Film, Layers, PencilLine, Play, Trash2, Upload, Wand2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { ConfirmDialog } from '../../app/components/ConfirmDialog';
import { downloadJsonFile } from '../../services/jsonTransfer';
import { notifySuccess } from '../../services/notifications';
import type { PuzzleSet } from '../../types';
import { useAppStore } from '../../store/appStore';

const samePuzzle = (
  left: { imageA: string; imageB: string } | null,
  right: { imageA: string; imageB: string } | null
) => Boolean(left && right && left.imageA === right.imageA && left.imageB === right.imageB);

export default function CreateReviewPage() {
  const navigate = useNavigate();
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const batch = useAppStore((state) => state.workspace.batch);
  const puzzle = useAppStore((state) => state.workspace.puzzle);
  const playIndex = useAppStore((state) => state.workspace.playIndex);
  const setPuzzle = useAppStore((state) => state.setPuzzle);
  const setPlayIndex = useAppStore((state) => state.setPlayIndex);
  const resetWorkspace = useAppStore((state) => state.resetWorkspace);

  const currentPuzzle = puzzle ?? batch[playIndex] ?? batch[0] ?? null;
  const selectedIndex = useMemo(() => {
    if (!currentPuzzle) return -1;
    const byIndex = batch[playIndex];
    if (samePuzzle(currentPuzzle, byIndex)) {
      return playIndex;
    }
    return batch.findIndex((entry) => samePuzzle(currentPuzzle, entry));
  }, [batch, currentPuzzle, playIndex]);

  const totalRegions = batch.reduce((sum, item) => sum + item.regions.length, 0);

  const handleSelectPuzzle = (index: number) => {
    setPlayIndex(index);
    setPuzzle(batch[index] ?? null);
  };

  const handleDownloadBatch = () => {
    const payload: PuzzleSet = {
      title: 'My Puzzle Batch',
      version: 1,
      puzzles: batch
    };
    downloadJsonFile(payload, 'puzzle-batch.json');
    notifySuccess('Batch JSON downloaded.');
  };

  const handleClearBatch = () => {
    resetWorkspace();
    setConfirmClearOpen(false);
    notifySuccess('Batch cleared from the current project.');
    navigate('/create/upload');
  };

  if (!batch.length) {
    return (
      <div className="rounded-[28px] border-4 border-dashed border-black bg-white p-10 text-center shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#2563EB]">Review Step</div>
        <h1 className="mt-3 text-3xl font-black uppercase tracking-tight text-slate-900">Nothing to review yet</h1>
        <p className="mt-3 text-sm font-semibold text-slate-600">
          Upload a puzzle pair first, then this page will help you decide whether to edit, play, or send the batch into video production.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            to="/create/upload"
            className="inline-flex items-center gap-2 rounded-xl border-2 border-black bg-[#FDE68A] px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-900 hover:bg-[#FCD34D]"
          >
            <Upload size={14} strokeWidth={2.5} />
            Start Uploading
          </Link>
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-xl border-2 border-black bg-white px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-700 hover:bg-slate-100"
          >
            Back To Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border-4 border-black bg-white p-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#2563EB]">Step 2</div>
            <h1 className="mt-3 text-3xl font-black uppercase tracking-tight text-slate-900">Review detection and choose the next move</h1>
            <p className="mt-3 text-sm font-semibold text-slate-600">
              Manual editing is still the safest option when a puzzle matters. Auto and AI are best used to accelerate the first pass, then this review step helps you decide what deserves cleanup.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border-2 border-black bg-[#FFF7ED] px-4 py-3">
              <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Puzzles</div>
              <div className="mt-2 text-3xl font-black text-slate-900">{batch.length}</div>
            </div>
            <div className="rounded-2xl border-2 border-black bg-[#F0FDF4] px-4 py-3">
              <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Regions</div>
              <div className="mt-2 text-3xl font-black text-slate-900">{totalRegions}</div>
            </div>
            <div className="rounded-2xl border-2 border-black bg-[#EFF6FF] px-4 py-3">
              <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Selected</div>
              <div className="mt-2 text-sm font-black uppercase text-slate-900">
                {selectedIndex >= 0 ? `Puzzle ${selectedIndex + 1}` : 'Draft'}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            to="/create/upload"
            className="inline-flex items-center gap-2 rounded-xl border-2 border-black bg-white px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-700 hover:bg-slate-100"
          >
            <Upload size={14} strokeWidth={2.5} />
            Add More
          </Link>
          <Link
            to="/create/editor"
            className="inline-flex items-center gap-2 rounded-xl border-2 border-black bg-[#FDE68A] px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-900 hover:bg-[#FCD34D]"
          >
            <PencilLine size={14} strokeWidth={2.5} />
            Manual Edit
          </Link>
          <Link
            to="/play"
            className="inline-flex items-center gap-2 rounded-xl border-2 border-black bg-[#DBEAFE] px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-900 hover:bg-[#BFDBFE]"
          >
            <Play size={14} strokeWidth={2.5} />
            Play Batch
          </Link>
          <Link
            to="/video/setup"
            className="inline-flex items-center gap-2 rounded-xl border-2 border-black bg-[#DCFCE7] px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-900 hover:bg-[#BBF7D0]"
          >
            <Film size={14} strokeWidth={2.5} />
            Build Video
          </Link>
          <Link
            to="/editor"
            className="inline-flex items-center gap-2 rounded-xl border-2 border-black bg-[#FCE7F3] px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-900 hover:bg-[#FBCFE8]"
          >
            <Wand2 size={14} strokeWidth={2.5} />
            Editor Studio
          </Link>
          <button
            type="button"
            onClick={handleDownloadBatch}
            className="inline-flex items-center gap-2 rounded-xl border-2 border-black bg-white px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-700 hover:bg-slate-100"
          >
            <Download size={14} strokeWidth={2.5} />
            Download JSON
          </button>
          <button
            type="button"
            onClick={() => setConfirmClearOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl border-2 border-black bg-white px-4 py-3 text-xs font-black uppercase tracking-wide text-red-700 hover:bg-red-50"
          >
            <Trash2 size={14} strokeWidth={2.5} />
            Clear Batch
          </button>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        {batch.map((item, index) => {
          const isSelected = index === selectedIndex || (selectedIndex === -1 && index === 0);
          const title = item.title?.trim() || `Puzzle ${index + 1}`;
          return (
            <button
              key={`${title}-${index}`}
              type="button"
              onClick={() => handleSelectPuzzle(index)}
              className={`rounded-[26px] border-4 p-4 text-left shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] transition-transform hover:-translate-y-1 ${
                isSelected ? 'border-black bg-[#FEF3C7]' : 'border-black bg-white'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Puzzle {index + 1}</div>
                  <h2 className="mt-2 text-xl font-black uppercase text-slate-900">{title}</h2>
                </div>
                <div className="rounded-full border border-black bg-white px-3 py-1 text-[10px] font-black uppercase text-slate-700">
                  {item.regions.length} diff{item.regions.length === 1 ? '' : 's'}
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border-2 border-black bg-white p-2">
                  <img src={item.imageA} alt={`${title} original`} className="h-44 w-full rounded-xl object-contain bg-slate-100" />
                </div>
                <div className="rounded-2xl border-2 border-black bg-white p-2">
                  <img src={item.imageB} alt={`${title} modified`} className="h-44 w-full rounded-xl object-contain bg-slate-100" />
                </div>
              </div>
            </button>
          );
        })}
      </section>

      <ConfirmDialog
        open={confirmClearOpen}
        title="Clear current batch?"
        description="This removes the current puzzle batch from the active project workspace. Autosaved projects and exported JSON backups stay untouched."
        confirmLabel="Clear Batch"
        tone="danger"
        onOpenChange={setConfirmClearOpen}
        onConfirm={handleClearBatch}
      />
    </div>
  );
}
