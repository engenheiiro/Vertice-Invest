import { describe, it, expect } from 'vitest';
import {
    ANCHOR_STATUS_ORDER,
    averageAnchorScore,
    groupByAnchorStatus,
    resolveAnchorStatus,
} from './anchorStatus';
import type { AnchorPayload, AnchorRankingItem } from '../services/research';

const item = (
    ticker: string,
    action: 'BUY' | 'WAIT',
    score: number,
    anchor: Partial<AnchorPayload> = {},
): AnchorRankingItem => ({
    position: 1,
    ticker,
    name: ticker,
    action,
    score,
    currentPrice: 10,
    targetPrice: 12,
    probability: 0,
    anchor: { axes: { durability: 70, resilience: 70, consistency: 70 }, ...anchor },
});

describe('resolveAnchorStatus', () => {
    it('COMPRAR é só quem o motor marcou como BUY', () => {
        // Inclui quem a histerese manteve abaixo do limiar de entrada: a lista
        // publicada é a autoridade, não o score.
        expect(resolveAnchorStatus(item('WEGE3', 'BUY', 88)).id).toBe('BUY');
        expect(resolveAnchorStatus(item('BRSR6', 'BUY', 64)).id).toBe('BUY');
    });

    it('separa "boa e cara" de "cara e fraca" pela convicção antes do freio', () => {
        // ITUB4: composite 82, só o preço segura. CMIG4: caro E fraco.
        expect(resolveAnchorStatus(item('ITUB4', 'WAIT', 74, { expensive: true, composite: 82 })).id).toBe('PRICE');
        expect(resolveAnchorStatus(item('CMIG4', 'WAIT', 58, { expensive: true, composite: 65 })).id).toBe('CONVICTION');
    });

    it('teto de composição não vira demérito do fundo', () => {
        const fund = item('KNCR11', 'WAIT', 78, {
            publicationLimit: { bucket: 'PAPER', cap: 1 },
        });
        expect(resolveAnchorStatus(fund).id).toBe('COMPOSITION');
    });

    it('renda não coberta pelo FFO tem precedência sobre preço e sobre o teto', () => {
        const fund = item('XPML11', 'WAIT', 72, {
            payoutUncovered: true,
            expensive: true,
            composite: 80,
            publicationLimit: { bucket: 'MANAGER', cap: 1, manager: 'XP' },
        });
        expect(resolveAnchorStatus(fund).id).toBe('INCOME');
    });

    it('sem bloqueador nomeado, o que falta é convicção', () => {
        expect(resolveAnchorStatus(item('TAEE11', 'WAIT', 61)).id).toBe('CONVICTION');
    });

    it('usa o limiar da apuração, não um 70 fixo', () => {
        const asset = item('SAPR11', 'WAIT', 66, { expensive: true, composite: 66 });
        expect(resolveAnchorStatus(asset, 70).id).toBe('CONVICTION');
        expect(resolveAnchorStatus(asset, 65).id).toBe('PRICE');
    });

    it('relatório antigo, sem payload âncora, não quebra a classificação', () => {
        const legacy = { ...item('ABEV3', 'WAIT', 70), anchor: null } as AnchorRankingItem;
        expect(resolveAnchorStatus(legacy).id).toBe('CONVICTION');
    });

    it('sem `composite`, cai no score — que já traz o freio descontado', () => {
        // Erra só para o lado seguro: subestimar a convicção manda para
        // "em observação", nunca promove indevidamente a "aguardando preço".
        expect(resolveAnchorStatus(item('ODPV3', 'WAIT', 71, { expensive: true })).id).toBe('PRICE');
        expect(resolveAnchorStatus(item('ODPV3', 'WAIT', 69, { expensive: true })).id).toBe('CONVICTION');
    });
});

describe('groupByAnchorStatus', () => {
    it('devolve as seções na ordem canônica e sem grupos vazios', () => {
        const groups = groupByAnchorStatus([
            item('A', 'WAIT', 60),
            item('B', 'BUY', 80),
            item('C', 'WAIT', 74, { expensive: true, composite: 80 }),
        ]);
        expect(groups.map(group => group.status.id)).toEqual(['BUY', 'PRICE', 'CONVICTION']);
        expect(groups[0].items.map(row => row.ticker)).toEqual(['B']);
    });

    it('preserva a ordem soberana de score dentro de cada seção', () => {
        const groups = groupByAnchorStatus([
            item('A', 'BUY', 88),
            item('B', 'BUY', 71),
            item('C', 'BUY', 80),
        ]);
        expect(groups[0].items.map(row => row.ticker)).toEqual(['A', 'B', 'C']);
    });

    it('a ordem canônica cobre todos os status conhecidos', () => {
        expect(new Set(ANCHOR_STATUS_ORDER).size).toBe(ANCHOR_STATUS_ORDER.length);
    });
});

describe('averageAnchorScore', () => {
    it('média simples do ranking publicado', () => {
        expect(averageAnchorScore([item('A', 'BUY', 80), item('B', 'WAIT', 70)])).toBe(75);
    });

    it('lista vazia não vira zero', () => {
        expect(averageAnchorScore([])).toBeNull();
    });
});
