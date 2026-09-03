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
// A sentinela entra aqui só pelo formatador PURO do fato — é o que fecha o elo
// entre quem produz e quem julga (nenhum IO acontece na importação).
import { summarizeWalletPayloadFailures } from '../services/dataHealthService.js';

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
    treasuryCatalog: {
        total: 37,
        duplicates: [],
        glued: [],
        implausibleRate: [],
        wrongIndex: [],
        minAbovePu: [],
        missingPrice: [],
        oldestDays: 1,
        issues: 0,
    },
    frozen: { count: 0, tickers: [] },
    timeSeries: {
        wallet: { total: 17, stale: 0, worst: [], dates: [] },
        universe: { total: 1022, stale: 120, worst: [], dates: [] },
    },
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

    // O catálogo (TreasuryBond) é outra coisa que a série de PU: em 30/08/2026 a
    // série estava em dia enquanto o catálogo tinha 4 duplicatas e um título com a
    // taxa da coluna errada. Nenhum check existente enxergava isso.
    it('catálogo com uma duplicata alerta; com três é CRITICAL', () => {
        const facts = healthyFacts();
        facts.treasuryCatalog = {
            ...facts.treasuryCatalog,
            duplicates: [{ title: 'Tesouro IPCA+ 2037 Juros Semestrais', variants: ['a', 'b'] }],
            issues: 1,
        };
        expect(byId(buildHealthReport(facts), 'plausibility.treasuryCatalog').status)
            .toBe(HEALTH_STATUS.WARN);

        facts.treasuryCatalog.issues = 3;
        expect(byId(buildHealthReport(facts), 'plausibility.treasuryCatalog').status)
            .toBe(HEALTH_STATUS.CRITICAL);
    });

    it('o detalhe nomeia o defeito — alarme sem nome não vira conserto', () => {
        const facts = healthyFacts();
        facts.treasuryCatalog = {
            ...facts.treasuryCatalog,
            implausibleRate: [{ title: 'Tesouro Reserva 2036', type: 'IPCA', rate: 14 }],
            minAbovePu: [{ title: 'Tesouro Reserva 2036', min: 30, pu: 10.93 }],
            issues: 2,
        };
        const detail = byId(buildHealthReport(facts), 'plausibility.treasuryCatalog').detail;
        expect(detail).toContain('Tesouro Reserva 2036');
        expect(detail).toContain('IPCA 14%');
        expect(detail).toContain('mínimo acima do PU');
    });

    it('catálogo vazio é CRITICAL nos dois eixos', () => {
        const facts = healthyFacts();
        facts.treasuryCatalog = { ...facts.treasuryCatalog, total: 0, oldestDays: null, issues: 0 };
        const report = buildHealthReport(facts);
        expect(byId(report, 'plausibility.treasuryCatalog').status).toBe(HEALTH_STATUS.CRITICAL);
        expect(byId(report, 'freshness.treasuryCatalog').status).toBe(HEALTH_STATUS.CRITICAL);
    });

    it('título parado enquanto o resto foi reescrito acusa frescor do catálogo', () => {
        // Os 4 duplicados estavam congelados havia 5 meses.
        const facts = healthyFacts();
        facts.treasuryCatalog = { ...facts.treasuryCatalog, oldestDays: 12 };
        expect(byId(buildHealthReport(facts), 'freshness.treasuryCatalog').status)
            .toBe(HEALTH_STATUS.WARN);

        facts.treasuryCatalog = { ...facts.treasuryCatalog, oldestDays: 158 };
        expect(byId(buildHealthReport(facts), 'freshness.treasuryCatalog').status)
            .toBe(HEALTH_STATUS.CRITICAL);
    });

    it('sync manual de poucos dias não deixa o painel amarelo', () => {
        const facts = healthyFacts();
        facts.treasuryCatalog = { ...facts.treasuryCatalog, oldestDays: 6 };
        expect(byId(buildHealthReport(facts), 'freshness.treasuryCatalog').status)
            .toBe(HEALTH_STATUS.OK);
    });

    it('universo de pesquisa mede FRAÇÃO de séries com candle velho, não média', () => {
        // Fração, e não média: a base real tem cauda longa (série morta de 199 dias)
        // que puxava a média para 115h enquanto a maioria estava fresca — a média
        // media a cauda, não a saúde.
        const facts = healthyFacts();
        facts.timeSeries.universe = { total: 1022, stale: 160, worst: [], dates: [] }; // 15.7%
        expect(byId(buildHealthReport(facts), 'freshness.timeSeriesUniverse').status)
            .toBe(HEALTH_STATUS.OK);

        facts.timeSeries.universe = { total: 1022, stale: 300, worst: [], dates: [] }; // 29.4%
        expect(byId(buildHealthReport(facts), 'freshness.timeSeriesUniverse').status)
            .toBe(HEALTH_STATUS.WARN);
    });

    it('REGRESSÃO 20/08/2026: 72% da base parada há 3 dias úteis é CRITICAL', () => {
        // O cenário que a regra antiga (lastUpdated vs. corte de 168h) classificou
        // como saudável: 910 de ~1.264 ativos com último candle em 17/08, nenhum ETF
        // com candle de 19/08 — e lastUpdated de todos renovado naquela manhã.
        const facts = healthyFacts();
        facts.timeSeries.universe = {
            total: 1022,
            stale: 674,
            worst: [{ ticker: 'VALE3', lastCandle: '2026-08-17', daysStale: 3 }],
            dates: [{ date: '2026-08-17', count: 652 }],
        };
        const check = byId(buildHealthReport(facts), 'freshness.timeSeriesUniverse');
        expect(check.status).toBe(HEALTH_STATUS.CRITICAL);
        // A concentração numa única data é o que separa "worker perdeu um ciclo"
        // de "alguns tickers morreram na fonte" — precisa estar no detalhe.
        expect(check.detail).toContain('2026-08-17');
    });

    it('carteira conta CABEÇAS: um único ativo atrasado já sai de OK', () => {
        // Candle atrasado em ativo detido corrompe WalletSnapshot → TWRR e Sharpe.
        // BOVA11 + IVVB11 eram 68% da renda variável de uma carteira real, então
        // fração aqui (2/17 = 12%) esconderia o dano.
        const facts = healthyFacts();
        facts.timeSeries.wallet = {
            total: 17,
            stale: 2,
            worst: [
                { ticker: 'BOVA11', lastCandle: '2026-08-18', daysStale: 2 },
                { ticker: 'IVVB11', lastCandle: '2026-08-18', daysStale: 2 },
            ],
            dates: [{ date: '2026-08-18', count: 2 }],
        };
        const check = byId(buildHealthReport(facts), 'freshness.timeSeriesWallet');
        expect(check.status).toBe(HEALTH_STATUS.WARN);
        expect(check.detail).toContain('BOVA11');
    });

    it('carteira com 3+ ativos sem candle é CRITICAL', () => {
        const facts = healthyFacts();
        facts.timeSeries.wallet = { total: 17, stale: 4, worst: [], dates: [] };
        expect(byId(buildHealthReport(facts), 'freshness.timeSeriesWallet').status)
            .toBe(HEALTH_STATUS.CRITICAL);
    });

    it('carteira em dia (e carteira vazia) ficam OK', () => {
        expect(byId(buildHealthReport(healthyFacts()), 'freshness.timeSeriesWallet').status)
            .toBe(HEALTH_STATUS.OK);
        const facts = healthyFacts();
        facts.timeSeries.wallet = { total: 0, stale: 0, worst: [], dates: [] };
        expect(byId(buildHealthReport(facts), 'freshness.timeSeriesWallet').status)
            .toBe(HEALTH_STATUS.OK);
    });

    it('ausência total de séries do universo é WARN (fail-closed)', () => {
        const facts = healthyFacts();
        facts.timeSeries.universe = { total: 0, stale: 0, worst: [], dates: [] };
        const check = byId(buildHealthReport(facts), 'freshness.timeSeriesUniverse');
        expect(check.status).toBe(HEALTH_STATUS.WARN);
        expect(check.value).toBeNull();
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

    it('job ACRESCENTADO depois ganha carência própria, contada da entrada no catálogo', () => {
        // 03/09/2026: 'wallet-candle-recovery' entrou no ar e o painel o acusou de
        // "nunca executado" dois minutos depois do deploy — a carência valia só
        // para a instrumentação, madura havia semanas, e não para o job novo.
        const facts = healthyFacts();
        facts.jobs.push({
            jobId: 'wallet-candle-recovery',
            label: 'Recuperação do fechamento oficial',
            severity: 'WARN',
            maxSilenceHours: 14,
            since: new Date(facts.now.getTime() - 0.5 * 3600000).toISOString().slice(0, 10),
            lastRunAt: null,
            lastStatus: null,
        });
        const check = byId(buildHealthReport(facts), 'jobs.wallet-candle-recovery');
        expect(check.status).toBe(HEALTH_STATUS.OK);
        expect(check.detail).toContain('Aguardando primeira execução');
    });

    it('passada a carência do próprio job, "nunca executado" volta a ser falha', () => {
        const facts = healthyFacts();
        facts.jobs.push({
            jobId: 'wallet-candle-recovery',
            label: 'Recuperação do fechamento oficial',
            severity: 'WARN',
            maxSilenceHours: 14,
            since: '2026-01-05', // entrou há meses e nunca rodou
            lastRunAt: null,
            lastStatus: null,
        });
        const check = byId(buildHealthReport(facts), 'jobs.wallet-candle-recovery');
        expect(check.status).toBe(HEALTH_STATUS.WARN);
        expect(check.detail).toContain('Nunca executado');
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
    it('carteira degradada aparece no painel já na PRIMEIRA ocorrência', () => {
        // warn: 1 é decisão, não folga. Uma carteira exibindo ROI simples com selo
        // "Estimado" já é um número errado na tela de alguém.
        const facts = healthyFacts();
        facts.walletPayload = { degraded24h: 1, sources: [{ failed: 'snapshots', count: 1 }] };
        expect(byId(buildHealthReport(facts), 'wallet.payloadDegraded24h').status)
            .toBe(HEALTH_STATUS.WARN);
    });

    it('carteira sem degradação fica OK e diz isso por extenso', () => {
        const facts = healthyFacts();
        facts.walletPayload = { degraded24h: 0, sources: [] };
        const c = byId(buildHealthReport(facts), 'wallet.payloadDegraded24h');
        expect(c.status).toBe(HEALTH_STATUS.OK);
        expect(c.detail).toMatch(/Nenhuma carteira degradada/);
    });

    it('o detalhe nomeia QUAIS buscas caíram — alarme sem endereço é ruído', () => {
        const facts = healthyFacts();
        facts.walletPayload = {
            degraded24h: 42,
            sources: [{ failed: 'snapshots', count: 30 }, { failed: 'treasuryPricing', count: 12 }],
        };
        const c = byId(buildHealthReport(facts), 'wallet.payloadDegraded24h');
        expect(c.status).toBe(HEALTH_STATUS.CRITICAL);
        expect(c.detail).toContain('snapshots (30)');
        expect(c.detail).toContain('treasuryPricing (12)');
    });

    it('fato ausente não quebra o relatório (sentinela antiga, deploy novo)', () => {
        const facts = healthyFacts();
        delete facts.walletPayload;
        const c = byId(buildHealthReport(facts), 'wallet.payloadDegraded24h');
        expect(c.status).toBe(HEALTH_STATUS.OK);
        expect(c.value).toBe(0);
    });

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
        facts.timeSeries.universe = { total: 1000, stale: 300, worst: [], dates: [] }; // 30% → WARN
        const failing = failingChecks(buildHealthReport(facts));
        expect(failing[0].status).toBe(HEALTH_STATUS.CRITICAL);
        expect(failing.at(-1).status).toBe(HEALTH_STATUS.WARN);
    });

    it('todo check carrega uma dica de onde olhar', () => {
        const report = buildHealthReport(healthyFacts());
        expect(report.checks.every((c) => typeof c.hint === 'string' && c.hint.length > 0)).toBe(true);
    });
});

