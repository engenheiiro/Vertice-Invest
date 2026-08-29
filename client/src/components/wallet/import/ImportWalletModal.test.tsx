/**
 * Fiação do wizard de importação.
 *
 * Os parsers já têm testes próprios e o serviço tem os dele; o que falta cobrir
 * é a costura entre eles — que é onde um import "funciona na demo e grava
 * errado" nasce. Em especial:
 *  - a classe escolhida na conferência tem que chegar em TODAS as linhas do ativo;
 *  - duplicata não pode ir para o commit, nem quando o ativo está marcado;
 *  - ativo desmarcado não pode ir junto;
 *  - ativo sem classe tem que TRAVAR o botão em vez de gravar posição sem classe.
 *
 * O fluxo é dirigido por UPLOAD DE ARQUIVO, que é a porta que está no ar. A porta
 * de colagem do Investidor10 está desligada por decisão de produto
 * (`INVESTIDOR10_ENABLED`), e o parser dela segue coberto em `parsers.test.ts`.
 *
 * `walletService` é mockado: nenhum teste aqui toca a rede.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ImportWalletModal } from './ImportWalletModal';
import { useWallet } from '../../../contexts/WalletContext';
import { useToast } from '../../../contexts/ToastContext';
import { walletService } from '../../../services/wallet';

vi.mock('../../../contexts/WalletContext', () => ({ useWallet: vi.fn() }));
vi.mock('../../../contexts/ToastContext', () => ({ useToast: vi.fn() }));
vi.mock('../../../services/wallet', () => ({
    walletService: { importPreview: vi.fn() },
}));

const mockImportCommit = vi.fn();
const mockImportUndo = vi.fn();

/** Resposta de preview com dois ativos: um limpo, um com linha duplicada. */
const previewResponse = {
    rows: [
        { ticker: 'PETR4', type: 'STOCK', side: 'BUY', quantity: 100, price: 30.5, date: '2023-03-01', currency: 'BRL', status: 'ok', reason: null },
        { ticker: 'MXRF11', type: 'FII', side: 'BUY', quantity: 200, price: 10.45, date: '2023-03-01', currency: 'BRL', status: 'ok', reason: null },
        { ticker: 'MXRF11', type: 'FII', side: 'BUY', quantity: 200, price: 10.45, date: '2023-03-01', currency: 'BRL', status: 'duplicado', reason: 'Lançamento idêntico já existe nesta carteira.' },
    ],
    summary: [
        { ticker: 'PETR4', type: 'STOCK', name: 'Petrobras', currency: 'BRL', rows: 1, quantity: 100, averagePrice: 30.5, totalCost: 3050, hadPosition: false },
        { ticker: 'MXRF11', type: 'FII', name: 'Maxi Renda', currency: 'BRL', rows: 2, quantity: 200, averagePrice: 10.45, totalCost: 2090, hadPosition: false },
    ],
    counts: { total: 3, ok: 2, duplicado: 1, atencao: 0, naoReconhecido: 0 },
};

const PLANILHA = [
    'Ticker;Classe;Operação;Quantidade;Preço;Data;Moeda',
    'PETR4;Ação;Compra;100;30,50;01/03/2023;BRL',
    'MXRF11;FII;Compra;200;10,45;01/03/2023;BRL',
].join('\n');

const EXTRATO_B3 = [
    'Entrada/Saída;Data;Movimentação;Produto;Instituição;Quantidade;Preço unitário;Valor da Operação',
    'Credito;15/03/2024;Transferência - Liquidação;PETR4 - PETROLEO BRASILEIRO S.A.;CORRETORA;100;30,50;3.050,00',
].join('\n');

/** Sobe um arquivo por uma das duas portas e espera a conferência aparecer. */
const enviarArquivo = async (rotulo: RegExp, conteudo: string, nome = 'carteira.csv') => {
    const input = screen.getByLabelText(rotulo) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([conteudo], nome, { type: 'text/csv' })] } });
    await waitFor(() => expect(screen.getByText(/Posição resultante/i)).toBeInTheDocument());
};

