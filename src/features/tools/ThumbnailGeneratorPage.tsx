import { useNavigate } from 'react-router-dom';
import { ThumbnailGeneratorMode } from '../../components/ThumbnailGeneratorMode';
import { useAppStore } from '../../store/appStore';

export default function ThumbnailGeneratorPage() {
  const navigate = useNavigate();
  const batch = useAppStore((state) => state.workspace.batch);
  const puzzle = useAppStore((state) => state.workspace.puzzle);
  const playIndex = useAppStore((state) => state.workspace.playIndex);

  const currentPuzzle = puzzle ?? batch[playIndex] ?? batch[0] ?? null;

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }

    navigate(batch.length > 0 ? '/create/review' : '/');
  };

  return <ThumbnailGeneratorMode currentPuzzle={currentPuzzle} batch={batch} onBack={handleBack} />;
}
