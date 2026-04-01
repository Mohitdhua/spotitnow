import { Suspense, lazy, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { RouteWorkspaceLoading } from '../../app/components/RouteWorkspaceLoading';
import { useAppStore } from '../../store/appStore';

const GameCanvas = lazy(async () => {
  const module = await import('../../components/GameCanvas');
  return { default: module.GameCanvas };
});

export default function PlayPage() {
  const navigate = useNavigate();
  const batch = useAppStore((state) => state.workspace.batch);
  const puzzle = useAppStore((state) => state.workspace.puzzle);
  const playIndex = useAppStore((state) => state.workspace.playIndex);
  const setPuzzle = useAppStore((state) => state.setPuzzle);
  const setPlayIndex = useAppStore((state) => state.setPlayIndex);

  const activePuzzle = puzzle ?? batch[playIndex] ?? batch[0] ?? null;

  useEffect(() => {
    if (!activePuzzle && batch[0]) {
      setPlayIndex(0);
      setPuzzle(batch[0]);
    }
  }, [activePuzzle, batch, setPlayIndex, setPuzzle]);

  const handleNextLevel = () => {
    if (playIndex < batch.length - 1) {
      const nextIndex = playIndex + 1;
      setPlayIndex(nextIndex);
      setPuzzle(batch[nextIndex] ?? null);
      return;
    }
    navigate('/create/review');
  };

  if (!activePuzzle) {
    return (
      <div className="rounded-[28px] border-4 border-dashed border-black bg-white p-10 text-center shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#2563EB]">Play</div>
        <h1 className="mt-3 text-3xl font-black uppercase tracking-tight text-slate-900">No puzzle ready to play</h1>
        <p className="mt-3 text-sm font-semibold text-slate-600">
          Review a draft first, then launch play mode from there.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            to="/create/review"
            className="inline-flex items-center gap-2 rounded-xl border-2 border-black bg-[#FDE68A] px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-900 hover:bg-[#FCD34D]"
          >
            Open Review
          </Link>
          <Link
            to="/create/upload"
            className="inline-flex items-center gap-2 rounded-xl border-2 border-black bg-white px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-700 hover:bg-slate-100"
          >
            Upload First
          </Link>
        </div>
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <RouteWorkspaceLoading
          eyebrow="Play"
          title="Loading play mode"
          description="Setting up the puzzle canvas and controls for the current batch."
          fullHeight
        />
      }
    >
      <GameCanvas
        key={`${activePuzzle.title ?? 'puzzle'}-${playIndex}`}
        puzzle={activePuzzle}
        onExit={() => navigate('/create/review')}
        onNextLevel={handleNextLevel}
        hasNextLevel={playIndex < batch.length - 1}
      />
    </Suspense>
  );
}
