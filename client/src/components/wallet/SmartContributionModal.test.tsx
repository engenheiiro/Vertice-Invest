/**
 * Testes do Aporte Inteligente da Carteira.
 *
 * Cobre as duas saídas do modal:
 *  - "Copiar aporte": texto em colunas (destino: Bloco de Notas), com classes,
 *    linhas-filhas e total.
 *  - Clique na linha: leva para a aba correspondente do Research com o valor
 *    daquela linha, convertido para a moeda da aba (USD nas classes em dólar).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SmartContributionModal } from './SmartContributionModal';
import { useWallet } from '../../contexts/WalletContext';

vi.mock('../../contexts/WalletContext', () => ({ useWallet: vi.fn() }));
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));

const USD_RATE = 5;

const walletStub = {
    assets: [],
    // Metade Ações BR, metade Exterior — sem posição atual, o gap é o próprio alvo.
    targetAllocation: { STOCK: 50, FII: 0, STOCK_US: 50, ETF: 0, CRYPTO: 0, FIXED_INCOME: 0, OURO: 0, CASH: 0 },
    targetReserve: 0,
    targetSubAllocation: {
        STOCK: { STOCK: 0, ETF: 0 },
        FIXED_INCOME: { IPCA: 0, POS: 0, PRE: 0 },
        // Todo o Exterior vai para ETFs → gera a linha-filha "ETFs".
        STOCK_US: { STOCK: 0, REIT: 0, ETF: 100, DOLLAR: 0 },
    },
    usdRate: USD_RATE,
};

const writeText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
    vi.clearAllMocks();
    (useWallet as unknown as ReturnType<typeof vi.fn>).mockReturnValue(walletStub);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

const renderWithAmount = (value: string) => {
    const onClose = vi.fn();
    render(<SmartContributionModal isOpen onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Valor do Aporte (R$)'), { target: { value } });
    return { onClose };
};

describe('SmartContributionModal — copiar para texto', () => {
    it('copia o plano com classes, linhas-filhas e total', async () => {
        renderWithAmount('1000');

        fireEvent.click(screen.getByText('Copiar aporte'));
        // O feedback "Copiado" só aparece depois do clipboard resolver.
        await screen.findByText('Copiado');

        expect(writeText).toHaveBeenCalledTimes(1);
        const text: string = writeText.mock.calls[0][0];

        expect(text).toContain('APORTE INTELIGENTE');
        expect(text).toMatch(/Ações BR\s+R\$ 500,00\s+50,0%/);
        expect(text).toMatch(/Exterior\s+R\$ 500,00\s+50,0%/);
        expect(text).toMatch(/-> ETFs\s+R\$ 500,00/);
        expect(text).toMatch(/TOTAL\s+R\$ 1\.000,00\s+100,0%/);
        // Bloco de Notas: quebra CRLF e sem NBSP herdado do Intl.
        expect(text).toContain('\r\n');
        expect(text).not.toContain(String.fromCharCode(160));
    });

    it('mantém o botão desabilitado sem sugestões', () => {
        render(<SmartContributionModal isOpen onClose={vi.fn()} />);
        expect(screen.getByText('Copiar aporte').closest('button')).toBeDisabled();
    });
});

describe('SmartContributionModal — atalho para o Research', () => {
    it('leva a classe em BRL para a aba correspondente com o valor da linha', () => {
        const { onClose } = renderWithAmount('1000');

        fireEvent.click(screen.getByText('Ações BR'));

        expect(onClose).toHaveBeenCalled();
        expect(mockNavigate).toHaveBeenCalledWith('/research', {
            state: { aporte: { assetClass: 'STOCK', exteriorView: undefined, etfOrigin: undefined, amount: 500, currency: 'BRL' } },
        });
    });

    it('converte para dólar na linha-filha de ETFs do Exterior', () => {
        renderWithAmount('1000');

        fireEvent.click(screen.getByText('ETFs'));

        expect(mockNavigate).toHaveBeenCalledWith('/research', {
            state: { aporte: { assetClass: 'ETF', exteriorView: undefined, etfOrigin: 'US', amount: 500 / USD_RATE, currency: 'USD' } },
        });
    });

    it('não navega a partir da linha de Reserva', () => {
        (useWallet as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ ...walletStub, targetReserve: 1000 });
        renderWithAmount('1000');

        fireEvent.click(screen.getByText('Reserva'));

        expect(mockNavigate).not.toHaveBeenCalled();
    });
});
