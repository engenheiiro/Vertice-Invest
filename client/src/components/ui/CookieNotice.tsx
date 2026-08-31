
import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Cookie } from 'lucide-react';
import {
  CONSENT_CHANGE_EVENT,
  denyAnalyticsConsent,
  grantAnalyticsConsent,
  hasDecidedConsent,
} from '../../utils/analyticsConsent';

// Telas do AuthLayout: card centralizado e alto — um aviso ancorado embaixo cai
// justamente sobre o botão de envio. Nelas o aviso vai para o topo no mobile.
const AUTH_PATHS = ['/login', '/register', '/forgot-password', '/reset-password', '/terms', '/privacy'];

/**
 * Pedido de consentimento, não aviso de ciência.
 *
 * A versão anterior tinha um único botão "Entendi" e afirmava "sem rastreamento
 * de terceiros" — enquanto o Google Analytics carregava no `index.html` antes de
 * o banner sequer aparecer. Agora as duas saídas são explícitas e simétricas:
 * fechar sem escolher não existe, e recusar custa o mesmo clique que aceitar
 * (exigência prática do consentimento livre, Art. 5º, XII da LGPD).
 */
export const CookieNotice: React.FC = () => {
  const { pathname } = useLocation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(!hasDecidedConsent());

    // Revogação pela Política de Privacidade volta ao estado "nunca perguntado".
    const aoMudar = (e: Event) => {
      const escolha = (e as CustomEvent).detail;
      if (escolha === null) setVisible(true);
    };
    window.addEventListener(CONSENT_CHANGE_EVENT, aoMudar);
    return () => window.removeEventListener(CONSENT_CHANGE_EVENT, aoMudar);
  }, []);

  if (!visible) return null;

  const aceitar = () => { grantAnalyticsConsent(); setVisible(false); };
  const recusar = () => { denyAnalyticsConsent(); setVisible(false); };

  const isAuthScreen = AUTH_PATHS.includes(pathname);

  return (
    <div
      role="dialog"
      aria-label="Cookies e medição de uso"
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
          <p className="text-xs font-bold text-slate-200 mb-1">Cookies e medição de uso</p>
          {/* Mobile: texto curto (1 linha extra); desktop mantém a explicação completa. */}
          <p className="text-[11px] text-slate-400 leading-relaxed">
            <span className="xl:hidden">
              Cookies de sessão são essenciais e sempre ativos. O Google Analytics só roda se você permitir.{' '}
            </span>
            <span className="hidden xl:inline">
              Usamos cookies próprios essenciais para autenticação e segurança da sessão — esses não dá para
              desligar. Com a sua permissão, usamos também o Google Analytics para entender como a plataforma
              é usada. Você pode mudar de ideia quando quiser.{' '}
            </span>
            <Link to="/privacy" className="text-blue-400 hover:underline font-medium">
              Política de Privacidade
            </Link>
          </p>
        </div>
      </div>
      {/* Mesmo tamanho para as duas saídas: recusar não pode ser mais difícil. */}
      <div className="mt-2 xl:mt-3 grid grid-cols-2 gap-2">
        <button
          onClick={recusar}
          className="py-2.5 bg-panel border border-slate-700/60 hover:border-slate-500 text-slate-300 text-xs font-bold rounded-lg transition-colors"
        >
          Recusar
        </button>
        <button
          onClick={aceitar}
          className="py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-colors"
        >
          Aceitar
        </button>
      </div>
    </div>
  );
};
