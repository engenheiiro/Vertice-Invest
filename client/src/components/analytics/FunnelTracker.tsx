import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { captureAcquisition, trackPageView } from '../../utils/analytics';

/**
 * Topo do funil, do lado do navegador.
 *
 * Duas tarefas, ambas invisíveis:
 *  - **Origem do primeiro toque**, guardada na sessão para virar atributo da
 *    conta no cadastro. É o que responde "de qual canal veio quem assinou" —
 *    pergunta que o Google Analytics não responde, porque ele só enxerga quem
 *    aceitou o cookie de medição.
 *  - **Página vista a cada rota.** O `config` do gtag dispara uma vez, no
 *    carregamento; numa SPA a navegação seguinte passaria despercebida e todo
 *    visitante pareceria ter visto exatamente uma página.
 *
 * Não renderiza nada e não pede permissão para existir: o envio ao Google é que
 * é condicionado ao consentimento, dentro de `trackEvent`.
 */
export const FunnelTracker = () => {
    const { pathname } = useLocation();

    // Uma vez por sessão: o primeiro toque é que conta. Rodar a cada rota daria
    // o crédito ao último clique interno e todo cadastro viria de '/pricing'.
    useEffect(() => { captureAcquisition(); }, []);

    useEffect(() => { trackPageView(pathname); }, [pathname]);

    return null;
};
