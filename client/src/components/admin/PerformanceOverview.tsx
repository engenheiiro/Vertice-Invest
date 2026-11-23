import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Activity, AlertTriangle, ChevronDown, ChevronRight, Clock3,
    Database, Gauge, MemoryStick, RefreshCw, ServerCog, TrendingUp,
} from 'lucide-react';
import {
    performanceService,
    type PerformanceDurationMetric,
    type PerformanceSnapshot,
} from '../../services/performance';
import {
    buildPerformanceSummary, formatMs, formatUptime,
    type MemoryNote, type PerformanceSummary, type Verdict,
} from './performanceOverviewView';

const VERDICT_UI: Record<Exclude<Verdict, null>, { value: string; chip: string; label: string }> = {
    GOOD: { value: 'text-emerald-400', chip: 'bg-emerald-900/20 text-emerald-400', label: 'normal' },
    WATCH: { value: 'text-yellow-400', chip: 'bg-yellow-900/20 text-yellow-400', label: 'atenção' },
    BAD: { value: 'text-red-400', chip: 'bg-red-900/20 text-red-400', label: 'ruim' },
};

const MetricCard = ({
    label, value, detail, detailTitle, Icon, verdict, meaning,
}: {
    label: string;
    value: string;
    detail: string;
    /**
     * Texto do `title` do detalhe, quando a leitura completa não cabe no card.
     * Só a memória usa: o card mostra o essencial e o balão traz os quatro
     * números medidos, sem obrigar a abrir os detalhes técnicos.
     */
    detailTitle?: string;
    Icon: React.ElementType;
    verdict?: Verdict;
    /** Uma frase dizendo o que o número significa. É o que torna o card legível. */
    meaning?: string;
}) => {
    const ui = verdict ? VERDICT_UI[verdict] : null;
    return (
        <div className="rounded-xl border border-slate-800 bg-panel p-3 min-w-0">
            <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5 text-slate-500 min-w-0">
                    <Icon size={12} className="shrink-0" />
                    <span className="text-[9px] font-bold uppercase tracking-wide truncate">{label}</span>
                </div>
                {ui && (
                    <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded-full shrink-0 ${ui.chip}`}>
                        {ui.label}
                    </span>
                )}
            </div>
            <p className={`mt-1.5 text-lg font-black font-mono truncate ${ui ? ui.value : 'text-white'}`} title={value}>
                {value}
            </p>
            {meaning && <p className="mt-0.5 text-[10px] text-slate-400 leading-snug">{meaning}</p>}
            {/* Sem truncar: no card da chamada mais lenta o `detail` É o nome da
                rota, e cortá-lo no meio ("GET /api/wallet/histo…") apaga a única
                informação acionável do medidor. */}
            <p className="mt-0.5 text-[10px] text-slate-500 leading-snug break-words" title={detailTitle ?? detail}>{detail}</p>
        </div>
    );
};

/**
 * Nome de cada domínio de medição em português. A tabela de detalhe imprimia a
 * chave crua ("http", "web", "mongo"), que só faz sentido para quem escreveu o
 * coletor — e é justamente a tabela que o leitor abre quando quer entender de
 * onde vem um número ruim.
 */
const DOMAIN_LABEL: Record<string, string> = {
    http: 'API',
    web: 'Arquivo do site',
    external: 'Fonte externa',
    mongo: 'Banco',
};

const SlowMetricRow = ({ domain, metric }: { domain: string; metric: PerformanceDurationMetric }) => (
    <tr className="border-t border-slate-800">
        <td className="py-2 pr-3 text-[9px] font-bold uppercase text-slate-500">
            {DOMAIN_LABEL[domain] ?? domain}
        </td>
        <td className="py-2 pr-3 text-[11px] font-mono text-slate-300 break-all">{metric.key}</td>
        <td className="py-2 pr-3 text-[11px] font-mono text-white text-right whitespace-nowrap">{formatMs(metric.p95Ms)}</td>
        <td className="py-2 text-[11px] text-slate-500 text-right whitespace-nowrap">
            {metric.sampled}/{metric.count}
        </td>
    </tr>
);

const formatPercent = (rate: number | null, digits: number) => (rate === null ? '—' : `${(rate * 100).toFixed(digits)}%`);

const MetricGrid = ({ summary }: { summary: PerformanceSummary }) => (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 mt-4">
        <MetricCard
            label="Chamada mais lenta"
            value={formatMs(summary.slowestHttp?.p95Ms)}
            /* p50 ao lado do p95 separa duas histórias muito
               diferentes: uma rota lenta para todo mundo e uma rota
               rápida com um pico ocasional. Só o p95 não distingue. */
            meaning={summary.slowestHttp
                ? `Metade responde em ${formatMs(summary.slowestHttp.p50Ms)}`
                : 'A chamada de API que mais faz esperar'}
            detail={summary.slowestHttp?.key ?? 'Aguardando tráfego'}
            Icon={Activity}
            verdict={summary.cardVerdicts.latency}
        />
        <MetricCard
            label="Requisições com erro"
            value={formatPercent(summary.errorRate, 2)}
            meaning="Telas que falharam ao carregar"
            detail={`${summary.errors} erro(s) em ${summary.requests} requisições`}
            Icon={AlertTriangle}
            verdict={summary.cardVerdicts.errors}
        />
        <MetricCard
            label="Memória do servidor"
            value={summary.memoryMb === null ? '—' : `${summary.memoryMb.toFixed(0)} MB`}
            meaning={`De ${summary.memoryLimitMb} MB disponíveis no plano`}
            detail={summary.memoryDetail}
            detailTitle={summary.memoryDetailTitle}
            Icon={MemoryStick}
            verdict={summary.cardVerdicts.memory}
        />
        <MetricCard
            label="Congestionamento"
            value={formatMs(summary.eventLoopP95)}
            meaning="Fila de espera dentro do servidor"
            detail="Alto = o servidor está engasgando"
            Icon={Clock3}
            verdict={summary.cardVerdicts.eventLoop}
        />
        <MetricCard
            label="Aproveitamento de cache"
            value={formatPercent(summary.cacheRate, 1)}
            meaning="Respostas servidas sem ir ao banco"
            detail={summary.cacheAttempts ? `${summary.cacheAttempts} consultas observadas` : 'Aguardando consultas'}
            Icon={Database}
            verdict={summary.cardVerdicts.cache}
        />
    </div>
);

const NOTE_TONE_UI: Record<MemoryNote['tone'], { box: string; text: string }> = {
    BAD: { box: 'border-red-900/40 bg-red-900/10', text: 'text-red-400' },
    WATCH: { box: 'border-yellow-900/40 bg-yellow-900/10', text: 'text-yellow-400' },
    NEUTRAL: { box: 'border-slate-800 bg-panel', text: 'text-slate-300' },
};

/**
 * A leitura da memória em palavras: está subindo, e de quem são os MB que não
 * estão no heap. Fica fora da grade porque são frases de diagnóstico — dentro de
 * um card de 10px ninguém as lê.
 */
const MemoryNoteBox = ({ note }: { note: MemoryNote }) => {
    const ui = NOTE_TONE_UI[note.tone];
    return (
        <div className={`mt-3 flex items-start gap-3 rounded-xl border p-3 ${ui.box}`}>
            {note.tone === 'NEUTRAL'
                ? <MemoryStick size={15} className="text-slate-500 mt-0.5 shrink-0" />
                : <TrendingUp size={15} className={`mt-0.5 shrink-0 ${ui.text}`} />}
            <div>
                <p className={`text-xs font-bold ${ui.text}`}>
                    {note.title}
                </p>
                {note.body && (
                    <p className="text-[10px] text-slate-400 mt-0.5 leading-snug">{note.body}</p>
                )}
            </div>
        </div>
    );
};

/**
 * CONFIGURAÇÃO, não medição: não muda com o tráfego nem passa sozinha. Ganha
 * destaque próprio porque é o tipo de defeito que nenhum dos cinco medidores
 * acende — eles dizem como o servidor está agora, e este diz que o limite que
 * deveria protegê-lo não protege.
 */
const HeapCeilingNotice = ({ heapLimitMb, memoryLimitMb }: { heapLimitMb: number; memoryLimitMb: number }) => (
    <div className="mt-3 flex items-start gap-3 rounded-xl border border-yellow-900/40 bg-yellow-900/10 p-3">
        <AlertTriangle size={15} className="text-yellow-400 mt-0.5 shrink-0" />
        <div>
            <p className="text-xs font-bold text-yellow-400">
                O limite de memória do Node não cabe na instância
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5 leading-snug">
                O processo pode crescer até {heapLimitMb} MB só de heap,
                numa instância de {memoryLimitMb} MB — e ainda usa memória
                fora do heap. Na prática, a instância derruba o processo antes de o Node achar que
                precisa liberar memória. Reduza o <span className="font-mono text-slate-300">--max-old-space-size</span>{' '}
                do <span className="font-mono text-slate-300">npm start</span> até o teto acima caber
                em {memoryLimitMb} MB com folga para o que roda fora do heap.
            </p>
        </div>
    </div>
);

/**
 * Fora da grade e sem veredito, de propósito: é medição de banda do visitante,
 * não de saúde do servidor. Colorir isso de amarelo seria alarmar por algo que
 * nenhum ajuste nosso resolve no ato.
 */
const WebDeliveryLine = ({ metric }: { metric: PerformanceDurationMetric }) => (
    <p className="mt-3 text-[10px] text-slate-500">
        <span className="font-bold text-slate-400">Entrega de arquivos do site:</span>{' '}
        {formatMs(metric.p95Ms)} no maior deles
        (<span className="font-mono">{metric.key}</span>) — depende sobretudo
        da conexão de quem acessa, não do servidor.
    </p>
);

const DetailsTable = ({ rows }: { rows: PerformanceSummary['detailRows'] }) => (
    <div className="overflow-x-auto mt-3">
        {rows.length === 0 ? (
            <p className="text-[10px] text-slate-500 py-2">Ainda não há amostras suficientes.</p>
        ) : (
            <table className="w-full min-w-[600px]">
                <thead>
                    <tr className="text-[9px] text-slate-500 font-bold uppercase text-left">
                        <th className="pb-2 pr-3">Origem</th>
                        <th className="pb-2 pr-3">Operação</th>
                        <th className="pb-2 pr-3 text-right">p95</th>
                        <th className="pb-2 text-right">Amostras/total</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map(({ domain, metric }) => (
                        <SlowMetricRow key={`${domain}:${metric.key}`} domain={domain} metric={metric} />
                    ))}
                </tbody>
            </table>
        )}
    </div>
);

const ActivePanel = ({
    snapshot, summary, showDetails, onToggleDetails,
}: {
    snapshot: PerformanceSnapshot;
    summary: PerformanceSummary;
    showDetails: boolean;
    onToggleDetails: () => void;
}) => (
    <>
        <MetricGrid summary={summary} />
        {summary.memoryNote && <MemoryNoteBox note={summary.memoryNote} />}
        {summary.heapCeilingOverflow && <HeapCeilingNotice {...summary.heapCeilingOverflow} />}
        {summary.slowestWeb && <WebDeliveryLine metric={summary.slowestWeb} />}

        <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-[10px] text-slate-600">
                Amostragem {(snapshot.sampleRate * 100).toFixed(0)}% · servidor ativo há {formatUptime(snapshot.runtime?.uptimeSeconds)}
            </p>
            <button
                onClick={onToggleDetails}
                className="text-[10px] font-bold text-slate-400 hover:text-white flex items-center gap-1 transition-colors"
            >
                {showDetails ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {showDetails ? 'Ocultar detalhes técnicos' : 'Ver detalhes técnicos'}
            </button>
        </div>

        {showDetails && <DetailsTable rows={summary.detailRows} />}
    </>
);

const PanelHeader = ({ verdictLabel, enabled }: { verdictLabel: string; enabled: boolean | undefined }) => (
    <div className="flex items-start justify-between gap-3">
        <div>
            <h4 id="performance-title" className="text-xs font-black text-white uppercase flex items-center gap-2">
                <Gauge size={14} className="text-blue-500" />
                Desempenho do sistema
            </h4>
            <p className="text-[11px] text-slate-400 mt-1 max-w-xl">
                {verdictLabel}
            </p>
            <p className="text-[10px] text-slate-500 mt-0.5">
                Quanto o site demora a responder e quanto fôlego o servidor tem. Leitura desde
                o último reinício; atualiza a cada 2 minutos.
            </p>
        </div>
        {enabled && (
            <span
                className={'text-[9px] font-bold uppercase text-emerald-400 bg-emerald-900/10 border border-emerald-900/40'
                    + ' px-2 py-1 rounded-full whitespace-nowrap'}
            >
                Medição ativa
            </span>
        )}
    </div>
);

const LoadingNotice = () => (
    <div className="flex items-center gap-2 py-6 text-slate-500">
        <RefreshCw size={14} className="animate-spin" />
        <span className="text-xs">Carregando medidores…</span>
    </div>
);

const UnavailableNotice = () => (
    <div className="mt-4 flex items-start gap-3 rounded-xl border border-yellow-900/40 bg-yellow-900/10 p-3">
        <AlertTriangle size={15} className="text-yellow-400 mt-0.5 shrink-0" />
        <div>
            <p className="text-xs font-bold text-yellow-400">Medidores indisponíveis</p>
            <p className="text-[10px] text-slate-500 mt-0.5">A saúde dos dados continua funcionando normalmente. Tente novamente mais tarde.</p>
        </div>
    </div>
);

const DisabledNotice = () => (
    <div className="mt-4 flex items-start gap-3 rounded-xl border border-slate-800 bg-panel p-3">
        <ServerCog size={16} className="text-slate-500 mt-0.5 shrink-0" />
        <div>
            <p className="text-xs font-bold text-slate-300">Medição contínua desativada</p>
            <p className="text-[10px] text-slate-500 mt-0.5">
                A configuração do servidor está com <span className="font-mono text-slate-400">PERF_METRICS_ENABLED=false</span>.
                Altere para <span className="font-mono text-slate-400">true</span> e reinicie o servidor.
            </p>
        </div>
    </div>
);

const usePerformanceSnapshot = (loadSnapshot: () => Promise<PerformanceSnapshot>) => {
    const [snapshot, setSnapshot] = useState<PerformanceSnapshot | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [unavailable, setUnavailable] = useState(false);

    const load = useCallback(async () => {
        try {
            setSnapshot(await loadSnapshot());
            setUnavailable(false);
        } catch {
            setUnavailable(true);
        } finally {
            setIsLoading(false);
        }
    }, [loadSnapshot]);

    useEffect(() => {
        load();
        const timer = setInterval(load, 120000);
        return () => clearInterval(timer);
    }, [load]);

    return { snapshot, isLoading, unavailable };
};

export const PerformanceOverview = ({
    loadSnapshot = performanceService.getSnapshot,
}: {
    loadSnapshot?: () => Promise<PerformanceSnapshot>;
}) => {
    const { snapshot, isLoading, unavailable } = usePerformanceSnapshot(loadSnapshot);
    const [showDetails, setShowDetails] = useState(false);
    const summary = useMemo(() => buildPerformanceSummary(snapshot), [snapshot]);
    const toggleDetails = useCallback(() => setShowDetails((value) => !value), []);

    return (
        <section className="bg-base border border-slate-800 rounded-2xl p-4" aria-labelledby="performance-title">
            <PanelHeader verdictLabel={summary.verdictLabel} enabled={snapshot?.enabled} />
            {isLoading && <LoadingNotice />}
            {!isLoading && unavailable && <UnavailableNotice />}
            {!isLoading && !unavailable && snapshot && !snapshot.enabled && <DisabledNotice />}
            {!isLoading && snapshot?.enabled && (
                <ActivePanel snapshot={snapshot} summary={summary} showDetails={showDetails} onToggleDetails={toggleDetails} />
            )}
        </section>
    );
};
