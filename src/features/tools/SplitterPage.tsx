import { useNavigate } from 'react-router-dom';
import { ImageSplitterPanel } from '../../components/ImageSplitterPanel';
import { notifySuccess } from '../../services/notifications';
import { useAppStore } from '../../store/appStore';

export default function SplitterPage() {
  const navigate = useNavigate();
  const appDefaults = useAppStore((state) => state.video.appDefaults);
  const queueInjectedUpload = useAppStore((state) => state.queueInjectedUpload);

  return (
    <ImageSplitterPanel
      onBatchProcess={(files) => {
        queueInjectedUpload(files);
        notifySuccess('Split files queued for the upload workflow.');
        navigate('/create/upload');
      }}
      defaultMode={appDefaults.splitterDefaults.defaultMode}
      namingDefaults={appDefaults.splitterDefaults}
    />
  );
}
