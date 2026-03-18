import { useNavigate } from 'react-router-dom';
import { WatermarkRemovalMode } from '../../components/WatermarkRemovalMode';

export default function WatermarkPage() {
  const navigate = useNavigate();

  return <WatermarkRemovalMode onBack={() => navigate('/')} />;
}
