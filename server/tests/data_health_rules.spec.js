/**
 * Sentinela de saúde dos dados — regras puras.
 *
 * O ponto do arquivo é provar cada limiar SEM banco: monta o fato agregado e
 * afirma o veredito. Um limiar que não tem teste aqui é um limiar que ninguém
 * consegue recalibrar com segurança depois.
 */
import { describe, it, expect } from 'vitest';
import {
    CATEGORY,
    DEFAULT_THRESHOLDS,
    HEALTH_STATUS,
    buildHealthReport,
    failingChecks,
    gradeAscending,
    hoursBetween,
    PLAUSIBILITY_RANGES,
    ratio,
    worstStatus,
} from '../utils/dataHealthRules.js';

const NOW = new Date('2026-08-16T12:00:00Z');
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600000);

/** Universo saudável: todo check em OK. Cada teste degrada um eixo por vez. */
const healthyFacts = (overrides = {}) => ({
    now: NOW,
    totals: { all: 1200, active: 1000, inactive: 10 },
    assets: {
        STOCK: {
            active: 400,
            stalePrice: 5,
            staleFundamentals: 20,
            missing: { lastPrice: 0, pl: 20, roe: 15, marketCap: 2, liquidity: 3 },
        },
        FII: {
            active: 300,
            stalePrice: 3,
            staleFundamentals: 15,
            missing: { lastPrice: 0, p_vp: 8, marketCap: 4, liquidity: 2 },
        },
        STOCK_US: {
            active: 250,
            stalePrice: 2,
            staleFundamentals: 5,
            missing: { lastPrice: 0, pl: 10, roe: 12, marketCap: 1 },
        },
        ETF: { active: 30, stalePrice: 0, missing: { lastPrice: 0 } },
        CRYPTO: { active: 20, stalePrice: 0, missing: { lastPrice: 0, marketCap: 0 } },
    },
    implausible: { dy: 1, pl: 2, p_vp: 0, beta: 1, change: 0, nonPositivePrice: 0 },
    macro: {
        selic: 12.43, ipca: 4.2, cdi: 12.33, ibov: 138000, dollar: 5.4,
        updatedAt: hoursAgo(0.5),
    },
    treasury: { titles: 14, businessDaysStale: 1 },
    frozen: { count: 0, tickers: [] },
    timeSeries: { count: 900, stale: 100 },
    fundamentals: { healthy: true, timestamp: hoursAgo(6), errorCode: null },
    jobs: [
        { jobId: 'quotes-sync', label: 'Cotações', severity: 'CRITICAL', maxSilenceHours: 2, lastRunAt: hoursAgo(0.3), lastStatus: 'SUCCESS' },
        { jobId: 'daily-snapshot', label: 'Snapshot', severity: 'CRITICAL', maxSilenceHours: 30, lastRunAt: hoursAgo(12), lastStatus: 'SUCCESS' },
    ],
    // Instrumentação madura: sem isso a carência mascararia os testes de cron parado.
    instrumentationSince: hoursAgo(24 * 30),
    errors: { last24h: 3 },
    ...overrides,
});

const byId = (report, id) => report.checks.find((c) => c.id === id);

describe('helpers puros', () => {
    it('ratio não devolve NaN nem Infinity com universo vazio', () => {
        expect(ratio(5, 0)).toBe(0);
        expect(ratio(0, 0)).toBe(0);
        expect(ratio(null, undefined)).toBe(0);
    });

    it('worstStatus escala OK < WARN < CRITICAL', () => {
        expect(worstStatus('OK', 'WARN')).toBe('WARN');
        expect(worstStatus('CRITICAL', 'WARN')).toBe('CRITICAL');
        expect(worstStatus('OK', 'OK')).toBe('OK');
    });

    it('gradeAscending respeita o teto de severidade', () => {
        const th = { warn: 0.2, critical: 0.5 };
        expect(gradeAscending(0.1, th)).toBe(HEALTH_STATUS.OK);
        expect(gradeAscending(0.3, th)).toBe(HEALTH_STATUS.WARN);
        expect(gradeAscending(0.9, th)).toBe(HEALTH_STATUS.CRITICAL);
        // Campo secundário estoura o crítico mas só pode alarmar como WARN.
        expect(gradeAscending(0.9, th, 'WARN')).toBe(HEALTH_STATUS.WARN);
    });

    it('valor não numérico vira WARN, nunca OK silencioso', () => {
        expect(gradeAscending(null, { warn: 1, critical: 2 })).toBe(HEALTH_STATUS.WARN);
    });

    it('hoursBetween mede na direção passado → agora', () => {
        expect(hoursBetween(hoursAgo(3), NOW)).toBeCloseTo(3);
    });
});

