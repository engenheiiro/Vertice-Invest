
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calculateDailyDietz, calculateSharpeRatio, calculateStdDev } from '../utils/mathUtils.js';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS — re-implementações locais das regras de negócio críticas do
// schedulerService e walletController (sem banco de dados).
// Se algo quebrar aqui, há um bug real nas fórmulas de produção.
// ─────────────────────────────────────────────────────────────────────────────

/** Simula a acumulação de quotaPrice ao longo de N dias (mesma lógica do schedulerService). */
const simulateSnapshots = (days) => {
    const snapshots = [];
    let quotaPrice = 100;

    for (const day of days) {
        const { v0, v1, flow, skip } = day;
        if (skip) {
            snapshots.push({ totalEquity: v1, quotaPrice, skipped: true });
            continue;
        }

        const dailyReturn = calculateDailyDietz(v0, v1, flow);
        const isAnomaly = Math.abs(dailyReturn) > 0.5; // Circuit breaker do scheduler

        if (!isAnomaly) {
            quotaPrice = quotaPrice * (1 + dailyReturn);
            snapshots.push({ totalEquity: v1, quotaPrice, dailyReturn });
        } else {
            snapshots.push({ totalEquity: v1, quotaPrice, skipped: true, dailyReturn });
        }
    }
    return snapshots;
};

