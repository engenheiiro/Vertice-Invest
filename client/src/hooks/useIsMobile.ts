import { useEffect, useState } from 'react';

/**
 * Hook reativo que indica se a viewport está abaixo do breakpoint `md` do
 * Tailwind (768px) — ou seja, no layout mobile onde o menu do topo dá lugar
 * à barra de navegação inferior (`BottomNav`).
 *
 * Usa `matchMedia` com listener de mudança para reagir a resize/rotação.
 */
const MOBILE_QUERY = '(max-width: 767px)';

export const useIsMobile = (): boolean => {
    const [isMobile, setIsMobile] = useState<boolean>(() => {
        if (typeof window === 'undefined' || !window.matchMedia) return false;
        return window.matchMedia(MOBILE_QUERY).matches;
    });

    useEffect(() => {
        if (typeof window === 'undefined' || !window.matchMedia) return;
        const mql = window.matchMedia(MOBILE_QUERY);
        const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);

        // Sincroniza no mount (caso a query tenha mudado entre render e efeito).
        setIsMobile(mql.matches);

        // addEventListener é o padrão moderno; addListener é fallback (Safari antigo).
        if (mql.addEventListener) {
            mql.addEventListener('change', handler);
            return () => mql.removeEventListener('change', handler);
        }
        mql.addListener(handler);
        return () => mql.removeListener(handler);
    }, []);

    return isMobile;
};
