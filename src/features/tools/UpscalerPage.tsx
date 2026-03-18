import { useNavigate } from 'react-router-dom';
import { ImageUpscalerMode } from '../../components/ImageUpscalerMode';

export default function UpscalerPage() {
  const navigate = useNavigate();

  return <ImageUpscalerMode onBack={() => navigate('/')} />;
}
