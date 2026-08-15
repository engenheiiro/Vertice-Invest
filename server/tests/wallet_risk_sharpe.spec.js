/**
 * Sharpe da carteira (utils/walletRisk) — fonte ÚNICA compartilhada pelo KPI
 * (getWalletData) e pelo gráfico (getWalletPerformance).
 *
 * O que estes testes travam:
 *  - a janela é a mesma nos dois caminhos (antes: 30 snapshots × histórico todo);
 *  - só pares separados por 1 pregão viram retorno diário (√252 pressupõe isso);
 *  - "não calculável" é null, nunca 0 (0 é um Sharpe legítimo).
 */
import { describe, it, expect } from 'vitest';
import {
    MIN_SHARPE_SAMPLE,
    RISK_UNAVAILABLE,
    SHARPE_CONFIDENCE,
    SHARPE_WINDOW_SNAPSHOTS,
    buildDailyQuotaReturns,
    computeQuotaBeta,
    computeQuotaSharpe,
    snapshotDayKey,
} from '../utils/walletRisk.js';
import { isBusinessDay, toDateKey } from '../utils/dateUtils.js';

const CDI = 13.9;
/** Snapshots suficientes para passar do piso de significância com folga. */
const AMPLA = MIN_SHARPE_SAMPLE + 20;

