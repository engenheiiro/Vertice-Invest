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
    navigate: vi.fn(),
    user: { plan: 'GUEST' } as { plan: string } | null,
    isAuthenticated: true,
}));

vi.mock('../services/subscription', () => ({
    subscriptionService: { initCheckout: mocks.initCheckout },
}));
vi.mock('../contexts/AuthContext', async () => ({
    useAuth: () => ({ user: mocks.user, isAuthenticated: mocks.isAuthenticated }),
    UserPlan: {},
}));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: mocks.addToast }) }));
vi.mock('../components/dashboard/Header', () => ({ Header: () => <div data-testid="header-app" /> }));
vi.mock('react-router-dom', () => ({
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
    useNavigate: () => mocks.navigate,
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
    mocks.isAuthenticated = true;
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

describe('Vitrine pública — visitante sem conta', () => {
    // A página vivia atrás do login: para descobrir o preço era preciso criar
    // conta às cegas, e a página ficava invisível para busca.
    beforeEach(() => {
        mocks.isAuthenticated = false;
        mocks.user = null;
    });

    it('mostra os preços sem exigir login', () => {
        render(<Pricing />);

        expect(within(cardDo('Pro')).getByText('69,90')).toBeInTheDocument();
        expect(within(cardDo('Elite')).getByText('129,90')).toBeInTheDocument();
    });

    it('troca o cabeçalho do app por uma barra própria', () => {
        // O Header do app depende do WalletProvider, que não existe fora da
        // área logada — renderizá-lo aqui derrubaria a página inteira.
        render(<Pricing />);

        expect(screen.queryByTestId('header-app')).not.toBeInTheDocument();
        expect(screen.getByRole('navigation', { name: /navegação principal/i })).toBeInTheDocument();
    });

    it('não anuncia "Plano Atual" para quem ainda não tem plano', () => {
        render(<Pricing />);

        expect(screen.queryByText(/plano atual/i)).not.toBeInTheDocument();
    });

    it('manda para o cadastro em vez de tentar o checkout', async () => {
        // Sem conta não há plano para creditar, e a rota de checkout exige
        // autenticação: ir ao Mercado Pago só produziria um 401.
        render(<Pricing />);
        await userEvent.click(within(cardDo('Pro')).getByRole('button', { name: /criar conta para assinar/i }));

        expect(mocks.navigate).toHaveBeenCalledWith('/register');
        expect(mocks.initCheckout).not.toHaveBeenCalled();
    });

    it('transforma o card Free em porta de entrada', async () => {
        render(<Pricing />);
        await userEvent.click(within(cardDo('Free')).getByRole('button', { name: /criar conta grátis/i }));

        expect(mocks.navigate).toHaveBeenCalledWith('/register');
    });

    it('mantém o alternador de ciclo funcionando para o visitante', async () => {
        render(<Pricing />);
        await trocarPara('Anual');

        expect(within(cardDo('Pro')).getByText(/598,80/)).toBeInTheDocument();
    });
});

describe('Usuário logado — a casca de sempre', () => {
    it('mantém o cabeçalho do app e o Plano Atual', () => {
        render(<Pricing />);

        expect(screen.getByTestId('header-app')).toBeInTheDocument();
        expect(screen.getAllByText(/plano atual/i).length).toBeGreaterThan(0);
    });
});
