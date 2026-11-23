import type {
    PerformanceDurationMetric,
    PerformanceRuntime,
    PerformanceSnapshot,
} from '../../services/performance';

/**
 * Leitura do painel de desempenho, sem React: o que cada medidor diz, em que cor,
 * e as frases de diagnóstico da memória. O componente só desenha o que sai daqui.
 */

/**
 * Teto de memória da instância quando o servidor não informa o seu.
 *
 * Sem um denominador, "180 MB" não diz nada — o mesmo número é folgado num plano
 * e é véspera de reinício em outro. O valor bom vem de `runtime.limitsMb`, que o
 * processo MEDE; este aqui é só a rede de segurança para um servidor ainda não
 * atualizado. Cravar o número dos dois lados foi o que deixou o painel e o
 * `--max-old-space-size` do `npm start` livres para discordarem em silêncio.
 */
const DEFAULT_MEMORY_LIMIT_MB = 512;

/**
 * Quanto de memória fora do heap um processo como este ocupa SEM ter nada de
 * errado: o binário do Node, as bibliotecas carregadas (Express, Mongoose, a
 * instrumentação OpenTelemetry que a Sentry soma às integrações padrão) e as
 * pilhas das threads do libuv. Referência grosseira, e é de propósito — serve
 * para dizer se o excedente é dezenas ou centenas de MB, não para fechar conta.
 */
const OFFHEAP_BASELINE_MB = 80;

/**
 * Excedente fora do heap, descontados os Buffers vivos, a partir do qual a tela
 * aponta retenção do allocator nativo.
 *
 * Não é um limiar de saúde — é o ponto em que a diferença deixa de caber no
 * baseline acima e passa a ter dono: memória que NÓS liberamos e o allocator do
 * sistema não devolveu ao SO. Nenhum GC alcança isso, e nenhum dos cinco
 * medidores acendia para isso: o RSS já contava esses MB sem dizer de quem eram.
 */
const UNATTRIBUTED_OFFHEAP_WATCH_MB = 150;

type Memory = PerformanceRuntime['memoryMb'];
type Trend = NonNullable<PerformanceRuntime['memoryTrend']>;

const isFiniteNumber = (value: number | null | undefined): value is number =>
    typeof value === 'number' && Number.isFinite(value);

export const formatMs = (value: number | null | undefined) => {
    if (!isFiniteNumber(value)) return '—';
    if (value < 1) return `${value.toFixed(2)} ms`;
    if (value < 1000) return `${Math.round(value)} ms`;
    return `${(value / 1000).toFixed(2)} s`;
};

export const formatUptime = (seconds: number | null | undefined) => {
    if (!isFiniteNumber(seconds)) return '—';
    const hours = Math.floor(seconds / 3600);
    if (hours < 1) return `${Math.max(1, Math.floor(seconds / 60))} min`;
    if (hours < 48) return `${hours}h`;
    return `${Math.floor(hours / 24)} dias`;
};

/**
 * Veredito de um medidor.
 *
 * Existe porque a versão anterior exibia cinco números sem régua nenhuma: "412 ms",
 * "0,80%", "180 MB" — informação para quem já sabe o que é bom, ruído para todos os
 * outros. Um painel de saúde que obriga o leitor a saber os limiares de cor não
 * está medindo saúde, está imprimindo telemetria.
 *
 * `null` = sem amostra suficiente para julgar (nunca "ruim").
 */
export type Verdict = 'GOOD' | 'WATCH' | 'BAD' | null;

/** Compara contra limiares crescentes (quanto MENOR, melhor). */
const gradeAscending = (value: number | null | undefined, watch: number, bad: number): Verdict => {
    if (!isFiniteNumber(value)) return null;
    if (value >= bad) return 'BAD';
    if (value >= watch) return 'WATCH';
    return 'GOOD';
};

/** Compara contra limiares decrescentes (quanto MAIOR, melhor). */
const gradeDescending = (value: number | null | undefined, watch: number, bad: number): Verdict => {
    if (!isFiniteNumber(value)) return null;
    if (value <= bad) return 'BAD';
    if (value <= watch) return 'WATCH';
    return 'GOOD';
};