describe('baseline saudável', () => {
    it('universo íntegro fecha OK sem nenhum check quebrado', () => {
        const report = buildHealthReport(healthyFacts());
        expect(report.status).toBe(HEALTH_STATUS.OK);
        expect(report.summary.critical).toBe(0);
        expect(report.summary.warn).toBe(0);
        expect(failingChecks(report)).toHaveLength(0);
    });

    it('base vazia não gera falso alarme de cobertura por divisão por zero', () => {
        const report = buildHealthReport({
            ...healthyFacts(),
            assets: { STOCK: { active: 0, stalePrice: 0, missing: {} } },
        });
        expect(report.checks.some((c) => c.id.startsWith('coverage.STOCK'))).toBe(false);
        expect(report.checks.some((c) => c.id === 'freshness.price.STOCK')).toBe(false);
    });
});

describe('FRESCOR', () => {
    it('preço velho em fração alta vira CRITICAL', () => {
        const facts = healthyFacts();
        facts.assets.STOCK.stalePrice = 200; // 50% de 400
        const report = buildHealthReport(facts);
        const check = byId(report, 'freshness.price.STOCK');
        expect(check.status).toBe(HEALTH_STATUS.CRITICAL);
        expect(check.category).toBe(CATEGORY.FRESHNESS);
        expect(report.status).toBe(HEALTH_STATUS.CRITICAL);
    });

    it('preço velho em fração intermediária vira WARN', () => {
        const facts = healthyFacts();
        facts.assets.STOCK.stalePrice = 100; // 25% → entre warn(15%) e critical(40%)
        expect(byId(buildHealthReport(facts), 'freshness.price.STOCK').status)
            .toBe(HEALTH_STATUS.WARN);
    });

    it('conta ativos congelados por CABEÇA, não por fração', () => {
        // Achado real: 9 ativos parados de 26 a 134 dias em 1342 = 0,7%, longe do
        // limiar de 15% do check de fração — mas entre eles NEOE3, ODPV3, BK e CTRA,
        // todos elegíveis a ranking com preço de meses atrás.
        const facts = healthyFacts();
        facts.frozen = { count: 9, tickers: ['DAWN', 'FOLD', 'CTRA', 'BK', 'NEOE3'] };
        const check = byId(buildHealthReport(facts), 'freshness.frozenAssets');
        expect(check.status).toBe(HEALTH_STATUS.WARN);
        // O alarme precisa nomear os culpados para virar conserto.
        expect(check.detail).toContain('NEOE3');
    });

    it('um único congelado já sai de OK; dez viram CRITICAL', () => {
        const facts = healthyFacts();
        facts.frozen = { count: 1, tickers: ['PORT3'] };
        expect(byId(buildHealthReport(facts), 'freshness.frozenAssets').status)
            .toBe(HEALTH_STATUS.WARN);
        facts.frozen = { count: 12, tickers: ['PORT3'] };
        expect(byId(buildHealthReport(facts), 'freshness.frozenAssets').status)
            .toBe(HEALTH_STATUS.CRITICAL);
    });

    it('sem congelados o check fica OK', () => {
        expect(byId(buildHealthReport(healthyFacts()), 'freshness.frozenAssets').status)
            .toBe(HEALTH_STATUS.OK);
    });

    it('ausência total de PU do Tesouro é CRITICAL', () => {
        const facts = healthyFacts();
        facts.treasury = { titles: 0, businessDaysStale: null };
        expect(byId(buildHealthReport(facts), 'freshness.treasury').status)
            .toBe(HEALTH_STATUS.CRITICAL);
    });

    it('fim de semana NÃO alarma o Tesouro (atraso contado em dias úteis)', () => {
        // Regressão da base real: num domingo o último PU é de sexta — ~52h de
        // atraso corrido, mas ZERO dia útil. Contar em horas pintava o painel de
        // amarelo todo fim de semana, que é como se ensina alguém a ignorar alarme.
        const facts = healthyFacts();
        facts.treasury = { titles: 81, businessDaysStale: 0 };
        expect(byId(buildHealthReport(facts), 'freshness.treasury').status)
            .toBe(HEALTH_STATUS.OK);
    });

    it('2 dias úteis de atraso NÃO alarma — é o piso da fonte + cron', () => {
        // Regressão da base real (19/08/2026, 05:55): último PU 17/08, painel em
        // amarelo com 81 títulos. Não havia defeito nenhum — o arquivo oficial sai
        // na manhã de D com Data Base D-1, então toda manhã, antes do cron das
        // 18:30, o atraso é exatamente 2. Alarmar aqui é alarmar todo dia.
        const facts = healthyFacts();
        facts.treasury = { titles: 81, businessDaysStale: 2 };
        expect(byId(buildHealthReport(facts), 'freshness.treasury').status)
            .toBe(HEALTH_STATUS.OK);
    });

    it('Tesouro sem publicar por 5 dias úteis é CRITICAL', () => {
        const facts = healthyFacts();
        facts.treasury = { titles: 81, businessDaysStale: 5 };
        expect(byId(buildHealthReport(facts), 'freshness.treasury').status)
            .toBe(HEALTH_STATUS.CRITICAL);
    });

    it('séries temporais medem FRAÇÃO velha, não média', () => {
        // Base real: 1519 séries com média 115h, puxada por uma série morta de 199
        // dias, enquanto 84% estavam abaixo de 72h. A média media a cauda, não a saúde.
        const facts = healthyFacts();
        facts.timeSeries = { count: 1519, stale: 237 }; // 15.6% — saudável
        expect(byId(buildHealthReport(facts), 'freshness.timeSeries').status)
            .toBe(HEALTH_STATUS.OK);

        facts.timeSeries = { count: 1519, stale: 800 }; // 52.7%
        expect(byId(buildHealthReport(facts), 'freshness.timeSeries').status)
            .toBe(HEALTH_STATUS.CRITICAL);
    });
});

