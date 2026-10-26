/**
 * Ingestão do PU do Tesouro quando o CSV oficial falha.
 *
 * Out/2026: o CSV do Tesouro Transparente parou de ser republicado (16/10) e,
 * de 21/10 em diante, o download voltava em ~0,3 s com uma página de bloqueio
 * no lugar do arquivo. O job registrava "nenhuma série reconhecida (layout
 * mudou?)" — mandava olhar o layout de um arquivo que nem tinha sido baixado —
 * e, nos dias em que o arquivo veio PARADO, gravava SUCCESS sem avançar a série.
 *
 * Cobre: diagnóstico do que veio no lugar do CSV; parser do JSON do Tesouro
 * Direto (reserva oficial); regra de só ACRESCENTAR a ponta; escolha da NTN-B
 * pelo JSON; e o fluxo de `ingestTreasuryPrices` com o CSV bloqueado/parado.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const axiosGet = vi.fn();
vi.mock('axios', () => ({ default: { get: (...args) => axiosGet(...args) } }));

const aggregate = vi.fn();
const bulkWrite = vi.fn();
vi.mock('../models/TreasuryPriceHistory.js', () => ({
    default: { aggregate: (...a) => aggregate(...a), bulkWrite: (...a) => bulkWrite(...a) },
}));

const {
    describeTesouroDownloadProblem,
    describeCsvLayoutProblem,
    parseTesouroDiretoQuotes,
    selectAppendableQuotes,
    ingestTreasuryPrices,
    clearCsvMemo,
    clearTesouroDiretoMemo,
    TESOURO_CSV_URL,
    TESOURO_DIRETO_QUOTES_URL,
} = await import('../services/treasuryPriceService.js');
const { macroDataService } = await import('../services/macroDataService.js');

const BLOCK_PAGE = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><title>429 - Muitas Requisições</title>
<style>${'.card{}'.repeat(300)}</style></head>
<body><h1>Acesso Limitado</h1><p>Muitas Requisições Detectadas</p></body></html>`;

const allBusinessDays = () => true;

const tdBond = (over = {}) => ({
    treasuryBondName: 'Tesouro IPCA+ 2040',
    maturityDate: '2040-08-15T00:00',
    lastMarketPricingDate: '2026-10-23T18:00:08.193',
    unitaryRedemptionValue: 1971.53,
    unitaryInvestmentValue: 2002.23,
    redemptionProfitabilityFeeIndexerName: 'IPCA + 6,65%',
    ...over,
});

describe('describeTesouroDownloadProblem', () => {
    it('página de bloqueio com HTTP 200 vira "Acesso Limitado", não "layout mudou"', () => {
        const msg = describeTesouroDownloadProblem({ status: 200, contentType: 'text/html', body: BLOCK_PAGE });
        expect(msg).toMatch(/Acesso Limitado/);
        expect(msg).toMatch(/excesso de requisições/);
        expect(msg).toMatch(/HTTP 200/);
        expect(msg).not.toMatch(/layout/i);
    });

    it('HTTP 429 diz que é bloqueio por excesso de requisições', () => {
        expect(describeTesouroDownloadProblem({ status: 429, contentType: 'text/html', body: BLOCK_PAGE }))
            .toMatch(/bloqueou o download por excesso de requisições \[HTTP 429/);
    });

    it('distingue fora do ar, endereço sumido e tempo esgotado', () => {
        expect(describeTesouroDownloadProblem({ status: 503, body: 'x' })).toMatch(/fora do ar/);
        expect(describeTesouroDownloadProblem({ status: 410, body: 'gone' })).toMatch(/não existe mais/);
        const timeout = Object.assign(new Error('aborted'), { name: 'TimeoutError' });
        expect(describeTesouroDownloadProblem({ error: timeout })).toMatch(/tempo esgotado/);
    });

    it('HTML genérico cita o título da página', () => {
        const msg = describeTesouroDownloadProblem({ status: 200, body: `<html><head><title>Manutenção</title></head>${'x'.repeat(2000)}</html>` });
        expect(msg).toMatch(/página HTML \("Manutenção"\)/);
    });

    it('CSV de verdade não tem problema (null)', () => {
        const csv = `Tipo Titulo;Data Vencimento;Data Base;Taxa Compra Manha\n${'linha;1;2;3\n'.repeat(200)}`;
        expect(describeTesouroDownloadProblem({ status: 200, contentType: 'text/csv', body: csv })).toBeNull();
    });

    it('layout só é acusado quando o arquivo veio, e mostra o cabeçalho', () => {
        expect(describeCsvLayoutProblem('Coluna A;Coluna B\n1;2')).toMatch(/layout mudou\?\): "Coluna A;Coluna B"/);
    });
});

describe('parseTesouroDiretoQuotes', () => {
    it('mapeia resgate → PU (venda) e investimento → PU de compra, com taxa e data', () => {
        const [q] = parseTesouroDiretoQuotes({ TesouroLegado: [tdBond()] }, { isBusinessDay: allBusinessDays });
        expect(q.titleKey).toBe('IPCA|2040-08-15');
        expect(q.point).toEqual({ date: '2026-10-23', pu: 1971.53, puBuy: 2002.23, rate: 6.65 });
    });

    it('Educa+ usa o vencimento final, casando com a chave do CSV', () => {
        const [q] = parseTesouroDiretoQuotes({
            TesouroLegado: [tdBond({ treasuryBondName: 'Tesouro Educa+ 2029', maturityDate: '2033-12-15T00:00' })],
        }, { isBusinessDay: allBusinessDays });
        expect(q.titleKey).toBe('EDUCA|2033-12-15');
    });

    it('lê taxa de prefixado e de Selic; descarta título sem família e dia sem pregão', () => {
        const out = parseTesouroDiretoQuotes({
            TesouroLegado: [
                tdBond({ treasuryBondName: 'Tesouro Prefixado 2029', maturityDate: '2029-01-01T00:00', redemptionProfitabilityFeeIndexerName: '12,88%', unitaryRedemptionValue: 769.49, unitaryInvestmentValue: 771.26 }),
                tdBond({ treasuryBondName: 'Tesouro Selic 2031', maturityDate: '2031-03-01T00:00', redemptionProfitabilityFeeIndexerName: 'SELIC + 0,1089%', unitaryRedemptionValue: 20065.78, unitaryInvestmentValue: 20074.43 }),
            ],
            Tesouro24x7: [tdBond({ treasuryBondName: 'Tesouro Reserva 2036', lastMarketPricingDate: '2026-10-25T00:03:32' })],
        }, { isBusinessDay: (d) => d !== '2026-10-25' });
        expect(out.map((q) => [q.titleKey, q.point.rate])).toEqual([['PRE|2029-01-01', 12.88], ['SELIC|2031-03-01', 0.1089]]);
    });

    it('PU de compra fora da faixa de bid-ask é descartado (mesma guarda do CSV)', () => {
        const [q] = parseTesouroDiretoQuotes({ TesouroLegado: [tdBond({ unitaryInvestmentValue: 1900 })] }, { isBusinessDay: allBusinessDays });
        expect(q.point.puBuy).toBeNull();
    });
});

describe('selectAppendableQuotes', () => {
    const quotes = parseTesouroDiretoQuotes({ TesouroLegado: [tdBond()] }, { isBusinessDay: allBusinessDays });

    it('acrescenta só a ponta posterior ao último ponto gravado', () => {
        expect(selectAppendableQuotes(quotes, new Map([['IPCA|2040-08-15', '2026-10-15']]))).toHaveLength(1);
        expect(selectAppendableQuotes(quotes, new Map([['IPCA|2040-08-15', '2026-10-23']]))).toHaveLength(0);
    });

    it('não cria série nova: título sem série gravada fica de fora', () => {
        expect(selectAppendableQuotes(quotes, new Map())).toHaveLength(0);
    });
});

describe('NTN-B pelo JSON do Tesouro Direto', () => {
    it('escolhe o IPCA+ longo pela escada de vencimentos, ignorando Educa+/Renda+', () => {
        const quotes = parseTesouroDiretoQuotes({
            TesouroLegado: [
                tdBond({ treasuryBondName: 'Tesouro Educa+ 2029', maturityDate: '2035-12-15T00:00', redemptionProfitabilityFeeIndexerName: 'IPCA + 6,81%' }),
                tdBond({ treasuryBondName: 'Tesouro IPCA+ com Juros Semestrais 2037', maturityDate: '2037-05-15T00:00', redemptionProfitabilityFeeIndexerName: 'IPCA + 6,82%' }),
                tdBond(),
            ],
        }, { isBusinessDay: allBusinessDays });
        expect(macroDataService._pickNtnbFromTesouroDiretoQuotes(quotes)).toBe(6.65);
    });

    it('sem IPCA+ longo, devolve null', () => {
        expect(macroDataService._pickNtnbFromTesouroDiretoQuotes([])).toBeNull();
    });
});

describe('ingestTreasuryPrices com o CSV fora', () => {
    beforeEach(() => {
        axiosGet.mockReset();
        aggregate.mockReset();
        bulkWrite.mockReset();
        clearCsvMemo();
        clearTesouroDiretoMemo();
    });

    const routeAxios = ({ csv, td }) => axiosGet.mockImplementation(async (url) => {
        if (url === TESOURO_CSV_URL) return csv;
        if (url === TESOURO_DIRETO_QUOTES_URL) return td;
        throw new Error(`URL inesperada: ${url}`);
    });

    it('bloqueio do CSV: a reserva acrescenta o pregão e o job sai ok, com o motivo do CSV guardado', async () => {
        routeAxios({
            csv: { status: 200, headers: { 'content-type': 'text/html' }, data: BLOCK_PAGE },
            td: { status: 200, headers: { 'content-type': 'application/json' }, data: { TesouroLegado: [tdBond()] } },
        });
        aggregate.mockResolvedValue([{ titleKey: 'IPCA|2040-08-15', last: '2026-10-15' }]);
        bulkWrite.mockResolvedValue({});

        const result = await ingestTreasuryPrices({ todayKey: '2026-10-26' }); // espera o pregão 2026-10-23
        expect(result.ok).toBe(true);
        expect(result.source).toBe('TESOURO_DIRETO');
        expect(result.lastBase).toBe('2026-10-23');
        expect(result.csvProblem).toMatch(/Acesso Limitado/);
        const [ops] = bulkWrite.mock.calls[0];
        expect(ops[0].updateOne.update.$push.history).toEqual({ date: '2026-10-23', pu: 1971.53, puBuy: 2002.23, rate: 6.65 });
    });

    it('as duas fontes fora: falha com o motivo de cada uma, sem falar em layout', async () => {
        routeAxios({
            csv: { status: 200, headers: { 'content-type': 'text/html' }, data: BLOCK_PAGE },
            td: { status: 503, headers: { 'content-type': 'text/html' }, data: '<html>indisponível</html>' },
        });

        const result = await ingestTreasuryPrices({ todayKey: '2026-10-26' });
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/^pregão 2026-10-23 não entrou — CSV oficial: .*Acesso Limitado.*; Tesouro Direto: .*fora do ar/);
        expect(result.reason).not.toMatch(/layout/i);
        expect(bulkWrite).not.toHaveBeenCalled();
    });

    it('reserva só tem pregão já gravado: falha dizendo isso', async () => {
        routeAxios({
            csv: { status: 429, headers: { 'content-type': 'text/html' }, data: BLOCK_PAGE },
            td: { status: 200, headers: {}, data: { TesouroLegado: [tdBond({ lastMarketPricingDate: '2026-10-15T18:00:00' })] } },
        });
        aggregate.mockResolvedValue([{ titleKey: 'IPCA|2040-08-15', last: '2026-10-15' }]);

        const result = await ingestTreasuryPrices({ todayKey: '2026-10-26' });
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/HTTP 429/);
        expect(result.reason).toMatch(/Tesouro Direto: só tem o pregão 2026-10-15/);
    });
});
