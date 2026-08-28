import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

type Theme = 'dark' | 'light';

interface ThemeContextValue {
  /** Tema EFETIVO (o que está pintado na tela agora). Fora da área logada é sempre 'dark'. */
  theme: Theme;
  /** Preferência salva do usuário — o que o toggle mostra, mesmo em página externa. */
  preference: Theme;
  toggleTheme: () => void;
}

interface InternalContextValue extends ThemeContextValue {
  openScope: () => void;
  closeScope: () => void;
}

const ThemeContext = createContext<InternalContextValue>({
  theme: 'dark',
  preference: 'dark',
  toggleTheme: () => {},
  openScope: () => {},
  closeScope: () => {},
});

// Chave v2: a v1 auto-salvava 'light' mesmo sem escolha do usuário, então todo mundo
// tinha uma preferência "fantasma" clara. A v2 zera isso — padrão ESCURO para todos;
// só quem trocar de propósito salva 'light'. Mantida em sincronia com o anti-FOUC do index.html.
const THEME_KEY = 'vertice-theme-v2';

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [preference, setPreference] = useState<Theme>(() => {
    // Padrão = escuro. Só fica claro se o usuário escolheu 'light' explicitamente antes.
    try {
      return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });

  // Quantos <ThemeScope> estão montados. O tema claro é uma preferência DE CONTA:
  // só vale dentro da área logada. Landing, login, cadastro, termos e carteira
  // pública são vitrine da marca e ficam sempre escuras — senão o logout deixava
  // o site institucional claro (e sem estilo pensado para isso).
  // É contador, não booleano, porque o StrictMode monta/desmonta efeitos em par
  // e rotas aninhadas podem sobrepor escopos por um commit.
  const [scopeCount, setScopeCount] = useState(0);
  const theme: Theme = scopeCount > 0 ? preference : 'dark';

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light') {
      root.setAttribute('data-theme', 'light');
    } else {
      root.removeAttribute('data-theme');
    }
  }, [theme]);

  // Persistimos a PREFERÊNCIA, nunca o tema efetivo: gravar o efetivo apagaria a
  // escolha do usuário toda vez que ele passasse por uma página externa.
  useEffect(() => {
    try {
      localStorage.setItem(THEME_KEY, preference);
    } catch {
      /* modo privado / storage cheio: segue com o tema em memória */
    }
  }, [preference]);

  const toggleTheme = useCallback(() => setPreference(t => (t === 'dark' ? 'light' : 'dark')), []);
  const openScope = useCallback(() => setScopeCount(c => c + 1), []);
  const closeScope = useCallback(() => setScopeCount(c => Math.max(0, c - 1)), []);

  const value = useMemo(
    () => ({ theme, preference, toggleTheme, openScope, closeScope }),
    [theme, preference, toggleTheme, openScope, closeScope]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

/**
 * Liga o tema claro enquanto estiver montado. Vai dentro da área autenticada
 * (ver ProtectedRoute); ao desmontar — logout, redirect para /login, volta pra
 * landing — o documento retorna ao escuro sozinho.
 */
export const ThemeScope: React.FC = () => {
  const { openScope, closeScope } = useContext(ThemeContext);

  useEffect(() => {
    openScope();
    return closeScope;
  }, [openScope, closeScope]);

  return null;
};

export const useTheme = (): ThemeContextValue => {
  const { theme, preference, toggleTheme } = useContext(ThemeContext);
  return { theme, preference, toggleTheme };
};
