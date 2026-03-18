import { useNavigate } from 'react-router-dom';
import { BackgroundGeneratorMode } from '../../components/BackgroundGeneratorMode';
import { useAppStore } from '../../store/appStore';

export default function BackgroundsPage() {
  const navigate = useNavigate();
  const backgroundPacksSessionId = useAppStore((state) => state.video.backgroundPacksSessionId);
  const bumpBackgroundPacksSession = useAppStore((state) => state.bumpBackgroundPacksSession);

  return (
    <BackgroundGeneratorMode
      onBack={() => navigate('/')}
      storageRefreshKey={backgroundPacksSessionId}
      onLibraryChange={bumpBackgroundPacksSession}
    />
  );
}
