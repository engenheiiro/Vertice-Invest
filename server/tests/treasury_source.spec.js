/**
 * Fontes da NTN-B / catálogo do Tesouro (jul/2026) — regressões do bug em que:
 *   (a) a API datastore_search do Tesouro Transparente foi desativada (HTTP 400) e
 *       a fonte oficial passou a ser o CSV "precotaxatesourodireto.csv"; e
 *   (b) o Investidor10 reordenou colunas e o scraper capturava a "Rentabilidade
 *       estimada" (nominal ~12–14%) em vez da "Rentabilidade anual" (taxa real),
 *       contaminando a NTN-B e o spread de renda fixa das carteiras.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as cheerio from 'cheerio';

vi.mock('@sentry/node', () => ({
    captureMessage: vi.fn(),
    captureException: vi.fn(),
}));
vi.mock('../models/TreasuryBond.js', () => ({
    default: {
        find: vi.fn(),
        bulkWrite: vi.fn(() => Promise.resolve({})),
        countDocuments: vi.fn(() => Promise.resolve(0)),
        deleteMany: vi.fn(() => Promise.resolve({ deletedCount: 0 })),
    },
}));

import TreasuryBond from '../models/TreasuryBond.js';
import { macroDataService, normalizeBondTitle } from '../services/macroDataService.js';

// CSV oficial: ';' + decimal com vírgula, datas dd/mm/aaaa. Colunas em ordem real.
const CSV_HEADER = 'Tipo Titulo;Data Vencimento;Data Base;Taxa Compra Manha;Taxa Venda Manha;PU Compra Manha;PU Venda Manha;PU Base Manha';

describe('_parseNtnbFromCsv — fonte oficial (Tesouro Transparente CSV)', () => {
    it('extrai a taxa REAL (Venda) da NTN-B longa na Data Base mais recente', () => {
        const csv = [
            CSV_HEADER,
            // Data Base mais recente (10/07/2026)
            'Tesouro IPCA+ com Juros Semestrais;15/05/2035;10/07/2026;7,95;8,07;3000,00;2990,00;2980,00',
            'Tesouro IPCA+;15/08/2040;10/07/2026;7,53;7,65;2000,00;1990,00;1980,00',
            'Tesouro IPCA+;15/08/2050;10/07/2026;7,21;7,33;1500,00;1490,00;1480,00',
            // Curto (<2035): deve ser ignorado
            'Tesouro IPCA+;15/05/2029;10/07/2026;5,49;5,61;2044,00;2027,00;2026,00',
            // Não-referência: Educa+ ignorado
            'Tesouro Educa+;15/01/2035;10/07/2026;7,10;7,20;100,00;99,00;98,00',
            // Data Base ANTERIOR: não deve prevalecer
            'Tesouro IPCA+ com Juros Semestrais;15/05/2035;09/07/2026;6,00;6,10;3000,00;2990,00;2980,00',
        ].join('\n');

        const rate = macroDataService._parseNtnbFromCsv(csv);
        // preferred=[2035,...] → pega 2035 da data mais recente: Taxa Venda = 8,07
        expect(rate).toBe(8.07);
    });

    it('ignora a Data Base antiga mesmo com vencimento preferido presente', () => {
        const csv = [
            CSV_HEADER,
            'Tesouro IPCA+;15/08/2040;10/07/2026;7,53;7,65;2000,00;1990,00;1980,00',
            'Tesouro IPCA+ com Juros Semestrais;15/05/2035;01/01/2020;6,00;6,10;3000,00;2990,00;2980,00',
        ].join('\n');
        // 2035 só existe numa base velha → cai para 2040 da base recente (7,65)
        expect(macroDataService._parseNtnbFromCsv(csv)).toBe(7.65);
    });

    it('retorna null quando não há NTN-B longa plausível', () => {
        const csv = [
            CSV_HEADER,
            'Tesouro Prefixado;01/01/2032;10/07/2026;14,20;14,26;480,00;479,00;478,00',
            'Tesouro IPCA+;15/05/2029;10/07/2026;5,49;5,61;2044,00;2027,00;2026,00',
        ].join('\n');
        expect(macroDataService._parseNtnbFromCsv(csv)).toBeNull();
    });

    it('rejeita taxa implausível (contaminada) e não a retorna', () => {
        const csv = [
            CSV_HEADER,
            'Tesouro IPCA+;15/08/2040;10/07/2026;12,00;12,18;2000,00;1990,00;1980,00',
        ].join('\n');
        expect(macroDataService._parseNtnbFromCsv(csv)).toBeNull();
    });

    it('é robusto a colunas reordenadas (resolve pelo cabeçalho)', () => {
        const csv = [
            'Data Base;Tipo Titulo;Taxa Venda Manha;Data Vencimento;Taxa Compra Manha',
            '10/07/2026;Tesouro IPCA+;7,65;15/08/2040;7,53',
        ].join('\n');
        expect(macroDataService._parseNtnbFromCsv(csv)).toBe(7.65);
    });

    it('não quebra com entrada vazia/inválida', () => {
        expect(macroDataService._parseNtnbFromCsv('')).toBeNull();
        expect(macroDataService._parseNtnbFromCsv(null)).toBeNull();
        expect(macroDataService._parseNtnbFromCsv('só uma linha sem dados')).toBeNull();
    });
});

describe('parseGenericRow — captura a Rentabilidade ANUAL (1ª %), não a estimada', () => {
    const rowHtml = (cells) =>
        cheerio.load(`<table><tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr></table>`);

    it('IPCA+: pega o real "IPCA + 7,95%" e ignora a estimada "12,18%"', () => {
        const $ = rowHtml(['Tesouro IPCA+ 2040', 'IPCA + 7,95%', '12,18%', 'R$ 3.000,00', '15/08/2040']);
        const data = macroDataService.parseGenericRow($, $('tr')[0]);
        expect(data).not.toBeNull();
        expect(data.rate).toBe(7.95);
    });

    it('Selic: pega "SELIC + 0,0740%" e ignora a estimada "14,33%"', () => {
        const $ = rowHtml(['Tesouro Selic 2031', 'SELIC + 0,0740%', '14,33%', 'R$ 19.349,60', '01/03/2031']);
        const data = macroDataService.parseGenericRow($, $('tr')[0]);
        expect(data.rate).toBe(0.074);
    });

    it('Prefixado: 1ª e 2ª % são ambas nominais e próximas — pega a 1ª', () => {
        const $ = rowHtml(['Tesouro Prefixado 2029', '13,98%', '14,10%', 'R$ 725,49', '01/01/2029']);
        const data = macroDataService.parseGenericRow($, $('tr')[0]);
        expect(data.rate).toBe(13.98);
    });

    it('declara o índice lido da coluna de rentabilidade anual', () => {
        const ipca = rowHtml(['Tesouro IPCA+ 2040', 'IPCA + 7,95%', '12,18%', 'R$ 3.000,00', '15/08/2040']);
        expect(macroDataService.parseGenericRow(ipca, ipca('tr')[0]).index).toBe('IPCA');

        const pre = rowHtml(['Tesouro Prefixado 2029', '13,98%', '14,10%', 'R$ 725,49', '01/01/2029']);
        expect(macroDataService.parseGenericRow(pre, pre('tr')[0]).index).toBe('PRE');
    });

    // "Tesouro Reserva 2036" (ago/2026): a coluna anual traz só "SELIC" — pós-fixado
    // de spread zero. Lendo "a primeira % da linha", o parser pegava a rentabilidade
    // ESTIMADA da coluna seguinte e o título entrava como "IPCA + 14,00%".
    it('pós-fixado sem número na coluna anual: spread 0 e índice declarado', () => {
        const $ = rowHtml(['Tesouro Reserva 2036', 'SELIC', '14,00%', 'R$ 10,93', '01/01/2036']);
        const data = macroDataService.parseGenericRow($, $('tr')[0]);
        expect(data).not.toBeNull();
        expect(data.rate).toBe(0);
        expect(data.index).toBe('SELIC');
        // O mínimo nunca passa do título inteiro (PU R$ 10,93 < piso de R$ 30).
        expect(data.minInvestment).toBe(10.93);
    });

    it('cai na varredura por % quando a coluna anual não é reconhecível', () => {
        const $ = rowHtml(['Tesouro IPCA+ 2040', 'sem taxa aqui', 'IPCA + 7,95%', 'R$ 3.000,00', '15/08/2040']);
        const data = macroDataService.parseGenericRow($, $('tr')[0]);
        expect(data.rate).toBe(7.95);
    });

    it('descarta linha sem taxa e sem índice', () => {
        const $ = rowHtml(['Tesouro Qualquer Coisa', 'texto', 'outro texto', 'R$ 10,00', '01/01/2036']);
        expect(macroDataService.parseGenericRow($, $('tr')[0])).toBeNull();
    });
});

// O selo "Juros Semestrais" vinha colado ao nome quando a fonte não deixava
// separador entre os elementos da célula. Como o catálogo é chaveado por título,
// a mesma emissão gerava duas linhas na vitrine — uma delas congelada no dia da
// mudança (ago/2026: 4 títulos duplicados, órfãos desde março).
describe('normalizeBondTitle — chave estável do catálogo', () => {
    it('descola o selo grudado no número do vencimento', () => {
        expect(normalizeBondTitle('Tesouro IPCA+ 2037Juros Semestrais'))
            .toBe('Tesouro IPCA+ 2037 Juros Semestrais');
    });

    it('é idempotente sobre o título já separado', () => {
        expect(normalizeBondTitle('Tesouro IPCA+ 2037 Juros Semestrais'))
            .toBe('Tesouro IPCA+ 2037 Juros Semestrais');
    });

    it('colapsa espaços repetidos e apara as pontas', () => {
        expect(normalizeBondTitle('  Tesouro   Selic 2031 \n')).toBe('Tesouro Selic 2031');
    });

    it('não parte títulos legítimos (número seguido de minúscula ou espaço)', () => {
        expect(normalizeBondTitle('Tesouro Renda+ Aposentadoria Extra 2065'))
            .toBe('Tesouro Renda+ Aposentadoria Extra 2065');
        expect(normalizeBondTitle('Tesouro Educa+ 2027')).toBe('Tesouro Educa+ 2027');
    });

    it('não quebra com entrada vazia', () => {
        expect(normalizeBondTitle(null)).toBe('');
        expect(normalizeBondTitle(undefined)).toBe('');
    });
});

describe('pruneStaleBonds — catálogo é espelho da fonte', () => {
    const titles = (n) => Array.from({ length: n }, (_, i) => `Titulo ${i}`);

    beforeEach(() => {
        TreasuryBond.countDocuments.mockResolvedValue(0);
        TreasuryBond.deleteMany.mockResolvedValue({ deletedCount: 0 });
        TreasuryBond.deleteMany.mockClear();
    });

    it('apaga o que a fonte não lista mais', async () => {
        TreasuryBond.countDocuments.mockResolvedValue(41);
        TreasuryBond.deleteMany.mockResolvedValue({ deletedCount: 4 });
        const list = titles(37);

        expect(await macroDataService.pruneStaleBonds(list)).toBe(4);
        expect(TreasuryBond.deleteMany).toHaveBeenCalledWith({ title: { $nin: list } });
    });

    it('não poda com coleta pequena (scrape quebrado)', async () => {
        TreasuryBond.countDocuments.mockResolvedValue(41);
        expect(await macroDataService.pruneStaleBonds(titles(8))).toBe(0);
        expect(TreasuryBond.deleteMany).not.toHaveBeenCalled();
    });

    it('não poda com coleta encolhida em relação ao catálogo', async () => {
        TreasuryBond.countDocuments.mockResolvedValue(41);
        expect(await macroDataService.pruneStaleBonds(titles(22))).toBe(0);
        expect(TreasuryBond.deleteMany).not.toHaveBeenCalled();
    });

    it('falha do banco não derruba o sync', async () => {
        TreasuryBond.countDocuments.mockRejectedValue(new Error('sem conexão'));
        await expect(macroDataService.pruneStaleBonds(titles(37))).resolves.toBe(0);
    });
});
