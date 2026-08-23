/**
 * QUALIDADE ESTRUTURAL: métrica inaplicável ao arquétipo é AUSENTE.
 *
 * O bloco de QUALITY do scoringEngine avalia banco com a régua de uma empresa
 * industrial. Três dos quatro insumos não existem para um banco, e o código lia
 * o campo em branco como medição:
 *
 *   `debtToEquity = 0` (alavancagem que banco não publica) valia +25 de
 *   "Estrutura de Capital Excelente" no caminho cru — e −10 de "Alavancagem
 *   Elevada" no caminho preparado, onde o mesmo campo chega como NaN. O MESMO
 *   ticker tirava notas diferentes conforme o caminho (ITUB4: 90 e 30).
 *
 * Estes testes travam a intenção, não os números do dia.
 *
 * Fixtures ancoradas na base de produção lida em 22/08/2026.
 */
import { describe, expect, it } from 'vitest';
import { scoringEngine } from '../services/engines/scoringEngine.js';
import { observedPart, observedWeightedAverage } from '../utils/metricObservation.js';

const CONTEXT = { MACRO: { SELIC: 14.75, IPCA: 4.62, RISK_FREE: 14.75, NTNB_LONG: 7.25 } };

const NOTHING_MISSING = {
    pl: false, marketCap: false, roe: false, netMargin: false,
    revenueGrowth: false, evEbitda: false, beta: false, dy: false,
    debtToEquity: false, payout: false,
};

const makeStock = (ticker, sector, metrics = {}, top = {}) => ({
    ticker, type: 'STOCK', name: ticker, sector, fiiSubType: null, price: 30,
    dbFlags: { isBlacklisted: false, isTier1: false },
    metrics: {
        pl: 8, pvp: 1.4, roe: 0, netMargin: 0, evEbitda: 0, revenueGrowth: 0,
        debtToEquity: 0, payout: 0, dy: 7, marketCap: 50_000_000_000,
        avgLiquidity: 200_000_000, volatility: 25, beta: 1.05, sma200: 28,
        _missing: { ...NOTHING_MISSING }, _staleDays: 20,
        ...metrics, sector, fiiSubType: null,
    },
    ...top,
});

// BBAS3 e ITUB4 como estão na base: mesmos campos, ordens de grandeza distintas
// só onde o fundamento realmente difere.
const bbas3 = makeStock('BBAS3', 'Bancos', {
    roe: 7.99, netMargin: 0, debtToEquity: 0, revenueGrowth: -9.61, payout: 21.72, beta: 1.066,
}, { sectorMetrics: { roeTtm: 13.54, capitalRatio: 14.23, earningsGrowth: -52.81 } });

const itub4 = makeStock('ITUB4', 'Bancos', {
    roe: 22.45, netMargin: 0, debtToEquity: 0, revenueGrowth: 30.28, payout: 73.68, beta: 1.108,
}, { sectorMetrics: { roeTtm: 32.37, capitalRatio: 14.77, earningsGrowth: 13.00 } });

const qualityOf = asset => scoringEngine.processAsset(asset, CONTEXT).metrics.structural.quality;
const qualityFactors = asset => scoringEngine.processAsset(asset, CONTEXT)
    .auditLog.filter(entry => entry.category === 'Qualidade').map(entry => entry.factor);

