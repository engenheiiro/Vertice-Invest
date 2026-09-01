/**
 * "Variação hoje" da renda variável: a variação exibida tem de pertencer à SESSÃO
 * de hoje, não à última que o provedor devolveu.
 *
 * O defeito que estes testes travam: o cache guarda `change` e `updatedAt`, e
 * `updatedAt` responde quando NÓS perguntamos, não quando o mercado negociou. À
 * 00:23 de um dia útil o refresh regrava a linha com o fechamento da véspera e um
 * updatedAt de hoje — e a carteira exibia o pregão de ontem como variação de hoje
 * até a B3 abrir. Numa carteira real isso valia R$ 14,77 de movimento inventado,
 * o mesmo movimento já contado às 23h59 do dia anterior.
 */
import { describe, it, expect } from 'vitest';
import { processWalletAsset } from '../controllers/walletController.js';
import { brazilDateKey } from '../utils/dateUtils.js';

const HOJE = brazilDateKey();
const ONTEM = brazilDateKey(new Date(Date.now() - 86400000));

const macroRates = { cdiRate: 14.15, selic: 14.25, ipca: 4.72 };

// BOVA11 real da carteira que expôs o defeito: 7 cotas a R$ 174,78, fechamento de
// 31/08 (+1,1927%) sendo exibido às 00:17 de 01/09.
const bova = () => ({
    ticker: 'BOVA11',
    type: 'ETF',
    quantity: 7,
    totalCost: 1200,
    taxLots: [{ date: new Date('2026-06-01T00:00:00.000Z'), quantity: 7, price: 171.43 }],
});

const ctx = (cached, overrides = {}) => ({
    assetMap: new Map([['BOVA11', cached]]),
    usdRate: 5.18,
    usdChange: 0,
    macroRates,
    isTodayBusinessDay: true,
    todayKey: HOJE,
    ...overrides,
});

const quote = (priceDate) => ({ price: 174.78, change: 1.1927, priceDate });

// Posição de cripto da mesma carteira (BTC em 01/09/2026).
const btc = () => ({
    ticker: 'BTC',
    type: 'CRYPTO',
    quantity: 0.0005014,
    totalCost: 180,
    taxLots: [{ date: new Date('2026-06-01T00:00:00.000Z'), quantity: 0.0005014, price: 70000 }],
});

const ctxCripto = (cached) => ({
    assetMap: new Map([['BTC', cached]]),
    usdRate: 5.185,
    usdChange: 0,
    macroRates,
    isTodayBusinessDay: true,
    todayKey: HOJE,
});

describe('variação do dia só vale se a sessão for a de hoje', () => {
    it('sessão de ontem não vira "variação hoje", mesmo em dia útil', () => {
        const { processed, dayChangeValueBr } = processWalletAsset(bova(), ctx(quote(ONTEM)));
        expect(processed.dayChangePct).toBe(0);
        expect(dayChangeValueBr).toBe(0);
    });

    it('sessão de hoje aparece normalmente', () => {
        const { processed, dayChangeValueBr } = processWalletAsset(bova(), ctx(quote(HOJE)));
        expect(processed.dayChangePct).toBeCloseTo(1.1927, 4);
        // 1.223,46 − 1.223,46 / 1,011927 ≈ 14,42
        expect(dayChangeValueBr).toBeCloseTo(14.42, 2);
    });

    it('o saldo NÃO é afetado: só o rótulo do dia estava errado', () => {
        const comOntem = processWalletAsset(bova(), ctx(quote(ONTEM)));
        const comHoje = processWalletAsset(bova(), ctx(quote(HOJE)));
        expect(comOntem.totalValueBr).toBe(comHoje.totalValueBr);
        expect(comOntem.totalValueBr).toBeCloseTo(1223.46, 2);
    });

    it('cotação sem data de sessão mantém o comportamento antigo (fail-open)', () => {
        // Documento anterior à migração ou fonte que não publica horário: um número
        // defasado é melhor que zerar a variação da carteira inteira. O campo se
        // preenche sozinho no primeiro refresh.
        const semData = processWalletAsset(bova(), ctx(quote(null)));
        expect(semData.processed.dayChangePct).toBeCloseTo(1.1927, 4);

        const semDataFimDeSemana = processWalletAsset(
            bova(),
            ctx(quote(null), { isTodayBusinessDay: false }),
        );
        expect(semDataFimDeSemana.processed.dayChangePct).toBe(0);
    });

    it('a data da sessão manda mesmo quando o dia útil discorda', () => {
        // Fim de semana com priceDate de hoje não existe na prática, mas a ordem de
        // precedência precisa ser explícita: quem decide é a sessão, não o calendário.
        const { processed } = processWalletAsset(
            bova(),
            ctx(quote(HOJE), { isTodayBusinessDay: false }),
        );
        expect(processed.dayChangePct).toBeCloseTo(1.1927, 4);
    });

    it('cripto não é zerada pela guarda de sessão: negocia 24h, sem pregão a datar', () => {
        const { processed } = processWalletAsset(btc(), ctxCripto({ price: 78662.2, change: 1.18, previousClose: 78559.11, priceDate: ONTEM }));
        expect(processed.dayChangePct).toBeGreaterThan(0);
    });
});

describe('cripto mede o dia do FECHAMENTO ANTERIOR, não da janela de 24h', () => {
    // O change do provedor é uma janela DESLIZANTE: à 00h48 ele ainda carrega o dia
    // inteiro de ontem, que já está no patrimônio de ontem. Era a diferença entre o
    // card (R$ 14,48) e o gráfico (R$ 10,74) na carteira real.
    it('usa price / previousClose, e não o change de 24h', () => {
        const { processed } = processWalletAsset(
            btc(),
            ctxCripto({ price: 78662.2, change: 1.18, previousClose: 78559.11, priceDate: HOJE }),
        );
        // 78662,20 / 78559,11 − 1 = +0,1312% — o change de 24h diria +1,18%,
        // quase dez vezes mais. (Posição de ~R$200: o arredondamento monetário de 4
        // casas mexe na 3ª casa do percentual.)
        expect(processed.dayChangePct).toBeCloseTo(0.13, 2);
    });

    it('sem previousClose cai na janela do provedor (fail-open)', () => {
        const { processed } = processWalletAsset(
            btc(),
            ctxCripto({ price: 78662.2, change: 1.18, previousClose: 0, priceDate: HOJE }),
        );
        expect(processed.dayChangePct).toBeCloseTo(1.18, 2);
    });

    it('queda desde o fechamento aparece como queda, mesmo com 24h positivas', () => {
        // O caso que mais engana: subiu forte ontem à noite e caiu de madrugada.
        const { processed } = processWalletAsset(
            btc(),
            ctxCripto({ price: 78000, change: 1.18, previousClose: 78559.11, priceDate: HOJE }),
        );
        expect(processed.dayChangePct).toBeLessThan(0);
    });
});