const irParaConferencia = () => enviarArquivo(/Enviar planilha/i, PLANILHA);

beforeEach(() => {
    vi.clearAllMocks();
    (useWallet as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        importCommit: mockImportCommit,
        importUndo: mockImportUndo,
        activeWalletId: 'w1',
        activeWalletName: 'Minha Carteira',
    });
    (useToast as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ addToast: vi.fn() });
    (walletService.importPreview as ReturnType<typeof vi.fn>).mockResolvedValue(previewResponse);
    mockImportCommit.mockResolvedValue({ batchId: 'b1', inserted: 2 });
});

describe('ImportWalletModal — escolha da fonte', () => {
    it('oferece a B3 como porta recomendada e a planilha como alternativa', () => {
        render(<ImportWalletModal isOpen onClose={vi.fn()} />);

        expect(screen.getByText('Extrato da B3')).toBeInTheDocument();
        expect(screen.getByText('Recomendado')).toBeInTheDocument();
        expect(screen.getByText('Planilha')).toBeInTheDocument();
    });

    it('NÃO expõe a porta do Investidor10 enquanto ela estiver desligada', () => {
        // Decisão de produto (ago/2026): o parser continua vivo e testado, mas a
        // entrada some da UI. Este teste é a trava que impede reaparecer sem querer.
        render(<ImportWalletModal isOpen onClose={vi.fn()} />);

        expect(screen.queryByText(/Colar do Investidor10/i)).not.toBeInTheDocument();
        expect(screen.queryByLabelText(/Cole aqui a tabela/i)).not.toBeInTheDocument();
        expect(screen.queryByLabelText(/Início da carteira/i)).not.toBeInTheDocument();
    });

    it('avisa que o arquivo é lido no navegador', () => {
        // É o argumento que sustenta pedir o extrato da B3, que carrega CPF.
        render(<ImportWalletModal isOpen onClose={vi.fn()} />);
        expect(screen.getByText(/lido no seu navegador/i)).toBeInTheDocument();
        expect(screen.getByText(/CPF, corretora e número de conta não saem/i)).toBeInTheDocument();
    });

    it('mostra o erro do parser sem sair da tela de fonte', async () => {
        render(<ImportWalletModal isOpen onClose={vi.fn()} />);

        const input = screen.getByLabelText(/Enviar planilha/i);
        fireEvent.change(input, { target: { files: [new File(['nada;aqui\n1;2'], 'x.csv', { type: 'text/csv' })] } });

        await waitFor(() => expect(screen.getByText(/colunas obrigatórias/i)).toBeInTheDocument());
        expect(walletService.importPreview).not.toHaveBeenCalled();
    });

    it('recusa formato não suportado com instrução clara', async () => {
        render(<ImportWalletModal isOpen onClose={vi.fn()} />);

        const input = screen.getByLabelText(/Enviar extrato da B3/i);
        fireEvent.change(input, { target: { files: [new File(['x'], 'extrato.xls')] } });

        await waitFor(() => expect(screen.getByText(/formato \.xls antigo não é suportado/i)).toBeInTheDocument());
    });
});

