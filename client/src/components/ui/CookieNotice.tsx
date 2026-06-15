
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Cookie, X } from 'lucide-react';

const STORAGE_KEY = 'vertice_cookie_notice_dismissed';

export const CookieNotice: React.FC = () => {
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

  return (
    <div
      role="dialog"
      aria-label="Aviso sobre cookies"
      className="fixed bottom-4 left-4 right-4 md:left-auto md:right-6 md:max-w-sm z-[200] bg-card border border-slate-700/60 rounded-xl shadow-2xl shadow-black/60 p-4 animate-fade-in"
    >
      <div className="flex items-start gap-3">
        <Cookie size={18} className="text-blue-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-slate-200 mb-1">Cookies Essenciais</p>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Usamos apenas cookies próprios e necessários para autenticação e segurança da sessão. Sem rastreamento de terceiros.{' '}
            <Link to="/privacy" className="text-blue-400 hover:underline font-medium">
              Política de Privacidade
            </Link>
          </p>
        </div>
        <button
          onClick={dismiss}
          aria-label="Fechar aviso de cookies"
          className="shrink-0 text-slate-500 hover:text-slate-300 transition-colors -mt-0.5"
        >
          <X size={16} />
        </button>
      </div>
      <button
        onClick={dismiss}
        className="mt-3 w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-colors"
      >
        Entendi
      </button>
    </div>
  );
};