describe('structural.quality — alavancagem não publicada não vira nota', () => {
    // O defeito nas duas direções: no caminho cru o zero virava nota MÁXIMA; no
    // caminho preparado (NaN) virava a PENALIDADE de alavancagem elevada.
    it('banco não recebe "Estrutura de Capital Excelente" por debtToEquity = 0', () => {
        const factors = qualityFactors(itub4);
        expect(factors).not.toContain('Estrutura Capital Excelente (D/P < 1.0)');
        expect(factors).not.toContain('Alavancagem Elevada');
        expect(factors.some(f => f.startsWith('debtToEquity:'))).toBe(true);
    });

    it('empresa industrial SEM dívida continua recebendo a nota máxima de estrutura', () => {
        // `debtToEquity = 0` numa operacional é medição legítima, não campo em branco.
        const factors = qualityFactors(makeStock('TAEE11', 'Energia Elétrica', {
            roe: 18, netMargin: 25, debtToEquity: 0, revenueGrowth: 12, payout: 60,
        }));
        expect(factors).toContain('Estrutura Capital Excelente (D/P < 1.0)');
    });

    it('a régua roda dentro do scorer: chamador que já apagou as métricas tira a mesma nota', () => {
        // Era aqui que o mesmo ticker tirava 90 na âncora e 30 no semanal: o
        // semanal apagava as métricas antes de chamar, a âncora não.
        const jaApagado = {
            ...itub4,
            metrics: {
                ...itub4.metrics,
                netMargin: Number.NaN, debtToEquity: Number.NaN, revenueGrowth: Number.NaN,
                _missing: { ...NOTHING_MISSING },
            },
        };
        expect(qualityOf(jaApagado)).toBe(qualityOf(itub4));
        expect(scoringEngine.processAsset(jaApagado, CONTEXT).scores)
            .toEqual(scoringEngine.processAsset(itub4, CONTEXT).scores);
    });

    it('NaN não escapa para quem persiste o resultado', () => {
        const metrics = scoringEngine.processAsset(itub4, CONTEXT).metrics;
        expect(metrics.netMargin).toBeNull();
        expect(metrics.debtToEquity).toBeNull();
        expect(metrics.roe).toBe(22.45);
    });
});

describe('inaplicabilidade vale para o scorer INTEIRO, não só para o bloco de qualidade', () => {
    const scoresOf = asset => scoringEngine.processAsset(asset, CONTEXT).scores;
    const factorsOf = asset => scoringEngine.processAsset(asset, CONTEXT).auditLog.map(e => e.factor);

    it('banco não é penalizado por "dado ausente" num campo que ninguém deixou de coletar', () => {
        // netMargin = 0 num banco é campo em branco, não coleta falha: cobrar
        // −15 de confiança por isso é cobrar duas vezes pela mesma inaplicabilidade.
        expect(factorsOf(itub4)).not.toContain('Dados de Rentabilidade Ausentes');
    });

    it('banco não ganha bônus de crescimento nem PEG por "receita" de intermediação', () => {
        const factors = factorsOf(itub4);
        expect(factors).not.toContain('Crescimento Receita Alto (>20%)');
        expect(factors.some(f => f.startsWith('PEG '))).toBe(false);
    });

    it('EV/EBITDA de seguradora não vira bônus de valuation', () => {
        // PSSA3 publica EV/EBITDA 0,44 — não existe EBITDA de seguradora, e o
        // número passava no teste de "< 8" valendo +20 de valuation.
        const pssa3 = makeStock('PSSA3', 'Seguros', {
            roe: 22.84, netMargin: 8.72, debtToEquity: -0.9, revenueGrowth: 14.34,
            evEbitda: 0.44, pl: 8.17, pvp: 1.87, payout: 40,
        });
        expect(factorsOf(pssa3)).not.toContain('EV/EBITDA Atrativo (<8)');
    });

    it('crescimento de PRÊMIO da seguradora continua pontuando — é receita de verdade', () => {
        const pssa3 = makeStock('PSSA3', 'Seguros', {
            roe: 22.84, netMargin: 8.72, debtToEquity: -0.9, revenueGrowth: 14.34,
            evEbitda: 0.44, pl: 8.17, pvp: 1.87, payout: 40,
        });
        expect(factorsOf(pssa3)).toContain('Crescimento de Receita Sólido (>10%)');
    });

    it('petroleira continua sendo premiada pelo crescimento de receita que ela publica', () => {
        // A matriz do eixo setorial apagava os +35,96% da PRIO3 e derrubava o
        // ARROJADO de 80 para 35 — medido na base em 22/08/2026.
        const prio3 = makeStock('PRIO3', 'Petróleo e Gás', {
            roe: 13.71, netMargin: 18.11, debtToEquity: 0.77, revenueGrowth: 35.96,
            evEbitda: 5.93, pl: 14.17, pvp: 1.94, payout: 0,
        });
        expect(factorsOf(prio3)).toContain('Hyper Growth (>25%)');
        expect(scoresOf(prio3).BOLD).toBeGreaterThan(scoresOf({
            ...prio3,
            metrics: { ...prio3.metrics, revenueGrowth: 0, _missing: { ...NOTHING_MISSING, revenueGrowth: true } },
        }).BOLD);
    });
});

