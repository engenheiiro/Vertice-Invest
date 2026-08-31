import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { Register } from './Register';
import { saveCheckoutIntent } from '../utils/checkoutIntent';

/**
 * Cadastro — o meio do caminho de quem veio comprar.
 *
 * Este formulário é o ponto mais caro do funil: o visitante já decidiu o plano
 * e é interrompido por um cadastro. O que se protege aqui é (a) que ele veja
 * POR QUE está preenchendo, e (b) que a escolha continue viva depois — quem
 * consome a intenção é a vitrine, depois do login, então o cadastro não pode
 * apagá-la.
 */

const mocks = vi.hoisted(() => ({
    register: vi.fn(),
    navigate: vi.fn(),
    trackEvent: vi.fn(),
    readAcquisition: vi.fn(() => null),
    clearAcquisition: vi.fn(),
}));

vi.mock('../services/auth', () => ({ authService: { register: mocks.register } }));
vi.mock('react-router-dom', () => ({
    useNavigate: () => mocks.navigate,
    Link: ({ children, to }: any) => <a href={to}>{children}</a>,
}));
vi.mock('../components/seo/PageMeta', () => ({ PageMeta: () => null }));
vi.mock('../utils/analytics', () => ({
    trackEvent: mocks.trackEvent,
    readAcquisition: mocks.readAcquisition,
    clearAcquisition: mocks.clearAcquisition,
}));

const preencher = () => {
    fireEvent.change(screen.getByLabelText(/Nome Completo/i), { target: { name: 'name', value: 'João Silva' } });
    fireEvent.change(screen.getByLabelText(/Email/i), { target: { name: 'email', value: 'joao@email.com' } });
    fireEvent.change(screen.getByLabelText(/^Senha$/i), { target: { name: 'password', value: 'Senha123' } });
    fireEvent.change(screen.getByLabelText(/Confirmar/i), { target: { name: 'confirmPassword', value: 'Senha123' } });
    const caixas = screen.getAllByRole('checkbox');
    fireEvent.click(caixas[0]); // termos
    fireEvent.click(caixas[1]); // privacidade
};

const enviar = () => fireEvent.submit(document.querySelector('form')!);

beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mocks.register.mockResolvedValue({ message: 'ok' });
});

describe('Sem intenção de compra', () => {
    it('não inventa um plano que o usuário não escolheu', () => {
        render(<Register />);

        expect(screen.queryByText(/Criando sua conta para assinar/i)).not.toBeInTheDocument();
    });
});

describe('Com plano escolhido antes do cadastro', () => {
    beforeEach(() => saveCheckoutIntent({ plan: 'PRO', cycle: 'ANNUAL' }));

    it('lembra o usuário do que ele veio fazer', () => {
        // Um formulário que não diz por que está sendo preenchido é um
        // formulário mais fácil de abandonar.
        render(<Register />);

        expect(screen.getByText(/Criando sua conta para assinar/i)).toBeInTheDocument();
        expect(screen.getByText('Pro')).toBeInTheDocument();
    });

    it('deixa claro que o pagamento vem depois', () => {
        render(<Register />);

        expect(screen.getByText(/confirma o pagamento no passo seguinte/i)).toBeInTheDocument();
    });

    it('não consome a intenção — quem a usa é a vitrine, depois do login', async () => {
        render(<Register />);
        preencher();
        enviar();

        await waitFor(() => expect(mocks.register).toHaveBeenCalled());
        expect(sessionStorage.getItem('vertice_checkout_intent')).not.toBeNull();
    });

    it('registra no evento de cadastro qual compra o originou', async () => {
        // Sem isso não dá para medir quantos cadastros nascem de intenção de
        // compra — que é a razão de este caminho existir.
        render(<Register />);
        preencher();
        enviar();

        await waitFor(() => expect(mocks.trackEvent).toHaveBeenCalledWith('sign_up', expect.objectContaining({
            intent_plan: 'PRO',
            intent_cycle: 'ANNUAL',
        })));
    });
});
