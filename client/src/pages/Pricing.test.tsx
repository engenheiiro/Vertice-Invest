import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Vitrine de planos com os dois ciclos (Onda 4).
 *
 * O que estes testes protegem é a promessa impressa no card. Um anual que
 * anuncia a parcela e esconde o total, ou um botão que manda a chave mensal
 * depois do usuário escolher "Anual", cobra do cliente algo diferente do que
 * ele leu — e isso não aparece em erro de tipo nenhum.
 */

const mocks = vi.hoisted(() => ({
    initCheckout: vi.fn(),
    addToast: vi.fn(),
    user: { plan: 'GUEST' } as { plan: string } | null,
}));

vi.mock('../services/subscription', () => ({
    subscriptionService: { initCheckout: mocks.initCheckout },
}));
vi.mock('../contexts/AuthContext', async () => ({
    useAuth: () => ({ user: mocks.user }),
    UserPlan: {},
}));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: mocks.addToast }) }));
vi.mock('../components/dashboard/Header', () => ({ Header: () => null }));
vi.mock('react-router-dom', () => ({
    Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

import { Pricing } from './Pricing';

/** O card do plano, isolado do carrossel mobile (que renderiza os mesmos textos). */
const cardDo = (plano: string) => {
    const titulo = screen.getAllByRole('heading', { name: plano, level: 3 })[0];
    return titulo.closest('div.bg-base, div.bg-card') as HTMLElement;
};

const trocarPara = async (ciclo: 'Mensal' | 'Anual') => {
    await userEvent.click(screen.getByRole('radio', { name: new RegExp(ciclo, 'i') }));
};

beforeEach(() => {
    vi.clearAllMocks();
    mocks.user = { plan: 'GUEST' };
    mocks.initCheckout.mockResolvedValue({ redirectUrl: 'https://mp/checkout' });
    // O jsdom não navega: sem este stub o redirect vira ruído de "Not implemented"
    // e some a chance de conferir PARA ONDE o usuário foi mandado.
    Object.defineProperty(window, 'location', { configurable: true, writable: true, value: { href: '' } });
});

describe('Ciclo mensal (padrão)', () => {
    it('abre na mensalidade, sem o usuário escolher nada', () => {
        render(<Pricing />);

        expect(screen.getByRole('radio', { name: /mensal/i })).toHaveAttribute('aria-checked', 'true');
        expect(within(cardDo('Pro')).getByText('69,90')).toBeInTheDocument();
    });

    it('avisa que o cartão renova sozinho', () => {
        render(<Pricing />);

        expect(screen.getByText(/renova automaticamente todo mês/i)).toBeInTheDocument();
    });
});

describe('Ciclo anual', () => {
    it('mostra a parcela como número grande E o total cobrado no ano', async () => {
        render(<Pricing />);
        await trocarPara('Anual');

        const pro = within(cardDo('Pro'));
        expect(pro.getByText('49,90')).toBeInTheDocument();
        // O total precisa estar visível: anunciar só "R$ 49,90/mês" num produto
        // que debita R$ 598,80 é a definição de preço enganoso.
        expect(pro.getByText(/598,80/)).toBeInTheDocument();
        expect(pro.getByText(/12× de R\$ 49,90/)).toBeInTheDocument();
    });

    it('declara que não há renovação automática', async () => {
        render(<Pricing />);
        await trocarPara('Anual');

        expect(screen.getByText(/não renova automaticamente/i)).toBeInTheDocument();
        expect(screen.queryByText(/renova automaticamente todo mês/i)).not.toBeInTheDocument();
    });

    it('anuncia a economia de cada plano, não um número único para todos', async () => {
        render(<Pricing />);
        await trocarPara('Anual');

        // ESSENTIAL economiza mais que ELITE — um selo só seria falso para dois.
        expect(within(cardDo('Essential')).getByText(/Economize 33%/)).toBeInTheDocument();
        expect(within(cardDo('Elite')).getByText(/Economize 23%/)).toBeInTheDocument();
    });

    it('deixa o Free intacto: não há anual para quem não paga', async () => {
        render(<Pricing />);
        await trocarPara('Anual');

        const free = within(cardDo('Free'));
        expect(free.getByText('0,00')).toBeInTheDocument();
        expect(free.queryByText(/Economize/)).not.toBeInTheDocument();
    });
});

describe('Checkout do ciclo escolhido', () => {
    it('envia a chave anual, e vai direto ao Mercado Pago sem o modal de método', async () => {
        // No anual não há decisão a tomar: é cobrança única, e o próprio checkout
        // do MP oferece cartão parcelado ou Pix na mesma tela.
        render(<Pricing />);
        await trocarPara('Anual');
        await userEvent.click(within(cardDo('Pro')).getByRole('button', { name: /assinar/i }));

        await waitFor(() => expect(mocks.initCheckout).toHaveBeenCalledWith('PRO_ANNUAL', 'ONE_TIME'));
        await waitFor(() => expect(window.location.href).toBe('https://mp/checkout'));
        expect(screen.queryByText(/como você quer pagar/i)).not.toBeInTheDocument();
    });

    it('no mensal ainda pergunta o método antes de redirecionar', async () => {
        // Cartão e Pix levam a APIs diferentes do MP, com consequências
        // diferentes de renovação — a escolha precisa vir antes.
        render(<Pricing />);
        await userEvent.click(within(cardDo('Pro')).getByRole('button', { name: /assinar/i }));

        expect(mocks.initCheckout).not.toHaveBeenCalled();
        expect(screen.getByText(/como você quer pagar/i)).toBeInTheDocument();
    });

    it('manda a chave mensal quando o método é confirmado no mensal', async () => {
        render(<Pricing />);
        await userEvent.click(within(cardDo('Pro')).getByRole('button', { name: /assinar/i }));
        await userEvent.click(screen.getByRole('button', { name: /continuar para o pagamento/i }));

        await waitFor(() => expect(mocks.initCheckout).toHaveBeenCalledWith('PRO', 'RECURRING'));
    });
});
