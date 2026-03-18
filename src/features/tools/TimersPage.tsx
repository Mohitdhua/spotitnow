import { useNavigate } from 'react-router-dom';
import { TimerMode } from '../../components/TimerMode';
import { useAppStore } from '../../store/appStore';

export default function TimersPage() {
  const navigate = useNavigate();
  const videoSettings = useAppStore((state) => state.video.videoSettings);
  const setVideoSettings = useAppStore((state) => state.setVideoSettings);

  return (
    <TimerMode
      settings={{
        visualStyle: videoSettings.visualStyle,
        videoPackagePreset: videoSettings.videoPackagePreset,
        timerStyle: videoSettings.timerStyle
      }}
      onSettingsChange={(patch) =>
        setVideoSettings((current) => ({
          ...current,
          ...patch
        }))
      }
      onBack={() => navigate('/')}
    />
  );
}
