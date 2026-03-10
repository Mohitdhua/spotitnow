import { useSyncExternalStore } from 'react';
import { mediaDiagnosticsStore } from '../services/mediaDiagnostics';

export const useMediaDiagnostics = () =>
  useSyncExternalStore(mediaDiagnosticsStore.subscribe, mediaDiagnosticsStore.getSnapshot, mediaDiagnosticsStore.getSnapshot);
