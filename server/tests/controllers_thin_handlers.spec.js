/**
 * Controllers finos — config (tunables), rebalanceamento, saúde dos dados,
 * importação de carteira e mercado. São cascas sobre serviços, então o contrato
 * que importa é o HTTP: status, corpo JSON e o que vai para o error handler.
 *
 * Sem banco: models, mongoose e serviços mockados (o `.env` local aponta para
 * produção).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';

const h = vi.hoisted(() => {
    const chain = (value) => {
        const q = {};
        for (const m of ['sort', 'limit', 'select', 'lean']) q[m] = vi.fn(() => q);
        q.exec = () => (value instanceof Error ? Promise.reject(value) : Promise.resolve(value));
        q.then = (ok, fail) => q.exec().then(ok, fail);
        return q;
    };
    return { chain };
});

vi.mock('mongoose', () => ({
    default: {
        Types: { ObjectId: { isValid: (id) => /^[0-9a-f]{24}$/i.test(String(id)) } },
        connect: vi.fn(() => { throw new Error('conexão real proibida em teste'); }),
    },
}));
vi.mock('../services/holidayService.js', () => ({
    holidayService: { sync: vi.fn(async () => true), isHoliday: () => false },
}));
vi.mock('../config/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../services/configService.js', () => ({ describeTunables: vi.fn(), updateTunables: vi.fn() }));
vi.mock('../services/rebalanceService.js', () => ({ rebalanceService: { generatePlan: vi.fn() } }));
vi.mock('../models/ErrorLog.js', () => ({ default: { find: vi.fn(), countDocuments: vi.fn(), findByIdAndUpdate: vi.fn() } }));
vi.mock('../models/JobRun.js', () => ({ default: { aggregate: vi.fn() } }));
vi.mock('../services/dataHealthService.js', () => ({
    getHealthHistory: vi.fn(), getLatestHealthReport: vi.fn(), getLiveSourceStatuses: vi.fn(), runDataHealthCheck: vi.fn(),
}));
vi.mock('../services/portfolioImportService.js', () => ({
    resolveRows: vi.fn(), applyImport: vi.fn(), undoImport: vi.fn(),
    ROW_STATUS: { OK: 'ok', DUPLICADO: 'duplicado', ATENCAO: 'atencao', NAO_RECONHECIDO: 'nao_reconhecido' },
}));
vi.mock('../models/ImportBatch.js', () => ({ default: { find: vi.fn() } }));
vi.mock('../services/marketDataService.js', () => ({
    marketDataService: { getPriceAtDate: vi.fn(), getMarketDataByTicker: vi.fn() },
}));
vi.mock('../services/logoService.js', () => ({ logoService: { getOrFetch: vi.fn() } }));
vi.mock('../models/AssetHistory.js', () => ({ default: { findOne: vi.fn() } }));
vi.mock('../models/SystemConfig.js', () => ({ default: { findOne: vi.fn() } }));
vi.mock('../models/MarketAsset.js', () => ({ default: { findOne: vi.fn(), find: vi.fn() } }));
vi.mock('../models/MarketAnalysis.js', () => ({ default: { findOne: vi.fn() } }));

const { describeTunables, updateTunables } = await import('../services/configService.js');
const { rebalanceService } = await import('../services/rebalanceService.js');
const ErrorLog = (await import('../models/ErrorLog.js')).default;
const JobRun = (await import('../models/JobRun.js')).default;
const dataHealth = await import('../services/dataHealthService.js');
const importService = await import('../services/portfolioImportService.js');
const ImportBatch = (await import('../models/ImportBatch.js')).default;
const { marketDataService } = await import('../services/marketDataService.js');
const { logoService } = await import('../services/logoService.js');
const AssetHistory = (await import('../models/AssetHistory.js')).default;
const SystemConfig = (await import('../models/SystemConfig.js')).default;
const MarketAsset = (await import('../models/MarketAsset.js')).default;
const MarketAnalysis = (await import('../models/MarketAnalysis.js')).default;
const { JOB_CATALOG } = await import('../config/jobCatalog.js');

const configCtrl = await import('../controllers/configController.js');
const rebalanceCtrl = await import('../controllers/rebalanceController.js');
const healthCtrl = await import('../controllers/healthController.js');
const importCtrl = await import('../controllers/importController.js');
const marketCtrl = await import('../controllers/marketController.js');

const { chain } = h;

const mockRes = () => {
    const res = { statusCode: 200, body: undefined, headers: {}, sent: undefined, ended: false };
    res.status = vi.fn((c) => { res.statusCode = c; return res; });
    res.json = vi.fn((b) => { res.body = b; return res; });
    res.set = vi.fn((k, v) => { res.headers[k] = v; return res; });
    res.send = vi.fn((b) => { res.sent = b; return res; });
    res.end = vi.fn(() => { res.ended = true; return res; });
    return res;
};

const call = async (handler, req = {}) => {
    const res = mockRes();
    const next = vi.fn();
    await handler({ user: { id: 'u1' }, walletId: 'w1', query: {}, params: {}, body: {}, headers: {}, ...req }, res, next);
    return { res, next };
};

const NOW = new Date('2026-11-24T18:00:00.000Z');
beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
});
afterAll(() => vi.useRealTimers());
beforeEach(() => vi.clearAllMocks());

describe('configController — tunables', () => {
    it('GET devolve os tunables descritos', async () => {
        describeTunables.mockResolvedValue([{ key: 'X', value: 1 }]);
        const { res } = await call(configCtrl.getTunablesHandler);
        expect(res.body).toEqual({ tunables: [{ key: 'X', value: 1 }] });
    });

    it('GET com erro vai para o error handler', async () => {
        describeTunables.mockRejectedValue(new Error('falhou'));
        const { next } = await call(configCtrl.getTunablesHandler);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'falhou' }));
    });

    it('PUT grava e devolve os valores atualizados', async () => {
        updateTunables.mockResolvedValue({ X: 2 });
        const { res } = await call(configCtrl.updateTunablesHandler, { body: { X: 2 } });
        expect(updateTunables).toHaveBeenCalledWith({ X: 2 });
        expect(res.body).toEqual({ message: 'Configurações atualizadas.', tunables: { X: 2 } });
    });

    it('PUT sem corpo manda objeto vazio ao serviço', async () => {
        updateTunables.mockResolvedValue({});
        await call(configCtrl.updateTunablesHandler, { body: undefined });
        expect(updateTunables).toHaveBeenCalledWith({});
    });

    it('PUT com valor inválido responde 400 com a mensagem do serviço', async () => {
        updateTunables.mockRejectedValue(Object.assign(new Error('X fora do intervalo'), { status: 400 }));
        const { res, next } = await call(configCtrl.updateTunablesHandler, { body: { X: -1 } });
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ message: 'X fora do intervalo' });
        expect(next).not.toHaveBeenCalled();
    });

    it('PUT com erro inesperado vai para o error handler', async () => {
        updateTunables.mockRejectedValue(new Error('Mongo fora'));
        const { next } = await call(configCtrl.updateTunablesHandler, { body: {} });
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Mongo fora' }));
    });
});

describe('rebalanceController', () => {
    it('perfil padrão é MODERATE e o plano volta como veio', async () => {
        rebalanceService.generatePlan.mockResolvedValue({ orders: [] });
        const { res } = await call(rebalanceCtrl.generateRebalancePlan, { body: undefined });
        expect(rebalanceService.generatePlan).toHaveBeenCalledWith('u1', 'w1', 'MODERATE');
        expect(res.body).toEqual({ orders: [] });
    });

    it('respeita o perfil pedido', async () => {
        rebalanceService.generatePlan.mockResolvedValue({ orders: [{ ticker: 'PETR4' }] });
        await call(rebalanceCtrl.generateRebalancePlan, { body: { riskProfile: 'BOLD' } });
        expect(rebalanceService.generatePlan).toHaveBeenCalledWith('u1', 'w1', 'BOLD');
    });

    it('erro vai para o error handler', async () => {
        rebalanceService.generatePlan.mockRejectedValue(new Error('sem carteira'));
        const { next } = await call(rebalanceCtrl.generateRebalancePlan);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'sem carteira' }));
    });
});

describe('healthController — saúde dos dados', () => {
    const sources = { sources: [{ id: 'yahoo' }], summary: { ok: 1 }, groups: ['g'], chains: { c: 1 }, suspects: [] };

    it('monta jobs a partir do CATÁLOGO, inclusive os que nunca rodaram', async () => {
        const [firstJob] = Object.keys(JOB_CATALOG);
        dataHealth.getLatestHealthReport.mockResolvedValue({ score: 90 });
        dataHealth.getHealthHistory.mockResolvedValue([{ at: 2 }, { at: 1 }]);
        dataHealth.getLiveSourceStatuses.mockResolvedValue(sources);
        JobRun.aggregate.mockResolvedValue([{
            _id: firstJob, lastRunAt: NOW, lastStatus: 'SUCCESS', lastError: null, lastDurationMs: 0, runs24h: 3, failures24h: 1,
        }]);

        const { res } = await call(healthCtrl.getDataHealth, { query: { limit: '10' } });

        expect(dataHealth.getHealthHistory).toHaveBeenCalledWith('10');
        expect(res.body.report).toEqual({ score: 90 });
        expect(res.body.history).toEqual([{ at: 1 }, { at: 2 }]);
        expect(res.body.jobs).toHaveLength(Object.keys(JOB_CATALOG).length);
        const ran = res.body.jobs.find((j) => j.jobId === firstJob);
        expect(ran).toMatchObject({ lastStatus: 'SUCCESS', lastDurationMs: 0, runs24h: 3, failures24h: 1 });
        const never = res.body.jobs.find((j) => j.jobId !== firstJob);
        expect(never).toMatchObject({ lastRunAt: null, lastStatus: null, lastDurationMs: null, runs24h: 0, failures24h: 0 });
        expect(res.body).toMatchObject({
            sources: sources.sources, sourceSummary: sources.summary, sourceGroups: sources.groups,
            sourceChains: sources.chains, quoteSuspects: sources.suspects,
        });
    });

    it('sem relatório persistido devolve report nulo', async () => {
        dataHealth.getLatestHealthReport.mockResolvedValue(undefined);
        dataHealth.getHealthHistory.mockResolvedValue([]);
        dataHealth.getLiveSourceStatuses.mockResolvedValue(sources);
        JobRun.aggregate.mockResolvedValue([]);

        const { res } = await call(healthCtrl.getDataHealth);

        expect(res.body.report).toBeNull();
    });

    it('erro vai para o error handler', async () => {
        dataHealth.getLatestHealthReport.mockRejectedValue(new Error('falhou'));
        dataHealth.getHealthHistory.mockResolvedValue([]);
        dataHealth.getLiveSourceStatuses.mockResolvedValue(sources);
        JobRun.aggregate.mockResolvedValue([]);
        const { next } = await call(healthCtrl.getDataHealth);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'falhou' }));
    });

    it('recalcular: 503 quando a avaliação não sai, 200 com o relatório quando sai', async () => {
        dataHealth.runDataHealthCheck.mockResolvedValueOnce(null);
        const falhou = await call(healthCtrl.runDataHealth);
        expect(falhou.res.statusCode).toBe(503);
        expect(dataHealth.runDataHealthCheck).toHaveBeenCalledWith({ trigger: 'MANUAL' });

        dataHealth.runDataHealthCheck.mockResolvedValueOnce({ score: 80 });
        const ok = await call(healthCtrl.runDataHealth);
        expect(ok.res.body).toEqual({ message: 'Saúde dos dados reavaliada.', report: { score: 80 } });

        dataHealth.runDataHealthCheck.mockRejectedValueOnce(new Error('falhou'));
        const erro = await call(healthCtrl.runDataHealth);
        expect(erro.next).toHaveBeenCalledWith(expect.objectContaining({ message: 'falhou' }));
    });

    it('lista erros não resolvidos por padrão, com limite saneado', async () => {
        const find = chain([{ message: 'x' }]);
        ErrorLog.find.mockReturnValue(find);
        ErrorLog.countDocuments.mockResolvedValue(7);

        const { res } = await call(healthCtrl.listErrors, { query: { limit: '9999', origin: 'http' } });

        expect(ErrorLog.find).toHaveBeenCalledWith({ origin: 'HTTP', resolvedAt: null });
        expect(find.limit).toHaveBeenCalledWith(200);
        expect(res.body).toEqual({ errors: [{ message: 'x' }], unresolvedCount: 7 });
    });

    it('includeResolved=true lista também os resolvidos; limite inválido vira 50', async () => {
        const find = chain([]);
        ErrorLog.find.mockReturnValue(find);
        ErrorLog.countDocuments.mockResolvedValue(0);

        await call(healthCtrl.listErrors, { query: { includeResolved: 'true', limit: 'abc' } });

        expect(ErrorLog.find).toHaveBeenCalledWith({});
        expect(find.limit).toHaveBeenCalledWith(50);
    });

    it('listErrors com erro vai para o error handler', async () => {
        ErrorLog.find.mockImplementation(() => { throw new Error('falhou'); });
        const { next } = await call(healthCtrl.listErrors);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'falhou' }));
    });

    it('resolver erro: 400 para id inválido, 404 inexistente, 200 marcado', async () => {
        const bad = await call(healthCtrl.resolveError, { params: { id: 'abc' } });
        expect(bad.res.statusCode).toBe(400);
        expect(ErrorLog.findByIdAndUpdate).not.toHaveBeenCalled();

        const id = '0123456789abcdef01234567';
        ErrorLog.findByIdAndUpdate.mockReturnValueOnce(chain(null));
        const missing = await call(healthCtrl.resolveError, { params: { id } });
        expect(missing.res.statusCode).toBe(404);

        ErrorLog.findByIdAndUpdate.mockReturnValueOnce(chain({ _id: id, resolvedAt: NOW }));
        const ok = await call(healthCtrl.resolveError, { params: { id } });
        expect(ErrorLog.findByIdAndUpdate).toHaveBeenLastCalledWith(id, { $set: { resolvedAt: NOW } }, { new: true });
        expect(ok.res.body).toEqual({ message: 'Erro marcado como tratado.', error: { _id: id, resolvedAt: NOW } });

        ErrorLog.findByIdAndUpdate.mockImplementationOnce(() => { throw new Error('falhou'); });
        const erro = await call(healthCtrl.resolveError, { params: { id } });
        expect(erro.next).toHaveBeenCalledWith(expect.objectContaining({ message: 'falhou' }));
    });
});

describe('importController — importação de carteira', () => {
    it('preview resolve as linhas e conta por status, sem gravar', async () => {
        importService.resolveRows.mockResolvedValue({
            rows: [{ status: 'ok' }, { status: 'ok' }, { status: 'duplicado' }, { status: 'nao_reconhecido' }],
            summary: { positions: 2 },
        });

        const { res } = await call(importCtrl.previewImport, { body: { rows: [{ ticker: 'PETR4' }] } });

        expect(importService.resolveRows).toHaveBeenCalledWith({ userId: 'u1', walletId: 'w1', rows: [{ ticker: 'PETR4' }] });
        expect(res.body.counts).toEqual({ total: 4, ok: 2, duplicado: 1, atencao: 0, naoReconhecido: 1 });
        expect(res.body.summary).toEqual({ positions: 2 });
        expect(importService.applyImport).not.toHaveBeenCalled();
    });

    it('preview com erro vai para o error handler', async () => {
        importService.resolveRows.mockRejectedValue(new Error('falhou'));
        const { next } = await call(importCtrl.previewImport, { body: { rows: [] } });
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'falhou' }));
    });

    it('commit grava o lote e responde 201', async () => {
        importService.applyImport.mockResolvedValue({ batchId: 'b1', inserted: 3, tickers: ['PETR4'], failures: [] });

        const { res } = await call(importCtrl.commitImport, {
            body: { rows: [{ ticker: 'PETR4', date: '2026-11-24' }], source: 'B3' },
        });

        expect(res.statusCode).toBe(201);
        expect(res.body).toEqual({ message: '3 lançamento(s) importado(s).', batchId: 'b1', inserted: 3, tickers: ['PETR4'], failures: [] });
    });

    it('commit com lançamento no futuro (Brasília) é recusado com 400 sem gravar', async () => {
        const { next } = await call(importCtrl.commitImport, {
            body: { rows: [{ ticker: 'PETR4', date: '2026-11-24' }, { ticker: 'VALE3', date: '2026-11-25' }], source: 'B3' },
        });

        expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 400, message: expect.stringContaining('2026-11-25') }));
        expect(importService.applyImport).not.toHaveBeenCalled();
    });

    it('desfazer: 404 quando o lote não é desta carteira, 200 com a contagem quando é', async () => {
        importService.undoImport.mockResolvedValueOnce(null);
        const missing = await call(importCtrl.revertImport, { params: { batchId: 'b9' } });
        expect(missing.next).toHaveBeenCalledWith(expect.objectContaining({ status: 404 }));

        importService.undoImport.mockResolvedValueOnce({ batchId: 'b1', removed: 3 });
        const ok = await call(importCtrl.revertImport, { params: { batchId: 'b1' } });
        expect(importService.undoImport).toHaveBeenLastCalledWith({ userId: 'u1', walletId: 'w1', batchId: 'b1' });
        expect(ok.res.body).toEqual({ message: '3 lançamento(s) removido(s).', batchId: 'b1', removed: 3 });
    });

    it('lista os lotes da carteira no formato da tela', async () => {
        const createdAt = new Date('2026-11-20T10:00:00.000Z');
        ImportBatch.find.mockReturnValue(chain([
            { _id: { toString: () => 'b1' }, source: 'B3', rowCount: 3, tickers: ['PETR4'], createdAt, undoneAt: null, extra: 'x' },
        ]));

        const { res } = await call(importCtrl.listImports);

        expect(ImportBatch.find).toHaveBeenCalledWith({ user: 'u1', wallet: 'w1' });
        expect(res.body).toEqual([{ id: 'b1', source: 'B3', rowCount: 3, tickers: ['PETR4'], createdAt, undoneAt: null }]);
    });

    it('listar com erro vai para o error handler', async () => {
        ImportBatch.find.mockImplementation(() => { throw new Error('falhou'); });
        const { next } = await call(importCtrl.listImports);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'falhou' }));
    });
});

describe('marketController', () => {
    it('preço histórico: 400 sem parâmetros, 404 sem dado, 200 com dado', async () => {
        const bad = await call(marketCtrl.getHistoricalPrice, { query: { ticker: 'PETR4' } });
        expect(bad.res.statusCode).toBe(400);

        marketDataService.getPriceAtDate.mockResolvedValueOnce(null);
        const missing = await call(marketCtrl.getHistoricalPrice, { query: { ticker: 'PETR4', date: '2026-01-02', type: 'STOCK' } });
        expect(missing.res.statusCode).toBe(404);

        marketDataService.getPriceAtDate.mockResolvedValueOnce({ price: 37.1 });
        const ok = await call(marketCtrl.getHistoricalPrice, { query: { ticker: 'PETR4', date: '2026-01-02', type: 'STOCK' } });
        expect(marketDataService.getPriceAtDate).toHaveBeenLastCalledWith('PETR4', '2026-01-02', 'STOCK');
        expect(ok.res.body).toEqual({ price: 37.1 });

        marketDataService.getPriceAtDate.mockRejectedValueOnce(new Error('falhou'));
        const erro = await call(marketCtrl.getHistoricalPrice, { query: { ticker: 'PETR4', date: '2026-01-02', type: 'STOCK' } });
        expect(erro.next).toHaveBeenCalledWith(expect.objectContaining({ message: 'falhou' }));
    });

    it('cotação atual é leitura interativa (stale-while-revalidate)', async () => {
        const bad = await call(marketCtrl.getCurrentQuote);
        expect(bad.res.statusCode).toBe(400);

        marketDataService.getMarketDataByTicker.mockResolvedValueOnce({ price: 35 });
        const ok = await call(marketCtrl.getCurrentQuote, { query: { ticker: 'PETR4' } });
        expect(marketDataService.getMarketDataByTicker).toHaveBeenCalledWith('PETR4', { interactive: true });
        expect(ok.res.body).toEqual({ price: 35 });

        marketDataService.getMarketDataByTicker.mockRejectedValueOnce(new Error('falhou'));
        const erro = await call(marketCtrl.getCurrentQuote, { query: { ticker: 'PETR4' } });
        expect(erro.next).toHaveBeenCalled();
    });

    it('status do ativo: cache de histórico, só ao vivo, ou inexistente', async () => {
        const updatedAt = new Date('2026-11-24T12:00:00.000Z');
        MarketAsset.findOne.mockResolvedValueOnce({ type: 'STOCK', lastPrice: 35, updatedAt });
        AssetHistory.findOne.mockResolvedValueOnce({ lastUpdated: updatedAt, history: [1, 2, 3] });
        const cached = await call(marketCtrl.getAssetStatus, { params: { ticker: ' petr4 ' } });
        expect(MarketAsset.findOne).toHaveBeenCalledWith({ ticker: 'PETR4' });
        expect(cached.res.body).toMatchObject({
            ticker: 'PETR4', currentPrice: 35, historyStatus: 'CACHED', dataPoints: 3, status: 'CACHED', lastUpdated: updatedAt,
        });

        MarketAsset.findOne.mockResolvedValueOnce({ type: 'STOCK', lastPrice: 10, updatedAt });
        AssetHistory.findOne.mockResolvedValueOnce(null);
        const live = await call(marketCtrl.getAssetStatus, { params: { ticker: 'VALE3' } });
        expect(live.res.body).toMatchObject({ historyStatus: 'NOT_CACHED', dataPoints: 0, status: 'LIVE_ONLY' });

        MarketAsset.findOne.mockResolvedValueOnce(null);
        AssetHistory.findOne.mockResolvedValueOnce(null);
        const none = await call(marketCtrl.getAssetStatus, { params: { ticker: 'XXXX3' } });
        expect(none.res.body).toMatchObject({ currentPrice: 0, lastSync: null, status: 'NOT_FOUND' });

        MarketAsset.findOne.mockRejectedValueOnce(new Error('falhou'));
        const erro = await call(marketCtrl.getAssetStatus, { params: { ticker: 'PETR4' } });
        expect(erro.next).toHaveBeenCalledWith(expect.objectContaining({ message: 'falhou' }));
    });

    it('logo: 304 quando o navegador já tem a mesma versão', async () => {
        logoService.getOrFetch.mockResolvedValue({ bytes: 120, contentType: 'image/png', data: Buffer.from('x') });

        const { res } = await call(marketCtrl.getAssetLogo, {
            params: { ticker: 'PETR4' }, query: { type: 'stock' }, headers: { 'if-none-match': '"PETR4-STOCK-120"' },
        });

        expect(res.statusCode).toBe(304);
        expect(res.send).not.toHaveBeenCalled();
        expect(res.headers.ETag).toBe('"PETR4-STOCK-120"');
    });

    it('logo: erro do serviço vai para o error handler', async () => {
        logoService.getOrFetch.mockRejectedValue(new Error('falhou'));
        const { next } = await call(marketCtrl.getAssetLogo, { params: { ticker: 'PETR4' } });
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'falhou' }));
    });

    it('landing: macro, tickers e destaques com retorno MEDIDO do ranking publicado', async () => {
        SystemConfig.findOne.mockResolvedValue({ cdiReturn12m: 11.2, spxReturn12m: 18.5, ibovReturn12m: Number.NaN, spxChange: 0.4 });
        MarketAsset.find
            .mockReturnValueOnce(chain([
                { ticker: 'PETR4', lastPrice: 35, change: 1.2 },
                { ticker: 'BTC', lastPrice: 90000, change: undefined },
            ]))
            .mockReturnValueOnce(chain([{ ticker: 'WEGE3', lastPrice: 55 }]));
        MarketAnalysis.findOne.mockReturnValue(chain({
            date: new Date('2026-11-20T12:00:00.000Z'),
            content: {
                ranking: [
                    { ticker: 'WEGE3', action: 'BUY', score: 85, currentPrice: 50, thesis: 'Margem em alta' },
                    { ticker: 'ITUB4', action: 'BUY', score: 81 },
                    { ticker: 'MGLU3', action: 'WAIT', score: 90 },
                    { ticker: 'VALE3', action: 'BUY', score: 70 },
                ],
            },
        }));

        const { res } = await call(marketCtrl.getLandingData);

        expect(res.body.macro).toEqual({ cdi: 11.2, spx: 18.5, ibov: null, spxChange: 0.4 });
        expect(res.body.tickers).toEqual([{ ticker: 'PETR4', price: 35, change: 1.2 }, { ticker: 'BTC', price: 90000, change: 0 }]);
        expect(res.body.results.map((r) => r.ticker)).toEqual(['WEGE3', 'ITUB4']);
        expect(res.body.results[0]).toMatchObject({ type: 'LONG', returnVal: '+10.0%', desc: 'Margem em alta' });
        // Sem os dois preços não há retorno: nulo, nunca um número inventado.
        expect(res.body.results[1].returnVal).toBeNull();
        expect(res.body.results[1].desc).toContain('Alta convicção');
    });

    it('landing sem ranking publicado e sem macro: lista vazia e CDI pelo fallback', async () => {
        SystemConfig.findOne.mockResolvedValue(null);
        MarketAsset.find.mockReturnValueOnce(chain([]));
        MarketAnalysis.findOne.mockReturnValue(chain(null));

        const { res } = await call(marketCtrl.getLandingData);

        expect(res.body.results).toEqual([]);
        expect(res.body.macro.spx).toBeNull();
        expect(res.body.macro.cdi).toBeGreaterThan(0);
    });

    it('landing com erro vai para o error handler', async () => {
        SystemConfig.findOne.mockRejectedValue(new Error('falhou'));
        const { next } = await call(marketCtrl.getLandingData);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'falhou' }));
    });
});
