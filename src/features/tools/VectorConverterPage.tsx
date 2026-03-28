import { useNavigate } from 'react-router-dom';
import { VectorImageConverterMode } from '../../components/VectorImageConverterMode';

export default function VectorConverterPage() {
  const navigate = useNavigate();

  return <VectorImageConverterMode onBack={() => navigate('/')} />;
}
