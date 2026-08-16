/**
 * Regras da sentinela de saúde dos dados — 100% PURAS.
 *
 * A coleta (queries no Mongo) fica em `services/dataHealthService.js`; aqui só
 * entra o "fato" já agregado e sai o veredito. A separação é o que torna cada
 * limiar testável sem banco: o teste monta o fato e afirma o status.
 *
 * Diferença essencial para o que já existia (`utils/ingestionHealth.js`): aquele
 * valida a EXECUÇÃO de um sync (parsed vs. aceitos, no momento em que roda). Este
 * valida o ESTADO do banco a qualquer momento — pega o caso em que o sync nunca
 * rodou, rodou pela metade há dois dias, ou zerou um campo sem quebrar o layout.
 *
 * Convenção de campo ausente: o schema de MarketAsset usa `default: 0` em quase
 * toda métrica, então 0 é indistinguível de "não coletado". A cobertura trata 0
 * como AUSENTE de propósito — um P/L 0 não é um P/L, é um buraco de dado.
 */

export const HEALTH_STATUS = {
    OK: 'OK',
    WARN: 'WARN',
    CRITICAL: 'CRITICAL',
};

const RANK = { OK: 0, WARN: 1, CRITICAL: 2 };

/** Pior entre dois status (OK < WARN < CRITICAL). */
export const worstStatus = (a, b) => (RANK[a] >= RANK[b] ? a : b);

export const CATEGORY = {
    FRESHNESS: 'FRESCOR',
    COVERAGE: 'COBERTURA',
    PLAUSIBILITY: 'PLAUSIBILIDADE',
    MACRO: 'MACRO',
    JOBS: 'ROTINAS',
    INGESTION: 'INGESTÃO',
    ERRORS: 'ERROS',
};

/**
 * Limiares padrão. Sobrescritíveis por `SystemConfig{ key: 'DATA_HEALTH_THRESHOLDS' }`
 * (merge raso por chave), para calibrar sem deploy.
 *
 * Fração = proporção do universo daquela classe (0.20 = 20%).
 */
export const DEFAULT_THRESHOLDS = {
    // Fração de ativos ATIVOS com cotação mais velha que `priceStaleAfterHours`.
    priceStaleAfterHours: 30,
    priceStaleRatio: { warn: 0.15, critical: 0.40 },
    // CONTAGEM (não fração) de ativos com preço congelado há semanas.
    // Existe porque o check de fração é cego para este caso: 9 ativos congelados
    // em 1342 dão 0,7% e jamais encostam no limiar de 15% — mas entre eles havia
    // NEOE3, ODPV3, BK e CTRA, parados por 26 a 134 dias, todos ainda elegíveis
    // para ranking e carteira com preço de meses atrás. Poucos ativos, dano alto:
    // o alarme certo conta cabeças, não percentual.
    frozenPriceAfterDays: 30,
    frozenAssets: { warn: 1, critical: 10 },
    // Fração de ativos SEM o campo fundamentalista (0/null = ausente).
    coverageMissingRatio: { warn: 0.25, critical: 0.50 },
    // Fração de ativos com valor economicamente impossível.
    implausibleRatio: { warn: 0.02, critical: 0.10 },
    // Idade do bloco macro (SELIC/IPCA/CDI/Ibov/dólar).
    macroAgeHours: { warn: 6, critical: 48 },
    // Atraso do último PU do Tesouro em DIAS ÚTEIS — não em horas. O Tesouro só
    // publica em dia útil, então em horas todo domingo acusaria ~52h de atraso
    // sobre a sexta e o painel amanheceria amarelo todo fim de semana.
    treasuryBusinessDaysStale: { warn: 2, critical: 4 },
    // Fração de séries temporais (AssetHistory) mais velhas que `timeSeriesStaleAfterHours`.
    // Fração, e não média: a base real tem cauda longa (série morta de 199 dias)
    // que puxa a média para 115h enquanto 84% das séries estão abaixo de 72h — a
    // média mediria a cauda, não a saúde.
    timeSeriesStaleAfterHours: 168,
    timeSeriesStaleRatio: { warn: 0.25, critical: 0.50 },
    // Fração de ativos sem fundamentos coletados (nulo ou mais velho que N dias).
    fundamentalsDateStaleAfterDays: 7,
    fundamentalsDateStaleRatio: { warn: 0.25, critical: 0.50 },
    // Fração do universo desativada por falha consecutiva de cotação.
    inactiveRatio: { warn: 0.05, critical: 0.15 },
    // Erros 5xx do backend nas últimas 24h.
    errors24h: { warn: 25, critical: 150 },
    // Idade da confirmação de saúde dos fundamentos BR (espelha o gate de publicação).
    fundamentalsAgeHours: { warn: 40, critical: 96 },
};

