/**
 * Control Room do Admin: orquestração das abas e dos handlers.
 *
 * As abas têm teste próprio (ou são só apresentação); aqui elas viram dublês que
 * guardam as props recebidas, e o teste chama os handlers como a aba chamaria.
 * O que fica travado é o contrato do painel:
 *  - carrega histórico, macro, config, descartes e status de publicação ao abrir;
 *  - badges: número de tickets esperando no Suporte e bolinha da Saúde fora de OK;
 *  - cada operação mostra o resultado REAL (sucesso ou a mensagem do erro);
 *  - ações destrutivas passam pelo confirm e não rodam se ele for negado;
 *  - "publicar pendentes" não transforma falha parcial em toast de sucesso.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { axe } from 'jest-axe';
import { AdminPanel } from './AdminPanel';
import { researchService } from '../../services/research';
import { marketService } from '../../services/market';
import { authService } from '../../services/auth';
import { subscriptionService } from '../../services/subscription';
import { supportService } from '../../services/support';
import { healthService } from '../../services/health';

const h = vi.hoisted(() => ({
  props: {} as Record<string, Record<string, unknown>>,
  confirm: vi.fn(),
  addToast: vi.fn(),
  stub: (name: string) => (p: Record<string, unknown>) => {
    h.props[name] = p;
    return React.createElement('div', { 'data-testid': `aba-${name}` });
  },
}));


vi.mock('../../components/dashboard/Header', () => ({ Header: () => null }));
vi.mock('../../components/admin/AuditDetailModal', () => ({
  AuditDetailModal: ({ isOpen, report }: { isOpen: boolean; report: { _id?: string } | null }) =>
    isOpen ? <div data-testid="auditoria">{report ? `relatório ${report._id}` : 'carregando'}</div> : null,
}));
vi.mock('./AdminPainelTab', () => ({ AdminPainelTab: h.stub('painel') }));
vi.mock('./AdminOperacoesTab', () => ({ AdminOperacoesTab: h.stub('operacoes') }));
vi.mock('./AdminFerramentasTab', () => ({ AdminFerramentasTab: h.stub('ferramentas') }));
vi.mock('./AdminSaudeTab', () => ({ AdminSaudeTab: h.stub('saude') }));
vi.mock('./AdminFunilTab', () => ({ AdminFunilTab: h.stub('funil') }));
vi.mock('./AdminSuporteTab', () => ({ AdminSuporteTab: h.stub('suporte') }));
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ addToast: h.addToast }) }));
vi.mock('../../hooks/useConfirm', () => ({ useConfirm: () => h.confirm }));
vi.mock('../../services/research', () => ({
  SECTION_LABEL: { RANKING: 'Ranking', MORNING_CALL: 'Morning Call', REPORT: 'Relatório', EXPLAINABLE_AI: 'Explainable IA' },
  researchService: {
    getHistory: vi.fn(), getMacroData: vi.fn(), getRadarStats: vi.fn(), getDataQualityStats: vi.fn(),
    getAlgorithmAccuracy: vi.fn(), getDiscardLogs: vi.fn(), getPublishStatus: vi.fn(), syncMarketData: vi.fn(),
    syncMacro: vi.fn(), runFullPipeline: vi.fn(), triggerSnapshot: vi.fn(), resetAssetHealth: vi.fn(),
    publish: vi.fn(), getReportDetails: vi.fn(), generateExplainableAI: vi.fn(), updateBacktestConfig: vi.fn(),
    syncTimeSeries: vi.fn(), clearSignalsHistory: vi.fn(),
  },
}));
vi.mock('../../services/market', () => ({ marketService: { getAssetCacheStatus: vi.fn() } }));
vi.mock('../../services/auth', () => ({ authService: { api: vi.fn() } }));
vi.mock('../../services/subscription', () => ({ subscriptionService: { testCheckout: vi.fn() } }));
vi.mock('../../services/support', () => ({ supportService: { adminSummary: vi.fn() } }));
vi.mock('../../services/health', () => ({ healthService: { getDataHealth: vi.fn() } }));

const rs = vi.mocked(researchService);
const call = async (aba: string, handler: string, ...args: unknown[]) => {
  const fn = h.props[aba]?.[handler] as (...a: unknown[]) => unknown;
  await act(async () => { await fn(...args); });
};
const prop = (aba: string, key: string) => h.props[aba]?.[key];
const form = { preventDefault: vi.fn() };

const renderPanel = async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(<QueryClientProvider client={client}><AdminPanel /></QueryClientProvider>);
  await waitFor(() => expect(prop('painel', 'isLoadingMacro')).toBe(false));
  return utils;
};
const abrir = (nome: RegExp) => fireEvent.click(screen.getByRole('button', { name: nome }));

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(h.props)) delete h.props[k];
  rs.getHistory.mockResolvedValue([{ _id: 'r1' }]);
  rs.getMacroData.mockResolvedValue({ selic: { value: 15 } });
  rs.getRadarStats.mockResolvedValue({ backtestHorizon: 14 });
  rs.getDataQualityStats.mockResolvedValue({ total: 3 });
  rs.getAlgorithmAccuracy.mockResolvedValue([{ date: '2026-11-20T12:00:00Z', avgReturn: 1.5, benchmarkReturn: 0.7 }]);
  rs.getDiscardLogs.mockResolvedValue([{ ticker: 'XPTO3' }]);
  rs.getPublishStatus.mockResolvedValue([]);
  vi.mocked(supportService.adminSummary).mockResolvedValue({ waiting: 3 });
  vi.mocked(healthService.getDataHealth).mockResolvedValue({ report: { status: 'CRITICAL' } });
  h.confirm.mockResolvedValue(true);
});

describe('abertura', () => {
  it('carrega os dados iniciais e repassa ao Painel, com a acurácia normalizada', async () => {
    await renderPanel();
    expect(prop('painel', 'macroData')).toEqual({ selic: { value: 15 } });
    expect(prop('painel', 'qualityStats')).toEqual({ total: 3 });
    await waitFor(() => expect(prop('painel', 'accuracyData')).toHaveLength(1));
    const [ponto] = prop('painel', 'accuracyData') as Record<string, unknown>[];
    expect(ponto).toMatchObject({ formattedDate: '20/11/2026', equityReturn: 1.5, ibovReturn: 0.7, spxReturn: 0, holdingsCount: 0 });
    // BRASIL_10 não leva perfil; outras classes levam.
    expect(rs.getAlgorithmAccuracy).toHaveBeenLastCalledWith('BRASIL_10', 30, undefined);
    await act(async () => { (prop('painel', 'setAccuracyAsset') as (v: string) => void)('STOCK'); });
    await waitFor(() => expect(rs.getAlgorithmAccuracy).toHaveBeenLastCalledWith('STOCK', 30, 'MODERATE'));
  });

  it('macro vazio vira null (o Painel mostra o estado de "sem dados")', async () => {
    rs.getMacroData.mockResolvedValue({});
    await renderPanel();
    expect(prop('painel', 'macroData')).toBeNull();
  });

  it('badges: número do Suporte e alerta crítico na Saúde', async () => {
    await renderPanel();
    expect(await screen.findByTitle('3 ticket(s) aguardando resposta')).toHaveTextContent('3');
    expect(await screen.findByTitle('Problema crítico nos dados')).toBeInTheDocument();
  });

  it('saúde OK e fila vazia: nenhum badge', async () => {
    vi.mocked(supportService.adminSummary).mockResolvedValue({ waiting: 0 });
    vi.mocked(healthService.getDataHealth).mockResolvedValue({ report: { status: 'OK' } });
    await renderPanel();
    await waitFor(() => expect(healthService.getDataHealth).toHaveBeenCalled());
    expect(screen.queryByTitle(/aguardando resposta/)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/saúde dos dados|crítico/)).not.toBeInTheDocument();
  });

  it('troca de aba mostra só a aba escolhida, sem violações de acessibilidade', async () => {
    const { container } = await renderPanel();
    abrir(/Funil/);
    expect(screen.getByTestId('aba-funil')).toBeInTheDocument();
    expect(screen.queryByTestId('aba-painel')).not.toBeInTheDocument();
    abrir(/Saúde/);
    expect(screen.getByTestId('aba-saude')).toBeInTheDocument();
    abrir(/Suporte/);
    expect(screen.getByTestId('aba-suporte')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('operações do Painel', () => {
  it('sincronizar mercado: sucesso recarrega macro e config', async () => {
    await renderPanel();
    rs.syncMarketData.mockResolvedValue(undefined);
    await call('painel', 'onSyncData');
    expect(screen.getByText('Banco de Dados atualizado! Cotações sincronizadas.')).toBeInTheDocument();
    expect(rs.getMacroData).toHaveBeenCalledTimes(2);
  });

  it('sincronizar mercado: erro mostra a mensagem do servidor', async () => {
    await renderPanel();
    rs.syncMarketData.mockRejectedValue(new Error('Lease ocupado'));
    await call('painel', 'onSyncData');
    expect(screen.getByText('Lease ocupado')).toBeInTheDocument();
  });

  it('sync macro, reset de saúde e séries temporais mostram o resultado', async () => {
    await renderPanel();
    rs.syncMacro.mockResolvedValue(undefined);
    await call('painel', 'onMacroSync');
    expect(screen.getByText('Indicadores e S&P 500 atualizados com sucesso.')).toBeInTheDocument();

    rs.resetAssetHealth.mockResolvedValue({ reactivated: 12 });
    await call('painel', 'onResetHealth');
    expect(screen.getByText('12 ativos reativados com sucesso.')).toBeInTheDocument();

    rs.resetAssetHealth.mockRejectedValue(new Error('x'));
    await call('painel', 'onResetHealth');
    expect(screen.getByText('Erro ao resetar saúde dos ativos.')).toBeInTheDocument();

    rs.syncTimeSeries.mockResolvedValue({});
    await call('painel', 'onSyncTimeSeries');
    expect(screen.getByText('Séries temporais atualizadas.')).toBeInTheDocument();

    rs.syncMacro.mockRejectedValue('timeout');
    await call('painel', 'onMacroSync');
    expect(screen.getByText('timeout')).toBeInTheDocument();
  });

  it('snapshot forçado: negado no confirm não roda; confirmado mostra os números', async () => {
    await renderPanel();
    h.confirm.mockResolvedValueOnce(false);
    await call('painel', 'onForceSnapshot');
    expect(rs.triggerSnapshot).not.toHaveBeenCalled();

    rs.triggerSnapshot.mockResolvedValue({ stats: { created: 40, skipped: 2 } });
    await call('painel', 'onForceSnapshot');
    expect(rs.triggerSnapshot).toHaveBeenCalledWith(true);
    expect(screen.getByText('Snapshot executado. Criados: 40, Ignorados: 2')).toBeInTheDocument();
  });
});

describe('operações de publicação', () => {
  it('protocolo completo: sucesso e falha', async () => {
    await renderPanel();
    abrir(/Operações/);
    rs.runFullPipeline.mockResolvedValue(undefined);
    await call('operacoes', 'onGlobalRun');
    expect(screen.getByText('Protocolo V3 Completo finalizado com sucesso!')).toBeInTheDocument();
    rs.runFullPipeline.mockRejectedValue(new Error('Gemini fora'));
    await call('operacoes', 'onGlobalRun');
    expect(screen.getByText('Gemini fora')).toBeInTheDocument();
  });

  it('publicar pendentes sem draft avisa que não há o que publicar', async () => {
    await renderPanel();
    abrir(/Operações/);
    await call('operacoes', 'onPublishAllPending');
    expect(screen.getByText('Nenhum draft pendente para publicar.')).toBeInTheDocument();
    expect(rs.publish).not.toHaveBeenCalled();
  });

  it('publicar pendentes reporta falha parcial e seções puladas, sem fingir sucesso', async () => {
    rs.getPublishStatus.mockResolvedValue([
      { assetClass: 'STOCK', readyToPublish: true, latestId: 's1' },
      { assetClass: 'FII', readyToPublish: true, latestId: 'f1' },
      { assetClass: 'CRYPTO', readyToPublish: true, latestId: 'c1' },
      { assetClass: 'ETF', readyToPublish: false, latestId: 'e1' },
    ]);
    rs.publish.mockImplementation(async (id: string) => {
      if (id === 's1') return { activated: ['RANKING'], skipped: ['MORNING_CALL'] };
      if (id === 'f1') return { activated: [], skipped: [] };
      throw new Error('429');
    });
    await renderPanel();
    abrir(/Operações/);
    await waitFor(() => expect(prop('operacoes', 'publishStatus')).toHaveLength(4));
    await call('operacoes', 'onPublishAllPending');
    expect(rs.publish).toHaveBeenCalledTimes(3);
    expect(rs.publish).toHaveBeenCalledWith('s1', 'ALL', { partial: true });
    expect(screen.getByText(/^1\/3 publicadas\. Sem conteúdo, não publicado: Morning Call\. Falhas — FII: nenhuma seção com conteúdo \| CRYPTO: 429$/))
      .toBeInTheDocument();
  });

  it('publicar pendentes tudo certo mostra quantas classes subiram', async () => {
    rs.getPublishStatus.mockResolvedValue([{ assetClass: 'STOCK', readyToPublish: true, latestId: 's1' }]);
    rs.publish.mockResolvedValue({ activated: ['RANKING', 'REPORT'] });
    await renderPanel();
    abrir(/Operações/);
    await waitFor(() => expect(prop('operacoes', 'publishStatus')).toHaveLength(1));
    await call('operacoes', 'onPublishAllPending');
    expect(screen.getByText('1 classe(s) publicadas com sucesso!')).toBeInTheDocument();
  });

  it('publicação granular: sucesso e falha', async () => {
    await renderPanel();
    abrir(/Operações/);
    rs.publish.mockResolvedValue({});
    await call('operacoes', 'onPublishGranular', 'r1', 'RANKING');
    expect(rs.publish).toHaveBeenCalledWith('r1', 'RANKING');
    expect(screen.getByText('Publicado com sucesso.')).toBeInTheDocument();
    rs.publish.mockRejectedValue(new Error(''));
    await call('operacoes', 'onPublishGranular', 'r1', 'REPORT');
    expect(screen.getByText('Falha ao publicar.')).toBeInTheDocument();
  });

  it('prompt da IA: carrega, gera com o texto editado e fecha', async () => {
    rs.getReportDetails.mockResolvedValue({ explainableAIPrompt: 'PROMPT', generatedExplainableAI: 'antigo' });
    await renderPanel();
    abrir(/Operações/);
    await call('operacoes', 'onViewPrompt', 'r1', 'STOCK');
    expect(prop('operacoes', 'promptModal')).toEqual({ open: true, id: 'r1', prompt: 'PROMPT', generatedAI: 'antigo', assetClass: 'STOCK' });
    expect(prop('operacoes', 'localGeneratedText')).toBe('antigo');

    await act(async () => {
      (prop('operacoes', 'setLocalGeneratedText') as (v: string) => void)('editado à mão');
      (prop('operacoes', 'setUserHasEdited') as (v: boolean) => void)(true);
    });
    rs.generateExplainableAI.mockResolvedValue({ generatedExplainableAI: 'novo' });
    await call('operacoes', 'onGenerateExplainableAI');
    expect(rs.generateExplainableAI).toHaveBeenCalledWith('r1', 'editado à mão');
    expect(prop('operacoes', 'localGeneratedText')).toBe('novo');
    expect(screen.getByText('Explainable IA salvo com sucesso!')).toBeInTheDocument();

    await call('operacoes', 'onClosePromptModal');
    expect((prop('operacoes', 'promptModal') as { open: boolean }).open).toBe(false);
  });

  it('prompt que falha fecha o modal e avisa por toast', async () => {
    rs.getReportDetails.mockRejectedValue(new Error('404'));
    await renderPanel();
    abrir(/Operações/);
    await call('operacoes', 'onViewPrompt', 'r1', 'FII');
    expect((prop('operacoes', 'promptModal') as { open: boolean }).open).toBe(false);
    expect(h.addToast).toHaveBeenCalledWith('Erro ao carregar prompt.', 'error');
  });

  it('auditoria abre carregando, mostra o relatório e fecha com toast se falhar', async () => {
    await renderPanel();
    abrir(/Operações/);
    rs.getReportDetails.mockResolvedValue({ _id: 'r1' });
    await call('operacoes', 'onOpenAudit', 'r1');
    expect(screen.getByTestId('auditoria')).toHaveTextContent('relatório r1');

    rs.getReportDetails.mockRejectedValue(new Error('sem permissão'));
    await call('operacoes', 'onOpenAudit', 'r2');
    expect(screen.queryByTestId('auditoria')).not.toBeInTheDocument();
    expect(h.addToast).toHaveBeenCalledWith('sem permissão', 'error');
  });
});

describe('Ferramentas', () => {
  it('backtest: salva o horizonte e mostra o erro quando falha', async () => {
    await renderPanel();
    abrir(/Ferramentas/);
    expect(prop('ferramentas', 'backtestDays')).toBe(14);
    rs.updateBacktestConfig.mockResolvedValue(undefined);
    await call('ferramentas', 'onSaveBacktestConfig', 30);
    expect(prop('ferramentas', 'backtestDays')).toBe(30);
    expect(screen.getByText('Horizonte de backtest atualizado para 30 dias.')).toBeInTheDocument();
    rs.updateBacktestConfig.mockRejectedValue(new Error('x'));
    await call('ferramentas', 'onSaveBacktestConfig', 60);
    expect(screen.getByText('Erro ao salvar configuração.')).toBeInTheDocument();
  });

  it('limpar radar respeita o confirm e reporta o resultado', async () => {
    await renderPanel();
    abrir(/Ferramentas/);
    h.confirm.mockResolvedValueOnce(false);
    await call('ferramentas', 'onClearRadarHistory');
    expect(rs.clearSignalsHistory).not.toHaveBeenCalled();
    rs.clearSignalsHistory.mockResolvedValue(undefined);
    await call('ferramentas', 'onClearRadarHistory');
    expect(screen.getByText('Histórico do Radar limpo com sucesso.')).toBeInTheDocument();
    rs.clearSignalsHistory.mockRejectedValue(new Error('x'));
    await call('ferramentas', 'onClearRadarHistory');
    expect(screen.getByText('Erro ao limpar histórico.')).toBeInTheDocument();
  });

  it('cache: sem ticker não busca; com ticker repassa o resultado', async () => {
    await renderPanel();
    abrir(/Ferramentas/);
    await call('ferramentas', 'onCacheSearch', form);
    expect(marketService.getAssetCacheStatus).not.toHaveBeenCalled();
    await act(async () => { (prop('ferramentas', 'setCacheSearchTicker') as (v: string) => void)('PETR4'); });
    vi.mocked(marketService.getAssetCacheStatus).mockResolvedValue({ ticker: 'PETR4', status: 'CACHED' });
    await call('ferramentas', 'onCacheSearch', form);
    expect(marketService.getAssetCacheStatus).toHaveBeenCalledWith('PETR4');
    expect(prop('ferramentas', 'cacheData')).toEqual({ ticker: 'PETR4', status: 'CACHED' });
  });

  it('split: confirmado chama a API; resposta não-ok mostra a mensagem dela', async () => {
    await renderPanel();
    abrir(/Ferramentas/);
    await call('ferramentas', 'onFixSplit', form);
    expect(h.confirm).not.toHaveBeenCalled();
    await act(async () => { (prop('ferramentas', 'setSplitTicker') as (v: string) => void)('mglu3'); });
    const api = vi.mocked(authService.api);
    api.mockResolvedValueOnce({ ok: true, json: async () => ({ message: 'Split aplicado', details: { updates: 7 } }) } as Response);
    await call('ferramentas', 'onFixSplit', form);
    expect(h.confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('MGLU3') }));
    expect(api).toHaveBeenCalledWith('/api/wallet/fix-splits', { method: 'POST', body: JSON.stringify({ ticker: 'mglu3', type: 'STOCK' }) });
    expect(screen.getByText('Split aplicado (7 afetados)')).toBeInTheDocument();

    api.mockResolvedValueOnce({ ok: false, json: async () => ({ message: 'Ticker desconhecido' }) } as Response);
    await call('ferramentas', 'onFixSplit', form);
    expect(screen.getByText('Ticker desconhecido')).toBeInTheDocument();
  });

  it('pagamento de teste abre o link do checkout em nova aba', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    await renderPanel();
    abrir(/Ferramentas/);
    vi.mocked(subscriptionService.testCheckout).mockResolvedValue({ redirectUrl: 'https://mp.test/checkout' });
    await call('ferramentas', 'onTestPayment', 'PRO', 'RECURRING', 'ANNUAL');
    expect(subscriptionService.testCheckout).toHaveBeenCalledWith('PRO', 'RECURRING', 'ANNUAL');
    expect(open).toHaveBeenCalledWith('https://mp.test/checkout', '_blank');

    vi.mocked(subscriptionService.testCheckout).mockRejectedValue(new Error('token de teste ausente'));
    await call('ferramentas', 'onTestPayment', 'ELITE');
    expect(subscriptionService.testCheckout).toHaveBeenLastCalledWith('ELITE', 'ONE_TIME', 'MONTHLY');
    expect(screen.getByText('token de teste ausente')).toBeInTheDocument();
    open.mockRestore();
  });
});
