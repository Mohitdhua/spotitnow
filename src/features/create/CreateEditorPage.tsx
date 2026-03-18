import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EditorCanvas } from '../../components/EditorCanvas';
import { downloadJsonFile } from '../../services/jsonTransfer';
import { notifySuccess } from '../../services/notifications';
import type { Puzzle, PuzzleSet } from '../../types';
import { useAppStore } from '../../store/appStore';

const samePuzzle = (left: Puzzle | null, right: Puzzle | null) =>
  Boolean(left && right && left.imageA === right.imageA && left.imageB === right.imageB);

const upsertPuzzle = (batch: Puzzle[], activePuzzle: Puzzle | null, playIndex: number, updatedPuzzle: Puzzle) => {
  if (!batch.length) {
    return {
      batch: [updatedPuzzle],
      index: 0
    };
  }

  if (samePuzzle(batch[playIndex] ?? null, activePuzzle)) {
    return {
      batch: batch.map((item, index) => (index === playIndex ? updatedPuzzle : item)),
      index: playIndex
    };
  }

  const matchedIndex = batch.findIndex((item) => samePuzzle(item, activePuzzle));
  if (matchedIndex >= 0) {
    return {
      batch: batch.map((item, index) => (index === matchedIndex ? updatedPuzzle : item)),
      index: matchedIndex
    };
  }

  return {
    batch: [...batch, updatedPuzzle],
    index: batch.length
  };
};

export default function CreateEditorPage() {
  const navigate = useNavigate();
  const batch = useAppStore((state) => state.workspace.batch);
  const puzzle = useAppStore((state) => state.workspace.puzzle);
  const playIndex = useAppStore((state) => state.workspace.playIndex);
  const setPuzzle = useAppStore((state) => state.setPuzzle);
  const setPlayIndex = useAppStore((state) => state.setPlayIndex);
  const setBatchAndPuzzle = useAppStore((state) => state.setBatchAndPuzzle);

  const activePuzzle = puzzle ?? batch[playIndex] ?? batch[0] ?? null;

  useEffect(() => {
    if (!activePuzzle && batch[0]) {
      setPlayIndex(0);
      setPuzzle(batch[0]);
    }
  }, [activePuzzle, batch, setPlayIndex, setPuzzle]);

  const syncPuzzle = (updatedPuzzle: Puzzle) => {
    const next = upsertPuzzle(batch, activePuzzle, playIndex, updatedPuzzle);
    setBatchAndPuzzle(next.batch, updatedPuzzle);
    setPlayIndex(next.index);
    return next.batch;
  };

  const handleSave = (updatedPuzzle: Puzzle) => {
    const nextBatch = syncPuzzle(updatedPuzzle);
    if (nextBatch.length === 1) {
      downloadJsonFile(updatedPuzzle, 'puzzle.json');
    } else {
      const payload: PuzzleSet = {
        title: 'My Puzzle Batch',
        version: 1,
        puzzles: nextBatch
      };
      downloadJsonFile(payload, 'puzzle-batch.json');
    }
    notifySuccess('Puzzle saved and exported as JSON backup.');
  };

  const handlePlay = (updatedPuzzle: Puzzle) => {
    syncPuzzle(updatedPuzzle);
    notifySuccess('Puzzle updated. Launching play mode.');
    navigate('/play');
  };

  const handleReturnToReview = (updatedPuzzle: Puzzle) => {
    syncPuzzle(updatedPuzzle);
    notifySuccess('Puzzle changes synced back into the batch.');
    navigate('/create/review');
  };

  const handleSendToVideo = (updatedPuzzle: Puzzle) => {
    syncPuzzle(updatedPuzzle);
    notifySuccess('Puzzle synced. Opening video setup.');
    navigate('/video/setup');
  };

  if (!activePuzzle) {
    return (
      <div className="rounded-[28px] border-4 border-dashed border-black bg-white p-10 text-center shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#2563EB]">Editor</div>
        <h1 className="mt-3 text-3xl font-black uppercase tracking-tight text-slate-900">Choose a puzzle first</h1>
        <p className="mt-3 text-sm font-semibold text-slate-600">
          The editor needs an active puzzle. Start from upload or pick a draft from the review step.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            to="/create/upload"
            className="inline-flex items-center gap-2 rounded-xl border-2 border-black bg-[#FDE68A] px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-900 hover:bg-[#FCD34D]"
          >
            Upload Puzzle
          </Link>
          <Link
            to="/create/review"
            className="inline-flex items-center gap-2 rounded-xl border-2 border-black bg-white px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-700 hover:bg-slate-100"
          >
            Back To Review
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-[28px] border-4 border-black bg-white p-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#2563EB]">Step 3</div>
        <h1 className="mt-3 text-3xl font-black uppercase tracking-tight text-slate-900">Manual edit and cleanup</h1>
        <p className="mt-3 text-sm font-semibold text-slate-600">
          This is still the best place to correct weak auto-detection, tighten region bounds, and make sure the puzzle feels fair before you publish it.
        </p>
      </section>

      <EditorCanvas
        imageA={activePuzzle.imageA}
        imageB={activePuzzle.imageB}
        onSave={handleSave}
        onPlay={handlePlay}
        onAddToBatch={handleReturnToReview}
        onExportVideo={handleSendToVideo}
        batchCount={batch.length}
      />
    </div>
  );
}