/**
 * Faixas de plausibilidade por métrica. Fora disso, o dado está corrompido.
 *
 * Calibração importante para P/L e P/VP: são RAZÕES cujo denominador tende a zero
 * (lucro ou patrimônio perto de zero), então valor extremo é matematicamente
 * esperado e NÃO é defeito. Contra a base real, a faixa antiga acusava 24 ações
 * com P/VP negativo — que são empresas de patrimônio líquido negativo (AZUL3,
 * AALR3, RCSL4), condição econômica real e não erro de coleta. A faixa larga
 * mantém só o que não tem explicação econômica nenhuma: PLTO5/PLTO6 com P/VP na
 * casa de 700.000, que é estouro de divisão na origem.
 */
export const PLAUSIBILITY_RANGES = {
    dy: { min: 0, max: 25, label: 'Dividend Yield', unit: '%' },
    pl: { min: -5000, max: 5000, label: 'P/L', unit: '' },
    p_vp: { min: -5000, max: 5000, label: 'P/VP', unit: '' },
    beta: { min: -2, max: 4, label: 'Beta', unit: '' },
    change: { min: -50, max: 50, label: 'Variação diária', unit: '%' },
};

/** Faixas de sanidade dos indicadores macro. */
export const MACRO_RANGES = {
    selic: { min: 0.5, max: 40, label: 'SELIC', unit: '%' },
    ipca: { min: -5, max: 40, label: 'IPCA', unit: '%' },
    cdi: { min: 0.5, max: 40, label: 'CDI', unit: '%' },
    ibov: { min: 30000, max: 500000, label: 'Ibovespa', unit: 'pts' },
    dollar: { min: 1, max: 30, label: 'Dólar', unit: 'R$' },
};

/**
 * Campos cobrados por classe. Um campo só entra aqui se (a) a ausência degrada o
 * produto de verdade e (b) `0` é INDISTINGUÍVEL de ausente para aquele campo.
 *
 * O critério (b) é o que exclui `dy`: o schema usa `default: 0`, e DY zero é um
 * valor econômico legítimo — PRIO3, ENEV3 e PETZ3 simplesmente não pagam dividendo.
 * Contra a base real isso acusava 100/346 ações "sem DY", um alarme que nunca
 * fecharia. A cobertura de fundamentos de verdade é medida por
 * `ingestion.fundamentalsDate`, que usa `lastFundamentalsDate` — esse sim é nulo
 * quando o dado não foi coletado, sem ambiguidade.
 *
 * Mesma razão exclui `marketCap` de ETF: o Yahoo não devolve valor de mercado
 * para ETF (reporta patrimônio sob outro nome), então os 23/23 "ausentes" da base
 * são um limite da fonte, não um defeito — e alarme que não tem conserto é ruído.
 */
