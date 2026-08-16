
import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Cookie, X } from 'lucide-react';

const STORAGE_KEY = 'vertice_cookie_notice_dismissed';

// Telas do AuthLayout: card centralizado e alto — um aviso ancorado embaixo cai
// justamente sobre o botão de envio. Nelas o aviso vai para o topo no mobile.
const AUTH_PATHS = ['/login', '/register', '/forgot-password', '/reset-password', '/terms', '/privacy'];

export const CookieNotice: React.FC = () => {
  const { pathname } = useLocation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      setVisible(true);
    }
  }, []);

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, '1');
    setVisible(false);
  };

  if (!visible) return null;

  const isAuthScreen = AUTH_PATHS.includes(pathname);

  return (
    <div
      role="dialog"
      aria-label="Aviso sobre cookies"
      // Sai de cena enquanto o tutorial de primeiro acesso está no ar (regra em
      // index.css). O CookieNotice vive fora do DemoProvider — daí o CSS global.
      data-tour-hide=""
      // No mobile o aviso sobe acima da BottomNav (h-16 + safe area) e vira uma
      // faixa compacta: ancorado em bottom-4 ele cobria a navegação e, no /login,
      // o próprio botão "Entrar" — o usuário só conseguia agir depois de fechar.
      className={`fixed left-3 right-3 xl:bottom-6 xl:top-auto xl:left-auto xl:right-6 xl:max-w-sm z-[200] bg-card border border-slate-700/60 rounded-xl shadow-2xl shadow-black/60 p-3 xl:p-4 animate-fade-in ${
        isAuthScreen
          ? 'top-[calc(0.75rem+env(safe-area-inset-top))] bottom-auto'
          : 'bottom-[calc(4.5rem+env(safe-area-inset-bottom))]'
      }`}
    >
      <div className="flex items-start gap-3">
        <Cookie size={18} className="text-blue-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-slate-200 mb-1">Cookies Essenciais</p>
          {/* Mobile: texto curto (1 linha extra); desktop mantém a explicação completa. */}
          <p className="text-[11px] text-slate-400 leading-relaxed">
            <span className="xl:hidden">Só cookies próprios de sessão. Sem rastreamento. </span>
            <span className="hidden xl:inline">
              Usamos apenas cookies próprios e necessários para autenticação e segurança da sessão. Sem rastreamento de terceiros.{' '}
            </span>
            <Link to="/privacy" className="text-blue-400 hover:underline font-medium">
              Política de Privacidade
            </Link>
          </p>
        </div>
        <button
          onClick={dismiss}
          aria-label="Fechar aviso de cookies"
          className="shrink-0 min-h-[44px] min-w-[44px] -m-2 flex items-center justify-center text-slate-500 hover:text-slate-300 transition-colors"
        >
          <X size={16} />
        </button>
      </div>
      <button
        onClick={dismiss}
        className="mt-2 xl:mt-3 w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-colors"
      >
        Entendi
      </button>
    </div>
  );
};
