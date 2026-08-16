/**
 * Desativação por falha de cotação (`buildQuoteFailureOps`).
 *
 * A regra tem duas forças opostas e o teste existe para provar que nenhuma das
 * duas venceu por completo:
 *  - desativar cedo demais tira blue chip do ranking por instabilidade do provedor
 *    (foi o que aconteceu com B3SA3 quando o fallback do Google quebrou);
 *  - nunca desativar deixa ativo morto congelado para sempre — a auditoria de
 *    ago/2026 achou NEOE3, BK e CTRA parados de 26 a 134 dias, ainda elegíveis.
 *
 * A proteção de porte, portanto, ADIA a desativação; não a cancela.
 */
import { describe, it, expect } from 'vitest';
import { marketDataService } from '../services/marketDataService.js';

const asset = (over = {}) => ({
    ticker: 'TEST3',
    marketCap: 0,
    liquidity: 0,
    failCount: 0,
    lastFailDate: null,
    ...over,
});

/** Extrai o $set da única op gerada. */
const opFor = (a) => {
    const ops = marketDataService.buildQuoteFailureOps([a], new Set());
    return ops.length ? ops[0].updateOne.update.$set : null;
};

describe('contagem de falhas', () => {
    it('incrementa e carimba a data da falha', () => {
        const set = opFor(asset({ failCount: 3 }));
        expect(set.failCount).toBe(4);
        expect(set.lastFailDate).toBeInstanceOf(Date);
    });

    it('não conta duas falhas no mesmo dia', () => {
        const ops = marketDataService.buildQuoteFailureOps(
            [asset({ failCount: 3, lastFailDate: new Date() })],
            new Set(),
        );
        expect(ops).toHaveLength(0);
    });

    it('ticker que cotou com sucesso não gera op', () => {
        const ops = marketDataService.buildQuoteFailureOps([asset()], new Set(['TEST3']));
        expect(ops).toHaveLength(0);
    });
});

describe('ativo pequeno', () => {
    it('sobrevive abaixo do limiar', () => {
        expect(opFor(asset({ failCount: 8 })).isActive).toBeUndefined();
    });

    it('é desativado ao atingir 10 falhas', () => {
        expect(opFor(asset({ failCount: 9 })).isActive).toBe(false);
    });
});

describe('ativo grande — proteção com prazo', () => {
    const grandePorMcap = { marketCap: 41_000_000_000 };  // NEOE3
    const grandePorLiquidez = { liquidity: 5_000_000 };

    it('não é desativado no limiar comum (janela de instabilidade do provedor)', () => {
        expect(opFor(asset({ ...grandePorMcap, failCount: 9 })).isActive).toBeUndefined();
        expect(opFor(asset({ ...grandePorLiquidez, failCount: 20 })).isActive).toBeUndefined();
    });

    it('continua protegido às 44 falhas', () => {
        expect(opFor(asset({ ...grandePorMcap, failCount: 43 })).isActive).toBeUndefined();
    });

    it('regressão: às 45 falhas a proteção EXPIRA e o ativo é desativado', () => {
        // Sem este teto, NEOE3 (R$41bi) ficava ativo indefinidamente com preço de
        // 6 semanas atrás. Instabilidade de provedor dura dias, não 45.
        expect(opFor(asset({ ...grandePorMcap, failCount: 44 })).isActive).toBe(false);
        expect(opFor(asset({ ...grandePorLiquidez, failCount: 44 })).isActive).toBe(false);
    });

    it('a proteção adia, mas o contador nunca para de subir', () => {
        // O painel de Saúde depende do failCount continuar crescendo para conseguir
        // acusar o congelamento ANTES do teto.
        expect(opFor(asset({ ...grandePorMcap, failCount: 100 })).failCount).toBe(101);
    });
});
