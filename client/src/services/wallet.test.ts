import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { walletService } from './wallet';
import { authService } from './auth';

/**
 * walletService: montagem da URL (escopo `?walletId=`), corpo das mutações e o
 * contrato de erro — leitura degrada para um fallback declarado, mutação
 * rejeita com a mensagem do servidor (é ela que vira toast).
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const notJson = (status = 500) => new Response('<html>Bad Gateway</html>', { status });

let apiSpy: ReturnType<typeof vi.spyOn<typeof authService, 'api'>>;

const lastCall = () => {
  const call = apiSpy.mock.calls.at(-1);
  if (!call) throw new Error('authService.api não foi chamado');
  const [url, options = {}] = call;
  return { url, method: options.method ?? 'GET', body: options.body ? JSON.parse(String(options.body)) : undefined };
};

beforeEach(() => {
  apiSpy = vi.spyOn(authService, 'api');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('walletService — escopo de carteira na URL', () => {
  it('omite walletId quando não informado (o servidor resolve a carteira ativa)', async () => {
    apiSpy.mockImplementation(async () => json({ assets: [] }));
    await walletService.getWallet();
    expect(lastCall().url).toBe('/api/wallet');
  });

  it('anexa walletId codificado com "?" quando a rota não tem query', async () => {
    apiSpy.mockImplementation(async () => json([]));
    await walletService.getHistory('w 1/a');
    expect(lastCall().url).toBe('/api/wallet/history?walletId=w%201%2Fa');
  });

  it('anexa walletId com "&" quando a rota já tem query (paginação)', async () => {
    apiSpy.mockImplementation(async () => json({ transactions: [] }));
    await walletService.getTransactions('PETR4', 2, 5, 'w-9');
    expect(lastCall().url).toBe('/api/wallet/transactions/PETR4?page=2&limit=5&walletId=w-9');
  });

  it('extrato codifica o filtro e mantém a carteira no fim', async () => {
    apiSpy.mockImplementation(async () => json({ items: [] }));
    await walletService.getCashFlow(1, 20, 'DIVIDEND&X', 'w-2');
    expect(lastCall().url).toBe('/api/wallet/cashflow?page=1&limit=20&filterType=DIVIDEND%26X&walletId=w-2');
  });

  it('busca de ativo monta q e type sem walletId (catálogo é global)', async () => {
    apiSpy.mockImplementation(async () => json([{ ticker: 'PETR4' }]));
    await expect(walletService.searchAsset('petr', 'STOCK')).resolves.toEqual([{ ticker: 'PETR4' }]);
    expect(lastCall().url).toBe('/api/wallet/search?q=petr&type=STOCK');

    await walletService.searchAsset('itub');
    expect(lastCall().url).toBe('/api/wallet/search?q=itub');
  });
});

describe('walletService — corpo das mutações', () => {
  it('addAsset envia POST com o lançamento serializado', async () => {
    apiSpy.mockImplementation(async () => json({ ok: true }));
    await walletService.addAsset({ ticker: 'BBAS3', quantity: 10 }, 'w-1');
    expect(lastCall()).toEqual({
      url: '/api/wallet/add?walletId=w-1',
      method: 'POST',
      body: { ticker: 'BBAS3', quantity: 10 },
    });
  });

  it('updateTargets envia as quatro metas no PUT, inclusive a renda mensal', async () => {
    apiSpy.mockImplementation(async () => json({ ok: true }));
    await walletService.updateTargets({ STOCK: 60, FII: 40 }, 5000, { STOCK: { BANK: 50 } }, 800, 'w-3');
    expect(lastCall()).toEqual({
      url: '/api/wallet/targets?walletId=w-3',
      method: 'PUT',
      body: {
        targetAllocation: { STOCK: 60, FII: 40 },
        targetReserve: 5000,
        targetSubAllocation: { STOCK: { BANK: 50 } },
        targetMonthlyDividendIncome: 800,
      },
    });
  });

  it('rebalanceamento usa MODERATE por padrão', async () => {
    apiSpy.mockImplementation(async () => json({ orders: [] }));
    await walletService.getRebalancePlan();
    expect(lastCall()).toMatchObject({ url: '/api/wallet/rebalance', method: 'POST', body: { riskProfile: 'MODERATE' } });
  });

  it('importação manda só fonte + linhas normalizadas, e o desfazer é DELETE do lote', async () => {
    apiSpy.mockImplementation(async () => json({ ok: true }));
    const rows = [{ ticker: 'PETR4', side: 'BUY', quantity: 1, price: 30, date: '2026-01-02' }];
    await walletService.importPreview('B3', rows, 'w-1');
    expect(lastCall()).toEqual({ url: '/api/wallet/import/preview?walletId=w-1', method: 'POST', body: { source: 'B3', rows } });

    await walletService.importCommit('B3', rows);
    expect(lastCall()).toEqual({ url: '/api/wallet/import/commit', method: 'POST', body: { source: 'B3', rows } });

    await walletService.importUndo('batch-7', 'w-1');
    expect(lastCall()).toMatchObject({ url: '/api/wallet/import/batch-7?walletId=w-1', method: 'DELETE' });
  });
});

describe('walletService — leituras degradam para fallback declarado', () => {
  it.each([
    ['getHistory', () => walletService.getHistory(), []],
    ['getPerformance', () => walletService.getPerformance(), []],
    ['searchAsset', () => walletService.searchAsset('xpto'), null],
  ] as const)('%s devolve o fallback e não o corpo de erro', async (_name, call, fallback) => {
    apiSpy.mockImplementation(async () => json({ message: 'boom' }, 500));
    await expect(call()).resolves.toEqual(fallback);
  });

  it('getDividends sem acesso devolve estrutura vazia completa (a tela não quebra)', async () => {
    apiSpy.mockImplementation(async () => json({ message: 'plano' }, 403));
    await expect(walletService.getDividends('w-1')).resolves.toEqual({
      history: [],
      provisioned: [],
      totalAllTime: 0,
      projectedMonthly: 0,
      yieldOnCost: [],
      goal: { target: 0, current: 0, progressPercent: null },
    });
  });
});

describe('walletService — mutações e leituras obrigatórias rejeitam', () => {
  it.each([
    ['getWallet', () => walletService.getWallet(), 'Falha ao carregar carteira'],
    ['removeAsset', () => walletService.removeAsset('a1'), 'Falha ao remover ativo'],
    ['updateTargets', () => walletService.updateTargets({}, 0), 'Falha ao salvar carteira ideal'],
    ['resetWallet', () => walletService.resetWallet(), 'Falha ao resetar carteira'],
    ['getTransactions', () => walletService.getTransactions('PETR4'), 'Falha ao buscar histórico'],
    ['deleteTransaction', () => walletService.deleteTransaction('t1'), 'Falha ao deletar transação'],
    ['getCashFlow', () => walletService.getCashFlow(), 'Falha ao buscar extrato'],
  ] as const)('%s lança mensagem fixa', async (_name, call, message) => {
    apiSpy.mockImplementation(async () => json({ message: 'ignorada' }, 500));
    await expect(call()).rejects.toThrow(message);
  });

  it.each([
    ['addAsset', () => walletService.addAsset({})],
    ['updateAsset', () => walletService.updateAsset('a1', { name: 'X' })],
    ['getTaxReport', () => walletService.getTaxReport(2025)],
    ['downloadTaxReportPdf', () => walletService.downloadTaxReportPdf(2025)],
    ['getRebalancePlan', () => walletService.getRebalancePlan('BOLD')],
    ['importPreview', () => walletService.importPreview('B3', [])],
    ['importCommit', () => walletService.importCommit('B3', [])],
    ['importUndo', () => walletService.importUndo('b1')],
  ] as const)('%s propaga a mensagem do servidor', async (_name, call) => {
    apiSpy.mockImplementation(async () => json({ message: 'Ticker não encontrado na B3.' }, 422));
    await expect(call()).rejects.toThrow('Ticker não encontrado na B3.');
  });

  it.each([
    ['updateAsset', () => walletService.updateAsset('a1', {}), 'Falha ao atualizar ativo'],
    ['getTaxReport', () => walletService.getTaxReport(2025), 'Falha ao gerar o relatório de IR'],
    ['downloadTaxReportPdf', () => walletService.downloadTaxReportPdf(2025), 'Falha ao gerar o PDF'],
    ['getRebalancePlan', () => walletService.getRebalancePlan(), 'Falha ao gerar o rebalanceamento'],
    ['importPreview', () => walletService.importPreview('B3', []), 'Falha ao analisar os dados importados'],
    ['importCommit', () => walletService.importCommit('B3', []), 'Falha ao importar a carteira'],
    ['importUndo', () => walletService.importUndo('b1'), 'Falha ao desfazer a importação'],
  ] as const)('%s com corpo de erro que não é JSON cai na mensagem padrão', async (_name, call, message) => {
    apiSpy.mockImplementation(async () => notJson(502));
    await expect(call()).rejects.toThrow(message);
  });

  it('addAsset sem mensagem no corpo usa o texto padrão', async () => {
    apiSpy.mockImplementation(async () => json({}, 400));
    await expect(walletService.addAsset({})).rejects.toThrow('Falha ao adicionar ativo');
  });
});

describe('walletService — download do PDF de IR', () => {
  // jsdom não implementa object URLs; o par é instalado só neste bloco.
  const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:ir');
  const revokeObjectURL = vi.fn((_url: string) => undefined);

  beforeEach(() => {
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
  });

  afterEach(() => {
    URL.createObjectURL = original.create;
    URL.revokeObjectURL = original.revoke;
  });

  it('baixa o blob com o nome do ano-base e libera o object URL', async () => {
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(`${this.download}|${this.href}`);
    });
    apiSpy.mockImplementation(async () => new Response('%PDF', { status: 200 }));

    await walletService.downloadTaxReportPdf(2025);

    expect(lastCall().url).toBe('/api/wallet/tax-report/2025/pdf');
    expect(downloads).toEqual(['vertice-ir-2025.pdf|blob:ir']);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:ir');
    // O link temporário não fica pendurado no DOM.
    expect(document.querySelector('a[download]')).toBeNull();
  });
});
