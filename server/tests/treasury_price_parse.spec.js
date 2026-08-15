/**
 * Parser do CSV oficial do Tesouro Transparente e identidade de título.
 *
 * As linhas dos fixtures são reais (recortadas do arquivo de 15/ago/2026),
 * inclusive a corrompida: em 14/08/2026 o PU Compra do IPCA+ com Juros
 * Semestrais 2050 veio 3.963,80 — ABAIXO do PU de venda do mesmo dia e ~3,3%
 * fora dos vizinhos, sem qualquer mudança de taxa.
 */
import { describe, it, expect } from 'vitest';
import { parseTreasuryPriceCsv, findSuspiciousMoves, MAX_BUY_SPREAD } from '../services/treasuryPriceService.js';
import {
    classifyTreasuryLabel,
    resolveTreasuryTitleKey,
    familyFromUserText,
    MATCH_REJECTION,
    TREASURY_FAMILIES,
} from '../utils/treasuryTitle.js';

const HEADER = 'Tipo Titulo;Data Vencimento;Data Base;Taxa Compra Manha;Taxa Venda Manha;PU Compra Manha;PU Venda Manha;PU Base Manha';

const csv = (...rows) => [HEADER, ...rows].join('\n');

describe('parseTreasuryPriceCsv', () => {
    it('extrai série por título com PU de venda como preço de marcação', () => {
        const out = parseTreasuryPriceCsv(csv(
            'Tesouro IPCA+;15/05/2035;13/08/2026;7,98;8,10;2434,34;2410,17;2410,17',
            'Tesouro IPCA+;15/05/2035;14/08/2026;7,98;8,10;2434,82;2410,97;2410,97',
        ));

        const serie = out.get('IPCA|2035-05-15');
        expect(serie.family).toBe(TREASURY_FAMILIES.IPCA);
        expect(serie.hasCoupon).toBe(false);
        expect(serie.history).toHaveLength(2);
        expect(serie.history[0]).toMatchObject({ date: '2026-08-13', pu: 2410.17, puBuy: 2434.34 });
    });

    it('ordena por data ASC mesmo com o arquivo fora de ordem', () => {
        const out = parseTreasuryPriceCsv(csv(
            'Tesouro IPCA+;15/05/2035;14/08/2026;7,98;8,10;2434,82;2410,97;2410,97',
            'Tesouro IPCA+;15/05/2035;11/08/2026;8,02;8,14;2424,93;2400,83;2400,83',
            'Tesouro IPCA+;15/05/2035;13/08/2026;7,98;8,10;2434,34;2410,17;2410,17',
        ));
        expect(out.get('IPCA|2035-05-15').history.map((h) => h.date))
            .toEqual(['2026-08-11', '2026-08-13', '2026-08-14']);
    });

    it('descarta o PU de compra corrompido (abaixo do de venda) sem perder o ponto', () => {
        const out = parseTreasuryPriceCsv(csv(
            'Tesouro IPCA+ com Juros Semestrais;15/08/2050;14/08/2026;7,57;7,69;3963,80;4050,64;4050,64',
        ));
        const point = out.get('IPCA_JS|2050-08-15').history[0];
        expect(point.pu).toBe(4050.64);
        // Bid-ask invertido não é preço: a âncora do lote cai no PU de venda.
        expect(point.puBuy).toBeNull();
    });

    it('descarta PU de compra com prêmio absurdo sobre o de venda', () => {
        const acima = 1000 * (1 + MAX_BUY_SPREAD + 0.01);
        const out = parseTreasuryPriceCsv(csv(
            `Tesouro Prefixado;01/01/2029;14/08/2026;12,00;12,10;${acima.toFixed(2).replace('.', ',')};1000,00;1000,00`,
        ));
        expect(out.get('PRE|2029-01-01').history[0].puBuy).toBeNull();
    });

    it('ignora linha sem PU utilizável e Tipo Titulo desconhecido', () => {
        const out = parseTreasuryPriceCsv(csv(
            'Tesouro IPCA+;15/05/2035;14/08/2026;7,98;8,10;2434,82;0;0',
            'Tesouro Cripto+;15/05/2035;14/08/2026;7,98;8,10;100,00;100,00;100,00',
        ));
        expect(out.size).toBe(0);
    });

    it('respeita o corte de histórico', () => {
        const out = parseTreasuryPriceCsv(csv(
            'Tesouro Selic;01/03/2029;10/01/2019;0,03;0,04;9000,00;8999,00;8999,00',
            'Tesouro Selic;01/03/2029;14/08/2026;0,03;0,04;19654,84;19639,67;19639,67',
        ), { sinceIso: '2020-01-01' });
        expect(out.get('SELIC|2029-03-01').history).toHaveLength(1);
    });

    it('deduplica Data Base repetida mantendo a última republicação', () => {
        const out = parseTreasuryPriceCsv(csv(
            'Tesouro Selic;01/03/2029;14/08/2026;0,03;0,04;19654,84;19600,00;19600,00',
            'Tesouro Selic;01/03/2029;14/08/2026;0,03;0,04;19654,84;19639,67;19639,67',
        ));
        const history = out.get('SELIC|2029-03-01').history;
        expect(history).toHaveLength(1);
        expect(history[0].pu).toBe(19639.67);
    });

    it('resolve as colunas pelo cabeçalho, não pela posição', () => {
        const reordenado = [
            'Data Base;Tipo Titulo;Data Vencimento;PU Venda Manha;PU Base Manha;PU Compra Manha;Taxa Compra Manha;Taxa Venda Manha',
            '14/08/2026;Tesouro IPCA+;15/05/2035;2410,97;2410,97;2434,82;7,98;8,10',
        ].join('\n');
        expect(parseTreasuryPriceCsv(reordenado).get('IPCA|2035-05-15').history[0].pu).toBe(2410.97);
    });

    it('entrada vazia ou sem cabeçalho reconhecível devolve mapa vazio', () => {
        expect(parseTreasuryPriceCsv('').size).toBe(0);
        expect(parseTreasuryPriceCsv(null).size).toBe(0);
        expect(parseTreasuryPriceCsv('a;b;c\n1;2;3').size).toBe(0);
    });
});

