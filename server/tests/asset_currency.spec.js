import { describe, it, expect } from 'vitest';
import { isDollarized, resolveAssetCurrency, resolveTransactionCurrency, needsCurrencyFallback } from '../utils/assetCurrency.js';
import AssetTransaction from '../models/AssetTransaction.js';

// Regressão do extrato em moeda errada: `price`/`totalValue` da AssetTransaction
// são gravados na moeda NATIVA do ativo, mas o extrato formatava tudo em R$.
// Uma compra de US$ 400 em AAPL aparecia como "R$ 400,00" e a soma do extrato
// não fechava com o Valor Aplicado da carteira, que converte pelo câmbio.

describe('isDollarized — regra única de moeda do ativo', () => {
    it('STOCK_US é dólar mesmo sem o campo currency (posições legadas)', () => {
        expect(isDollarized({ type: 'STOCK_US' })).toBe(true);
    });

    it('CRYPTO é dólar mesmo sem o campo currency', () => {
        expect(isDollarized({ type: 'CRYPTO' })).toBe(true);
    });

    it('currency=USD dolariza qualquer tipo — é como o ETF internacional se distingue', () => {
        // BOVA11 e VOO são ambos type=ETF; só a moeda os separa.
        expect(isDollarized({ type: 'ETF', currency: 'USD' })).toBe(true);
        expect(isDollarized({ type: 'ETF', currency: 'BRL' })).toBe(false);
    });

    it('ativos brasileiros não são dolarizados', () => {
        expect(isDollarized({ type: 'STOCK', currency: 'BRL' })).toBe(false);
        expect(isDollarized({ type: 'FII' })).toBe(false);
        expect(isDollarized({ type: 'FIXED_INCOME' })).toBe(false);
        expect(isDollarized({ type: 'CASH' })).toBe(false);
    });

    it('tolera null/undefined/objeto vazio sem lançar', () => {
        expect(isDollarized(null)).toBe(false);
        expect(isDollarized(undefined)).toBe(false);
        expect(isDollarized({})).toBe(false);
    });
});

describe('resolveAssetCurrency', () => {
    it('mapeia para USD/BRL', () => {
        expect(resolveAssetCurrency({ type: 'STOCK_US' })).toBe('USD');
        expect(resolveAssetCurrency({ type: 'STOCK' })).toBe('BRL');
    });

    it('sem ativo cai em BRL (moeda base do app)', () => {
        expect(resolveAssetCurrency(null)).toBe('BRL');
    });
});

describe('resolveTransactionCurrency — precedência', () => {
    it('1) moeda gravada vence a posição atual (registro histórico é imutável)', () => {
        // Correção de cadastro não pode reescrever o passado: US$ 400 pagos
        // continuam US$ 400, mesmo que o ativo hoje esteja marcado como BRL.
        const tx = { currency: 'USD' };
        expect(resolveTransactionCurrency(tx, { type: 'STOCK', currency: 'BRL' })).toBe('USD');
    });

    it('2) sem moeda gravada, usa a posição atual (lançamento pré-migração)', () => {
        expect(resolveTransactionCurrency({}, { type: 'STOCK_US' })).toBe('USD');
        expect(resolveTransactionCurrency({}, { type: 'FII' })).toBe('BRL');
    });

    it('3) sem moeda e sem posição (venda total), cai em BRL — igual ao legado', () => {
        expect(resolveTransactionCurrency({}, null)).toBe('BRL');
        expect(resolveTransactionCurrency({})).toBe('BRL');
    });

    it('ignora valor gravado inválido e volta ao fallback', () => {
        expect(resolveTransactionCurrency({ currency: 'EUR' }, { type: 'STOCK_US' })).toBe('USD');
        expect(resolveTransactionCurrency({ currency: null }, { type: 'CRYPTO' })).toBe('USD');
    });

    it('tolera tx null', () => {
        expect(resolveTransactionCurrency(null, { type: 'STOCK_US' })).toBe('USD');
        expect(resolveTransactionCurrency(null, null)).toBe('BRL');
    });
});

