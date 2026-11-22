import type { KeyboardEvent, MouseEvent } from 'react';

/**
 * Teclado para elemento clicável que não pode virar `<button>` (linha de
 * tabela, card com botões dentro): Enter e Espaço disparam a mesma ação do
 * clique. Só reage quando o foco está NO próprio elemento — Enter num botão
 * de dentro já dispara o clique dele, e borbulhar até aqui abriria as duas
 * coisas. O Espaço tem o `preventDefault` para não rolar a página.
 */
export function onActivateKey(action: () => void) {
    return (e: KeyboardEvent<HTMLElement>) => {
        if (e.target !== e.currentTarget) return;
        if (e.key !== 'Enter' && e.key !== ' ') return;
        if (e.key === ' ') e.preventDefault();
        action();
    };
}

/**
 * Fecha ao clicar no fundo do modal, e só nele: clique que nasceu dentro do
 * painel borbulha até o fundo com outro `target` e é ignorado. Substitui o
 * `stopPropagation` no painel, que obrigava um `onClick` no `role="dialog"`.
 */
export function onBackdropClick(close: () => void) {
    return (e: MouseEvent<HTMLElement>) => {
        if (e.target === e.currentTarget) close();
    };
}