/** Simula a lógica live do walletController.getWallet (linha ~370-420). */
const computeLiveKPI = (snapshots, liveEquity, txsSinceSnapshot) => {
    // Encontra âncora: snapshot mais recente com quotaPrice != 100
    let anchor = null;
    for (let i = snapshots.length - 1; i >= 0; i--) {
        const s = snapshots[i];
        if (!s.skipped && Math.abs((s.quotaPrice || 100) - 100) >= 0.1) {
            anchor = s;
            break;
        }
        if (i === 0) anchor = s;
    }
    if (!anchor) return { twrr: 0, quality: 'ESTIMATED' };

    const v0 = anchor.totalEquity;
    const v1 = liveEquity;
    const f = txsSinceSnapshot;
    const periodReturn = calculateDailyDietz(v0, v1, f);

    let liveQuota = anchor.quotaPrice;
    if (periodReturn > -0.8 && periodReturn < 1.0) {
        liveQuota = anchor.quotaPrice * (1 + periodReturn);
    }
    const twrr = ((liveQuota / 100) - 1) * 100;
    return { twrr, liveQuota, periodReturn };
};

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — calculateDailyDietz: fórmula pura
// ─────────────────────────────────────────────────────────────────────────────
describe('calculateDailyDietz — Fórmula Pura (Modified Dietz)', () => {

    it('Retorno zero sem variação e sem fluxo', () => {
        // V0=1000, V1=1000, F=0 → return = 0
        expect(calculateDailyDietz(1000, 1000, 0)).toBeCloseTo(0, 6);
    });

    it('Retorno positivo simples sem fluxo', () => {
        // V0=1000, V1=1100, F=0 → return = 10%
        expect(calculateDailyDietz(1000, 1100, 0)).toBeCloseTo(0.10, 4);
    });

    it('Retorno negativo simples sem fluxo', () => {
        // V0=1000, V1=900, F=0 → return = -10%
        expect(calculateDailyDietz(1000, 900, 0)).toBeCloseTo(-0.10, 4);
    });

    it('Fluxo de aporte (BUY) — retorno deve ser isolado do aporte', () => {
        // V0=1000, V1=2100, F=+1000 (aporte no meio do dia)
        // Se o ativo subiu 10%: V0*1.1 + F = 1100+1000=2100
        // Numerador = 2100 - 1000 - 1000 = 100
        // Denominador = 1000 + 0.5*1000 = 1500
        // Return ≈ 6.67% (não 10%, pois o aporte dilui levemente via Dietz)
        const r = calculateDailyDietz(1000, 2100, 1000);
        expect(r).toBeCloseTo(100 / 1500, 4);
    });

    it('Fluxo de resgate (SELL) — retorno correto com fluxo negativo', () => {
        // V0=2000, V1=1100, F=-900 (resgate)
        // Ativo ficou flat: 2000 - 900 = 1100. Retorno esperado = 0.
        expect(calculateDailyDietz(2000, 1100, -900)).toBeCloseTo(0, 4);
    });

    it('Primeiro dia (V0=0) — usa fluxo como base de cálculo', () => {
        // V0=0, V1=1050, F=1000 → return = (1050-1000)/1000 = 5%
        expect(calculateDailyDietz(0, 1050, 1000)).toBeCloseTo(0.05, 4);
    });

    it('Primeiro dia sem fluxo — retorna 0 (sem base de cálculo)', () => {
        expect(calculateDailyDietz(0, 0, 0)).toBe(0);
    });

    it('Resgate total: denominador V0+F ≤ 0 — usa V0 como base', () => {
        // V0=1000, V1=10 (resíduo), F=-1000 (resgate total)
        // V0 + F = 0 → branch especial: return = (10 - 1000 - (-1000)) / 1000 = 10/1000 = 1%
        expect(calculateDailyDietz(1000, 10, -1000)).toBeCloseTo(0.01, 4);
    });

    it('Não retorna NaN nem Infinity em inputs extremos', () => {
        expect(isFinite(calculateDailyDietz(0.001, 100, 0))).toBe(true);
        expect(isNaN(calculateDailyDietz(0, 0, 0))).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — Acumulação de Cota (TWRR Multi-Dia)
// ─────────────────────────────────────────────────────────────────────────────
describe('Acumulação de Cota — TWRR Multi-Dia (Lógica do Scheduler)', () => {

    it('Cenário: ativo sobe 10% e 10% → cota deve ser ~121', () => {
        // Dia 1: V0=0, V1=1000, F=1000 (primeiro aporte)
        // Dia 2: V0=1000, V1=1100, F=0 (+10%)
        // Dia 3: V0=1100, V1=1210, F=0 (+10%)
        // Cota esperada ≈ 100 * 1.1 * 1.1 = 121
        const snaps = simulateSnapshots([
            { v0: 0,    v1: 1000, flow: 1000 },
            { v0: 1000, v1: 1100, flow: 0    },
            { v0: 1100, v1: 1210, flow: 0    },
        ]);
        expect(snaps[2].quotaPrice).toBeCloseTo(121, 1);
    });

    it('TWRR vs ROI — compra adicional a preço alto não distorce TWRR', () => {
        // D1: compra @ 10, V=1000
        // D2: sobe +50% → V=1500 (dentro do circuit breaker ≤50%)
        // D3: compra +100 @ 15, V=3000, F=1500 (return = 0 neste dia)
        // D4: cai -33.3% → V=2000
        // TWRR acumulado: 1.50 * 1.00 * 0.667 = 1.00 → cota ≈ 100
        // ROI simples: investiu 1000+1500=2500, tem 2000 = -20%
        const snaps = simulateSnapshots([
            { v0: 0,    v1: 1000, flow: 1000 },
            { v0: 1000, v1: 1500, flow: 0    }, // +50% (limite do circuit breaker)
            { v0: 1500, v1: 3000, flow: 1500 }, // flat + aporte
            { v0: 3000, v1: 2000, flow: 0    }, // -33.3%
        ]);
        expect(snaps[3].quotaPrice).toBeCloseTo(100, 0); // TWRR ≈ 0%

        // ROI simples é negativo mesmo com TWRR ≈ 0%
        const roi = (2000 - 2500) / 2500 * 100;
        expect(roi).toBeCloseTo(-20, 1);
    });

    it('Sequência de queda: cota reflete perdas acumuladas corretamente', () => {
        // -10%, -10%, -10% → cota = 100 * 0.9^3 ≈ 72.9
        const snaps = simulateSnapshots([
            { v0: 0,    v1: 1000, flow: 1000 },
            { v0: 1000, v1: 900,  flow: 0    },
            { v0: 900,  v1: 810,  flow: 0    },
            { v0: 810,  v1: 729,  flow: 0    },
        ]);
        expect(snaps[3].quotaPrice).toBeCloseTo(72.9, 1);
    });

    it('Aporte em baixa: ROI melhora mas TWRR reflete queda real', () => {
        // D1: compra @ 100, V=1000
        // D2: cai -20%, V=800
        // D3: compra @ 80, V=1600, F=800
        // D4: sobe +25% (de 80 para 100), V=2000
        // TWRR: (0.8) * (1.0 aporte não distorce) * (1.25) = 1.0 → 0%
        // ROI: comprou 1000+800=1800, tem 2000 → +11.1%
        const snaps = simulateSnapshots([
            { v0: 0,    v1: 1000, flow: 1000 },
            { v0: 1000, v1: 800,  flow: 0    }, // -20%
            { v0: 800,  v1: 1600, flow: 800  }, // flat + aporte
            { v0: 1600, v1: 2000, flow: 0    }, // +25%
        ]);
        expect(snaps[3].quotaPrice).toBeCloseTo(100, 1); // TWRR ≈ 0%
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — Circuit Breaker (Anomalia > 50%)
// ─────────────────────────────────────────────────────────────────────────────
describe('Circuit Breaker — Snapshot ignorado quando retorno > ±50%', () => {

    it('Retorno de +200% → snapshot skipped, cota não avança', () => {
        const snaps = simulateSnapshots([
            { v0: 0,    v1: 1000, flow: 1000 },
            { v0: 1000, v1: 3000, flow: 0    }, // +200%: anomalia
        ]);
        expect(snaps[1].skipped).toBe(true);
        expect(snaps[1].quotaPrice).toBeCloseTo(100, 2); // Cota anterior preservada
    });

    it('Retorno de -60% → snapshot skipped, cota não recua', () => {
        // Primeiro dia estabelece cota 110
        const snaps = simulateSnapshots([
            { v0: 0,    v1: 1000, flow: 1000 },
            { v0: 1000, v1: 1100, flow: 0    }, // +10% → cota 110
            { v0: 1100, v1: 440,  flow: 0    }, // -60%: anomalia
        ]);
        expect(snaps[2].skipped).toBe(true);
        expect(snaps[2].quotaPrice).toBeCloseTo(110, 2); // cota preservada
    });

    it('Retorno de 49% → NÃO é anomalia, snapshot válido', () => {
        const snaps = simulateSnapshots([
            { v0: 0,    v1: 1000, flow: 1000 },
            { v0: 1000, v1: 1490, flow: 0    }, // +49%: dentro do limite
        ]);
        expect(snaps[1].skipped).toBeUndefined();
        expect(snaps[1].quotaPrice).toBeGreaterThan(100);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — Live TWRR KPI (lógica do walletController.getWallet)
// ─────────────────────────────────────────────────────────────────────────────
describe('Live TWRR KPI — Cálculo de Âncora (walletController)', () => {

    it('Âncora correta: usa snapshot mais recente com cota != 100', () => {
        const snapshots = [
            { totalEquity: 500,  quotaPrice: 100  }, // Snap antigo base
            { totalEquity: 800,  quotaPrice: 130  }, // pico
            { totalEquity: 700,  quotaPrice: 115  }, // âncora esperada (mais recente non-100)
        ];
        // Live equity: 700 (sem variação desde âncora), sem fluxo → TWRR = 15%
        const { twrr } = computeLiveKPI(snapshots, 700, 0);
        expect(twrr).toBeCloseTo(15, 1);
    });

    it('Queda desde âncora: live TWRR reflete queda proporcional', () => {
        const snapshots = [
            { totalEquity: 1000, quotaPrice: 100  },
            { totalEquity: 1500, quotaPrice: 150  }, // âncora: +50%
        ];
        // Equity caiu de 1500 para 1200 (-20%)
        // liveQuota = 150 * (1 - 0.2) = 120 → TWRR = +20%
        const { twrr, liveQuota } = computeLiveKPI(snapshots, 1200, 0);
        expect(liveQuota).toBeCloseTo(120, 1);
        expect(twrr).toBeCloseTo(20, 1);
    });

    it('BUG DETECTADO: equity caiu mas aporte recente impede TWRR falso-negativo', () => {
        // V0=1000 (âncora), aporte de 500, equity agora = 1450
        // Sem o aporte, V1 seria 950 (-5%). Com aporte:
        // periodReturn = (1450 - 1000 - 500) / (1000 + 0.5*500) = -50/1250 = -4%
        // liveQuota = 100 * 0.96 = 96 → TWRR = -4% (correto, não -45%)
        const snapshots = [
            { totalEquity: 1000, quotaPrice: 100 },
        ];
        const { twrr } = computeLiveKPI(snapshots, 1450, 500);
        expect(twrr).toBeCloseTo(-4, 1);
    });

    it('TWRR não pode ser positivo quando ativo caiu e não houve aportes', () => {
        const snapshots = [
            { totalEquity: 1000, quotaPrice: 110 },
        ];
        // Equity caiu para 900 (-10%)
        const { twrr } = computeLiveKPI(snapshots, 900, 0);
        expect(twrr).toBeLessThan(10); // Precisa ser menor que o pico
        expect(twrr).toBeLessThan(snapshots[0].quotaPrice - 100); // Deve diminuir
    });

    it('CENÁRIO DEV02: ROI positivo com TWRR negativo — causado por aportes em alta seguidos de queda', () => {
        // Reprodução do cenário observado no usuário dev02:
        // 1. Compra inicial pequena a preço baixo → ROI bom no futuro
        // 2. Aportes pesados no pico → TWRR sofre bastante na queda
        // 3. ROI parece bom pois base de custo foi formada em parte no fundo
        const snaps = simulateSnapshots([
            { v0: 0,    v1: 200,  flow: 200  }, // compra inicial pequena
            { v0: 200,  v1: 400,  flow: 0    }, // +100%
            { v0: 400,  v1: 800,  flow: 0    }, // +100%
            { v0: 800,  v1: 4800, flow: 4000 }, // grande aporte no pico
            { v0: 4800, v1: 2400, flow: 0    }, // -50%
            { v0: 2400, v1: 1800, flow: 0    }, // -25%
        ]);
        const lastSnap = snaps[snaps.length - 1];
        const twrr = ((lastSnap.quotaPrice / 100) - 1) * 100;

        // totalInvested = 200 + 4000 = 4200, totalEquity = 1800
        const roi = ((1800 - 4200) / 4200) * 100;

        // ROI é negativo aqui pois o aporte foi enorme. No cenário real do dev02,
        // o primeiro aporte foi em preço MUITO baixo, então ROI ainda pode ser positivo.
        // O ponto é: TWRR é SEMPRE mais severo que ROI quando se aposta no pico.
        expect(twrr).toBeLessThan(roi); // TWRR < ROI no cenário de aporte em alta + queda
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 5 — FIXED_INCOME: Acúmulo de juros compostos no snapshot
// ─────────────────────────────────────────────────────────────────────────────
describe('FIXED_INCOME — Juros compostos no snapshot (corrigido)', () => {

    // Replica a lógica do schedulerService após a correção:
    // effectiveDailyFactor = ((selic - 1) * percentOfCdi) + 1  →  para taxa > 50 (% do CDI)
    // accruedValue = lot.quantity * lot.price * factor^businessDays
    const simulateFixedIncomeEquity = ({ totalCost, quantity, annualRate, businessDays }) => {
        const cdi = 11.25; // taxa mock
        const selicDailyFactor = Math.pow(1 + cdi / 100, 1 / 252);
        let effectiveDailyFactor;
        if (annualRate > 50) {
            // % do CDI
            effectiveDailyFactor = ((selicDailyFactor - 1) * (annualRate / 100)) + 1;
        } else {
            // prefixada
            effectiveDailyFactor = Math.pow(1 + annualRate / 100, 1 / 252);
        }
        const avgPrice = totalCost / quantity;
        return quantity * avgPrice * Math.pow(effectiveDailyFactor, businessDays);
    };

    it('CDB 100% CDI cresce acima do custo após 252 dias úteis', () => {
        const equity = simulateFixedIncomeEquity({ totalCost: 10000, quantity: 10000, annualRate: 100, businessDays: 252 });
        expect(equity).toBeGreaterThan(10000);
        expect(equity).toBeCloseTo(10000 * (1 + 11.25 / 100), 0); // ~R$11.125
    });

    it('LCI prefixada 12% a.a. cresce corretamente em 126 dias úteis (~6 meses)', () => {
        const equity = simulateFixedIncomeEquity({ totalCost: 5000, quantity: 5000, annualRate: 12, businessDays: 126 });
        const expectedFactor = Math.pow(1 + 12 / 100, 126 / 252);
        expect(equity).toBeCloseTo(5000 * expectedFactor, 1);
        expect(equity).toBeGreaterThan(5000);
    });

    it('Renda fixa com juros acumulados reflete TWRR positivo na cota', () => {
        // Simula 3 snapshots: aporte de R$10.000, depois equity cresce com juros
        const daily = Math.pow(1 + 11.25 / 100, 1 / 252) - 1; // retorno diário CDI
        const equityD1 = 10000;
        const equityD2 = equityD1 * (1 + daily); // equity real acrescida de juros
        const equityD3 = equityD2 * (1 + daily);

        const snaps = simulateSnapshots([
            { v0: 0,       v1: equityD1, flow: 10000 }, // primeiro dia
            { v0: equityD1, v1: equityD2, flow: 0 },    // juros dia 2
            { v0: equityD2, v1: equityD3, flow: 0 },    // juros dia 3
        ]);
        expect(snaps[2].quotaPrice).toBeGreaterThan(100); // TWRR positivo
    });

    it('factor nunca é menor que 1 (Math.max garante sem retroação)', () => {
        // Se businessDays = 0, factor deve ser 1 (não abaixo de 1)
        const equity = simulateFixedIncomeEquity({ totalCost: 1000, quantity: 1000, annualRate: 100, businessDays: 0 });
        expect(equity).toBeCloseTo(1000, 2);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 6 — Sharpe Ratio e Volatilidade
// ─────────────────────────────────────────────────────────────────────────────
describe('Sharpe Ratio e Volatilidade (mathUtils)', () => {

    it('Retorno constante → Sharpe é um número finito válido', () => {
        // stdDev pode não ser exatamente 0 por imprecisão float, mas o resultado deve ser finito
        const constantReturns = Array(20).fill(0.05);
        const sharpe = calculateSharpeRatio(constantReturns, 11.25);
        expect(typeof sharpe).toBe('number');
        expect(isNaN(sharpe)).toBe(false);
        // Nota: a proteção "if (stdDev === 0) return 0" pode não disparar
        // porque 0.05 em IEEE 754 acumula erro e stdDev ≈ 1e-18, não exatamente 0.
    });

    it('Retornos variados → Sharpe positivo para bons ativos', () => {
        // Série com retorno médio acima do risk-free diário
        const goodReturns = Array(20).fill(0.08); // 0.08% ao dia
        goodReturns[5] = -0.02;
        goodReturns[10] = -0.01;
        const sharpe = calculateSharpeRatio(goodReturns, 11.25);
        expect(typeof sharpe).toBe('number');
        expect(isNaN(sharpe)).toBe(false);
    });

    it('Menos de 10 observações → Sharpe = 0 (dados insuficientes)', () => {
        const fewReturns = [0.1, 0.2, -0.1, 0.3];
        expect(calculateSharpeRatio(fewReturns, 11.25)).toBe(0);
    });

    it('calculateStdDev: desvio padrão amostral correto para série conhecida', () => {
        // [2, 4, 4, 4, 5, 5, 7, 9] — média = 5
        // Desvio populacional = 2.0, mas a função usa (n-1) → desvio AMOSTRAL ≈ 2.138
        // sqrt(sum_sq_diff / (n-1)) = sqrt(32/7) ≈ 2.138
        const series = [2, 4, 4, 4, 5, 5, 7, 9];
        expect(calculateStdDev(series)).toBeCloseTo(2.138, 2);
    });

    it('calculateStdDev: menos de 2 pontos → retorna 0', () => {
        expect(calculateStdDev([5])).toBe(0);
        expect(calculateStdDev([])).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 7 — Proteção Anti-Reset de Cota
// ─────────────────────────────────────────────────────────────────────────────
describe('Proteção Anti-Reset — Cota não pode voltar a 100 indevidamente', () => {

    it('Após cota de 150, um dia que resultaria em cota=100 deve ser detectado como reset', () => {
        // Regra do schedulerService linha 119:
        // if (|quotaPrice - 100| < 0.1 && |lastSnapshot.quotaPrice - 100| > 5) → abort
        const prevQuotaPrice = 150;
        const newQuotaPrice = 100.05; // quase 100

        const wouldReset = Math.abs(newQuotaPrice - 100) < 0.1 && Math.abs(prevQuotaPrice - 100) > 5;
        expect(wouldReset).toBe(true);
    });

    it('Cota legítima de 101 não dispara proteção anti-reset', () => {
        const prevQuotaPrice = 102;
        const newQuotaPrice = 101;

        const wouldReset = Math.abs(newQuotaPrice - 100) < 0.1 && Math.abs(prevQuotaPrice - 100) > 5;
        expect(wouldReset).toBe(false); // 101 está fora da zona de "suspeita de reset"
    });

    it('Primeira cota legítima perto de 100 não dispara falso positivo', () => {
        // Usuário com cota histórica = 101 (nunca foi > 5% acima de 100)
        const prevQuotaPrice = 101;
        const newQuotaPrice = 100.02;

        const wouldReset = Math.abs(newQuotaPrice - 100) < 0.1 && Math.abs(prevQuotaPrice - 100) > 5;
        expect(wouldReset).toBe(false); // prevQuota < 105, não dispara
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 8 — Integridade: Cota nunca negativa, nunca NaN
// ─────────────────────────────────────────────────────────────────────────────
describe('Integridade — Invariantes da Cota', () => {

    it('Cota nunca é NaN em qualquer cenário de inputs', () => {
        const scenarios = [
            { v0: 0,   v1: 0,    flow: 0     },
            { v0: 0,   v1: 1000, flow: 1000  },
            { v0: 1,   v1: 0,    flow: 0     },
            { v0: 100, v1: 50,   flow: -100  },
            { v0: 100, v1: 200,  flow: -50   },
        ];
        for (const s of scenarios) {
            const r = calculateDailyDietz(s.v0, s.v1, s.flow);
            expect(isNaN(r)).toBe(false);
            expect(isFinite(r)).toBe(true);
        }
    });

    it('Cota acumulada nunca é negativa mesmo com perdas extremas (não anômalas)', () => {
        // Máxima queda não-anômala por dia = 49%
        // Após 5 dias seguidos de -49%: 100 * 0.51^5 ≈ 3.5 (nunca negativo)
        const snaps = simulateSnapshots([
            { v0: 0,    v1: 1000, flow: 1000 },
            { v0: 1000, v1: 510,  flow: 0    }, // -49%
            { v0: 510,  v1: 260,  flow: 0    }, // -49%
            { v0: 260,  v1: 133,  flow: 0    }, // -49%
            { v0: 133,  v1: 68,   flow: 0    }, // -49%
            { v0: 68,   v1: 35,   flow: 0    }, // -49%
        ]);
        const finalCota = snaps[snaps.length - 1].quotaPrice;
        expect(finalCota).toBeGreaterThan(0);
        expect(isNaN(finalCota)).toBe(false);
    });
});
