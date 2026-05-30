import React, { useEffect, useState } from 'react';
import { Download, X, Share, Plus } from 'lucide-react';

const DISMISS_KEY = 'vertice_pwa_install_dismissed';

// Evento beforeinstallprompt (não tipado no lib.dom padrão)
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  // iOS Safari
  (window.navigator as any).standalone === true;

const isIOS = () =>
  /iphone|ipad|ipod/i.test(window.navigator.userAgent) &&
  !(window.navigator as any).standalone;

/**
 * Banner de instalação do PWA. Aparece apenas no mobile (md:hidden) e nunca no desktop.
 * - Android/Chrome: usa o evento `beforeinstallprompt`.
 * - iOS/Safari: mostra instrução manual (Compartilhar → Adicionar à Tela de Início).
 */
export const InstallPrompt: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isStandalone()) return; // Já instalado: não mostrar
    if (localStorage.getItem(DISMISS_KEY) === '1') return;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener('beforeinstallprompt', handler);

    // iOS não dispara o evento — mostrar dica manual
    if (isIOS()) {
      setShowIosHint(true);
      setVisible(true);
    }

    const installedHandler = () => {
      setVisible(false);
      localStorage.setItem(DISMISS_KEY, '1');
    };
    window.addEventListener('appinstalled', installedHandler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', installedHandler);
    };
  }, []);

  const dismiss = () => {
    setVisible(false);
    localStorage.setItem(DISMISS_KEY, '1');
  };

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setVisible(false);
    localStorage.setItem(DISMISS_KEY, '1');
  };

  if (!visible) return null;

  return (
    <div className="md:hidden fixed bottom-0 inset-x-0 z-[90] p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
      <div className="bg-[#0B101A] border border-blue-500/30 rounded-2xl shadow-2xl p-4 flex items-start gap-3">
        <div className="w-10 h-10 shrink-0 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center">
          <Download size={20} className="text-blue-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white">Instalar o Vértice</p>
          {showIosHint ? (
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Toque em <Share size={12} className="inline -mt-0.5 text-blue-400" /> e depois em
              <span className="inline-flex items-center gap-1 text-slate-300">
                {' '}
                <Plus size={12} className="inline -mt-0.5" /> "Adicionar à Tela de Início"
              </span>
              .
            </p>
          ) : (
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Tenha acesso rápido em tela cheia, direto da sua tela inicial.
            </p>
          )}

          {!showIosHint && (
            <button
              onClick={handleInstall}
              className="mt-3 w-full bg-emerald-500 hover:bg-emerald-400 text-black text-sm font-bold py-2.5 rounded-xl transition-colors"
            >
              Instalar app
            </button>
          )}
        </div>
        <button
          onClick={dismiss}
          aria-label="Dispensar"
          className="p-1 text-slate-500 hover:text-white transition-colors shrink-0"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
};