/**
 * O pior de vários vereditos sobre o MESMO medidor.
 *
 * A memória passou a ser julgada por duas evidências independentes — o nível de
 * agora e a inclinação da janela —, e um medidor tem uma cor só. Vence a pior:
 * 300 MB subindo rumo ao teto em 6h não é "normal" porque 300 de 512 é folgado,
 * e 396 MB estáveis há 24h não deixam de merecer o olho porque a reta é plana.
 */
const worstVerdict = (...verdicts: Verdict[]): Verdict => {
    const rank: Record<Exclude<Verdict, null>, number> = { GOOD: 0, WATCH: 1, BAD: 2 };
    const known = verdicts.filter((v): v is Exclude<Verdict, null> => v !== null);
    if (!known.length) return null;
    return known.reduce((pior, atual) => (rank[atual] > rank[pior] ? atual : pior));
};

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

const byP95Desc = (a: PerformanceDurationMetric, b: PerformanceDurationMetric) => (b.p95Ms ?? 0) - (a.p95Ms ?? 0);

const slowestSampled = (metrics: PerformanceDurationMetric[]): PerformanceDurationMetric | undefined =>
    metrics.filter((metric) => metric.sampled > 0 && metric.p95Ms !== null).sort(byP95Desc)[0];

const cacheStats = (cache: Record<string, number>) => {
    const entries = Object.entries(cache);
    const hits = sum(entries.filter(([key]) => key.endsWith('.hit')).map(([, value]) => value));
    const attempts = sum(entries
        .filter(([key]) => /\.(hit|miss|expired|fallback|error)$/.test(key))
        .map(([, value]) => value));
    return { cacheAttempts: attempts, cacheRate: attempts > 0 ? hits / attempts : null };
};

const buildDetailRows = (durations: PerformanceSnapshot['durations']) => Object.entries(durations)
    .flatMap(([domain, metrics]) => metrics
        .filter((metric) => metric.sampled > 0)
        .map((metric) => ({ domain, metric })))
    .sort((a, b) => byP95Desc(a.metric, b.metric))
    .slice(0, 12);

/**
 * A leitura completa da memória, em uma linha.
 *
 * O card mostrava RSS e `heapUsed` e engolia `heapTotal` e `external` —
 * justamente os dois que explicam o vão entre eles. Com 407 MB de RSS e
 * 117 MB de heap em uso, o que sobra são 290 MB que o card afirmava
 * existir sem dizer de quem são: página que o V8 comprometeu e não
 * devolveu (normal depois de um job pesado) ou memória nativa presa
 * (Buffer, fragmentação) — diagnósticos opostos, mesmo número na tela.
 */
const buildMemoryDetail = (memory: Memory | null) => {
    if (!memory) return 'Sem leitura';
    return `Heap ${memory.heapUsed.toFixed(0)} de ${memory.heapTotal.toFixed(0)} MB`
        + (memory.offHeap === undefined ? '' : ` · ${memory.offHeap.toFixed(0)} MB fora do heap`)
        // `external` é o que dá dono ao vão: sem esse número, "272 MB fora do
        // heap" é um total sem composição, e Buffer vivo e retenção do allocator
        // ficam indistinguíveis — a pergunta que o card existe para responder.
        + ` · Buffers ${memory.external.toFixed(0)} MB`;
};

const trendWindowLine = (trend: Trend | null) => (trend?.direction
    ? `Janela medida: ${trend.points} amostras em ${trend.spanHours.toFixed(1)}h`
        + ` (mín. ${trend.rssMinMb} / máx. ${trend.rssMaxMb} MB)`
    : 'Janela medida: ainda acumulando amostras');

interface MemoryInputs {
    memory: Memory | null;
    memoryLimitMb: number;
    heapLimitMb: number | null;
    trend: Trend | null;
    arenaMax: number | null | undefined;
}

