/**
 * Relatório TXT do ranking (reports/ranking_latest.txt).
 *
 * O arquivo é lido por gente (auditoria do ranking), então o que importa é o
 * conteúdo: número ausente aparece como N/D (nunca "NaN" ou "0.00" inventado),
 * moeda segue a classe, setor financeiro não mostra margem/EV que não se aplica
 * e a seção "fora do ranking" não repete quem já está no ranking. O `fs` é
 * falso: nada é gravado em disco.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fsMock = vi.hoisted(() => ({
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
}));

vi.mock('fs', () => ({ default: fsMock, ...fsMock }));

const { rankingTxtExportService } = await import('../services/rankingTxtExportService.js');

const gerar = async (allData, macro) => {
    const r = await rankingTxtExportService.saveRankingReport(allData, macro);
    expect(r.success).toBe(true);
    return fsMock.writeFileSync.mock.calls.at(-1)[1];
};

const STOCK_ITEM = {
    position: 1,
    previousPosition: 3,
    ticker: 'ITUB4',
    name: 'Itaú Unibanco',
    type: 'STOCK',
    sector: 'Bancos',
    action: 'BUY',
    tier: 'GOLD',
    riskProfile: 'DEFENSIVE',
    score: 82.345,
    scores: { DEFENSIVE: 82.3, MODERATE: 70, BOLD: 55.55 },
    currentPrice: 30,
    targetPrice: 36,
    isDividendAristocrat: true,
    thesis: 'Banco sólido',
    bullThesis: ['ROE alto'],
    bearThesis: ['Ciclo de crédito'],
    auditLog: [
        { category: 'Qualidade', factor: 'ROE > 15%', points: 10, type: 'bonus' },
        { category: 'Qualidade', factor: 'Base', points: 50, type: 'base' },
        { factor: 'Dívida', points: -5, type: 'penalty' },
        { category: 'Valuation', factor: 'Neutro', points: 0, type: 'bonus' },
    ],
    metrics: {
        fairPrice: 35.5,
        method: 'Graham',
        grahamPrice: 34,
        bazinPrice: null,
        pegRatio: NaN,
        marketCap: 3.2e11,
        avgLiquidity: 5.5e8,
        volatility: 22.5,
        beta: 0.9,
        pl: 8.5,
        pvp: 1.8,
        evEbitda: 6,
        netMargin: 20,
        ebitMargin: 25,
        roe: 21,
        patrimLiq: 1.5e12,
        netDebt: 5e6,
        netRevenue: 999,
        structural: { quality: 80.4, valuation: 60, risk: 70 },
        _staleDays: 12,
        _missing: { beta: false, dy: true, payout: true },
    },
};

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-22T15:30:00Z'));
    fsMock.existsSync.mockReset().mockReturnValue(true);
    fsMock.mkdirSync.mockReset();
    fsMock.writeFileSync.mockReset();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('gravação do arquivo', () => {
    it('grava sempre em ranking_latest.txt, em UTF-8', async () => {
        const r = await rankingTxtExportService.saveRankingReport({}, null);
        expect(r).toMatchObject({ success: true, filename: 'ranking_latest.txt' });
        expect(r.filePath.endsWith('ranking_latest.txt')).toBe(true);
        const [destino, , encoding] = fsMock.writeFileSync.mock.calls[0];
        expect(destino).toBe(r.filePath);
        expect(encoding).toBe('utf-8');
        expect(fsMock.mkdirSync).not.toHaveBeenCalled();
    });

    it('cria a pasta reports quando ela não existe', async () => {
        fsMock.existsSync.mockReturnValue(false);
        await rankingTxtExportService.saveRankingReport({}, null);
        expect(fsMock.mkdirSync).toHaveBeenCalledWith(expect.stringMatching(/reports$/), { recursive: true });
    });

    it('falha de disco vira { success:false, error } em vez de exceção', async () => {
        fsMock.writeFileSync.mockImplementation(() => { throw new Error('EACCES'); });
        const r = await rankingTxtExportService.saveRankingReport({}, null);
        expect(r).toEqual({ success: false, error: 'EACCES' });
    });
});

describe('cabeçalho e macro', () => {
    it('sem macro não imprime o bloco de contexto; com classe vazia avisa que não há ativo', async () => {
        const txt = await gerar({ FII: { ranking: [] } }, null);
        expect(txt).toContain('VÉRTICE INVEST — RANKING QUANTITATIVO');
        expect(txt).not.toContain('Contexto Macro');
        expect(txt).toContain('CLASSE: FIIs');
        expect(txt).toContain('(nenhum ativo no ranking para esta classe)');
        expect(txt).toContain('FIM DO RELATÓRIO');
    });

    it('macro ausente sai como N/D, variação positiva ganha sinal', async () => {
        const txt = await gerar({}, {
            selic: 10.5, cdi: null, ipca: 4.2, riskFree: undefined, ntnbLong: 6.1,
            dollar: 5.4, ibov: 125000.4, ibovChange: 1.25, btc: 90000, btcChange: -2,
        });
        expect(txt).toContain('SELIC:      10.50%');
        expect(txt).toContain('CDI:        N/D');
        expect(txt).toContain('Risk Free:  N/D');
        expect(txt).toMatch(/Dólar:\s+R\$\s5,40/);
        expect(txt).toContain('125000 pts (+1.25%)');
        expect(txt).toContain('$90000 (-2.00%)');
    });

    it('classes saem na ordem fixa, não na ordem do objeto', async () => {
        const txt = await gerar({ STOCK_US: { ranking: [] }, CRYPTO: { ranking: [] }, BRASIL_10: { ranking: [] } }, null);
        const iB10 = txt.indexOf('BRASIL 10');
        const iCripto = txt.indexOf('CRIPTOMOEDAS');
        const iUS = txt.indexOf('ATIVOS GLOBAIS (S&P 500)');
        expect(iB10).toBeGreaterThan(0);
        expect(iB10).toBeLessThan(iCripto);
        expect(iCripto).toBeLessThan(iUS);
    });
});

describe('item do ranking (ação de banco)', () => {
    let txt;
    beforeEach(async () => {
        txt = await gerar({
            STOCK: {
                ranking: [STOCK_ITEM, { ...STOCK_ITEM, position: 2, previousPosition: 1, ticker: 'BBAS3', action: 'WAIT', tier: 'SILVER' }],
                discardLogs: [{ assetType: 'STOCK', ticker: 'OIBR3', reason: 'Liquidez', details: '< 1M/dia' },
                    { assetType: 'FII', ticker: 'XPTO11', reason: 'Outro' }],
            },
        }, null);
    });

    it('resumo da classe conta tiers, compras e descartes só da classe', () => {
        expect(txt).toContain('Total no Ranking: 2   GOLD: 1  SILVER: 1  BRONZE: 0');
        expect(txt).toContain('COMPRAR: 1   AGUARDAR: 1   Descartados: 1');
    });

    it('rótulos de ação, tier, perfil e delta de posição', () => {
        expect(txt).toContain('✅ COMPRAR');
        expect(txt).toContain('🥇 GOLD');
        expect(txt).toContain('Perfil: Defensivo');
        expect(txt).toContain('⬆️ +2 (era #3)');
        expect(txt).toContain('⬇️ -1 (era #1)');
        expect(txt).toContain('Score:   82.3/100');
    });

    it('upside calculado sobre o preço atual e preço em reais', () => {
        expect(txt).toContain('Upside/Downside: +20.0%');
        expect(txt).toMatch(/Preço Atual:\s+R\$ 30,00/);
        expect(txt).toContain('🏆 DIVIDEND ARISTOCRAT');
        expect(txt).toContain('+ ROE alto');
        expect(txt).toContain('- Ciclo de crédito');
    });

    it('audit log agrupa por categoria, sem categoria vai para Geral', () => {
        expect(txt).toContain('[Qualidade]');
        expect(txt).toContain('[Geral]');
        expect(txt).toMatch(/▲ ROE > 15%\s+\[ \+10 pts\] \(bônus\)/);
        expect(txt).toMatch(/▼ Dívida\s+\[ {2}-5 pts\] \(penalidade\)/);
        expect(txt).toMatch(/○ Neutro/);
        expect(txt).toMatch(/\(base\)/);
    });

    it('setor financeiro não mostra EV/EBITDA nem margens', () => {
        expect(txt).toContain('EV/EBITDA:         N/A (financeiro)');
        expect(txt).toContain('Margem Líquida:    N/A (financeiro)');
    });

    it('número ausente/NaN vira N/D e escala do market cap é legível', () => {
        expect(txt).toContain('PEG Ratio:         N/D');
        expect(txt).toMatch(/Preço Bazin:\s+N\/D/);
        expect(txt).toContain('Market Cap:        R$ 320.00 bi');
        expect(txt).toContain('Liquidez Média:    R$ 550.00 mi/dia');
        expect(txt).toContain('Patrimônio Líq.:   R$ 1.50 tri');
        expect(txt).toContain('Dív. Líquida: R$ 5.00 mi');
        expect(txt).toContain('Receita Líquida:   R$ 999');
        expect(txt).not.toContain('NaN');
    });

    it('defasagem e só os campos realmente ausentes', () => {
        expect(txt).toContain('Defasagem dos Dados Fundamentais: 12 dias');
        expect(txt).toContain('Campos Ausentes: dy, payout');
        expect(txt).toContain('Qualidade:         80/100');
    });

    it('descartes listam motivo e detalhe, só da classe', () => {
        expect(txt).toContain('ATIVOS DESCARTADOS (STOCK) — 1 ativos');
        expect(txt).toContain('Detalhe: < 1M/dia');
        expect(txt).not.toContain('XPTO11');
    });
});

describe('outras classes', () => {
    it('STOCK_US em dólar; campo zerado no banco sai N/D, não 0.00', async () => {
        const txt = await gerar({
            STOCK_US: {
                ranking: [{
                    position: 1, ticker: 'AAPL', type: 'STOCK_US', sector: 'Technology', action: 'WAIT', tier: 'BRONZE',
                    riskProfile: 'BOLD', score: 60, currentPrice: 200, targetPrice: 180,
                    metrics: { fairPrice: 180, marketCap: 3e12, avgLiquidity: 2e9, pvp: 0, evEbitda: 0, roic: null, netMargin: 25 },
                }],
            },
        }, null);
        expect(txt).toContain('🥉 BRONZE');
        expect(txt).toContain('Perfil: Arrojado');
        expect(txt).toContain('⏳ AGUARDAR');
        expect(txt).toContain('🆕 Novo');
        expect(txt).toContain('Preço Justo:       $ 180.00');
        expect(txt).toContain('Market Cap:        $ 3.00 tri');
        expect(txt).toContain('Liquidez Média:    $ 2.00 bi/dia');
        expect(txt).toContain('P/VP:         N/D');
        expect(txt).toContain('EV/EBITDA:         N/D');
        expect(txt).toContain('ROIC:         N/D');
        expect(txt).toContain('Margem Líquida:    25.00%');
        expect(txt).toContain('Upside/Downside: -10.0%');
    });

    it('FII mostra o bloco próprio e não o de múltiplos de ação', async () => {
        const txt = await gerar({
            FII: {
                ranking: [{
                    position: 1, ticker: 'HGLG11', type: 'FII', action: 'BUY', tier: 'GOLD', riskProfile: 'MODERATE', score: 75,
                    metrics: { pvp: 0.95, dy: 9.1, vacancy: 3, qtdImoveis: 20, vpCota: 160, marketCap: 5e9, avgLiquidity: 5000 },
                }],
            },
        }, null);
        expect(txt).toContain('Indicadores de FII');
        expect(txt).toContain('Perfil: Moderado');
        expect(txt).toContain('Vacância:          3.00%');
        expect(txt).toContain('Qtd. Imóveis:      20');
        expect(txt).toContain('Liquidez Média:    R$ 5 mil/dia');
        expect(txt).not.toContain('Múltiplos Fundamentais');
        expect(txt).toContain('Setor: N/D');
    });

    it('cripto: bloco próprio, liquidez em dólar e tier/perfil desconhecidos passam como vieram', async () => {
        const txt = await gerar({
            CRYPTO: {
                ranking: [{
                    position: 1, ticker: 'BTC', type: 'CRYPTO', action: 'SELL', tier: 'X', riskProfile: 'OUTRO', score: 50,
                    metrics: { marketCap: 500, avgLiquidity: 500, volatility: 60 },
                }],
            },
        }, null);
        expect(txt).toContain('🔴 VENDER');
        expect(txt).toContain('Indicadores Cripto');
        expect(txt).toContain('Liquidez Média:    $ 500/dia');
        expect(txt).toContain('Liquidez:          R$ 500/dia');
        expect(txt).toContain('Market Cap:        R$ 500');
        expect(txt).toContain('Perfil: OUTRO');
        expect(txt).toContain('(sem registros)');
    });
});

describe('lista completa fora do ranking', () => {
    it('não repete quem está no ranking e resume o audit em uma linha', async () => {
        const txt = await gerar({
            STOCK: {
                ranking: [{ ...STOCK_ITEM }],
                fullList: [
                    { ticker: 'ITUB4', score: 82 },
                    {
                        ticker: 'PETR4', type: 'STOCK', score: 45.25, action: 'WAIT', currentPrice: 38.123, sector: 'Petróleo',
                        scores: { DEFENSIVE: 40, MODERATE: 45, BOLD: 50 },
                        auditLog: [{ factor: 'P/L baixo', points: 5 }, { factor: 'Estatal', points: -10 }],
                    },
                    { ticker: 'SOL', type: 'CRYPTO', score: null },
                ],
            },
        }, null);
        expect(txt).toContain('FORA DO RANKING (2 ativos)');
        expect(txt).toContain('R$ 38.12');
        expect(txt).toContain('D: 40  M: 45  B: 50');
        expect(txt).toContain('Audit: P/L baixo(+5) | Estatal(-10)');
        expect(txt).toMatch(/SOL\s+Score:\s+N\/D\/100/);
        const linhasItub = txt.split('\n').filter(l => /^\s{2}ITUB4\s+Score:/.test(l));
        expect(linhasItub).toHaveLength(0);
    });
});