describe('structural.quality — ROE recorrente do banco', () => {
    it('usa roeTtm do IF.data no lugar do ROE contábil deprimido', () => {
        // BBAS3: 7,99% no Fundamentus (reprovaria em tudo) contra 13,54% recorrente.
        // O rótulo cita o número recorrente, não o contábil — é como a auditoria
        // mostra ao leitor QUAL ROE entrou na conta.
        expect(qualityFactors(bbas3).some(f => f.includes('13.5%'))).toBe(true);
        expect(qualityFactors(bbas3).some(f => f.includes('7.99') || f.includes('8.0'))).toBe(false);
    });

    it('sem roeTtm o banco cai no ROE genérico, sem inventar dado', () => {
        const semRecorrente = { ...bbas3, sectorMetrics: { capitalRatio: 14.23 } };
        expect(qualityFactors(semRecorrente)).toContain('ROE Modesto / Baixo');
    });
});

describe('structural.quality — crescimento de RECEITA não separa banco', () => {
    // Era o segundo defeito: 25 dos 100 pontos decididos por um número que, para
    // banco, oscila com intermediação e marcação a mercado. BBAS3 −9,61% contra
    // ITUB4 +30,28% valia 25 pontos de diferença por si só.
    it('revenueGrowth não pontua para banco', () => {
        const factors = qualityFactors(itub4);
        expect(factors).not.toContain('Crescimento de Receita Sólido (>10%)');
        expect(factors.some(f => f.startsWith('revenueGrowth:'))).toBe(true);
    });

    it('a distância entre dois bancos vem do ROE recorrente, não de ruído', () => {
        // Esta asserção substitui um teto fixo de 65 pontos, escrito quando o
        // abismo entre BBAS3 e ITUB4 (21 x 90) vinha da régua industrial —
        // crescimento de RECEITA e alavancagem não publicada. Aquele teto media a
        // MAGNITUDE do desvio para provar a ATRIBUIÇÃO, e virou falso-positivo
        // quando a atribuição foi corrigida: com o ROE recorrente como único
        // insumo, 13,54% contra 32,37% é distância legítima, e a régua industrial
        // dá 0 a 8% das operacionais e 100 a 11% delas — os extremos não são
        // privilégio de banco.
        //
        // O que importa é a atribuição, e é isso que se trava aqui: zerar a única
        // diferença de fundamento tem que zerar a diferença de nota.
        const mesmoRoe = { ...bbas3, sectorMetrics: { ...bbas3.sectorMetrics, roeTtm: 32.37 } };
        const mesmoRoeEPayout = { ...mesmoRoe, metrics: { ...mesmoRoe.metrics, payout: 73.68 } };
        expect(qualityOf(mesmoRoeEPayout)).toBe(qualityOf(itub4));
    });

    it('bancos com ROE recorrente diferente não empatam na nota máxima', () => {
        // O defeito que esta rampa existe para impedir: a escada industrial
        // (>15 → 100) aplicada ao ROE RECORRENTE, que é ~1,5× o contábil, fazia
        // 10 dos 11 bancos da base empatarem em 100 — a nota deixava de separar.
        const roes = [20.80, 24.03, 32.37, 49.07];
        const notas = roes.map(roeTtm => qualityOf({
            ...itub4, sectorMetrics: { ...itub4.sectorMetrics, roeTtm },
        }));
        expect(new Set(notas).size).toBeGreaterThan(1);
        // E a ordem tem que acompanhar o fundamento, sem inversão.
        expect([...notas].sort((a, b) => a - b)).toEqual(notas);
    });

    it('bancos com ROE recorrente quase igual tiram nota quase igual', () => {
        // BAZA3 19,86 e BRSR6 19,82 na base: a diferença é ruído de medição e a
        // régua não pode transformá-la em degrau.
        const nota = roeTtm => qualityOf({ ...itub4, sectorMetrics: { ...itub4.sectorMetrics, roeTtm } });
        expect(Math.abs(nota(19.86) - nota(19.82))).toBeLessThan(2);
    });

    it('banco sem roeTtm é medido pela escada industrial, não pela rampa do recorrente', () => {
        // A régua acompanha a FONTE. Ler um ROE contábil de 14% pela rampa do
        // recorrente (12–30) o rebaixaria a 11 por ausência de dado — que é
        // exatamente o defeito que este módulo existe para impedir.
        const semRecorrente = makeStock('BMGB4', 'Bancos', {
            roe: 14.47, netMargin: 0, debtToEquity: 0, revenueGrowth: 0, payout: 42.7,
        }, { sectorMetrics: { capitalRatio: 12.10 } });
        expect(qualityFactors(semRecorrente)).toContain('ROE Saudável (>10%)');
    });
});

