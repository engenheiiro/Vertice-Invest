/**
 * assetDetailView — derivações puras do dossiê de ativo: semáforo de métricas,
 * formatos, nota/sinal pelo score (corte 70) e recorte da auditoria por perfil.
 */
import { describe, it, expect } from 'vitest';
import {
    actionView, buildFinancialSection, buildMetricRows, computeUpside, detailRowColor, filterAuditForProfile, formatCurrency,
    priceCurrency, profileSignalLabel, scoreGrade, scoreGradeClass, scoreVerdict, splitAudit, structuralScores, upsideLabel,
    yieldColor, yieldLabel,
} from './assetDetailView';
import { BUY_THRESHOLD, type AuditEntry, type RankingItem } from '../../services/research';

const asset = (over: Partial<RankingItem>, metrics: Partial<RankingItem['metrics']> = {}): RankingItem => ({
    position: 1, ticker: 'X', name: 'X', type: 'STOCK', action: 'WAIT', currentPrice: 10, targetPrice: 12, score: 50,
    probability: 1, thesis: '', reason: '', ...over,
    metrics: metrics as RankingItem['metrics'],
});

const byLabel = (rows: Array<{ label: string; value: string; status: string }>) =>
    Object.fromEntries(rows.map((r) => [r.label, [r.value, r.status]]));

describe('nota, sinal e boletim pelo score', () => {
    it('nota por faixa, com o B começando no corte de compra', () => {
        expect([100, 95, 94, 90, 89, 80, 79, BUY_THRESHOLD, 69, 60, 59, 0, NaN].map(scoreGrade))
            .toEqual(['A+', 'A+', 'A', 'A', 'B+', 'B+', 'B', 'B', 'C', 'C', 'F', 'F', 'F']);
    });

    it('borda da nota: abaixo do corte é vermelha, mesmo com nota C', () => {
        expect(scoreGradeClass(90)).toContain('border-emerald-500');
        expect(scoreGradeClass(80)).toContain('border-blue-500');
        expect(scoreGradeClass(70)).toContain('border-slate-400');
        expect(scoreGradeClass(69)).toContain('border-red-500');
    });

    it('score 69 não lê "recomendado" no boletim (corte em 70)', () => {
        expect(scoreVerdict(80)).toMatch(/classe A/);
        expect(scoreVerdict(70)).toMatch(/recomendado/);
        expect(scoreVerdict(69)).toMatch(/requer cautela/);
    });

    it('rótulo e cor do sinal; ação desconhecida cai em AGUARDAR', () => {
        expect(actionView('BUY')).toEqual({ label: 'OPORTUNIDADE DE ENTRADA', textClass: 'text-emerald-500', barClass: 'bg-emerald-500' });
        expect(actionView('SELL').label).toBe('VENDA');
        expect(actionView('SELL').barClass).toBe('bg-slate-500');
        expect(actionView('WAIT').label).toBe('AGUARDAR');
        expect(actionView('HOLD').textClass).toBe('text-yellow-500');
    });

    it('perfil do sinal sem perfil cai em moderado', () => {
        expect(profileSignalLabel('DEFENSIVE')).toBe('defensivo');
        expect(profileSignalLabel('BOLD')).toBe('arrojado');
        expect(profileSignalLabel('MODERATE')).toBe('moderado');
        expect(profileSignalLabel(undefined)).toBe('moderado');
    });
});