export const COVERAGE_SPEC = {
    STOCK: [
        { field: 'lastPrice', label: 'Preço', severity: 'CRITICAL' },
        { field: 'pl', label: 'P/L', severity: 'WARN' },
        { field: 'roe', label: 'ROE', severity: 'WARN' },
        { field: 'marketCap', label: 'Valor de mercado', severity: 'CRITICAL' },
        { field: 'liquidity', label: 'Liquidez', severity: 'CRITICAL' },
    ],
    FII: [
        { field: 'lastPrice', label: 'Preço', severity: 'CRITICAL' },
        { field: 'p_vp', label: 'P/VP', severity: 'WARN' },
        { field: 'marketCap', label: 'Valor de mercado', severity: 'WARN' },
        { field: 'liquidity', label: 'Liquidez', severity: 'CRITICAL' },
    ],
    STOCK_US: [
        { field: 'lastPrice', label: 'Preço', severity: 'CRITICAL' },
        { field: 'pl', label: 'P/L', severity: 'WARN' },
        { field: 'roe', label: 'ROE', severity: 'WARN' },
        { field: 'marketCap', label: 'Valor de mercado', severity: 'WARN' },
    ],
    ETF: [
        { field: 'lastPrice', label: 'Preço', severity: 'CRITICAL' },
    ],
    CRYPTO: [
        { field: 'lastPrice', label: 'Preço', severity: 'CRITICAL' },
        { field: 'marketCap', label: 'Valor de mercado', severity: 'WARN' },
    ],
};

/** Classes cujos fundamentos vêm do scraping BR e têm `lastFundamentalsDate`. */
export const FUNDAMENTALS_DATE_CLASSES = ['STOCK', 'FII', 'STOCK_US'];

// --- helpers puros ---------------------------------------------------------

// null/undefined precisam sobreviver como null até o classificador: `Number(null)`
// é 0, e 0 é um valor VÁLIDO em quase todo check aqui — converter ausência em zero
// faria "dado não coletado" ser lido como "dado excelente".
const num = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

/** Divisão protegida: universo vazio devolve 0, nunca NaN/Infinity. */
export const ratio = (part, total) => {
    const p = num(part) ?? 0;
    const t = num(total) ?? 0;
    return t > 0 ? p / t : 0;
};

export const hoursBetween = (from, to) => {
    const a = from instanceof Date ? from : new Date(from);
    const b = to instanceof Date ? to : new Date(to);
    const ms = b.getTime() - a.getTime();
    if (!Number.isFinite(ms)) return null;
    return ms / 3600000;
};

/**
 * Classifica um valor contra `{ warn, critical }` em que MAIOR é pior.
 * `severityCap` limita o pior status possível — deixa um campo secundário
 * (P/L ausente) alarmar no máximo como WARN mesmo estourando o limiar crítico.
 */
export const gradeAscending = (value, { warn, critical }, severityCap = 'CRITICAL') => {
    const v = num(value);
    if (v === null) return HEALTH_STATUS.WARN;
    if (v >= critical) return severityCap === 'WARN' ? HEALTH_STATUS.WARN : HEALTH_STATUS.CRITICAL;
    if (v >= warn) return HEALTH_STATUS.WARN;
    return HEALTH_STATUS.OK;
};

const pct = (v) => `${(v * 100).toFixed(1)}%`;

const check = ({ id, label, category, status, value, detail, hint }) => ({
    id,
    label,
    category,
    status,
    value: value ?? null,
    detail: detail || '',
    // `hint` é o que o painel mostra como "onde olhar" — a razão de existir do
    // alarme é virar conserto, não virar número.
    hint: hint || '',
});

const mergeThresholds = (overrides) => {
    if (!overrides || typeof overrides !== 'object') return DEFAULT_THRESHOLDS;
    const merged = { ...DEFAULT_THRESHOLDS };
    for (const [key, value] of Object.entries(overrides)) {
        if (!(key in DEFAULT_THRESHOLDS)) continue;
        const base = DEFAULT_THRESHOLDS[key];
        if (typeof base === 'object' && base !== null && typeof value === 'object' && value !== null) {
            const warn = num(value.warn);
            const critical = num(value.critical);
            merged[key] = {
                warn: warn ?? base.warn,
                critical: critical ?? base.critical,
            };
        } else {
            merged[key] = num(value) ?? base;
        }
    }
    return merged;
};

// --- construtores de check por domínio -------------------------------------