describe('COBERTURA', () => {
    it('campo crítico ausente em massa derruba para CRITICAL', () => {
        const facts = healthyFacts();
        facts.assets.FII.missing.liquidity = 200; // 66% de 300
        const check = byId(buildHealthReport(facts), 'coverage.FII.liquidity');
        expect(check.status).toBe(HEALTH_STATUS.CRITICAL);
        expect(check.detail).toContain('200/300');
    });

    it('DY não entra na cobertura — zero é valor econômico legítimo', () => {
        // PRIO3, ENEV3 e PETZ3 não pagam dividendo. Com `default: 0` no schema,
        // DY=0 é indistinguível de "não coletado", e cobrar cobertura de DY acusava
        // 100/346 ações na base real — alarme que nunca fecharia.
        const report = buildHealthReport(healthyFacts());
        expect(report.checks.some((c) => c.id.endsWith('.dy') && c.category === CATEGORY.COVERAGE)).toBe(false);
    });

    it('marketCap de ETF não entra na cobertura — a fonte não fornece', () => {
        expect(byId(buildHealthReport(healthyFacts()), 'coverage.ETF.marketCap')).toBeUndefined();
    });

    it('campo secundário ausente em massa fica em WARN (teto de severidade)', () => {
        const facts = healthyFacts();
        facts.assets.STOCK.missing.pl = 400; // 100% ausente
        const report = buildHealthReport(facts);
        expect(byId(report, 'coverage.STOCK.pl').status).toBe(HEALTH_STATUS.WARN);
        // E não contamina o veredito global como crítico.
        expect(report.status).toBe(HEALTH_STATUS.WARN);
    });

    it('regressão silenciosa: layout muda, linhas seguem aceitas, ROE zera', () => {
        // Este é o caso que ingestionHealth.js NÃO pega: taxa de aceitação
        // continua ótima porque as linhas entram — só que sem o campo.
        const facts = healthyFacts();
        facts.assets.STOCK.missing.roe = 380; // 95%
        const report = buildHealthReport(facts);
        expect(byId(report, 'coverage.STOCK.roe').status).toBe(HEALTH_STATUS.WARN);
        expect(failingChecks(report).map((c) => c.id)).toContain('coverage.STOCK.roe');
    });

    it('dica de cobertura BR aponta o Fundamentus, e a de fora aponta o Yahoo', () => {
        const report = buildHealthReport(healthyFacts());
        expect(byId(report, 'coverage.STOCK.roe').hint).toMatch(/Fundamentus/);
        expect(byId(report, 'coverage.STOCK_US.roe').hint).toMatch(/Yahoo/);
    });
});