const buildMemoryDetailTitle = ({ memory, memoryLimitMb, heapLimitMb, trend }: MemoryInputs) => {
    if (!memory) return undefined;
    return [
        `Total do processo (RSS): ${memory.rss.toFixed(0)} MB de ${memoryLimitMb} MB da instância`,
        `Heap em uso: ${memory.heapUsed.toFixed(0)} MB`,
        `Heap reservado pelo V8: ${memory.heapTotal.toFixed(0)} MB`
            + (heapLimitMb === null ? '' : ` (teto de ${heapLimitMb} MB)`),
        `Buffers e nativo (external): ${memory.external.toFixed(0)} MB`,
        memory.offHeap === undefined
            ? null
            : `Fora do heap (RSS − heap reservado): ${memory.offHeap.toFixed(0)} MB`,
        trendWindowLine(trend),
    ].filter(Boolean).join('\n');
};

type NoteTone = 'BAD' | 'WATCH' | 'NEUTRAL';
export interface MemoryNote { tone: NoteTone; title: string; body: string }

const noteTitle = (memory: Memory, trend: Trend, memoryLimitMb: number, subindo: boolean) => {
    const inclinacao = trend.rssSlopeMbPerHour ?? 0;
    if (subindo) {
        return `Memória subindo ${inclinacao.toFixed(1)} MB/h`
            + (trend.hoursToLimit === null
                ? ` nas últimas ${trend.spanHours.toFixed(0)}h`
                : ` — no mesmo ritmo, encosta nos ${memoryLimitMb} MB da instância em ~${trend.hoursToLimit.toFixed(0)}h`);
    }
    if (trend.decelerating) {
        return `Memória estabilizada — plana nas últimas ${trend.recentSpanHours}h, em ${memory.rss.toFixed(0)} MB`;
    }
    return `Memória ${trend.direction === 'FALLING' ? 'em queda' : 'estável'} há ${trend.spanHours.toFixed(0)}h`
        + ` — ${memory.rss.toFixed(0)} MB agora, entre ${trend.rssMinMb} e ${trend.rssMaxMb} MB na janela`;
};

/**
 * A frase existe porque o número que sobra na janela longa CONTRADIZ o título,
 * e um painel que mostra os dois sem explicar o desencontro devolve a dúvida
 * para quem lê.
 */
const warmupSentence = (trend: Trend) => {
    if (!trend.decelerating) return '';
    const inclinacao = (trend.rssSlopeMbPerHour ?? 0).toFixed(1);
    return ` A janela de ${trend.spanHours.toFixed(0)}h ainda acusa ${inclinacao} MB/h`
        + ' porque inclui a subida que todo processo faz ao esquentar;'
        + ` nas últimas ${trend.recentSpanHours}h a inclinação é ${(trend.recentSlopeMbPerHour ?? 0).toFixed(1)} MB/h.`;
};

/**
 * Onde está a subida decide o que fazer. No heap, o GC ainda alcança e o teto do
 * V8 ainda contém — morre com OOM diagnosticável. Fora dele, nem um nem outro
 * alcançam: o container derruba o processo em SIGKILL mudo, sem stack e sem
 * evento no Sentry.
 */
const growthSentence = (trend: Trend, subindo: boolean) => {
    const foraDoHeap = trend.offHeapSlopeMbPerHour;
    if (!subindo || foraDoHeap === null) return '';
    const inclinacao = trend.rssSlopeMbPerHour ?? 0;
    const total = inclinacao.toFixed(1);
    if (foraDoHeap >= inclinacao * 0.6) {
        return ` O crescimento está FORA do heap (${foraDoHeap.toFixed(1)} MB/h dos ${total}):`
            + ' não é objeto JavaScript vivo, então o GC não resolve e o teto do V8 não contém.';
    }
    return ` O crescimento está no heap (${(inclinacao - foraDoHeap).toFixed(1)} MB/h dos ${total}):`
        + ' é objeto JavaScript retido, e o teto do V8 ainda o transforma em OOM diagnosticável antes do SIGKILL.';
};

/**
 * Conselho já aplicado é ruído que nunca apaga, e ensina a ignorar o bloco
 * inteiro. Quem sabe se a variável valeu é o processo, porque é do ambiente dele
 * que o glibc a lê.
 */