describe('sidebar: preço, upside, yield e eixos', () => {
    it('cripto e exterior em dólar; ação, FII e ETF em reais', () => {
        expect(['CRYPTO', 'STOCK_US', 'STOCK', 'FII', 'ETF', undefined].map(priceCurrency)).toEqual(['USD', 'USD', 'BRL', 'BRL', 'BRL', 'BRL']);
    });

    it('formatCurrency: ausente ou NaN vira traço', () => {
        expect(formatCurrency(undefined)).toBe('-');
        expect(formatCurrency(null)).toBe('-');
        expect(formatCurrency(NaN)).toBe('-');
        expect(formatCurrency(90_000, 'USD')).toMatch(/^US\$\s90\smil$/);
    });

    it('upside sem preço atual é zero; sinal só no positivo', () => {
        expect(computeUpside(40, 50)).toBeCloseTo(25);
        expect(computeUpside(0, 50)).toBe(0);
        expect(upsideLabel(25)).toBe('+25.0%');
        expect(upsideLabel(0)).toBe('0.0%');
        expect(upsideLabel(-10)).toBe('-10.0%');
    });

    it('yield: cinza sem dado, amarelo abaixo de 6%, verde a partir de 6%', () => {
        expect([undefined, 0, -1, 5.9, 6, 9].map(yieldColor))
            .toEqual(['text-slate-500', 'text-slate-500', 'text-slate-500', 'text-yellow-400', 'text-emerald-400', 'text-emerald-400']);
        expect(yieldLabel(undefined)).toBe('0%');
        expect(yieldLabel(6.25)).toBe('6.3%');
    });

    it('eixos estruturais ausentes ficam em 50', () => {
        expect(structuralScores({} as RankingItem['metrics'])).toEqual({ quality: 50, valuation: 50, risk: 50 });
        const s = { quality: 1, valuation: 2, risk: 3 };
        expect(structuralScores({ structural: s } as RankingItem['metrics'])).toBe(s);
    });
});

describe('quadro de indicadores', () => {
    it('ação: faixas de ROE, margem, dívida (escala % acima de 10), P/VP e EV/EBITDA', () => {
        const rows = byLabel(buildMetricRows(asset({}, { pl: 8, pvp: 0.9, roe: 16, netMargin: -1, debtToEquity: 250, evEbitda: 16 })));
        expect(rows['P/L']).toEqual(['8', 'neutral']);
        expect(rows['P/VP'][1]).toBe('good');
        expect(rows.ROE).toEqual(['16.00%', 'good']);
        expect(rows['Margem Líquida'][1]).toBe('bad');
        expect(rows['Dívida Líq/PL'][1]).toBe('bad');
        expect(rows['EV/EBITDA'][1]).toBe('warning');
        expect(rows.Beta).toEqual(['N/A', 'neutral']);
    });

    it('ETF e tipo ausente usam o quadro de ação', () => {
        expect(buildMetricRows(asset({ type: 'ETF' }))[0].label).toBe('P/L');
        expect(buildMetricRows(asset({ type: undefined }))[0].label).toBe('P/L');
    });

    it('FII: DY info entre 4 e 8, vacância alta ruim, cap rate baixo em alerta', () => {
        const rows = byLabel(buildMetricRows(asset({ type: 'FII' }, { dy: 6, vacancy: 16, capRate: 5, ffoYield: 7, avgLiquidity: 0 })));
        expect(rows['Dividend Yield (12m)'][1]).toBe('info');
        expect(rows['Vacância Física'][1]).toBe('bad');
        expect(rows['Cap Rate Impl.'][1]).toBe('warning');
        expect(rows['FFO Yield'][1]).toBe('neutral');
        expect(rows['Liquidez Diária'][0]).toBe('R$ 0');
    });

    it('exterior: P/E zero é N/A neutro; entre 25 e 40 neutro', () => {
        expect(byLabel(buildMetricRows(asset({ type: 'STOCK_US' }, { pl: 0 })))['P/E (P/L)']).toEqual(['N/A', 'neutral']);
        expect(byLabel(buildMetricRows(asset({ type: 'STOCK_US' }, { pl: 30 })))['P/E (P/L)'][1]).toBe('neutral');
        expect(byLabel(buildMetricRows(asset({ type: 'STOCK_US' }, { pl: -3 })))['P/E (P/L)'][1]).toBe('good');
    });

    it('cripto: market cap cai no mktCap; preço abaixo da SMA 200 é ruim', () => {
        const rows = byLabel(buildMetricRows(asset({ type: 'CRYPTO', currentPrice: 10, score: BUY_THRESHOLD }, { mktCap: 2e9, sma200: 12 })));
        expect(rows['Market Cap']).toEqual(['R$ 2.0B', 'info']);
        expect(rows['SMA 200'][1]).toBe('bad');
        expect(rows['Score Estrutural']).toEqual(['70', 'good']);
    });

    it('cor do valor: traço apagado independe do status', () => {
        expect(detailRowColor('-', 'bad')).toBe('text-slate-500');
        expect(detailRowColor('1', 'bad')).toBe('text-red-500 font-black');
        expect(detailRowColor('1', 'neutral')).toBe('text-white');
    });
});

