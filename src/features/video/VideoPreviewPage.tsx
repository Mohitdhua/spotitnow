import { Link, useNavigate } from 'react-router-dom';
import { VideoPlayer } from '../../components/VideoPlayer';
import { notifyError, notifySuccess } from '../../services/notifications';
import { createVideoTransferFrames } from '../../services/videoTransferFrames';
import { useAppStore } from '../../store/appStore';

export default function VideoPreviewPage() {
  const navigate = useNavigate();
  const batch = useAppStore((state) => state.workspace.batch);
  const videoSettings = useAppStore((state) => state.video.videoSettings);
  const backgroundPacksSessionId = useAppStore((state) => state.video.backgroundPacksSessionId);
  const setIncomingVideoFrames = useAppStore((state) => state.setIncomingVideoFrames);

  const handleSendToEditor = async () => {
    if (!batch.length) {
      notifyError('Add at least one puzzle first.');
      return;
    }
    const frames = await createVideoTransferFrames(batch, {
      aspectRatio: videoSettings.aspectRatio,
      showDuration: videoSettings.showDuration,
      revealDuration: videoSettings.revealDuration,
      transitionDuration: videoSettings.transitionDuration
    });
    setIncomingVideoFrames(frames);
    notifySuccess('Preview frames prepared for the editor studio.');
    navigate('/editor');
  };

  if (!batch.length) {
    return (
      <div className="rounded-[28px] border-4 border-dashed border-black bg-white p-10 text-center shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#2563EB]">Video Preview</div>
        <h1 className="mt-3 text-3xl font-black uppercase tracking-tight text-slate-900">No batch to preview</h1>
        <p className="mt-3 text-sm font-semibold text-slate-600">
          Build a batch in the create workflow first, then preview the package here.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            to="/create/review"
            className="inline-flex items-center gap-2 rounded-xl border-2 border-black bg-[#FDE68A] px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-900 hover:bg-[#FCD34D]"
          >
            Go To Review
          </Link>
          <Link
            to="/video/setup"
            className="inline-flex items-center gap-2 rounded-xl border-2 border-black bg-white px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-700 hover:bg-slate-100"
          >
            Video Setup
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[28px] border-4 border-black bg-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
      <VideoPlayer
        puzzles={batch}
        settings={videoSettings}
        backgroundPacksSessionId={backgroundPacksSessionId}
        onExit={() => navigate('/video/setup')}
        onSendToEditor={() => void handleSendToEditor()}
      />
    </div>
  );
}