const freshnessChecks = (facts, th) => {
    const out = [];

    // Congelados: contagem absoluta, com os tickers no detalhe — um alarme que diz
    // "9 ativos parados" sem dizer QUAIS obriga a mesma investigação toda vez.
    const frozen = num(facts.frozen?.count) ?? 0;
    const sample = facts.frozen?.tickers || [];
    out.push(check({
        id: 'freshness.frozenAssets',
        label: 'Ativos com preço congelado',
        category: CATEGORY.FRESHNESS,
        status: frozen === 0 ? HEALTH_STATUS.OK : gradeAscending(frozen, th.frozenAssets),
        value: frozen,
        detail: frozen === 0
            ? `Nenhum ativo parado há mais de ${th.frozenPriceAfterDays} dias`
            : `${frozen} ativo(s) sem cotação nova há mais de ${th.frozenPriceAfterDays} dias`
              + (sample.length ? `: ${sample.join(', ')}` : ''),
        hint: 'Ativo grande é poupado da desativação automática (proteção contra queda de fonte), então some do radar sem sair do ranking. Confirme se ainda cota na origem — pode ter sido deslistado, adquirido ou trocado de ticker.',
    }));

    for (const [assetClass, stats] of Object.entries(facts.assets || {})) {
        const active = num(stats.active) ?? 0;
        if (active === 0) continue; // classe não povoada não é falha
        const r = ratio(stats.stalePrice, active);
        out.push(check({
            id: `freshness.price.${assetClass}`,
            label: `Preço desatualizado — ${assetClass}`,
            category: CATEGORY.FRESHNESS,
            status: gradeAscending(r, th.priceStaleRatio),
            value: r,
            detail: `${stats.stalePrice}/${active} ativos sem cotação há mais de ${th.priceStaleAfterHours}h (${pct(r)})`,
            hint: 'Cotações vêm de marketDataService (Yahoo → Google → Brapi). Cheque o cron de preços e o failCount dos tickers.',
        }));
    }
    return out;
};

const coverageChecks = (facts, th) => {
    const out = [];
    for (const [assetClass, spec] of Object.entries(COVERAGE_SPEC)) {
        const stats = facts.assets?.[assetClass];
        const active = num(stats?.active) ?? 0;
        if (active === 0) continue;
        for (const { field, label, severity } of spec) {
            const missing = num(stats.missing?.[field]) ?? 0;
            const r = ratio(missing, active);
            out.push(check({
                id: `coverage.${assetClass}.${field}`,
                label: `${label} ausente — ${assetClass}`,
                category: CATEGORY.COVERAGE,
                status: gradeAscending(r, th.coverageMissingRatio, severity),
                value: r,
                detail: `${missing}/${active} ativos sem ${label} (${pct(r)})`,
                hint: assetClass === 'STOCK' || assetClass === 'FII'
                    ? 'Origem: scraping do Fundamentus (fundamentusService). Campo zerado em massa costuma ser mudança de layout — rode o canário de fontes.'
                    : 'Origem: Yahoo Finance (usStocksFundamentalsService / marketDataService).',
            }));
        }
    }
    return out;
};

const plausibilityChecks = (facts, th) => {
    const out = [];
    const totals = facts.implausible || {};
    const universe = num(facts.totals?.active) ?? 0;
    if (universe === 0) return out;
    for (const [field, range] of Object.entries(PLAUSIBILITY_RANGES)) {
        const count = num(totals[field]) ?? 0;
        const r = ratio(count, universe);
        out.push(check({
            id: `plausibility.${field}`,
            label: `${range.label} fora da faixa`,
            category: CATEGORY.PLAUSIBILITY,
            status: gradeAscending(r, th.implausibleRatio),
            value: r,
            detail: `${count} ativo(s) com ${range.label} fora de [${range.min}, ${range.max}]${range.unit ? ` ${range.unit}` : ''} (${pct(r)})`,
            hint: 'Valor impossível quase sempre é coluna trocada na origem ou unidade errada (fração vs. percentual).',
        }));
    }
    // Preço não-positivo é categórico: ativo ativo sem preço válido é sempre defeito,
    // então UMA ocorrência já sai de OK (piso WARN) — mas só vira CRITICAL quando
    // atinge fração relevante, para um ticker órfão não pintar o painel de vermelho.
    const zeroPrice = num(facts.implausible?.nonPositivePrice) ?? 0;
    out.push(check({
        id: 'plausibility.nonPositivePrice',
        label: 'Preço zerado ou negativo',
        category: CATEGORY.PLAUSIBILITY,
        status: zeroPrice === 0
            ? HEALTH_STATUS.OK
            : worstStatus(
                HEALTH_STATUS.WARN,
                gradeAscending(ratio(zeroPrice, universe), th.implausibleRatio),
            ),
        value: zeroPrice,
        detail: `${zeroPrice} ativo(s) ativo(s) com preço ≤ 0`,
        hint: 'Ativo ativo sem preço válido entra em ranking e carteira com valor errado. Verifique o fallback de cotação.',
    }));
    return out;
};