const arenaAdvice = (arenaMax: number | null | undefined) => (arenaMax === null || arenaMax === undefined
    ? ' MALLOC_ARENA_MAX=2 no ambiente do processo costuma devolver parte dela;'
        + ' no .env não adianta, o dotenv lê depois do allocator já ter decidido.'
    : ` As arenas já estão limitadas a ${arenaMax}, então isto é o que o processo de fato segura`
        + ' — o próximo passo é reduzir o que ele aloca, não como o allocator agrupa.');

const compositionSentence = (memory: Memory, arenaMax: number | null | undefined) => {
    if (memory.offHeap === undefined) return '';
    const foraDoHeap = memory.offHeap.toFixed(0);
    const buffers = memory.external.toFixed(0);
    const semDono = Math.max(0, memory.offHeap - memory.external);
    if (semDono < UNATTRIBUTED_OFFHEAP_WATCH_MB) {
        return ` Fora do heap há ${foraDoHeap} MB, ${buffers} deles em Buffers vivos`
            + ' — dentro do que o binário, as bibliotecas e os downloads explicam.';
    }
    return ` Dos ${foraDoHeap} MB fora do heap, ${buffers} MB são Buffers vivos;`
        + ` os outros ${semDono.toFixed(0)} MB estão muito acima dos ~${OFFHEAP_BASELINE_MB} MB`
        + ' que o binário, as bibliotecas e as pilhas ocupam — é memória que o allocator nativo reteve sem devolver ao sistema.'
        + arenaAdvice(arenaMax);
};

/**
 * A LEITURA, não os números.
 *
 * O card dizia "396 MB de 512" e parava ali — e as duas perguntas que decidem se
 * alguém age ficavam sem resposta: está subindo, e de quem são os MB que não
 * estão no heap. A primeira só a janela responde; a segunda sai de `external`.
 *
 * Subida que JÁ PAROU não é subida: a janela inteira ainda a acusa porque a
 * rampa de aquecimento continua dentro dela, e a reta não sabe que a curva
 * achatou — quem sabe é a inclinação recente.
 */
const buildMemoryNote = ({ memory, trend, memoryLimitMb, arenaMax }: MemoryInputs): MemoryNote | null => {
    if (!memory || !trend?.direction) return null;
    const subindo = trend.direction === 'RISING' && !trend.decelerating;
    const horizonte = trend.hoursToLimit;
    const urgente = horizonte !== null && horizonte <= 24;
    return {
        tone: subindo ? (urgente ? 'BAD' : 'WATCH') : 'NEUTRAL',
        title: noteTitle(memory, trend, memoryLimitMb, subindo),
        body: `${warmupSentence(trend)}${growthSentence(trend, subindo)}${compositionSentence(memory, arenaMax)}`.trim(),
    };
};

/**
 * Veredito da memória: nível E inclinação.
 *
 * Só o nível deixava um vão inteiro sem alarme — 300 MB de 512 pinta "normal"
 * mesmo subindo 40 MB/h rumo ao SIGKILL em 5h, porque o limiar fala de agora e o
 * problema é de trajetória. A subida nunca CALA o nível, só pode piorá-lo.
 */
const buildMemoryVerdict = ({ memory, memoryLimitMb, trend }: MemoryInputs): Verdict => {
    const trendVerdict: Verdict = trend?.direction !== 'RISING' || trend.decelerating
        ? null
        : trend.hoursToLimit !== null && trend.hoursToLimit <= 24 ? 'BAD' : 'WATCH';
    return worstVerdict(
        gradeAscending(memory ? memory.rss : null, memoryLimitMb * 0.75, memoryLimitMb * 0.9),
        trendVerdict,
    );
};

/**
 * O TETO DO HEAP NÃO CABE NA INSTÂNCIA.
 *
 * O processo sobe com `--max-old-space-size` e o V8 entende esse valor como
 * "pode crescer até lá" — só que RSS é o heap MAIS tudo que roda fora dele.
 * Quando o V8 finalmente aperta o GC, perto do teto dele, o container já matou o
 * processo. É configuração, não medição: a tela não arbitra o valor certo, só
 * mostra que os dois lados se contradizem, com os dois números na mão.
 */