/**
 * Elo PRODUTOR → CONSUMIDOR do check de carteira degradada.
 *
 * A sentinela monta o fato (`summarizeWalletPayloadFailures`) e a régua o lê
 * (`walletPayloadCheck`). São arquivos diferentes ligados por um nome de chave —
 * e se um lado renomear sozinho, o check não quebra: passa a ler `undefined`,
 * grada como zero e mostra "nenhuma carteira degradada" para sempre. O alarme
 * mente calado, que é o pior defeito possível num alarme.
 *
 * Estes testes fecham o elo sem banco: as linhas cruas do ErrorLog entram, o
 * relatório sai.
 */
describe('carteira degradada: sentinela e régua falam a mesma língua', () => {
    const rows = (...entries) => entries.map(([code, total]) => ({ _id: code, total }));

    const reportFrom = (errorLogRows) => {
        const facts = healthyFacts();
        facts.walletPayload = summarizeWalletPayloadFailures(errorLogRows);
        return byId(buildHealthReport(facts), 'wallet.payloadDegraded24h');
    };

    it('linhas do ErrorLog viram um check com contagem e endereço', () => {
        const c = reportFrom(rows(['snapshots', 30], ['treasuryPricing', 12]));

        expect(c.value).toBe(42);
        expect(c.status).toBe(HEALTH_STATUS.CRITICAL);
        expect(c.detail).toContain('snapshots (30)');
        expect(c.detail).toContain('treasuryPricing (12)');
    });

    it('sem nenhuma ocorrência o check fica OK', () => {
        const c = reportFrom([]);
        expect(c.value).toBe(0);
        expect(c.status).toBe(HEALTH_STATUS.OK);
    });

    it('a cauda longa é cortada no detalhe, mas contada no total', () => {
        const c = reportFrom(rows(['a', 5], ['b', 4], ['c', 3], ['d', 2], ['e', 1]));

        expect(c.value).toBe(15);
        expect(c.detail).toContain('a (5)');
        expect(c.detail).not.toContain('d (2)');
    });

    it('code vazio ainda rende uma linha legível, não "undefined"', () => {
        const c = reportFrom([{ _id: null, total: 2 }]);
        expect(c.detail).toContain('? (2)');
    });
});