const macroChecks = (facts, th) => {
    const out = [];
    const macro = facts.macro || {};
    const age = macro.updatedAt ? hoursBetween(macro.updatedAt, facts.now) : null;

    out.push(check({
        id: 'macro.freshness',
        label: 'Idade do bloco macro',
        category: CATEGORY.MACRO,
        status: age === null ? HEALTH_STATUS.CRITICAL : gradeAscending(age, th.macroAgeHours),
        value: age,
        detail: age === null
            ? 'Nenhum registro de macro encontrado'
            : `Atualizado há ${age.toFixed(1)}h`,
        hint: 'macroDataService — cadeia BCB → BrasilAPI → IBGE. Cheque o cron de 15 min e o circuito de rede.',
    }));

    for (const [field, range] of Object.entries(MACRO_RANGES)) {
        const value = num(macro[field]);
        const missing = value === null || value === 0;
        const outOfRange = !missing && (value < range.min || value > range.max);
        out.push(check({
            id: `macro.value.${field}`,
            label: `${range.label}`,
            category: CATEGORY.MACRO,
            status: missing || outOfRange ? HEALTH_STATUS.CRITICAL : HEALTH_STATUS.OK,
            value,
            detail: missing
                ? 'Ausente'
                : `${value} ${range.unit}${outOfRange ? ` — fora de [${range.min}, ${range.max}]` : ''}`,
            hint: 'Indicador macro alimenta taxa livre de risco, Bazin e o score inteiro. Valor fora da faixa contamina todo o ranking.',
        }));
    }
    return out;
};

const treasuryCheck = (facts, th) => {
    const days = num(facts.treasury?.businessDaysStale);
    const hasSeries = (num(facts.treasury?.titles) ?? 0) > 0;
    return check({
        id: 'freshness.treasury',
        label: 'PU do Tesouro Direto',
        category: CATEGORY.FRESHNESS,
        status: !hasSeries || days === null
            ? HEALTH_STATUS.CRITICAL
            : gradeAscending(days, th.treasuryBusinessDaysStale),
        value: days,
        detail: !hasSeries
            ? 'Nenhuma série de PU encontrada'
            : `Último PU tem ${days} dia(s) útil(eis) de atraso (${facts.treasury.titles} títulos)`,
        hint: 'treasuryPriceService. Sem PU recente a renda fixa cai para accrual (fail-closed) e o snapshot marca na curva.',
    });
};

const timeSeriesCheck = (facts, th) => {
    const count = num(facts.timeSeries?.count) ?? 0;
    if (count === 0) {
        return check({
            id: 'freshness.timeSeries',
            label: 'Séries temporais (AssetHistory)',
            category: CATEGORY.FRESHNESS,
            status: HEALTH_STATUS.WARN,
            value: null,
            detail: 'Sem séries registradas',
            hint: 'timeSeriesWorker nunca populou AssetHistory.',
        });
    }
    const r = ratio(facts.timeSeries?.stale, count);
    return check({
        id: 'freshness.timeSeries',
        label: 'Séries temporais (AssetHistory)',
        category: CATEGORY.FRESHNESS,
        status: gradeAscending(r, th.timeSeriesStaleRatio),
        value: r,
        detail: `${facts.timeSeries?.stale || 0}/${count} séries sem atualizar há mais de `
            + `${th.timeSeriesStaleAfterHours}h (${pct(r)})`,
        hint: 'timeSeriesWorker. Série velha achata beta/volatilidade/SMA200 e distorce o backtest.',
    });
};

