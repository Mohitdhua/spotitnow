import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { AppRoot } from './app/AppRoot.tsx';
import { initializePwa } from './services/pwa.ts';
import './index.css';

initializePwa();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppRoot />
  </StrictMode>,
);
