/**
 * O TICKER CANÔNICO É UM NAMESPACE GLOBAL — e cabe UM dono por sigla.
 *
 * `MarketAsset.ticker` é `unique: true`. Não há `{ ticker, type }`: a classe é
 * campo da linha, não parte da chave. Três catálogos estáticos semeiam nesse
 * namespace (`cryptoList`, `sp500List` + `usEtfList`, `brEtfList`) e todos os
 * três usam `filter: { ticker }` + `$setOnInsert` — quem chega primeiro leva a
 * sigla, e quem chega depois casa com a linha alheia, não insere nada e não
 * levanta erro nenhum. `upsertedCount` apenas não sobe.
 *
 * MEDIDO EM PRODUÇÃO, 16/09/2026. `STX` era Stacks no catálogo de cripto e
 * Seagate Technology no S&P 500. Havia UMA linha no banco — a da Seagate — e a
 * Stacks nunca chegou a existir. Pior que sumir: o seed de cripto empurrava a
 * moeda para a fila de cotação de qualquer jeito, e a gravação (também por
 * `{ ticker }`) punha o preço da MOEDA na linha da AÇÃO. Dentro de um único run:
 *
 *   02:17:2x  seed de cripto     → STX = 0,24   (Stacks)
 *   02:17:40  refreshQuotesBatch → STX = 771,81 (Seagate)
 *
 * Dois caminhos escrevendo na mesma linha, cada um convicto de estar falando de
 * outro ativo. O único sintoma era o juiz de magnitude acusando 319888% todo
 * run — um alarme que se lê como erro de fonte e era, na verdade, duas
 * identidades brigando por uma linha.
 *
 * ISTO NÃO É O MESMO QUE A SIGLA DISPUTADA DO PROVEDOR. `crypto_symbol_map.spec`
 * trava a PERGUNTA (qual símbolo o Yahoo entende por `ARB`). Este arquivo trava a
 * LINHA: não adianta perguntar pelo ativo certo se a resposta é gravada em cima
 * do errado.
 */
import { describe, it, expect } from 'vitest';
import {
    SEEDED_CATALOGS,
    buildTickerOwnership,
    findTickerCollisions,
    describeCollision,
} from '../config/tickerNamespace.js';

describe('namespace do ticker canônico', () => {
    it('nenhuma sigla é reivindicada por duas CLASSES — o banco só comporta uma', () => {
        const { crossClass } = findTickerCollisions();
        // A mensagem carrega o caso inteiro: sem ela a falha diz que há colisão
        // mas não qual arquivo editar, que é a única coisa acionável aqui.
        expect(crossClass.map(describeCollision)).toEqual([]);
    });

    it('a Seagate ficou com STX; Stacks saiu do catálogo de cripto', () => {
        const dono = buildTickerOwnership().get('STX');
        expect(dono).toHaveLength(1);
        expect(dono[0].type).toBe('STOCK_US');
    });

    it('todo catálogo semeado declara a classe que grava', () => {
        for (const { source, type, assets } of SEEDED_CATALOGS) {
            expect(type, `${source} sem classe`).toBeTruthy();
            expect(assets.length, `${source} vazio`).toBeGreaterThan(0);
        }
    });

    it('toda entrada tem ticker não-vazio — sigla em branco casaria com qualquer linha', () => {
        const vazios = SEEDED_CATALOGS.flatMap(({ source, assets }) =>
            assets.filter((a) => !String(a.ticker || '').trim()).map(() => source));
        expect(vazios).toEqual([]);
    });
});

describe('repetição dentro da MESMA classe', () => {
    /*
     * Não corrompe linha: os dois seeds produziriam o mesmo documento. O que
     * custa é trabalho duplicado em toda varredura estática e a dica do segundo
     * catálogo caindo no chão (`$setOnInsert` só olha a primeira ocorrência).
     * Por isso é reportada, não proibida — e o universo do Exterior deduplica
     * mesclando antes de usar.
     */
    it('só os cinco REITs que moram no S&P 500 e na lista de ETFs', () => {
        const { sameClass } = findTickerCollisions();
        expect(sameClass.map((c) => c.ticker).sort()).toEqual(['AMT', 'EQIX', 'O', 'PLD', 'SPG']);
    });

    it('e todas concordam na classe — senão seriam colisão, não repetição', () => {
        const { sameClass } = findTickerCollisions();
        for (const c of sameClass) expect(c.classes).toEqual(['STOCK_US']);
    });
});

describe('detecção', () => {
    const catalogos = (...defs) => defs.map(([source, type, ...tickers]) => ({
        source, type, assets: tickers.map((ticker) => ({ ticker, name: ticker })),
    }));

    it('acusa a sigla disputada entre classes', () => {
        const { crossClass } = findTickerCollisions(
            catalogos(['a.js', 'CRYPTO', 'STX'], ['b.js', 'STOCK_US', 'STX']));
        expect(crossClass).toHaveLength(1);
        expect(crossClass[0].classes.sort()).toEqual(['CRYPTO', 'STOCK_US']);
    });

    it('separa repetição de colisão', () => {
        const r = findTickerCollisions(
            catalogos(['a.js', 'STOCK_US', 'O'], ['b.js', 'STOCK_US', 'O'], ['c.js', 'ETF', 'BOVA11']));
        expect(r.crossClass).toEqual([]);
        expect(r.sameClass.map((c) => c.ticker)).toEqual(['O']);
    });

    it('normaliza caixa e espaço — " stx " e "STX" são a mesma sigla no banco', () => {
        const { crossClass } = findTickerCollisions(
            catalogos(['a.js', 'CRYPTO', ' stx '], ['b.js', 'STOCK_US', 'STX']));
        expect(crossClass.map((c) => c.ticker)).toEqual(['STX']);
    });
});
