/**
 * Testes de componente para AddAssetModal.
 *
 * O modal é um formulário de tela única, dividido em seções (Operação,
 * Ativo, Valores) — todos os campos ficam visíveis ao mesmo tempo, sem
 * navegação por etapas. Cobre os dois fluxos principais (compra e venda),
 * as validações de erro mais críticas e o modo CASH (cofrinhos).
 *
 * Estratégia de mock:
 *  - useWallet / useToast: funções simples de vi.fn() retornando stubs
 *  - usePriceFetch / useAssetSearch: hooks isolados que não fazem fetch
 *  - AssetLogo: renderizado como null para evitar chamadas de rede
 *  - createPortal: delegado ao jsdom (document.body está disponível)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AddAssetModal } from './AddAssetModal';
import { useWallet } from '../../contexts/WalletContext';
import { useToast } from '../../contexts/ToastContext';
import { usePriceFetch } from '../../hooks/usePriceFetch';
import { useAssetSearch } from '../../hooks/useAssetSearch';
import type { Asset } from '../../contexts/WalletContext';

vi.mock('../../contexts/WalletContext', () => ({ useWallet: vi.fn() }));
vi.mock('../../contexts/ToastContext', () => ({ useToast: vi.fn() }));
vi.mock('../../hooks/usePriceFetch', () => ({ usePriceFetch: vi.fn() }));
vi.mock('../../hooks/useAssetSearch', () => ({ useAssetSearch: vi.fn() }));
vi.mock('../common/AssetLogo', () => ({ default: () => null }));

// ─── Stubs reutilizáveis ─────────────────────────────────────────────────────

const mockAddAsset = vi.fn();
const mockAddToast = vi.fn();

const priceFetchStub = {
  isFetchingPrice: false,
  priceSource: 'manual' as const,
  suggestedPrice: null,
  historicalDateFound: null,
  isCurrentPrice: false,
  setManual: vi.fn(),
  reset: vi.fn(),
};

const searchStub = {
  searchResults: [],
  showDropdown: false,
  setShowDropdown: vi.fn(),
  isSearching: false,
  activeIndex: -1,
  setActiveIndex: vi.fn(),
  handleKeyDown: vi.fn(),
  containerRef: { current: null },
  searchTicker: vi.fn(),
  selectResult: vi.fn(),
  reset: vi.fn(),
};

const makeAsset = (ticker: string, quantity: number, currentPrice = 35): Asset => ({
  id: ticker,
  ticker,
  name: ticker,
  type: 'STOCK',
  quantity,
  averagePrice: currentPrice,
  currentPrice,
  totalValue: quantity * currentPrice,
  totalCost: quantity * currentPrice,
  profit: 0,
  profitPercent: 0,
  currency: 'BRL',
});

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useWallet).mockReturnValue({ addAsset: mockAddAsset, assets: [], usdRate: 5 } as any);
  vi.mocked(useToast).mockReturnValue({ addToast: mockAddToast } as any);
  vi.mocked(usePriceFetch).mockReturnValue(priceFetchStub);
  vi.mocked(useAssetSearch).mockReturnValue(searchStub as any);
});

const renderModal = (props: { isOpen?: boolean; onClose?: () => void } = {}) => {
  const onClose = props.onClose ?? vi.fn();
  render(<AddAssetModal isOpen={props.isOpen ?? true} onClose={onClose} />);
  return { onClose };
};

// ─── Visibilidade ─────────────────────────────────────────────────────────────

describe('visibilidade', () => {
  it('não renderiza nada quando isOpen=false', () => {
    renderModal({ isOpen: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renderiza o modal quando isOpen=true', () => {
    renderModal();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Nova Transação')).toBeInTheDocument();
  });

  it('exibe as três seções do formulário na mesma tela', () => {
    renderModal();
    // Seções visíveis simultaneamente — sem navegação por etapas.
    expect(screen.getByRole('heading', { name: 'Operação' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ativo' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Valores' })).toBeInTheDocument();
    // Campos de seções diferentes coexistem na tela.
    expect(screen.getByLabelText(/Código \/ Ticker/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Quantidade/i)).toBeInTheDocument();
  });

  it('fecha o modal ao clicar no botão X', () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: /Fechar/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('fecha o modal ao clicar no backdrop', () => {
    const { onClose } = renderModal();
    // O backdrop é o primeiro div filho dentro do portal (bg-black/70)
    const backdrop = document.querySelector('.fixed.inset-0') as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });
});

// ─── Toggle Compra / Venda ────────────────────────────────────────────────────

describe('toggle Comprar / Vender', () => {
  it('inicia em modo Comprar (botão com bg-emerald-600)', () => {
    renderModal();
    expect(screen.getByRole('button', { name: /Comprar/i })).toHaveClass('bg-emerald-600');
  });

  it('alterna para modo Vender ao clicar', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /Vender/i }));
    expect(screen.getByRole('button', { name: /Vender/i })).toHaveClass('bg-red-600');
  });
});

// ─── Estado do botão Confirmar ────────────────────────────────────────────────

describe('botão Confirmar', () => {
  it('fica desabilitado enquanto ticker/quantidade/preço estão vazios', () => {
    renderModal();
    expect(screen.getByRole('button', { name: /Confirmar/i })).toBeDisabled();
  });

  it('fica habilitado após preencher os três campos obrigatórios', () => {
    renderModal();
    // ticker
    fireEvent.change(screen.getByLabelText(/Código \/ Ticker/i), { target: { value: 'PETR4' } });
    // quantidade
    fireEvent.change(screen.getByLabelText(/Quantidade/i), { target: { value: '100' } });
    // preço (CurrencyInput: "3500" → formata para "35,00")
    fireEvent.change(screen.getByLabelText(/Preço Unitário/i), { target: { value: '3500' } });

    expect(screen.getByRole('button', { name: /Confirmar/i })).not.toBeDisabled();
  });
});

// ─── Modo Venda ───────────────────────────────────────────────────────────────

describe('modo venda (SELL)', () => {
  it('exibe dropdown de ativos em vez do campo de busca', () => {
    vi.mocked(useWallet).mockReturnValue({
      addAsset: mockAddAsset,
      assets: [makeAsset('PETR4', 100)],
      usdRate: 5,
    } as any);

    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /Vender/i }));

    // Campo de busca (compra) deve desaparecer no modo venda
    expect(screen.queryByLabelText(/Código \/ Ticker/i)).not.toBeInTheDocument();
    // Dropdown com o ativo da carteira
    expect(screen.getByRole('option', { name: /PETR4/ })).toBeInTheDocument();
  });

  it('exibe aviso quando não há ativos do tipo selecionado', () => {
    renderModal(); // assets=[]
    fireEvent.click(screen.getByRole('button', { name: /Vender/i }));
    expect(screen.getByText(/não possui ativos/i)).toBeInTheDocument();
  });
});

// ─── Compra bem-sucedida ──────────────────────────────────────────────────────

describe('compra (BUY) — caminho feliz', () => {
  it('chama addAsset com payload correto e dispara toast de sucesso', async () => {
    mockAddAsset.mockResolvedValue(undefined);
    renderModal();

    fireEvent.change(screen.getByLabelText(/Código \/ Ticker/i), { target: { value: 'PETR4' } });
    fireEvent.change(screen.getByLabelText(/Quantidade/i), { target: { value: '100' } });
    // "3500" → CurrencyInput formata → "35,00" → parseCurrencyToFloat → 35
    fireEvent.change(screen.getByLabelText(/Preço Unitário/i), { target: { value: '3500' } });

    fireEvent.click(screen.getByRole('button', { name: /Confirmar/i }));

    await waitFor(() =>
      expect(mockAddAsset).toHaveBeenCalledWith(
        expect.objectContaining({
          ticker: 'PETR4',
          type: 'STOCK',
          quantity: 100,
          price: 35,
          currency: 'BRL',
        })
      )
    );

    expect(mockAddToast).toHaveBeenCalledWith(
      expect.stringMatching(/sucesso/i),
      'success'
    );
  });
});

// ─── Venda bem-sucedida ───────────────────────────────────────────────────────

describe('venda (SELL) — caminho feliz', () => {
  it('chama addAsset com quantidade negativa', async () => {
    const petr4 = makeAsset('PETR4', 100, 35);
    vi.mocked(useWallet).mockReturnValue({
      addAsset: mockAddAsset,
      assets: [petr4],
      usdRate: 5,
    } as any);
    mockAddAsset.mockResolvedValue(undefined);

    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /Vender/i }));

    // Seleciona o ativo no dropdown — handleSellAssetSelect preenche ticker e price
    const option = screen.getByRole('option', { name: /PETR4/ });
    fireEvent.change(option.closest('select')!, { target: { value: 'PETR4' } });

    // Preenche quantidade
    fireEvent.change(screen.getByLabelText(/Quantidade/i), { target: { value: '10' } });

    fireEvent.click(screen.getByRole('button', { name: /Confirmar/i }));

    await waitFor(() =>
      expect(mockAddAsset).toHaveBeenCalledWith(
        expect.objectContaining({ ticker: 'PETR4', quantity: -10 })
      )
    );
  });
});

// ─── Validações de erro ───────────────────────────────────────────────────────

describe('validações de erro', () => {
  it('exibe alerta para data futura e não chama addAsset', async () => {
    renderModal();

    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().split('T')[0];
    fireEvent.change(screen.getByLabelText(/Data do Aporte/i), { target: { value: tomorrow } });
    fireEvent.change(screen.getByLabelText(/Código \/ Ticker/i), { target: { value: 'PETR4' } });
    fireEvent.change(screen.getByLabelText(/Quantidade/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Preço Unitário/i), { target: { value: '3500' } });

    // fireEvent.submit bypassa o atributo `max` do jsdom (constraint validation HTML5),
    // que bloquearia o onSubmit do React ao clicar o botão com data inválida.
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/futuras/i)
    );
    expect(mockAddAsset).not.toHaveBeenCalled();
  });

  it('exibe alerta de erro quando addAsset rejeita', async () => {
    mockAddAsset.mockRejectedValue(new Error('Falha de rede'));
    renderModal();

    fireEvent.change(screen.getByLabelText(/Código \/ Ticker/i), { target: { value: 'PETR4' } });
    fireEvent.change(screen.getByLabelText(/Quantidade/i), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(/Preço Unitário/i), { target: { value: '3500' } });

    fireEvent.click(screen.getByRole('button', { name: /Confirmar/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/falha de rede/i)
    );
    expect(mockAddToast).toHaveBeenCalledWith(expect.stringMatching(/falha/i), 'error');
  });
});

// ─── STOCK_US — frações e binding valor↔quantidade ───────────────────────────

describe('STOCK_US — ações fracionárias', () => {
  const switchToStockUS = () =>
    fireEvent.change(screen.getByDisplayValue('Ações Brasil (B3)'), {
      target: { value: 'STOCK_US' },
    });

  it('o input de quantidade aceita valores decimais (step=0.00000001)', () => {
    renderModal();
    switchToStockUS();

    const qtyInput = screen.getByLabelText(/Quantidade/i);
    expect(qtyInput).toHaveAttribute('step', '0.00000001');
    expect(qtyInput).not.toHaveAttribute('step', '1');
  });

  it('label do input de quantidade é "Quantidade" (sem "(Cotas)")', () => {
    renderModal();
    switchToStockUS();
    // getByLabelText já valida que o label existe e está correto
    expect(screen.getByLabelText('Quantidade')).toBeInTheDocument();
  });

  it('exibe o campo "Valor Total (US$)" para STOCK_US', () => {
    renderModal();
    switchToStockUS();
    expect(screen.getByLabelText(/Valor Total \(US\$\)/i)).toBeInTheDocument();
  });

  it('não exibe o campo "Valor Total (US$)" para STOCK (B3)', () => {
    renderModal();
    // Tipo padrão já é STOCK
    expect(screen.queryByLabelText(/Valor Total \(US\$\)/i)).not.toBeInTheDocument();
  });

  it('aceita quantidade fracionária e gera payload com float', async () => {
    mockAddAsset.mockResolvedValue(undefined);
    renderModal();
    switchToStockUS();

    fireEvent.change(screen.getByLabelText(/Código \/ Ticker/i), {
      target: { value: 'AAPL' },
    });
    // Fractional quantity
    fireEvent.change(screen.getByLabelText('Quantidade'), {
      target: { value: '0.5' },
    });
    // CurrencyInput: "20000" → 200.00
    fireEvent.change(screen.getByLabelText(/Preço Unitário/i), {
      target: { value: '20000' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Confirmar/i }));

    await waitFor(() =>
      expect(mockAddAsset).toHaveBeenCalledWith(
        expect.objectContaining({
          ticker: 'AAPL',
          type: 'STOCK_US',
          quantity: 0.5,
          currency: 'USD',
        })
      )
    );
  });

  it('preenche quantidade a partir do valor total digitado', () => {
    renderModal();
    switchToStockUS();

    // Set a unit price first (CurrencyInput: "20000" → 200.00)
    fireEvent.change(screen.getByLabelText(/Preço Unitário/i), {
      target: { value: '20000' },
    });

    // Type a total value of 100 USD → quantity should become 100 / 200 = 0.5
    fireEvent.change(screen.getByLabelText(/Valor Total \(US\$\)/i), {
      target: { value: '100' },
    });

    const qtyInput = screen.getByLabelText('Quantidade') as HTMLInputElement;
    expect(parseFloat(qtyInput.value)).toBeCloseTo(0.5, 5);
  });

  it('digitar quantidade limpa o campo de valor total', () => {
    renderModal();
    switchToStockUS();

    // First fill in the total value field
    fireEvent.change(screen.getByLabelText(/Preço Unitário/i), {
      target: { value: '20000' },
    });
    fireEvent.change(screen.getByLabelText(/Valor Total \(US\$\)/i), {
      target: { value: '100' },
    });

    // Now manually change the quantity
    fireEvent.change(screen.getByLabelText('Quantidade'), {
      target: { value: '0.25' },
    });

    const totalInput = screen.getByLabelText(/Valor Total \(US\$\)/i) as HTMLInputElement;
    expect(totalInput.value).toBe('');
  });
});

// ─── Modo CASH (cofrinhos) ────────────────────────────────────────────────────

describe('modo CASH', () => {
  const switchToCash = () =>
    fireEvent.change(screen.getByDisplayValue('Ações Brasil (B3)'), { target: { value: 'CASH' } });

  it('exibe seletor de cofrinho ao selecionar tipo CASH', () => {
    renderModal();
    switchToCash();
    // Texto exato do label gerado em BUY CASH — evita ambiguidade com
    // "Criar novo cofrinho" (option) e "Nome do Cofrinho" (label do input).
    expect(screen.getByText('Cofrinho (Reserva)')).toBeInTheDocument();
  });

  it('exige nome ao tentar criar novo cofrinho sem preencher o campo', async () => {
    renderModal();
    switchToCash();

    // Preenche o valor mas deixa o nome em branco
    fireEvent.change(screen.getByLabelText(/Valor do Aporte/i), { target: { value: '50000' } });

    fireEvent.click(screen.getByRole('button', { name: /Confirmar/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/nome/i)
    );
    expect(mockAddAsset).not.toHaveBeenCalled();
  });

  it('em modo venda CASH sem reservas exibe mensagem de aviso', () => {
    renderModal(); // assets=[] → sem reservas
    switchToCash();
    fireEvent.click(screen.getByRole('button', { name: /Vender/i }));
    expect(screen.getByText(/não possui reservas/i)).toBeInTheDocument();
  });
});
