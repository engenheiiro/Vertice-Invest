/**
 * O que a etapa de fundamentos do sync grava no MarketAsset — e o que NÃO grava.
 *
 * Dois defeitos achados no sync:prod de 30/10/2026:
 *
 *  1. O mapa de typos fundia FIIs distintos. `RBHG11 → RBRL11`: o Fundamentus
 *     lista RBHG11 antes de RBRL11, então o RBRL11 recebia DY, P/VP, VP por cota,
 *     setor e preço do RBHG11 (54,79 contra 71,39), e o verdadeiro caía no filtro
 *     de duplicidade. Origem do "RBRL11 valendo 58,45" de 07/09/2026.
 *  2. Estar na listagem reativava o ativo e zerava `failCount` a cada sync, e o
 *     FII parado havia semanas (JASC11, REME11, KISU11…) nunca chegava à baixa.
 */
import { describe, expect, it } from 'vitest';
import { buildFundamentusAssetUpdate, correctSourceTicker } from '../services/syncService.js';

describe('correctSourceTicker', () => {
    it('corrige o typo que a fonte publica no lugar do nome certo', () => {
        expect(correctSourceTicker('CPLEE5', new Map())).toBe('CPLE6');
        expect(correctSourceTicker('JPSA3')).toBe('IGTI3');
    });

    it('NÃO funde dois papéis quando a fonte lista o "typo" e o alvo juntos', () => {
        // Mesmo que o par volte ao mapa por engano, a trava segura: typo de
        // verdade não convive com o nome certo na mesma listagem.
        const listagem = new Map([['CPLEE5', {}], ['CPLE6', {}]]);
        expect(correctSourceTicker('CPLEE5', listagem)).toBe('CPLEE5');
    });

    it('RBHG11 e BLMO11 são FIIs próprios, não erro de digitação', () => {
        expect(correctSourceTicker('RBHG11', new Map())).toBe('RBHG11');
        expect(correctSourceTicker('BLMO11', new Map())).toBe('BLMO11');
    });

    it('ticker fora do mapa passa intacto', () => {
        expect(correctSourceTicker('RBRL11', new Map([['RBRL11', {}]]))).toBe('RBRL11');
    });
});

describe('buildFundamentusAssetUpdate', () => {
    const timestamp = new Date('2026-10-30T21:58:00.000Z');
    const build = (data = {}) => buildFundamentusAssetUpdate({
        ticker: 'JASC11', type: 'FII', liquidity: 12_000, timestamp,
        data: { price: 8.1, dy: 12, pvp: 0.7, sector: 'Logística', ...data },
    });

    it('não reativa nem zera falhas de quem já existe: listagem não prova pregão', () => {
        const { $set } = build();
        expect($set).not.toHaveProperty('isActive');
        expect($set).not.toHaveProperty('failCount');
    });

    it('papel novo nasce ativo e sem falhas', () => {
        const { $setOnInsert } = build();
        expect($setOnInsert).toMatchObject({ isActive: true, failCount: 0, isBlacklisted: false, type: 'FII' });
    });

    it('grava os fundamentos com a assinatura do preço', () => {
        const { $set } = build({ vpCota: 9.9 });
        expect($set).toMatchObject({
            lastPrice: 8.1, priceSource: 'FUNDAMENTUS', dy: 12, p_vp: 0.7, vpCota: 9.9,
            liquidity: 12_000, lastFundamentalsDate: timestamp,
        });
    });

    it('LTM zerado não sobrescreve o valor bom que já está no banco', () => {
        expect(build({ marketCap: 0 }).$set).not.toHaveProperty('marketCap');
        expect(build({ marketCap: 5e8 }).$set.marketCap).toBe(5e8);
    });
});
