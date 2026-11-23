/**
 * Partes do relatório TXT do ranking (services/rankingExport/). O texto
 * completo está travado pela caracterização; aqui ficam as regras de cada parte.
 */
import { describe, expect, it } from 'vitest';
import { fmt, fmtMarketCapUSD, tierLabel } from '../services/rankingExport/formatters.js';
import { formatMetrics } from '../services/rankingExport/metricsText.js';
import { formatRankingItem } from '../services/rankingExport/rankingItemText.js';

describe('formatters', () => {
    it('ausente, NaN e infinito viram N/D; string passa como veio', () => {
        expect([fmt(null), fmt(''), fmt(NaN), fmt(Infinity), fmt('7,5'), fmt(1.234, 1)]).toEqual(['N/D', 'N/D', 'N/D', 'N/D', '7,5', '1.2']);
        expect(fmtMarketCapUSD(2.5e9)).toBe('$ 2.50 bi');
        expect(tierLabel(undefined)).toBe('N/D');
    });
});

describe('formatMetrics', () => {
    it('sem métricas avisa em vez de imprimir blocos', () => {
        expect(formatMetrics(null, 'STOCK', 'Bancos')).toBe('  (sem métricas)\n');
    });

    it('setor de seguros esconde EV/EBITDA e margens; STOCK_US com zero sai N/D', () => {
        const txt = formatMetrics({ evEbitda: 5, netMargin: 10, pvp: 0, roic: 0 }, 'STOCK_US', 'Insurance');
        expect(txt).toContain('EV/EBITDA:         N/A (financeiro)');
        expect(txt).toContain('Margem EBIT:  N/A (financeiro)');
        expect(txt).toContain('P/VP:         N/D');
        expect(txt).toContain('ROIC:         N/D');
    });

    it('FII e cripto ganham o bloco próprio, sem múltiplos de ação', () => {
        expect(formatMetrics({}, 'FII')).toContain('Indicadores de FII');
        const cripto = formatMetrics({ avgLiquidity: 2e6 }, 'CRYPTO');
        expect(cripto).toContain('Liquidez Média:    $ 2.00 mi/dia');
        expect(cripto).toContain('Liquidez:          R$ 2.00 mi/dia');
        expect(cripto).not.toContain('Múltiplos Fundamentais');
    });

    it('defasagem 0 aparece; campo marcado false não entra em ausentes', () => {
        const txt = formatMetrics({ _staleDays: 0, _missing: { beta: false, dy: true } }, 'ETF');
        expect(txt).toContain('Defasagem dos Dados Fundamentais: 0 dias');
        expect(txt).toContain('Campos Ausentes: dy\n');
    });
});

describe('formatRankingItem', () => {
    it('cripto em dólar, upside negativo sem sinal de mais, teses vazias omitidas', () => {
        const txt = formatRankingItem({
            position: 1, ticker: 'BTC', type: 'CRYPTO', currentPrice: 100, targetPrice: 90, bullThesis: [], bearThesis: ['Volátil'],
        });
        expect(txt).toMatch(/Preço Atual:\s+\$ 100,00/);
        expect(txt).toContain('Upside/Downside: -10.0%');
        expect(txt).not.toContain('Bull Thesis');
        expect(txt).toContain('    - Volátil');
        expect(txt).toContain('(sem registros)');
    });
});
