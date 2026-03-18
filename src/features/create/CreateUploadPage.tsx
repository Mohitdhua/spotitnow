import { BrainCircuit, MousePointer2, ShieldCheck, Upload } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { ImageUploader } from '../../components/ImageUploader';
import type { ProcessingMode, Puzzle, Region } from '../../types';
import { notifySuccess } from '../../services/notifications';
import { useAppStore } from '../../store/appStore';

const optionCards = [
  {
    icon: ShieldCheck,
    title: 'Manual First',
    copy: 'Safest choice when you want full control. Upload now, then fine-tune regions in the editor before you play or export.'
  },
  {
    icon: MousePointer2,
    title: 'Auto Review',
    copy: 'Fastest route for clean pairs. Let the app detect regions, then review the batch before sending it forward.'
  },
  {
    icon: BrainCircuit,
    title: 'AI Assist',
    copy: 'Best when the differences are subtle or messy. Use it when auto detection struggles, then still review the output before shipping.'
  }
];

export default function CreateUploadPage() {
  const navigate = useNavigate();
  const batch = useAppStore((state) => state.workspace.batch);
  const puzzle = useAppStore((state) => state.workspace.puzzle);
  const injectedFiles = useAppStore((state) => state.workspace.injectedUploadFiles);
  const injectedProcessingMode = useAppStore((state) => state.workspace.injectedUploadProcessingMode);
  const injectedFilesSessionId = useAppStore((state) => state.workspace.injectedUploadFilesSessionId);
  const setBatchAndPuzzle = useAppStore((state) => state.setBatchAndPuzzle);
  const clearInjectedUpload = useAppStore((state) => state.clearInjectedUpload);

  const handleImagesSelected = (imageA: string, imageB: string, regions: Region[] = []) => {
    const nextPuzzle: Puzzle = {
      imageA,
      imageB,
      regions,
      title: 'Draft Puzzle'
    };
    setBatchAndPuzzle([nextPuzzle], nextPuzzle);
    notifySuccess('Puzzle uploaded. Review the draft before you play or export.');
    navigate('/create/review');
  };

  const handleBatchSelected = (newPuzzles: Puzzle[]) => {
    if (!newPuzzles.length) return;
    const nextBatch = batch.length > 0 ? [...batch, ...newPuzzles] : newPuzzles;
    setBatchAndPuzzle(nextBatch, puzzle ?? nextBatch[0] ?? null);
    notifySuccess(`Loaded ${newPuzzles.length} puzzle${newPuzzles.length === 1 ? '' : 's'} into the review step.`);
    navigate('/create/review');
  };

  const handleExportVideo = (newPuzzles: Puzzle[]) => {
    if (!newPuzzles.length) return;
    setBatchAndPuzzle(newPuzzles, newPuzzles[0] ?? null);
    notifySuccess('Batch prepared for video setup.');
    navigate('/video/setup');
  };

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border-4 border-black bg-white p-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#2563EB]">Create Workflow</div>
            <h1 className="mt-3 text-3xl font-black uppercase tracking-tight text-slate-900 sm:text-4xl">
              Start with source files, then review before you commit to play or export
            </h1>
            <p className="mt-3 text-sm font-semibold text-slate-600 sm:text-base">
              This step is intentionally beginner-safe. Upload your pair, let the app assist where it can, then move
              into review instead of jumping straight into a final output.
            </p>
          </div>

          <div className="rounded-2xl border-2 border-black bg-[#FEF3C7] px-4 py-3 text-sm font-black uppercase text-slate-900">
            {batch.length > 0 ? `${batch.length} puzzle${batch.length === 1 ? '' : 's'} already in this project` : 'New project draft'}
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {optionCards.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.title} className="rounded-2xl border-2 border-black bg-[#FFFDF5] p-4">
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl border-2 border-black bg-white">
                  <Icon size={18} strokeWidth={2.6} />
                </div>
                <h2 className="mt-4 text-lg font-black uppercase text-slate-900">{item.title}</h2>
                <p className="mt-2 text-sm font-semibold text-slate-600">{item.copy}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-[28px] border-4 border-black bg-white p-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Step 1</div>
            <h2 className="mt-2 text-2xl font-black uppercase tracking-tight text-slate-900">Upload Pairs</h2>
          </div>
          <Link
            to={batch.length > 0 ? '/create/review' : '/'}
            className="inline-flex items-center gap-2 rounded-xl border-2 border-black bg-white px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-700 hover:bg-slate-100"
          >
            <Upload size={14} strokeWidth={2.5} />
            {batch.length > 0 ? 'Resume Review' : 'Back To Dashboard'}
          </Link>
        </div>

        <ImageUploader
          onImagesSelected={handleImagesSelected}
          onBatchSelected={handleBatchSelected}
          onExportVideo={handleExportVideo}
          injectedFiles={injectedFiles ?? undefined}
          injectedProcessingMode={injectedProcessingMode as ProcessingMode | null}
          injectedFilesSessionId={injectedFilesSessionId}
          onInjectedFilesHandled={clearInjectedUpload}
        />
      </section>
    </div>
  );
}