const ingestionChecks = (facts, th) => {
    const out = [];
    const f = facts.fundamentals || {};
    const age = f.timestamp ? hoursBetween(f.timestamp, facts.now) : null;
    const healthy = f.healthy === true;
    let status = HEALTH_STATUS.OK;
    if (!healthy) status = HEALTH_STATUS.CRITICAL;
    else if (age === null) status = HEALTH_STATUS.CRITICAL;
    else status = gradeAscending(age, th.fundamentalsAgeHours);

    out.push(check({
        id: 'ingestion.fundamentals',
        label: 'Fundamentos BR (Fundamentus)',
        category: CATEGORY.INGESTION,
        status,
        value: age,
        detail: !healthy
            ? `Último sync marcado como DEGRADADO${f.errorCode ? ` (${f.errorCode})` : ''}`
            : age === null
                ? 'Sem confirmação de saúde'
                : `Saudável, confirmado há ${age.toFixed(1)}h`,
        hint: 'Espelha o gate de ingestionHealth.js. Enquanto vermelho, a publicação de ranking BR fica bloqueada.',
    }));

    // Cobertura de fundamentos SEM ambiguidade: `lastFundamentalsDate` é nulo
    // quando nunca foi coletado, ao contrário das métricas que têm `default: 0`
    // e confundem "empresa não paga dividendo" com "não raspamos o dado".
    for (const assetClass of FUNDAMENTALS_DATE_CLASSES) {
        const stats = facts.assets?.[assetClass];
        const active = num(stats?.active) ?? 0;
        if (active === 0) continue;
        const stale = num(stats.staleFundamentals) ?? 0;
        const rate = ratio(stale, active);
        out.push(check({
            id: `ingestion.fundamentalsDate.${assetClass}`,
            label: `Fundamentos não coletados — ${assetClass}`,
            category: CATEGORY.INGESTION,
            status: gradeAscending(rate, th.fundamentalsDateStaleRatio),
            value: rate,
            detail: `${stale}/${active} ativos sem fundamentos há mais de `
                + `${th.fundamentalsDateStaleAfterDays} dias ou nunca coletados (${pct(rate)})`,
            hint: 'Ativo que sumiu da varredura da fonte para de receber fundamento e envelhece calado — o preço continua atualizando, então nada mais denuncia.',
        }));
    }

    const inactive = num(facts.totals?.inactive) ?? 0;
    const total = num(facts.totals?.all) ?? 0;
    const r = ratio(inactive, total);
    out.push(check({
        id: 'ingestion.inactiveAssets',
        label: 'Ativos desativados por falha',
        category: CATEGORY.INGESTION,
        status: gradeAscending(r, th.inactiveRatio),
        value: r,
        detail: `${inactive}/${total} ativos inativos por falha de cotação (${pct(r)})`,
        hint: 'Cresce quando uma fonte cai por dias. O cron de reativação (seg 05:00) tenta reverter; "Resetar saúde" força.',
    }));
    return out;
};