describe('structural.quality — arquétipo industrial continua sendo medido como indústria', () => {
    // Regressão contra reusar a matriz do EIXO SETORIAL aqui: ela marca
    // netMargin/debtToEquity/revenueGrowth como N/A para petroleira porque o eixo
    // dela prefere ebitdaMargin e netDebtEbitda — não porque uma petroleira não
    // tenha margem ou dívida. Reusá-la derrubava a PRIO3 de 90 para 60.
    it('produtora de óleo e gás mantém margem, alavancagem e crescimento', () => {
        const prio3 = makeStock('PRIO3', 'Petróleo e Gás', {
            roe: 13.71, netMargin: 18.11, debtToEquity: 0.77, revenueGrowth: 35.96, payout: 0,
        });
        const factors = qualityFactors(prio3);
        expect(factors).toContain('Margem Líquida Robusta (>10%)');
        expect(factors).toContain('Estrutura Capital Excelente (D/P < 1.0)');
        expect(factors).toContain('Crescimento de Receita Sólido (>10%)');
    });

    it('com os quatro insumos presentes o resultado é o do modelo aditivo anterior', () => {
        // 25 (ROE > 15) + 25 (margem > 10) + 25 (D/P < 1) + 25 (cresc. > 10)
        // + 15 (payout saudável) = 115, limitado a 100.
        const cheia = makeStock('FULL3', 'Energia Elétrica', {
            roe: 18, netMargin: 22, debtToEquity: 0.8, revenueGrowth: 12, payout: 55,
        });
        expect(qualityOf(cheia)).toBe(100);
        // E um caso sem estouro: 15 + 15 + 15 + 10 = 55, payout fora das faixas.
        const media = makeStock('MID3', 'Energia Elétrica', {
            roe: 12, netMargin: 7, debtToEquity: 1.5, revenueGrowth: 7, payout: 30,
        });
        expect(qualityOf(media)).toBe(55);
    });

    it('dado marcado como ausente redistribui o peso em vez de valer zero', () => {
        const semCrescimento = makeStock('NOG3', 'Energia Elétrica', {
            roe: 18, netMargin: 22, debtToEquity: 0.8, revenueGrowth: 0, payout: 55,
            _missing: { ...NOTHING_MISSING, revenueGrowth: true },
        });
        // Três observadas, todas na nota máxima: 100 (e não 75, que era imputar zero).
        expect(qualityOf(semCrescimento)).toBe(100);
        expect(qualityFactors(semCrescimento).some(f => f.startsWith('revenueGrowth:'))).toBe(true);
    });
});

describe('observedWeightedAverage', () => {
    it('redistribui o peso das ausentes entre as observadas', () => {
        const result = observedWeightedAverage([
            observedPart('a', 100, 0.25),
            observedPart('b', null, 0.25),
            observedPart('c', 60, 0.25),
            observedPart('d', undefined, 0.25),
        ]);
        expect(result.score).toBe(80);
        expect(result.observed).toBe(true);
        expect(result.observedWeight).toBe(0.5);
        expect(result.components.map(c => c.effectiveWeight)).toEqual([0.5, 0.5]);
    });

    it('NaN é ausente, não zero', () => {
        const result = observedWeightedAverage([
            observedPart('a', Number.NaN, 0.5),
            observedPart('b', 40, 0.5),
        ]);
        expect(result.score).toBe(40);
    });

    it('nada observado devolve observed=false — 0 ali é "sem informação"', () => {
        const result = observedWeightedAverage([observedPart('a', null, 1)]);
        expect(result).toMatchObject({ score: 0, observed: false, observedWeight: 0 });
    });
});