const buildHeapCeilingOverflow = ({ heapLimitMb, memoryLimitMb }: MemoryInputs) => (
    heapLimitMb !== null && heapLimitMb > memoryLimitMb ? { heapLimitMb, memoryLimitMb } : null
);

/** O teto vem do processo; o constante local só entra se o servidor for antigo demais para informá-lo. */
const readMemoryInputs = (runtime: PerformanceRuntime | null): MemoryInputs => ({
    memory: runtime?.memoryMb ?? null,
    memoryLimitMb: runtime?.limitsMb?.container ?? DEFAULT_MEMORY_LIMIT_MB,
    heapLimitMb: runtime?.limitsMb?.heap ?? null,
    trend: runtime?.memoryTrend ?? null,
    arenaMax: runtime?.mallocArenaMax ?? null,
});

/** Uma frase no lugar de cinco números soltos: quem abre a aba quer saber se precisa agir. */
const buildVerdictLabel = (verdicts: Verdict[]) => {
    const ruins = verdicts.filter((v) => v === 'BAD').length;
    const atencao = verdicts.filter((v) => v === 'WATCH').length;
    if (ruins > 0) return `${ruins} medidor(es) fora do aceitável — o site pode estar lento ou falhando para o usuário.`;
    if (atencao > 0) return `${atencao} medidor(es) merecendo o olho, mas nada quebrado.`;
    return 'Tudo dentro do normal — o site está respondendo bem e o servidor tem folga.';
};

const summarizeTraffic = (snapshot: PerformanceSnapshot | null) => {
    const http = snapshot?.durations.http ?? [];
    const requests = sum(http.map((metric) => metric.count));
    const errors = sum(http.map((metric) => metric.errors));
    return {
        slowestHttp: slowestSampled(http),
        // Entrega de arquivo do build. Fica FORA do medidor principal de propósito:
        // o tempo aqui é dominado pela banda de quem baixa, não por código nosso, e
        // um bundle grande sempre venceria o p95 e esconderia a rota realmente lenta.
        slowestWeb: slowestSampled(snapshot?.durations.web ?? []),
        requests,
        errors,
        errorRate: requests > 0 ? errors / requests : null,
        ...cacheStats(snapshot?.counters.cache ?? {}),
        detailRows: buildDetailRows(snapshot?.durations ?? {}),
    };
};

export const buildPerformanceSummary = (snapshot: PerformanceSnapshot | null) => {
    const traffic = summarizeTraffic(snapshot);
    const runtime = snapshot?.runtime ?? null;
    const memoryInputs = readMemoryInputs(runtime);
    const eventLoopP95 = runtime?.eventLoopDelayMs?.p95;
    const cardVerdicts = {
        latency: gradeAscending(traffic.slowestHttp?.p95Ms, 1000, 3000),
        errors: gradeAscending(traffic.errorRate, 0.01, 0.05),
        memory: buildMemoryVerdict(memoryInputs),
        eventLoop: gradeAscending(eventLoopP95, 100, 500),
        cache: gradeDescending(traffic.cacheRate, 0.5, 0.2),
    };
    return {
        ...traffic,
        eventLoopP95,
        cardVerdicts,
        verdictLabel: buildVerdictLabel(Object.values(cardVerdicts)),
        memoryMb: memoryInputs.memory ? memoryInputs.memory.rss : null,
        memoryLimitMb: memoryInputs.memoryLimitMb,
        memoryDetail: buildMemoryDetail(memoryInputs.memory),
        memoryDetailTitle: buildMemoryDetailTitle(memoryInputs),
        memoryNote: buildMemoryNote(memoryInputs),
        heapCeilingOverflow: buildHeapCeilingOverflow(memoryInputs),
    };
};

export type PerformanceSummary = ReturnType<typeof buildPerformanceSummary>;