describe('PLAUSIBILIDADE', () => {
    it('DY absurdo em massa alarma', () => {
        const facts = healthyFacts();
        facts.implausible.dy = 150; // 15% de 1000
        expect(byId(buildHealthReport(facts), 'plausibility.dy').status)
            .toBe(HEALTH_STATUS.CRITICAL);
    });

    it('P/VP negativo não é defeito — patrimônio líquido negativo é real', () => {
        // AZUL3, AALR3 e RCSL4 têm PL negativo de verdade. A faixa antiga (min: 0)
        // acusava 24 ações da base como dado corrompido.
        expect(PLAUSIBILITY_RANGES.p_vp.min).toBeLessThan(-100);
        expect(PLAUSIBILITY_RANGES.pl.min).toBeLessThan(-500);
    });

    it('P/VP em ordem de grandeza absurda continua sendo defeito', () => {
        // PLTO5/PLTO6 na base real marcam ~700.000 — estouro de divisão na origem.
        expect(700000).toBeGreaterThan(PLAUSIBILITY_RANGES.p_vp.max);
    });

    it('um único preço ≤ 0 já sai de OK', () => {
        const facts = healthyFacts();
        facts.implausible.nonPositivePrice = 1;
        const check = byId(buildHealthReport(facts), 'plausibility.nonPositivePrice');
        expect(check.status).not.toBe(HEALTH_STATUS.OK);
        expect(check.detail).toContain('1 ativo');
    });

    it('preço zerado ausente mantém OK', () => {
        expect(byId(buildHealthReport(healthyFacts()), 'plausibility.nonPositivePrice').status)
            .toBe(HEALTH_STATUS.OK);
    });
});

describe('MACRO', () => {
    it('indicador ausente é CRITICAL', () => {
        const facts = healthyFacts();
        facts.macro.selic = 0;
        const check = byId(buildHealthReport(facts), 'macro.value.selic');
        expect(check.status).toBe(HEALTH_STATUS.CRITICAL);
        expect(check.detail).toBe('Ausente');
    });

    it('Selic fora da faixa plausível é CRITICAL', () => {
        const facts = healthyFacts();
        facts.macro.selic = 87;
        expect(byId(buildHealthReport(facts), 'macro.value.selic').status)
            .toBe(HEALTH_STATUS.CRITICAL);
    });

    it('Ibovespa em escala errada (pontos vs. milhares) é pego pela faixa', () => {
        const facts = healthyFacts();
        facts.macro.ibov = 138; // veio em milhares
        expect(byId(buildHealthReport(facts), 'macro.value.ibov').status)
            .toBe(HEALTH_STATUS.CRITICAL);
    });

    it('bloco macro nunca sincronizado é CRITICAL', () => {
        const facts = healthyFacts();
        facts.macro = {};
        expect(byId(buildHealthReport(facts), 'macro.freshness').status)
            .toBe(HEALTH_STATUS.CRITICAL);
    });

    it('macro parado por 8h vira WARN antes de virar crítico', () => {
        const facts = healthyFacts();
        facts.macro.updatedAt = hoursAgo(8);
        expect(byId(buildHealthReport(facts), 'macro.freshness').status)
            .toBe(HEALTH_STATUS.WARN);
    });
});