describe('findSuspiciousMoves', () => {
    it('sinaliza salto atípico sem descartar o ponto (o crash de 2020 foi real)', () => {
        const flagged = findSuspiciousMoves([
            { date: '2020-03-11', pu: 3000 },
            { date: '2020-03-12', pu: 2259 }, // -24,7%: NTN-B 2045 na quinta-feira do COVID
            { date: '2020-03-13', pu: 2300 },
        ]);
        expect(flagged).toEqual([{ date: '2020-03-12', move: -24.7 }]);
    });

    it('não sinaliza oscilação normal', () => {
        expect(findSuspiciousMoves([
            { date: '2026-08-13', pu: 2410.17 },
            { date: '2026-08-14', pu: 2410.97 },
        ])).toEqual([]);
    });
});

describe('classifyTreasuryLabel — os 8 rótulos do arquivo oficial', () => {
    it.each([
        ['Tesouro Selic', 'SELIC'],
        ['Tesouro Prefixado', 'PRE'],
        ['Tesouro Prefixado com Juros Semestrais', 'PRE_JS'],
        ['Tesouro IPCA+', 'IPCA'],
        ['Tesouro IPCA+ com Juros Semestrais', 'IPCA_JS'],
        ['Tesouro IGPM+ com Juros Semestrais', 'IGPM_JS'],
        ['Tesouro Educa+', 'EDUCA'],
        ['Tesouro Renda+ Aposentadoria Extra', 'RENDA'],
    ])('%s → %s', (label, family) => {
        expect(classifyTreasuryLabel(label)).toBe(family);
    });

    it('rótulo novo/desconhecido é ignorado em vez de virar família inventada', () => {
        expect(classifyTreasuryLabel('Tesouro Sustentável 2040')).toBeNull();
        expect(classifyTreasuryLabel('CDB Banco X')).toBeNull();
    });
});

describe('familyFromUserText — nome comercial e nome técnico de corretora', () => {
    it.each([
        ['Tesouro IPCA+ 2035', 'IPCA'],
        ['NTN-B Principal 2035', 'IPCA'],
        ['NTN-B 2035', 'IPCA_JS'],           // sem "Principal" = com cupom
        ['NTN-F 2031', 'PRE_JS'],
        ['LTN 010129', 'PRE'],
        ['LFT 010329', 'SELIC'],
        ['Tesouro Pré-fixado 2029', 'PRE'],  // acento normalizado
        ['Tesouro Renda+ 2065', 'RENDA'],
    ])('%s → %s', (text, family) => {
        expect(familyFromUserText(text)).toBe(family);
    });
});

