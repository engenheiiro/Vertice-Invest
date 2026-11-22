import { useCallback } from 'react';
import { useDemo } from '../contexts/DemoContext';
import { useToast } from '../contexts/ToastContext';

export const DEMO_BLOCKED_MESSAGE = 'Modo demonstração: nada foi alterado.';

/**
 * Trava de escrita do modo demo. Devolve uma função que, no demo, avisa (toast
 * informativo) e responde `true` — quem chama sai antes da mutação. Durante o
 * tour a tela mostra dados fictícios, mas o token é o da conta REAL: sem esta
 * trava, um clique em "excluir meta" apagaria a meta de verdade do usuário.
 *
 * Uso: `if (blockInDemo()) return;` no início do handler, antes do `mutate`.
 */
export const useDemoGuard = () => {
    const { isDemoMode } = useDemo();
    const { addToast } = useToast();
    return useCallback((message: string = DEMO_BLOCKED_MESSAGE): boolean => {
        if (!isDemoMode) return false;
        addToast(message, 'info');
        return true;
    }, [isDemoMode, addToast]);
};