/** Dias úteis consecutivos a partir de 06/07/2026 (segunda-feira, sem feriados). */
const businessDayKeys = (count, startKey = '2026-07-06') => {
    const keys = [];
    const cursor = new Date(`${startKey}T00:00:00.000Z`);
    while (keys.length < count) {
        if (isBusinessDay(cursor)) keys.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return keys;
};

/** Snapshot no instante real de fechamento: 23:59 BRT (= 02:59 UTC do dia seguinte). */
const snapshotAt = (dayKey, quotaPrice, extra = {}) => ({
    date: new Date(`${dayKey}T23:59:00-03:00`),
    quotaPrice,
    totalEquity: 20_000,
    totalInvested: 19_000,
    ...extra,
});

/** Série de cota com variação determinística (desvio padrão > 0). */
const buildSeries = (count, startKey) =>
    businessDayKeys(count, startKey).map((dayKey, i) =>
        snapshotAt(dayKey, 100 * (1 + 0.002 * Math.sin(i * 1.7))));

describe('snapshotDayKey — dia-calendário BR do fechamento', () => {
    it('fechamento das 23:59 BRT NÃO escorrega para o dia UTC seguinte', () => {
        // O instante real gravado é 02:59Z do dia seguinte. A chave UTC crua
        // apontava para o pregão seguinte: era isso que adiantava a série do
        // Ibovespa no gráfico em um dia.
        const snap = snapshotAt('2026-08-13', 100);
        expect(toDateKey(snap.date)).toBe('2026-08-14'); // o que a chave crua daria
        expect(snapshotDayKey(snap)).toBe('2026-08-13'); // o dia BR de verdade
    });

    it('sexta-feira não cai num sábado inexistente', () => {
        // 14/08/2026 é sexta. A chave UTC dava 15/08 (sábado), o índice não tinha
        // cotação e o dia herdava o valor anterior.
        const sexta = snapshotAt('2026-08-14', 100);
        expect(snapshotDayKey(sexta)).toBe('2026-08-14');
        expect(new Date(`${snapshotDayKey(sexta)}T12:00:00Z`).getUTCDay()).toBe(5);
    });

    it('snapshot de rebuild (meio-dia UTC) resolve para o mesmo dia', () => {
        expect(snapshotDayKey({ date: new Date('2026-08-13T12:00:00.000Z') })).toBe('2026-08-13');
    });

    it('dia puro (ponto live) passa intacto', () => {
        expect(snapshotDayKey({ date: new Date('2026-08-13T00:00:00.000Z') })).toBe('2026-08-13');
    });
});

describe('buildDailyQuotaReturns — espaçamento de 1 pregão', () => {
    it('fim de semana conta como 1 dia útil (sexta → segunda é retorno diário)', () => {
        // 10/07 é sexta, 13/07 é segunda: o gap de 3 dias CORRIDOS é 1 pregão.
        const { returns, skippedGaps } = buildDailyQuotaReturns([
            snapshotAt('2026-07-10', 100),
            snapshotAt('2026-07-13', 101),
        ]);
        expect(returns).toHaveLength(1);
        expect(returns[0]).toBeCloseTo(1, 6);
        expect(skippedGaps).toBe(0);
    });

    it('snapshot faltando (outage) é descartado em vez de virar retorno diário', () => {
        // Falta 08/07: o par 07/07 → 09/07 cobre 2 pregões e não é diário.
        const { returns, skippedGaps } = buildDailyQuotaReturns([
            snapshotAt('2026-07-06', 100),
            snapshotAt('2026-07-07', 101),
            snapshotAt('2026-07-09', 105),
        ]);
        expect(returns).toHaveLength(1);
        expect(returns[0]).toBeCloseTo(1, 6); // só o par 06→07
        expect(skippedGaps).toBe(1);
    });

    it('gap não inflaciona a volatilidade da série', () => {
        const contigua = buildSeries(20);
        const comBuraco = contigua.filter((_, i) => i !== 10);

        const { returns: base } = buildDailyQuotaReturns(contigua);
        const { returns: furada, skippedGaps } = buildDailyQuotaReturns(comBuraco);

        expect(skippedGaps).toBe(1);
        // Perde os 2 retornos que tocavam o snapshot ausente, não ganha um salto.
        expect(furada).toHaveLength(base.length - 2);
        expect(Math.max(...furada.map(Math.abs)))
            .toBeLessThanOrEqual(Math.max(...base.map(Math.abs)) + 1e-9);
    });

    it('ignora o ponto live (fechamento parcial do dia, não é retorno diário)', () => {
        const series = buildSeries(12);
        const comLive = [...series, { ...snapshotAt('2026-07-22', 130), isLive: true }];

        expect(buildDailyQuotaReturns(comLive).returns)
            .toEqual(buildDailyQuotaReturns(series).returns);
    });

    it('snapshot sem patrimônio é descartado (NaN não escapa pelo filtro)', () => {
        // `NaN <= 1` é falso: escrito ingenuamente, o filtro deixaria passar
        // exatamente o registro malformado que ele existe para barrar.
        const semEquity = businessDayKeys(AMPLA).map((dayKey, i) => ({
            date: new Date(`${dayKey}T23:59:00-03:00`),
            quotaPrice: 100 * (1 + 0.002 * Math.sin(i * 1.7)),
        }));
        expect(buildDailyQuotaReturns(semEquity).returns).toHaveLength(0);
        expect(computeQuotaSharpe(semEquity, CDI).sharpe).toBeNull();
    });

    it('descarta cota inválida, data inválida e entradas nulas', () => {
        const { returns } = buildDailyQuotaReturns([
            null,
            snapshotAt('2026-07-06', 100),
            { date: new Date('inválida'), quotaPrice: 100 },
            snapshotAt('2026-07-07', 101),
            snapshotAt('2026-07-08', 0),
            snapshotAt('2026-07-09', NaN),
        ]);
        expect(returns).toHaveLength(1);
        expect(returns[0]).toBeCloseTo(1, 6);
    });
});

describe('computeQuotaSharpe — janela única e contrato de indisponibilidade', () => {
    it('KPI e /performance chegam ao MESMO número (janela rolante compartilhada)', () => {
        // Os dois caminhos carregam conjuntos diferentes do banco; a janela é que
        // precisa ser a mesma.
        const historicoCompleto = buildSeries(SHARPE_WINDOW_SNAPSHOTS + 50);
        const janela = historicoCompleto.slice(-SHARPE_WINDOW_SNAPSHOTS);

        expect(computeQuotaSharpe(historicoCompleto, CDI).sharpe)
            .toBe(computeQuotaSharpe(janela, CDI).sharpe);
    });

    it('a janela é limitada mesmo com histórico longo', () => {
        const { sample } = computeQuotaSharpe(buildSeries(SHARPE_WINDOW_SNAPSHOTS + 150), CDI);
        expect(sample).toBe(SHARPE_WINDOW_SNAPSHOTS - 1);
    });

    it('ordem de entrada não importa (o KPI busca em ordem decrescente)', () => {
        const asc = buildSeries(AMPLA);
        const desc = [...asc].reverse();
        expect(computeQuotaSharpe(desc, CDI).sharpe).toBe(computeQuotaSharpe(asc, CDI).sharpe);
    });

    it('volatilidade zero → null, distinguível de um Sharpe neutro real', () => {
        const cotaTravada = businessDayKeys(AMPLA).map((dayKey) => snapshotAt(dayKey, 100));
        const { sharpe, reason } = computeQuotaSharpe(cotaTravada, CDI);
        expect(sharpe).toBeNull();
        expect(reason).toBe(RISK_UNAVAILABLE.ZERO_VOLATILITY);
    });

    it('série válida devolve número finito e motivo nulo', () => {
        const { sharpe, sample, skippedGaps, reason } = computeQuotaSharpe(buildSeries(AMPLA), CDI);
        expect(Number.isFinite(sharpe)).toBe(true);
        expect(sample).toBe(AMPLA - 1);
        expect(skippedGaps).toBe(0);
        expect(reason).toBeNull();
    });

    it('carteira sem snapshots não explode', () => {
        expect(computeQuotaSharpe([], CDI).sharpe).toBeNull();
        expect(computeQuotaSharpe(undefined, CDI).sharpe).toBeNull();
    });

    it('carteira que rende exatamente o CDI tem Sharpe ~0 — e ele é EXIBIDO', () => {
        // Regressão do contrato: antes, "0" era a sentinela de "sem dado" e a UI
        // escondia justamente a carteira 100% pós-fixada, que é o caso comum.
        const diario = (Math.pow(1 + CDI / 100, 1 / 252) - 1);
        const series = businessDayKeys(AMPLA).map((dayKey, i) =>
            // Ruído mínimo alternado para o desvio padrão não ser exatamente zero.
            snapshotAt(dayKey, 100 * Math.pow(1 + diario, i) * (1 + (i % 2 ? 1e-6 : -1e-6))));

        const { sharpe } = computeQuotaSharpe(series, CDI);
        expect(sharpe).not.toBeNull();
        expect(Math.abs(sharpe)).toBeLessThan(1);
    });
});

describe('computeQuotaSharpe — gate de significância', () => {
    it(`abaixo de ${MIN_SHARPE_SAMPLE} observações não publica número`, () => {
        // Amostra curta é justamente o caso em que o erro-padrão supera o próprio
        // indicador — publicar seria transmitir precisão inexistente.
        const { sharpe, sample, reason } = computeQuotaSharpe(buildSeries(MIN_SHARPE_SAMPLE), CDI);
        expect(sharpe).toBeNull();
        expect(sample).toBe(MIN_SHARPE_SAMPLE - 1);
        expect(reason).toBe(RISK_UNAVAILABLE.INSUFFICIENT_SAMPLE);
    });

    it('exatamente no piso já publica', () => {
        const { sharpe, sample } = computeQuotaSharpe(buildSeries(MIN_SHARPE_SAMPLE + 1), CDI);
        expect(sample).toBe(MIN_SHARPE_SAMPLE);
        expect(sharpe).not.toBeNull();
    });

    it('a confiança sobe com a amostra', () => {
        expect(computeQuotaSharpe(buildSeries(AMPLA), CDI).confidence).toBe(SHARPE_CONFIDENCE.LOW);
        expect(computeQuotaSharpe(buildSeries(140), CDI).confidence).toBe(SHARPE_CONFIDENCE.MODERATE);
        expect(computeQuotaSharpe(buildSeries(300), CDI).confidence).toBe(SHARPE_CONFIDENCE.HIGH);
    });

    it('a margem de erro encolhe conforme a amostra cresce', () => {
        const curta = computeQuotaSharpe(buildSeries(AMPLA), CDI).standardError;
        const longa = computeQuotaSharpe(buildSeries(300), CDI).standardError;
        expect(curta).toBeGreaterThan(0);
        expect(longa).toBeLessThan(curta);
    });

    it('indisponível não vem com margem nem confiança fantasma', () => {
        const { standardError, confidence } = computeQuotaSharpe(buildSeries(10), CDI);
        expect(standardError).toBeNull();
        expect(confidence).toBeNull();
    });
});

describe('computeQuotaSharpe — quebra de regime', () => {
    /** 20 pregões com carteira pequena, depois um aporte que a multiplica por ~50. */
    const comAporte = () => {
        const keys = businessDayKeys(100);
        return keys.map((dayKey, i) => (i < 20
            ? snapshotAt(dayKey, 100 * (1 + 0.004 * Math.sin(i * 1.7)), { totalEquity: 400, totalInvested: 380 })
            : snapshotAt(dayKey, 100 * (1 + 0.001 * Math.sin(i * 1.7)), { totalEquity: 20_000, totalInvested: 19_000 })));
    };

    it('um aporte que refaz a carteira reinicia a janela', () => {
        const { sample, regimeBreakAt } = computeQuotaSharpe(comAporte(), CDI);
        // Série passa a começar no snapshot do aporte (índice 20): 80 restantes.
        expect(sample).toBe(79);
        expect(regimeBreakAt).toBe(businessDayKeys(100)[20]);
    });

    it('sem quebra, a série inteira é usada', () => {
        const { sample, regimeBreakAt } = computeQuotaSharpe(buildSeries(100), CDI);
        expect(sample).toBe(99);
        expect(regimeBreakAt).toBeNull();
    });

    it('aporte pequeno (10% do patrimônio) NÃO reinicia a janela', () => {
        const series = businessDayKeys(100).map((dayKey, i) =>
            snapshotAt(dayKey, 100 * (1 + 0.002 * Math.sin(i * 1.7)), {
                totalEquity: 20_000,
                totalInvested: i < 50 ? 19_000 : 21_000, // +R$2.000 sobre R$20.000
            }));

        expect(computeQuotaSharpe(series, CDI).regimeBreakAt).toBeNull();
    });

    it('a mistura de regimes deixa de contaminar a volatilidade', () => {
        // O trecho pré-aporte oscila 4× mais; incluí-lo inflava o desvio padrão de
        // um portfólio que já não existe.
        const comCorte = computeQuotaSharpe(comAporte(), CDI);
        const semCorte = computeQuotaSharpe(
            comAporte().map((snap) => ({ ...snap, totalInvested: 19_000 })), CDI);

        expect(comCorte.regimeBreakAt).not.toBeNull();
        expect(semCorte.regimeBreakAt).toBeNull();
        expect(comCorte.sharpe).not.toBe(semCorte.sharpe);
    });
});

describe('computeQuotaSharpe — taxa livre de risco da época', () => {
    it('mesma série em 2020 (CDI 2,77%) rende Sharpe maior que hoje (CDI ~14%)', () => {
        // Descontar a taxa de HOJE de um retorno de 2020 mede um prêmio que nunca
        // existiu: o custo de oportunidade da época era muito menor.
        const em2020 = computeQuotaSharpe(buildSeries(AMPLA, '2020-01-02'), CDI).sharpe;
        const hoje = computeQuotaSharpe(buildSeries(AMPLA, '2026-01-02'), CDI).sharpe;

        expect(em2020).toBeGreaterThan(hoje);
    });
});

describe('computeQuotaBeta — mesma série do Sharpe', () => {
    /** Índice que replica a cota → beta esperado = 1. */
    const indexFromSeries = (series) => {
        const closes = new Map(series.map((snap) => [
            new Date(snap.date).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }),
            snap.quotaPrice,
        ]));
        return (dayKey) => closes.get(dayKey);
    };

    it('índice que replica a carteira devolve beta 1', () => {
        const series = buildSeries(AMPLA);
        const { beta, sample } = computeQuotaBeta(series, indexFromSeries(series));
        expect(beta).toBeCloseTo(1, 6);
        expect(sample).toBe(AMPLA - 1);
    });

    it('usa a MESMA janela do Sharpe (nada de histórico inteiro)', () => {
        const series = buildSeries(SHARPE_WINDOW_SNAPSHOTS + 100);
        expect(computeQuotaBeta(series, indexFromSeries(series)).sample)
            .toBe(computeQuotaSharpe(series, CDI).sample);
    });

    it('dia sem cotação do índice é descartado dos DOIS lados', () => {
        // Antes o código repetia a última cotação, injetando um retorno de mercado
        // artificial (zero) que puxava o beta para baixo.
        const series = buildSeries(AMPLA);
        const completo = indexFromSeries(series);
        const buraco = new Date(series[30].date)
            .toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

        const { beta, sample } = computeQuotaBeta(series, (k) => (k === buraco ? undefined : completo(k)));
        expect(sample).toBe(AMPLA - 3); // perde os 2 pares que tocavam o dia
        expect(beta).toBeCloseTo(1, 6); // e o beta continua limpo
    });

    it('sem benchmark → null, não o beta neutro 1', () => {
        const { beta, reason } = computeQuotaBeta(buildSeries(AMPLA), () => undefined);
        expect(beta).toBeNull();
        expect(reason).toBe(RISK_UNAVAILABLE.NO_BENCHMARK);
    });

    it('amostra insuficiente → null', () => {
        const series = buildSeries(20);
        const { beta, reason } = computeQuotaBeta(series, indexFromSeries(series));
        expect(beta).toBeNull();
        expect(reason).toBe(RISK_UNAVAILABLE.INSUFFICIENT_SAMPLE);
    });
});