const jobChecks = (facts) => {
    const out = [];
    // Há quanto tempo existe registro de execução. Um cron diário legitimamente
    // não tem histórico se a instrumentação subiu há duas horas — sem esta carência
    // o painel nasceria vermelho acusando 12 rotinas de "nunca executadas", e um
    // monitor cuja primeira impressão é um alarme falso é um monitor que se aprende
    // a ignorar. A carência de cada job é o próprio teto de silêncio dele.
    const instrumentedForHours = facts.instrumentationSince
        ? hoursBetween(facts.instrumentationSince, facts.now)
        : 0;

    for (const job of facts.jobs || []) {
        const { jobId, label, severity = 'WARN', maxSilenceHours, lastRunAt, lastStatus, lastError } = job;

        if (!lastRunAt) {
            const withinGrace = Number.isFinite(maxSilenceHours)
                && instrumentedForHours < maxSilenceHours;
            out.push(check({
                id: `jobs.${jobId}`,
                label,
                category: CATEGORY.JOBS,
                status: withinGrace
                    ? HEALTH_STATUS.OK
                    : (severity === 'CRITICAL' ? HEALTH_STATUS.CRITICAL : HEALTH_STATUS.WARN),
                value: null,
                detail: withinGrace
                    ? `Aguardando primeira execução (monitorado há ${instrumentedForHours.toFixed(1)}h, `
                      + `roda a cada ${maxSilenceHours}h)`
                    : 'Nunca executado desde a instrumentação',
                hint: withinGrace
                    ? 'Normal logo após subir a instrumentação — o job ainda não teve a vez dele.'
                    : 'Se o job existe no scheduler e nunca gravou execução, o scheduler pode não ter subido.',
            }));
            continue;
        }

        const age = hoursBetween(lastRunAt, facts.now);
        const overdue = Number.isFinite(maxSilenceHours) && age > maxSilenceHours;
        const failed = lastStatus === 'FAILED';

        let status = HEALTH_STATUS.OK;
        if (failed || overdue) {
            status = severity === 'CRITICAL' ? HEALTH_STATUS.CRITICAL : HEALTH_STATUS.WARN;
        }

        const parts = [`Última execução há ${age.toFixed(1)}h`];
        if (overdue) parts.push(`acima do teto de ${maxSilenceHours}h`);
        if (failed) parts.push(`falhou: ${lastError || 'erro não registrado'}`);

        out.push(check({
            id: `jobs.${jobId}`,
            label,
            category: CATEGORY.JOBS,
            status,
            value: age,
            detail: parts.join(' — '),
            hint: failed
                ? 'Veja o erro completo na aba de Erros do painel.'
                : 'Silêncio acima do teto indica scheduler parado, deploy que derrubou o processo, ou EXTERNAL_SCHEDULER mal configurado.',
        }));
    }
    return out;
};

const errorChecks = (facts, th) => {
    const count = num(facts.errors?.last24h) ?? 0;
    return [check({
        id: 'errors.backend24h',
        label: 'Erros do backend (24h)',
        category: CATEGORY.ERRORS,
        status: gradeAscending(count, th.errors24h),
        value: count,
        detail: `${count} erro(s) registrado(s) nas últimas 24h`,
        hint: 'Detalhe por rota/job na aba de Erros.',
    })];
};

// --- montagem do relatório --------------------------------------------------

/**
 * Recebe os fatos agregados e devolve o relatório completo.
 *
 * `facts` esperado:
 *   { now, totals{all,active,inactive}, assets{CLASSE:{active,stalePrice,missing{}}},
 *     implausible{campo:count,nonPositivePrice}, macro{...,updatedAt},
 *     treasury{titles,latestDate}, timeSeries{count,avgAgeHours},
 *     fundamentals{healthy,timestamp,errorCode}, jobs[], errors{last24h} }
 */
export const buildHealthReport = (facts = {}, thresholdOverrides = null) => {
    const th = mergeThresholds(thresholdOverrides);
    const now = facts.now instanceof Date ? facts.now : new Date(facts.now || Date.now());
    const ctx = { ...facts, now };

    const checks = [
        ...freshnessChecks(ctx, th),
        treasuryCheck(ctx, th),
        timeSeriesCheck(ctx, th),
        ...coverageChecks(ctx, th),
        ...plausibilityChecks(ctx, th),
        ...macroChecks(ctx, th),
        ...ingestionChecks(ctx, th),
        ...jobChecks(ctx),
        ...errorChecks(ctx, th),
    ];

    const summary = { ok: 0, warn: 0, critical: 0 };
    let status = HEALTH_STATUS.OK;
    for (const c of checks) {
        if (c.status === HEALTH_STATUS.CRITICAL) summary.critical += 1;
        else if (c.status === HEALTH_STATUS.WARN) summary.warn += 1;
        else summary.ok += 1;
        status = worstStatus(status, c.status);
    }

    return { runAt: now, status, summary, checks, thresholds: th };
};

/** Só o que está quebrado, pior primeiro — é o que o painel destaca no topo. */
export const failingChecks = (report) =>
    (report?.checks || [])
        .filter((c) => c.status !== HEALTH_STATUS.OK)
        .sort((a, b) => RANK[b.status] - RANK[a.status]);