describe('resolveTreasuryTitleKey', () => {
    const catalog = [
        'IPCA|2032-08-15', 'IPCA|2035-05-15', 'IPCA|2045-05-15',
        'IPCA_JS|2032-08-15',
        'SELIC|2029-03-01', 'PRE|2029-01-01',
        'EDUCA|2040-12-15', 'EDUCA|2041-12-15',
    ];

    it('casa pelo vencimento exato', () => {
        expect(resolveTreasuryTitleKey(
            { type: 'FIXED_INCOME', name: 'Tesouro IPCA+ 2032', maturityDate: new Date('2032-08-15T00:00:00.000Z') },
            catalog,
        )).toMatchObject({ key: 'IPCA|2032-08-15', reason: null });
    });

    it('casa pelo ANO quando o dia do vencimento foi digitado errado', () => {
        expect(resolveTreasuryTitleKey(
            { type: 'FIXED_INCOME', name: 'Tesouro IPCA+ 2035', maturityDate: '2035-08-15' },
            catalog,
        ).key).toBe('IPCA|2035-05-15');
    });

    it('casa pelo ano no nome quando não há vencimento cadastrado', () => {
        expect(resolveTreasuryTitleKey(
            { type: 'FIXED_INCOME', ticker: 'TESOURO SELIC 2029', name: '' },
            catalog,
        ).key).toBe('SELIC|2029-03-01');
    });

    it('recusa RF privada — CDB/LCI não têm preço público', () => {
        expect(resolveTreasuryTitleKey({ type: 'FIXED_INCOME', name: 'PÓS-FIXADO - Nubank' }, catalog))
            .toMatchObject({ key: null, reason: MATCH_REJECTION.NOT_TREASURY });
        expect(resolveTreasuryTitleKey({ type: 'FIXED_INCOME', name: 'LCI 110% CDI Inter' }, catalog))
            .toMatchObject({ key: null, reason: MATCH_REJECTION.NOT_TREASURY });
    });

    it('recusa título com cupom semestral (o PU cai no dia do cupom)', () => {
        expect(resolveTreasuryTitleKey(
            { type: 'FIXED_INCOME', name: 'Tesouro IPCA+ com Juros Semestrais 2032', maturityDate: '2032-08-15' },
            catalog,
        )).toMatchObject({ key: null, reason: MATCH_REJECTION.HAS_COUPON, hasCoupon: true });
    });

    it('recusa quando o ano não desambigua (dois vencimentos no mesmo ano)', () => {
        const comColisao = [...catalog, 'IPCA|2035-08-15'];
        expect(resolveTreasuryTitleKey(
            { type: 'FIXED_INCOME', name: 'Tesouro IPCA+ 2035' },
            comColisao,
        )).toMatchObject({ key: null, reason: MATCH_REJECTION.AMBIGUOUS });
    });

    it('nome com o ano da compra junto do vencimento usa o ano MAIOR', () => {
        expect(resolveTreasuryTitleKey(
            { type: 'FIXED_INCOME', name: 'Tesouro IPCA+ 2045 (aporte 2026)' },
            catalog,
        ).key).toBe('IPCA|2045-05-15');
    });

    it('recusa sem vencimento nem ano no nome', () => {
        expect(resolveTreasuryTitleKey({ type: 'FIXED_INCOME', name: 'Tesouro IPCA+' }, catalog))
            .toMatchObject({ key: null, reason: MATCH_REJECTION.NO_MATURITY });
    });

    it('recusa título cuja série não foi ingerida', () => {
        expect(resolveTreasuryTitleKey(
            { type: 'FIXED_INCOME', name: 'Tesouro Prefixado 2033', maturityDate: '2033-01-01' },
            catalog,
        )).toMatchObject({ key: null, reason: MATCH_REJECTION.NO_SERIES });
    });

    it('CASH (reserva) nunca é marcado a mercado', () => {
        expect(resolveTreasuryTitleKey(
            { type: 'CASH', name: 'Tesouro Selic 2029' },
            catalog,
        )).toMatchObject({ key: null, reason: MATCH_REJECTION.NOT_TREASURY });
    });
});