describe('needsCurrencyFallback — evita consultar posições à toa', () => {
    // As rotas de extrato só vão ao banco buscar UserAsset quando a página tem
    // lançamento legado. Com a base migrada, a consulta extra some.
    it('moeda gravada válida dispensa o fallback', () => {
        expect(needsCurrencyFallback({ currency: 'BRL' })).toBe(false);
        expect(needsCurrencyFallback({ currency: 'USD' })).toBe(false);
    });

    it('ausente ou inválida exige o fallback', () => {
        expect(needsCurrencyFallback({})).toBe(true);
        expect(needsCurrencyFallback({ currency: null })).toBe(true);
        expect(needsCurrencyFallback({ currency: 'EUR' })).toBe(true);
        expect(needsCurrencyFallback(null)).toBe(true);
    });

    it('concorda com resolveTransactionCurrency (uma definição só)', () => {
        // Se não precisa de fallback, o resolve devolve exatamente o gravado —
        // sem consultar a posição (aqui passada como null de propósito).
        const gravados = [{ currency: 'BRL' }, { currency: 'USD' }];
        gravados.forEach((tx) => {
            expect(needsCurrencyFallback(tx)).toBe(false);
            expect(resolveTransactionCurrency(tx, null)).toBe(tx.currency);
        });
    });

    it('uma página inteira migrada não dispara nenhuma busca', () => {
        const page = [{ currency: 'USD' }, { currency: 'BRL' }, { currency: 'BRL' }];
        expect(page.some(needsCurrencyFallback)).toBe(false);
    });

    it('uma única linha legada na página já dispara a busca', () => {
        const page = [{ currency: 'USD' }, {}, { currency: 'BRL' }];
        expect(page.some(needsCurrencyFallback)).toBe(true);
    });
});

describe('AssetTransaction.currency — invariante do schema', () => {
    // Este é o detalhe que sustenta todo o fallback: o Mongoose aplica defaults ao
    // HIDRATAR documentos que não têm o campo. Um `default: 'BRL'` faria lançamentos
    // legados voltarem como 'BRL' e o passo 2 da precedência nunca rodaria — uma
    // compra em dólar não migrada seria lida como real, de novo.
    it('NÃO tem default (ausente precisa continuar distinguível de BRL)', () => {
        const path = AssetTransaction.schema.path('currency');
        expect(path).toBeDefined();
        expect(path.defaultValue).toBeUndefined();
    });

    it('documento novo sem moeda não ganha valor implícito', () => {
        const doc = new AssetTransaction({
            user: '000000000000000000000001',
            wallet: '000000000000000000000002',
            ticker: 'AAPL', type: 'BUY', quantity: 1, price: 328.5, totalValue: 328.5, date: new Date(),
        });
        expect(doc.currency).toBeUndefined();
        // E o fallback pela posição assume corretamente.
        expect(resolveTransactionCurrency(doc, { type: 'STOCK_US' })).toBe('USD');
    });

    it('aceita apenas BRL/USD', () => {
        const path = AssetTransaction.schema.path('currency');
        expect(path.enumValues).toEqual(['BRL', 'USD']);
    });
});

describe('regressão: extrato da Carteira 02 fecha com o Valor Aplicado', () => {
    // Caso real que expôs o bug. O Aplicado exibia R$ 8.843,15; somar o extrato
    // como se tudo fosse real dava R$ 5.172,50. A diferença era exatamente o
    // câmbio sobre as duas linhas americanas.
    // Câmbio derivado do próprio caso: (Aplicado − parte em BRL) / US$ em custo.
    const USD_RATE = (8843.15 - 4272.5) / 900; // ≈ 5,0785

    const positions = [
        { ticker: 'BOVA11', type: 'ETF', currency: 'BRL', totalCost: 1697.0 },
        { ticker: 'PETR4', type: 'STOCK', currency: 'BRL', totalCost: 2075.5 },
        { ticker: 'PÓS-FIXADO', type: 'FIXED_INCOME', currency: 'BRL', totalCost: 500.0 },
        { ticker: 'AAPL', type: 'STOCK_US', currency: 'USD', totalCost: 400.0 },
        { ticker: 'VOO', type: 'STOCK_US', currency: 'USD', totalCost: 500.0 },
    ];

    it('Valor Aplicado converte só as posições dolarizadas', () => {
        const invested = positions.reduce(
            (acc, p) => acc + p.totalCost * (isDollarized(p) ? USD_RATE : 1),
            0,
        );
        expect(invested).toBeCloseTo(8843.15, 2);
    });

    it('o extrato rotula cada linha na moeda certa', () => {
        const txs = positions.map((p) => ({
            ticker: p.ticker,
            totalValue: p.totalCost,
            currency: resolveAssetCurrency(p),
        }));
        expect(txs.filter((t) => t.currency === 'USD').map((t) => t.ticker)).toEqual(['AAPL', 'VOO']);
        expect(txs.filter((t) => t.currency === 'BRL')).toHaveLength(3);
    });

    it('somando o extrato pela moeda de cada linha, reconcilia com o Aplicado', () => {
        const txs = positions.map((p) => ({ totalValue: p.totalCost, currency: resolveAssetCurrency(p) }));
        const totalBRL = txs.reduce((acc, t) => acc + t.totalValue * (t.currency === 'USD' ? USD_RATE : 1), 0);
        expect(totalBRL).toBeCloseTo(8843.15, 2);

        // E o bug antigo: tratar tudo como real subestimava em R$ 3.670,65.
        const naive = txs.reduce((acc, t) => acc + t.totalValue, 0);
        expect(naive).toBeCloseTo(5172.5, 2);
        expect(totalBRL - naive).toBeCloseTo(3670.65, 2);
    });
});