describe('ImportWalletModal — conferência', () => {
    it('parseia a planilha e manda as linhas ao preview', async () => {
        render(<ImportWalletModal isOpen onClose={vi.fn()} />);
        await irParaConferencia();

        const [source, rows] = (walletService.importPreview as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(source).toBe('SHEET');
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({ ticker: 'PETR4', quantity: 100, price: 30.5, date: '2023-03-01' });
    });

    it('detecta o extrato da B3 e reporta a fonte certa', async () => {
        render(<ImportWalletModal isOpen onClose={vi.fn()} />);
        await enviarArquivo(/Enviar extrato da B3/i, EXTRATO_B3, 'movimentacao.csv');

        const [source] = (walletService.importPreview as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(source).toBe('B3_MOVIMENTACAO');
    });

    it('mostra a posição resultante por ativo para conferir contra a origem', async () => {
        render(<ImportWalletModal isOpen onClose={vi.fn()} />);
        await irParaConferencia();

        expect(screen.getByText('PETR4')).toBeInTheDocument();
        expect(screen.getByText('MXRF11')).toBeInTheDocument();
        expect(screen.getByText('R$ 3.050,00')).toBeInTheDocument();
    });

    it('informa quantas duplicatas foram descartadas', async () => {
        render(<ImportWalletModal isOpen onClose={vi.fn()} />);
        await irParaConferencia();
        expect(screen.getByText(/1 lançamento\(s\) já existiam/i)).toBeInTheDocument();
    });
});

describe('ImportWalletModal — o que chega ao commit', () => {
    it('NÃO envia a linha duplicada, mesmo com o ativo marcado', async () => {
        // É o que torna reimportar o mesmo extrato uma operação segura.
        render(<ImportWalletModal isOpen onClose={vi.fn()} />);
        await irParaConferencia();

        fireEvent.click(screen.getByRole('button', { name: /Importar 2 lançamentos/i }));

        await waitFor(() => expect(mockImportCommit).toHaveBeenCalled());
        const [, rows] = mockImportCommit.mock.calls[0];
        expect(rows).toHaveLength(2);
        expect(rows.filter((r: { ticker: string }) => r.ticker === 'MXRF11')).toHaveLength(1);
    });

    it('não envia o ativo desmarcado na conferência', async () => {
        render(<ImportWalletModal isOpen onClose={vi.fn()} />);
        await irParaConferencia();

        fireEvent.click(screen.getByLabelText(/Incluir MXRF11 na importação/i));
        fireEvent.click(screen.getByRole('button', { name: /Importar 1 lançamento/i }));

        await waitFor(() => expect(mockImportCommit).toHaveBeenCalled());
        const [, rows] = mockImportCommit.mock.calls[0];
        expect(rows).toEqual([expect.objectContaining({ ticker: 'PETR4' })]);
    });

    it('aplica a classe escolhida a TODAS as linhas daquele ativo', async () => {
        render(<ImportWalletModal isOpen onClose={vi.fn()} />);
        await irParaConferencia();

        fireEvent.change(screen.getByLabelText(/Classe de PETR4/i), { target: { value: 'ETF' } });
        fireEvent.click(screen.getByRole('button', { name: /Importar 2 lançamentos/i }));

        await waitFor(() => expect(mockImportCommit).toHaveBeenCalled());
        const [, rows] = mockImportCommit.mock.calls[0];
        expect(rows.find((r: { ticker: string }) => r.ticker === 'PETR4').type).toBe('ETF');
        expect(rows.find((r: { ticker: string }) => r.ticker === 'MXRF11').type).toBe('FII');
    });

    it('TRAVA o commit enquanto houver ativo sem classe definida', async () => {
        // Gravar posição sem classe a jogaria na alocação errada em silêncio.
        (walletService.importPreview as ReturnType<typeof vi.fn>).mockResolvedValue({
            ...previewResponse,
            rows: [{ ...previewResponse.rows[0], ticker: 'XPTO11', type: undefined, status: 'nao_reconhecido', reason: 'Ativo fora do nosso catálogo.' }],
            summary: [{ ...previewResponse.summary[0], ticker: 'XPTO11', type: null, name: null }],
        });

        render(<ImportWalletModal isOpen onClose={vi.fn()} />);
        await irParaConferencia();

        expect(screen.getByText(/Defina a classe de XPTO11/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Importar 0 lançamento/i })).toBeDisabled();
    });

    it('mostra data e preço legíveis na linha que pede atenção', async () => {
        // A data volta do servidor como ISO COM HORA (`2026-07-31T12:00:00.000Z`),
        // porque lá ela virou Date. Sem cortar a hora, a tela exibia
        // "31T12:00:00.000Z/07/2026"; e sem o preço não dá para conferir a linha
        // contra o extrato.
        (walletService.importPreview as ReturnType<typeof vi.fn>).mockResolvedValue({
            ...previewResponse,
            rows: [{
                ...previewResponse.rows[0],
                ticker: 'TESOURO IPCA+ 2032',
                type: undefined,
                quantity: 0.25,
                price: 2943.69,
                date: '2026-07-31T12:00:00.000Z',
                status: 'nao_reconhecido',
                reason: 'Ativo fora do nosso catálogo. Escolha a classe para importar.',
            }],
            summary: [{ ...previewResponse.summary[0], ticker: 'TESOURO IPCA+ 2032', type: null, name: null }],
        });

        render(<ImportWalletModal isOpen onClose={vi.fn()} />);
        await irParaConferencia();

        expect(screen.getByText(/em 31\/07\/2026/)).toBeInTheDocument();
        expect(screen.getByText(/2\.943,69/)).toBeInTheDocument();
    });

    it('destrava assim que a classe do ativo desconhecido é escolhida', async () => {
        (walletService.importPreview as ReturnType<typeof vi.fn>).mockResolvedValue({
            ...previewResponse,
            rows: [{ ...previewResponse.rows[0], ticker: 'XPTO11', type: undefined, status: 'nao_reconhecido', reason: 'Ativo fora do nosso catálogo.' }],
            summary: [{ ...previewResponse.summary[0], ticker: 'XPTO11', type: null, name: null }],
        });

        render(<ImportWalletModal isOpen onClose={vi.fn()} />);
        await irParaConferencia();

        fireEvent.change(screen.getByLabelText(/Classe de XPTO11/i), { target: { value: 'FII' } });

        const botao = screen.getByRole('button', { name: /Importar 1 lançamento/i });
        expect(botao).not.toBeDisabled();
        fireEvent.click(botao);

        await waitFor(() => expect(mockImportCommit).toHaveBeenCalled());
        expect(mockImportCommit.mock.calls[0][1][0]).toMatchObject({ ticker: 'XPTO11', type: 'FII' });
    });
});

describe('ImportWalletModal — conclusão', () => {
    it('confirma o resultado e oferece desfazer', async () => {
        render(<ImportWalletModal isOpen onClose={vi.fn()} />);
        await irParaConferencia();
        fireEvent.click(screen.getByRole('button', { name: /Importar 2 lançamentos/i }));

        await waitFor(() => expect(screen.getByText(/Sua carteira está no Vértice/i)).toBeInTheDocument());
        expect(screen.getByText(/2 lançamento\(s\) importado\(s\)/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Desfazer importação/i })).toBeInTheDocument();
    });

    it('desfazer reverte o lote recém-criado', async () => {
        const onClose = vi.fn();
        render(<ImportWalletModal isOpen onClose={onClose} />);
        await irParaConferencia();
        fireEvent.click(screen.getByRole('button', { name: /Importar 2 lançamentos/i }));
        await waitFor(() => expect(screen.getByRole('button', { name: /Desfazer importação/i })).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: /Desfazer importação/i }));

        await waitFor(() => expect(mockImportUndo).toHaveBeenCalledWith('b1'));
        expect(onClose).toHaveBeenCalled();
    });

    it('mostra o erro do servidor sem sair da conferência', async () => {
        mockImportCommit.mockRejectedValue(new Error('Muitas importações seguidas.'));

        render(<ImportWalletModal isOpen onClose={vi.fn()} />);
        await irParaConferencia();
        fireEvent.click(screen.getByRole('button', { name: /Importar 2 lançamentos/i }));

        await waitFor(() => expect(screen.getByText(/Muitas importações seguidas/i)).toBeInTheDocument());
        expect(screen.getByText(/Posição resultante/i)).toBeInTheDocument();
    });
});