describe('INGESTÃO', () => {
    it('sync de fundamentos degradado é CRITICAL e explica o código', () => {
        const facts = healthyFacts();
        facts.fundamentals = {
            healthy: false,
            timestamp: hoursAgo(1),
            errorCode: 'FUNDAMENTUS_ACCEPTANCE_COLLAPSE',
        };
        const check = byId(buildHealthReport(facts), 'ingestion.fundamentals');
        expect(check.status).toBe(HEALTH_STATUS.CRITICAL);
        expect(check.detail).toContain('FUNDAMENTUS_ACCEPTANCE_COLLAPSE');
    });

    it('saúde de fundamentos sem confirmação há 2 dias é CRITICAL', () => {
        const facts = healthyFacts();
        facts.fundamentals = { healthy: true, timestamp: hoursAgo(100), errorCode: null };
        expect(byId(buildHealthReport(facts), 'ingestion.fundamentals').status)
            .toBe(HEALTH_STATUS.CRITICAL);
    });

    it('fundamentos não coletados usam lastFundamentalsDate, sem ambiguidade', () => {
        // Substitui a cobertura de DY: `lastFundamentalsDate` é NULO quando o dado
        // nunca foi coletado, então não confunde "empresa sem dividendo" com
        // "ativo que sumiu da varredura da fonte".
        const facts = healthyFacts();
        facts.assets.STOCK.staleFundamentals = 240; // 60% de 400
        const check = byId(buildHealthReport(facts), 'ingestion.fundamentalsDate.STOCK');
        expect(check.status).toBe(HEALTH_STATUS.CRITICAL);
        expect(check.detail).toContain('240/400');
    });

    it('fração pequena de fundamentos velhos permanece OK', () => {
        // Base real: 34/346 ações (9.8%) e 54/367 FIIs (14.7%) — normal.
        const facts = healthyFacts();
        facts.assets.STOCK.staleFundamentals = 34;
        facts.assets.STOCK.active = 346;
        expect(byId(buildHealthReport(facts), 'ingestion.fundamentalsDate.STOCK').status)
            .toBe(HEALTH_STATUS.OK);
    });

    it('massa de ativos desativados por falha alarma', () => {
        const facts = healthyFacts();
        facts.totals = { all: 1200, active: 1000, inactive: 240 }; // 20%
        expect(byId(buildHealthReport(facts), 'ingestion.inactiveAssets').status)
            .toBe(HEALTH_STATUS.CRITICAL);
    });
});

describe('ROTINAS (crons)', () => {
    it('cron crítico parado além do teto vira CRITICAL', () => {
        const facts = healthyFacts();
        facts.jobs[0].lastRunAt = hoursAgo(6); // teto 2h
        const check = byId(buildHealthReport(facts), 'jobs.quotes-sync');
        expect(check.status).toBe(HEALTH_STATUS.CRITICAL);
        expect(check.detail).toContain('acima do teto de 2h');
    });

    it('cron não-crítico parado só vira WARN', () => {
        const facts = healthyFacts();
        facts.jobs.push({
            jobId: 'dividends-sync', label: 'Proventos', severity: 'WARN',
            maxSilenceHours: 30, lastRunAt: hoursAgo(100), lastStatus: 'SUCCESS',
        });
        expect(byId(buildHealthReport(facts), 'jobs.dividends-sync').status)
            .toBe(HEALTH_STATUS.WARN);
    });

    it('última execução com falha alarma mesmo estando recente', () => {
        const facts = healthyFacts();
        facts.jobs[0].lastStatus = 'FAILED';
        facts.jobs[0].lastError = 'ECONNRESET no Yahoo';
        const check = byId(buildHealthReport(facts), 'jobs.quotes-sync');
        expect(check.status).toBe(HEALTH_STATUS.CRITICAL);
        expect(check.detail).toContain('ECONNRESET no Yahoo');
    });

    it('cron que nunca rodou, com instrumentação madura, é falha', () => {
        const facts = healthyFacts();
        facts.jobs[1].lastRunAt = null;
        facts.jobs[1].lastStatus = null;
        const check = byId(buildHealthReport(facts), 'jobs.daily-snapshot');
        expect(check.status).toBe(HEALTH_STATUS.CRITICAL);
        expect(check.detail).toContain('Nunca executado');
    });

    it('cron sem histórico fica OK enquanto o período dele não passou', () => {
        // Regressão da base real: 2h após instrumentar, 12 rotinas apareciam como
        // "nunca executadas" — 4 delas críticas. O painel nascia vermelho por um
        // motivo falso, na primeira vez que o dono fosse olhar.
        const facts = healthyFacts();
        facts.instrumentationSince = hoursAgo(2);
        facts.jobs[1].lastRunAt = null;   // snapshot diário, teto de 30h
        facts.jobs[1].lastStatus = null;
        const check = byId(buildHealthReport(facts), 'jobs.daily-snapshot');
        expect(check.status).toBe(HEALTH_STATUS.OK);
        expect(check.detail).toContain('Aguardando primeira execução');
    });

    it('passada a carência, o mesmo cron sem histórico vira falha', () => {
        const facts = healthyFacts();
        facts.instrumentationSince = hoursAgo(40); // > teto de 30h
        facts.jobs[1].lastRunAt = null;
        facts.jobs[1].lastStatus = null;
        expect(byId(buildHealthReport(facts), 'jobs.daily-snapshot').status)
            .toBe(HEALTH_STATUS.CRITICAL);
    });

    it('carência não silencia cron que JÁ rodou e depois parou', () => {
        const facts = healthyFacts();
        facts.instrumentationSince = hoursAgo(2);
        facts.jobs[0].lastRunAt = hoursAgo(6); // teto de 2h
        expect(byId(buildHealthReport(facts), 'jobs.quotes-sync').status)
            .toBe(HEALTH_STATUS.CRITICAL);
    });

    it('cron dentro do teto e com sucesso fica OK', () => {
        expect(byId(buildHealthReport(healthyFacts()), 'jobs.quotes-sync').status)
            .toBe(HEALTH_STATUS.OK);
    });
});