describe('demonstrativos', () => {
    it('só ação (LTM) e exterior (USD) têm bloco', () => {
        expect(buildFinancialSection(asset({ type: 'STOCK' }))?.title).toBe('Financials (LTM)');
        expect(buildFinancialSection(asset({ type: undefined }))?.title).toBe('Financials (LTM)');
        expect(buildFinancialSection(asset({ type: 'STOCK_US' }))?.title).toBe('Financials (USD)');
        expect(buildFinancialSection(asset({ type: 'FII' }))).toBeNull();
        expect(buildFinancialSection(asset({ type: 'ETF' }))).toBeNull();
        expect(buildFinancialSection(asset({ type: 'CRYPTO' }))).toBeNull();
    });

    it('LTM: zero é dado ausente; dívida acima do valor de mercado em alerta; prejuízo é ruim', () => {
        const rows = byLabel(buildFinancialSection(asset({}, { marketCap: 0, netDebt: 5e5, netIncome: -2e6, totalAssets: 1500 }))?.rows ?? []);
        expect(rows['Valor de Mercado']).toEqual(['-', 'info']);
        expect(rows['Dívida Líquida']).toEqual(['R$ 500.000', 'warning']);
        expect(rows['Lucro Líquido']).toEqual(['R$ -2.0M', 'bad']);
        expect(rows['Ativos Totais'][0]).toBe('R$ 1.500');
    });

    it('USD: LPA/VPA com cifrão e duas casas', () => {
        const rows = byLabel(buildFinancialSection(asset({ type: 'STOCK_US' }, { lpa: 1.234, vpa: 0, debtToEquity: 1 }))?.rows ?? []);
        expect(rows['EPS (LPA)'][0]).toBe('$1.23');
        expect(rows['Book Value'][0]).toBe('N/A');
        expect(rows['Debt/Equity']).toEqual(['1', 'neutral']);
    });
});

describe('auditoria por perfil', () => {
    const log = (category: string, points: number): AuditEntry => ({ category, factor: `${category} ${points}`, points, type: 'bonus' });

    it('mantém universais e a categoria do perfil do ativo, sem linhas de zero ponto', () => {
        const entries = [
            log('Qualidade', 3), log('Dados e Confiança', -1), log('Perfil Moderado', 2), log('Perfil Defensivo', 4),
            log('Risco', 0), log('Livre', 9),
        ];
        expect(filterAuditForProfile(entries, 'MODERATE').map((e) => e.factor))
            .toEqual(['Qualidade 3', 'Dados e Confiança -1', 'Perfil Moderado 2']);
        expect(filterAuditForProfile(entries, undefined).map((e) => e.factor)).toEqual(['Qualidade 3', 'Dados e Confiança -1']);
        expect(filterAuditForProfile(undefined, 'BOLD')).toEqual([]);
    });

    it('separa ganhos e perdas com no máximo 12 de cada lado', () => {
        const entries = [...Array.from({ length: 13 }, (_, i) => log('Qualidade', i + 1)), log('Risco', -2)];
        const { gains, losses } = splitAudit(entries);
        expect(gains).toHaveLength(12);
        expect(gains[0].points).toBe(1);
        expect(losses.map((l) => l.points)).toEqual([-2]);
    });
});
