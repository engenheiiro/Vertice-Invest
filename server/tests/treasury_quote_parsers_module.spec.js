// Módulos puros extraídos de treasuryPriceService: parsers das fontes de PU e
// diagnóstico do download.
import { describe, it, expect } from 'vitest';
import { parseTreasuryPriceCsv, parseTesouroDiretoQuotes, MAX_BUY_SPREAD } from '../services/treasury/treasuryQuoteParsers.js';
import { describeTesouroDownloadProblem, describeCsvLayoutProblem } from '../services/treasury/downloadDiagnosis.js';

const HEADER = 'PU Venda Manha;Data Base;Tipo Titulo;Data Vencimento;PU Compra Manha;Taxa Venda Manha';

describe('treasuryQuoteParsers', () => {
    it('CSV: colunas pelo cabeçalho, decimal com vírgula, ordem ASC e a última repetição vence', () => {
        const csv = [
            `\uFEFF${HEADER}`,
            '4.100,00;02/10/2026;Tesouro IPCA+ com Juros Semestrais;15/08/2050;4.150,00;6,2',
            '4.000,00;01/10/2026;Tesouro IPCA+ com Juros Semestrais;15/08/2050;3.900,00;6,1',
            '4.101,00;02/10/2026;Tesouro IPCA+ com Juros Semestrais;15/08/2050;;x',
            '0;03/10/2026;Tesouro IPCA+ com Juros Semestrais;15/08/2050;1;1',
            '1;31/99/2026;Tesouro IPCA+ com Juros Semestrais;15/08/2050',
        ].join('\r\n');
        const entry = parseTreasuryPriceCsv(csv).get('IPCA_JS|2050-08-15');
        expect(entry.hasCoupon).toBe(true);
        expect(entry.history).toEqual([
            { date: '2026-10-01', pu: 4000, puBuy: null, rate: 6.1 },
            { date: '2026-10-02', pu: 4101, puBuy: null, rate: null },
            // Estranheza congelada: o regex de data não valida dia/mês.
            { date: '2026-99-31', pu: 1, puBuy: null, rate: null },
        ]);
    });

    it('CSV sem a coluna de PU não produz série', () => {
        expect(parseTreasuryPriceCsv('Tipo Titulo;Data Base;Data Vencimento\nTesouro Selic;01/10/2026;01/03/2029').size).toBe(0);
    });

    it('JSON: guarda de spread no PU de compra e o primeiro título repetido vence', () => {
        const bond = {
            treasuryBondName: 'Tesouro Selic 2029', maturityDate: '2029-03-01T00:00', lastMarketPricingDate: '2026-10-23T18:00',
            unitaryRedemptionValue: 1000, unitaryInvestmentValue: 1000 * (1 + MAX_BUY_SPREAD + 0.01),
            redemptionProfitabilityFeeIndexerName: 'SELIC + 0,1089%',
        };
        const out = parseTesouroDiretoQuotes({ TesouroLegado: [bond], Tesouro24x7: [{ ...bond, unitaryRedemptionValue: 5 }] }, { isBusinessDay: () => true });
        expect(out).toEqual([{
            titleKey: 'SELIC|2029-03-01', family: 'SELIC', maturity: '2029-03-01', sourceLabel: 'Tesouro Selic 2029',
            point: { date: '2026-10-23', pu: 1000, puBuy: null, rate: 0.1089 },
        }]);
    });
});

describe('downloadDiagnosis', () => {
    it('separa rede, status, página HTML e CSV de verdade', () => {
        expect(describeTesouroDownloadProblem({ error: { code: 'ETIMEDOUT' } })).toBe('tempo esgotado esperando o site do Tesouro');
        expect(describeTesouroDownloadProblem({ status: 503, body: '' })).toMatch(/^site do Tesouro fora do ar \[HTTP 503/);
        expect(describeTesouroDownloadProblem({ status: 200, body: '<html><title> Oi </title></html>' })).toMatch(/página HTML \("Oi"\)/);
        expect(describeTesouroDownloadProblem({ status: 200, body: 'a;b\n'.repeat(400) })).toBeNull();
        expect(describeCsvLayoutProblem('x;y\nz')).toMatch(/"x;y"$/);
    });
});