describe('ERROS', () => {
    it('pico de erros 5xx alarma', () => {
        const facts = healthyFacts();
        facts.errors = { last24h: 300 };
        expect(byId(buildHealthReport(facts), 'errors.backend24h').status)
            .toBe(HEALTH_STATUS.CRITICAL);
    });
});

describe('limiares configuráveis', () => {
    it('override aperta o limiar sem precisar de deploy', () => {
        const facts = healthyFacts();
        facts.assets.STOCK.stalePrice = 40; // 10% — OK no padrão
        expect(byId(buildHealthReport(facts), 'freshness.price.STOCK').status)
            .toBe(HEALTH_STATUS.OK);
        const tightened = buildHealthReport(facts, {
            priceStaleRatio: { warn: 0.05, critical: 0.30 },
        });
        expect(byId(tightened, 'freshness.price.STOCK').status).toBe(HEALTH_STATUS.WARN);
    });

    it('override parcial preserva os demais padrões', () => {
        const report = buildHealthReport(healthyFacts(), { errors24h: { warn: 1, critical: 2 } });
        expect(report.thresholds.errors24h).toEqual({ warn: 1, critical: 2 });
        expect(report.thresholds.priceStaleRatio).toEqual(DEFAULT_THRESHOLDS.priceStaleRatio);
    });

    it('override com lixo é ignorado em vez de corromper o limiar', () => {
        const report = buildHealthReport(healthyFacts(), {
            naoExiste: 42,
            priceStaleRatio: { warn: 'abc' },
        });
        expect(report.thresholds.naoExiste).toBeUndefined();
        expect(report.thresholds.priceStaleRatio.warn).toBe(DEFAULT_THRESHOLDS.priceStaleRatio.warn);
    });
});

describe('agregação do veredito', () => {
    it('um crítico isolado derruba o relatório inteiro', () => {
        const facts = healthyFacts();
        facts.macro.dollar = 0;
        const report = buildHealthReport(facts);
        expect(report.status).toBe(HEALTH_STATUS.CRITICAL);
        expect(report.summary.critical).toBe(1);
    });

    it('failingChecks ordena crítico antes de alerta', () => {
        const facts = healthyFacts();
        facts.macro.dollar = 0;                            // CRITICAL
        facts.timeSeries = { count: 1000, stale: 300 };     // 30% → WARN
        const failing = failingChecks(buildHealthReport(facts));
        expect(failing[0].status).toBe(HEALTH_STATUS.CRITICAL);
        expect(failing.at(-1).status).toBe(HEALTH_STATUS.WARN);
    });

    it('todo check carrega uma dica de onde olhar', () => {
        const report = buildHealthReport(healthyFacts());
        expect(report.checks.every((c) => typeof c.hint === 'string' && c.hint.length > 0)).toBe(true);
    });
});
