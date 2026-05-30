import React, { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useToast } from '../../contexts/ToastContext';

/**
 * Detecta nova versão do PWA (novo service worker) e oferece atualização.
 * Garante que nenhum dispositivo — incluindo desktop — fique preso em build antigo.
 */
export const ReloadPrompt: React.FC = () => {
  const { addToast } = useToast();
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  useEffect(() => {
    if (needRefresh) {
      addToast('Nova versão disponível. Atualizando…', 'info');
      // Aplica o novo SW e recarrega para servir o build mais recente.
      const t = setTimeout(() => updateServiceWorker(true), 1200);
      return () => clearTimeout(t);
    }
  }, [needRefresh, addToast, updateServiceWorker]);

  return null;
};
