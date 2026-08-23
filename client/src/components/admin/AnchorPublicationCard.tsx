import React from 'react';
import { RefreshCw, ShieldCheck, Play, AlertCircle, Send, CheckCircle2, Ban, ArrowRightCircle, MinusCircle, LifeBuoy, LogOut } from 'lucide-react';
import { researchService } from '../../services/research';
import type { AnchorAssetClass, AnchorBuilt, AnchorPublishOutcome, AnchorRankingItem } from '../../services/research';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../hooks/useConfirm';

/**
 * Card admin-only (aba Operações): PUBLICAÇÃO da lista âncora `BUY_AND_HOLD`.
 *
 * Substitui o antigo card de shadow, que ficou obsoleto quando a âncora saiu do
 * shadow: ele ainda anunciava "não publica", mostrava a saída crua do motor
 * (sem histerese e sem teto de composição) e chamava o endpoint sem
 * `assetClass` — o servidor fazia default para STOCK e os FIIs não apareciam em
 * lugar nenhum do Admin.
 *
 * Aqui o fluxo é o mesmo que o dono já conhece do Research semanal:
 * **Ver rascunho → conferir → Publicar**. O rascunho é um `dryRun` no MESMO
 * caminho que o cron mensal usa (motor → portão → histerese → teto), então o
 * que aparece na tela é literalmente o que vai ao ar — não uma aproximação.
 *
 * ISOLAMENTO: nada aqui toca no Research semanal (`BUY_HOLD`). Outra strategy,
 * outro ponteiro publicado. Publicar a âncora não publica o semanal, e o
 * "Publicar Tudo Pendente" do semanal não publica a âncora.
 */

const CLASSES: { id: AnchorAssetClass; label: string }[] = [
    { id: 'STOCK', label: 'Ações' },
    { id: 'FII', label: 'FIIs' },
];

/** Estado por classe: o rascunho de Ações não some ao olhar os FIIs. */
interface ClassState {
    outcome: AnchorPublishOutcome | null;
    loading: 'draft' | 'publish' | null;
    error: string | null;
}

const EMPTY: ClassState = { outcome: null, loading: null, error: null };

export const AnchorPublicationCard: React.FC = () => {
    const [tab, setTab] = React.useState<AnchorAssetClass>('STOCK');
    const [state, setState] = React.useState<Record<AnchorAssetClass, ClassState>>({
        STOCK: { ...EMPTY },
        FII: { ...EMPTY },
    });
    const { addToast } = useToast();
    const confirm = useConfirm();

    const current = state[tab];
    const patch = (assetClass: AnchorAssetClass, next: Partial<ClassState>) =>
        setState(prev => ({ ...prev, [assetClass]: { ...prev[assetClass], ...next } }));

    const run = async (assetClass: AnchorAssetClass, dryRun: boolean) => {
        patch(assetClass, { loading: dryRun ? 'draft' : 'publish', error: null });
        try {
            const response = await researchService.publishAnchorRanking({ assetClass, dryRun });
            const outcome = response.results[0] ?? null;
            patch(assetClass, { outcome, loading: null });

            if (outcome?.error) addToast(`Falha ao calcular ${assetClass}: ${outcome.error}`, 'error');
            else if (outcome?.blocked) addToast(`Portão de qualidade bloqueou: ${outcome.reason}`, 'error');
            else if (outcome?.published) addToast(`Lista âncora de ${assetClass} publicada.`, 'success');
            else addToast('Rascunho gerado — nada foi publicado.', 'info');
        } catch (e) {
            patch(assetClass, { loading: null, error: e instanceof Error ? e.message : 'Falha ao processar.' });
        }
    };

    // Publicar troca a lista que o assinante vê. Confirmação explícita, com os
    // números do rascunho na frente do dono — e sempre UMA classe por vez.
    const onPublish = async (assetClass: AnchorAssetClass) => {
        const built = state[assetClass].outcome?.built;
        const label = CLASSES.find(c => c.id === assetClass)?.label ?? assetClass;
        const summary = built
            ? `${built.counts.buy} em COMPRAR, ${built.counts.entered} entrando, ${built.counts.exits} saindo.`
            : 'O rascunho ainda não foi gerado — o cálculo será feito agora, sem prévia.';
        const ok = await confirm({
            title: `Publicar a lista âncora de ${label}?`,
            message: `${summary}\n\nEla substitui a lista Buy-and-Hold que os assinantes veem hoje nesta classe. O Research semanal não é afetado.`,
            confirmText: 'Publicar',
        });
        if (ok) await run(assetClass, false);
    };

    return (
        <div className="bg-base border border-slate-800 rounded-2xl overflow-hidden shadow-2xl mb-6">
            <div className="p-5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-card">
                <div className="flex items-center gap-2">
                    <ShieldCheck size={18} className="text-emerald-500" />
                    <div>
                        <h3 className="font-bold text-white text-sm uppercase tracking-wider">
                            Lista Âncora — Buy-and-Hold
                        </h3>
                        <p className="text-[10px] text-slate-500 mt-0.5">
                            Publicação mensal e deliberada · o cron roda dia 1 às 07:30 · aqui é a válvula manual
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <div className="flex rounded-lg border border-slate-700 overflow-hidden">
                        {CLASSES.map(c => (
                            <button
                                key={c.id}
                                onClick={() => setTab(c.id)}
                                className={`px-3 py-2 text-[11px] font-black uppercase tracking-wider transition-colors ${
                                    tab === c.id ? 'bg-slate-700 text-white' : 'bg-transparent text-slate-500 hover:text-slate-300'
                                }`}
                            >
                                {c.label}
                            </button>
                        ))}
                    </div>

                    <button
                        onClick={() => run(tab, true)}
                        disabled={current.loading !== null}
                        className={`px-4 py-2 rounded-xl font-black text-[11px] uppercase tracking-wider transition-all flex items-center gap-2 ${
                            current.loading
                                ? 'bg-slate-800 text-slate-400 cursor-wait border border-slate-700'
                                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                        }`}
                    >
                        {current.loading === 'draft'
                            ? <><RefreshCw size={13} className="animate-spin" /> Calculando...</>
                            : <><Play size={13} fill="currentColor" /> Ver rascunho</>}
                    </button>

                    <button
                        onClick={() => onPublish(tab)}
                        disabled={current.loading !== null}
                        className={`px-4 py-2 rounded-xl font-black text-[11px] uppercase tracking-wider transition-all flex items-center gap-2 ${
                            current.loading
                                ? 'bg-slate-800 text-slate-400 cursor-wait border border-slate-700'
                                : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/30'
                        }`}
                    >
                        {current.loading === 'publish'
                            ? <><RefreshCw size={13} className="animate-spin" /> Publicando...</>
                            : <><Send size={13} /> Publicar</>}
                    </button>
                </div>
            </div>

            {current.error && (
                <div className="p-4 flex items-center gap-2 text-xs text-red-400 bg-red-900/10 border-b border-red-900/30">
                    <AlertCircle size={14} /> {current.error}
                </div>
            )}

            <ClassPanel state={current} assetClass={tab} />
        </div>
    );
};

const ClassPanel: React.FC<{ state: ClassState; assetClass: AnchorAssetClass }> = ({ state, assetClass }) => {
    const { outcome } = state;

    if (!outcome) {
        if (state.error) return null;
        return (
            <div className="p-8 text-center text-xs text-slate-500">
                Clique em <span className="font-bold text-slate-400">Ver rascunho</span> para calcular o que iria ao ar
                em {assetClass === 'FII' ? 'FIIs' : 'Ações'} — sem publicar nada.
            </div>
        );
    }

    // O servidor isola as classes: uma pode falhar sozinha.
    if (outcome.error) {
        return (
            <div className="p-4 flex items-start gap-2 text-xs text-red-400 bg-red-900/10">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span>Cálculo falhou: {outcome.error}</span>
            </div>
        );
    }

    return (
        <>
            {/* Portão de qualidade reprovou: a lista NÃO foi ao ar, e o motivo é
                o que o dono precisa ler antes de tentar de novo. */}
            {outcome.blocked && (
                <div className="p-4 flex items-start gap-2 text-xs bg-red-900/10 border-b border-red-900/30">
                    <Ban size={14} className="mt-0.5 shrink-0 text-red-400" />
                    <div>
                        <p className="font-bold text-red-400">Portão de qualidade bloqueou a publicação</p>
                        <p className="text-slate-400 mt-0.5">{outcome.reason}</p>
                        <p className="text-slate-600 mt-1 text-[10px]">
                            Nada foi escrito. O rascunho abaixo é o que teria ido ao ar.
                        </p>
                    </div>
                </div>
            )}

            {outcome.published && (
                <div className="p-4 flex items-start gap-2 text-xs bg-emerald-900/10 border-b border-emerald-900/30">
                    <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-400" />
                    <div>
                        <p className="font-bold text-emerald-400">
                            Publicada{outcome.bootstrap ? ' — primeira publicação desta classe' : ''}
                        </p>
                        <p className="text-slate-400 mt-0.5">
                            {outcome.counts?.buy ?? 0} em COMPRAR · {outcome.counts?.entered ?? 0} entraram ·{' '}
                            {outcome.exits?.length ?? 0} saíram.
                        </p>
                        <p className="text-slate-600 mt-1 text-[10px]">
                            Gere o rascunho de novo para ver a lista já publicada.
                        </p>
                    </div>
                </div>
            )}

            {outcome.built ? <BuiltView built={outcome.built} /> : null}
        </>
    );
};

const BuiltView: React.FC<{ built: AnchorBuilt }> = ({ built }) => {
    const fmtBRL = (n: number) => `R$ ${(n / 1e9).toFixed(0)} bi`;

    return (
        <>
            <div className="p-4 flex flex-wrap items-center gap-3 border-b border-slate-800/60 bg-card/40 text-[10px]">
                <Chip label="Analisados" value={built.counts.analyzed} />
                <Chip label="Elegíveis" value={built.counts.eligible} tone="emerald" />
                <Chip label="COMPRAR" value={built.counts.buy} tone="emerald" />
                <Chip label="AGUARDAR" value={built.counts.wait} tone="yellow" />
                <Chip label="Entraram" value={built.counts.entered} tone="blue" />
                <Chip label="Banda" value={built.counts.held} tone="purple" />
                <Chip label="Saíram" value={built.counts.exits} tone="slate" />
                {built.bootstrap && (
                    <span className="px-2 py-1 rounded border border-blue-900/50 bg-blue-900/10 text-blue-400 font-bold">
                        1ª publicação — sem lista anterior, vale o limiar de entrada para todos
                    </span>
                )}
                <span className="ml-auto text-slate-600">
                    entra ≥ {built.thresholds.entryScore} · fica ≥ {built.thresholds.holdScore} · cap ≥{' '}
                    {fmtBRL(built.config.minMarketCap)} · beta ≤ {built.config.maxBeta}
                </span>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[820px]">
                    <thead>
                        <tr className="bg-card border-b border-slate-800 text-[9px] font-black text-slate-500 uppercase tracking-widest">
                            <th scope="col" className="px-4 py-2.5">#</th>
                            <th scope="col" className="px-4 py-2.5">Ativo</th>
                            <th scope="col" className="px-3 py-2.5 text-center">Score</th>
                            <th scope="col" className="px-3 py-2.5 text-center">Ação</th>
                            <th scope="col" className="px-3 py-2.5 text-center">Histerese</th>
                            <th scope="col" className="px-3 py-2.5 text-center" title="Durabilidade / Resiliência / Consistência">Eixos D/R/C</th>
                            <th scope="col" className="px-4 py-2.5">Motivo</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50">
                        {built.ranking.map(row => (
                            <RankingRow key={row.ticker} row={row} />
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Saídas: quem estava na lista publicada e não está mais. A lista
                âncora não descarta em silêncio — cada saída sai com motivo. */}
            {built.exits.length > 0 && (
                <div className="border-t border-slate-800/60 bg-red-900/5">
                    <p className="px-4 pt-3 text-[9px] font-black text-red-400/80 uppercase tracking-widest flex items-center gap-1.5">
                        <LogOut size={10} /> Saíram da lista ({built.exits.length})
                    </p>
                    <ul className="p-4 pt-2 space-y-1.5">
                        {built.exits.map(exit => (
                            <li key={exit.ticker} className="text-[10px] text-slate-400 flex flex-wrap items-baseline gap-x-2">
                                <span className="font-bold text-slate-200">{exit.ticker}</span>
                                {exit.previousScore !== null && (
                                    <span className="font-mono text-slate-600">
                                        {exit.previousScore} → {exit.score ?? '—'}
                                    </span>
                                )}
                                <span className={exit.stillListed ? 'text-slate-500' : 'text-red-400/80'}>
                                    {exit.reason}
                                </span>
                                {!exit.stillListed && (
                                    <span className="text-[9px] font-bold text-red-400/70">(sumiu do ranking — perdeu o portão)</span>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <div className="p-3 border-t border-slate-800/60 flex flex-wrap gap-x-4 gap-y-1 text-[9px] text-slate-600">
                <span className="font-bold text-slate-500">Excluídos por motivo:</span>
                {built.excludedByReason.slice(0, 6).map(e => (
                    <span key={e.reason}>
                        {e.reason} <span className="text-slate-400 font-bold">{e.count}</span>
                    </span>
                ))}
            </div>
        </>
    );
};

const RankingRow: React.FC<{ row: AnchorRankingItem }> = ({ row }) => {
    const anchor = row.anchor;
    const axes = anchor?.axes;
    return (
        <tr className="hover:bg-slate-900/20 transition-colors">
            <td className="px-4 py-2.5 text-slate-600 font-mono text-[10px]">{row.position}</td>
            <td className="px-4 py-2.5">
                <span className="text-xs font-bold text-slate-200">{row.ticker}</span>
                <span className="block text-[9px] text-slate-500">
                    {row.sector}
                    {anchor?.archetype ? ` · ${anchor.archetype}` : ''}
                    {anchor?.manager ? ` · ${anchor.manager}` : ''}
                </span>
            </td>
            <td className="px-3 py-2.5 text-center">
                <span className="text-sm font-black text-white">{row.score}</span>
                {anchor?.hysteresis?.previousScore != null && anchor.hysteresis.previousScore !== row.score && (
                    <span className="block text-[9px] font-mono text-slate-600">de {anchor.hysteresis.previousScore}</span>
                )}
            </td>
            <td className="px-3 py-2.5 text-center">
                <span
                    className={`text-[9px] font-black uppercase px-2 py-0.5 rounded ${
                        row.action === 'BUY'
                            ? 'text-emerald-400 bg-emerald-900/20 border border-emerald-900/50'
                            : 'text-yellow-400 bg-yellow-900/20 border border-yellow-900/50'
                    }`}
                >
                    {row.action === 'BUY' ? 'COMPRAR' : 'AGUARDAR'}
                </span>
            </td>
            <td className="px-3 py-2.5 text-center">
                <HysteresisBadge state={anchor?.hysteresis?.state} exitReason={anchor?.exitReason} />
            </td>
            <td className="px-3 py-2.5 text-center text-[10px] font-mono text-slate-400">
                {axes ? `${axes.durability}/${axes.resilience}/${axes.consistency}` : '—'}
            </td>
            <td className="px-4 py-2.5 text-[10px] text-slate-500 max-w-xs truncate" title={anchor?.exitReason || row.reason}>
                {anchor?.exitReason || row.reason}
            </td>
        </tr>
    );
};

/**
 * O estado de histerese responde a pergunta que o dono faz olhando a lista:
 * este ativo é novo, já estava, está sendo segurado pela banda, ou saiu?
 */
const HYSTERESIS_LABELS: Record<string, { label: string; className: string; title: string }> = {
    ENTERED: {
        label: 'Entrou',
        className: 'text-emerald-400 bg-emerald-900/20 border-emerald-900/50',
        title: 'Cruzou o limiar de entrada nesta apuração',
    },
    MAINTAINED: {
        label: 'Permanece',
        className: 'text-blue-400 bg-blue-900/20 border-blue-900/50',
        title: 'Já estava em COMPRAR e segue acima do limiar de entrada',
    },
    HELD: {
        label: 'Banda',
        className: 'text-purple-400 bg-purple-900/20 border-purple-900/50',
        title: 'Abaixo do limiar de entrada, mantido pela banda de permanência',
    },
    OUT: {
        label: 'Saiu',
        className: 'text-red-400 bg-red-900/20 border-red-900/50',
        title: 'Fora do COMPRAR',
    },
};

const HYSTERESIS_ICONS: Record<string, React.ReactNode> = {
    ENTERED: <ArrowRightCircle size={9} />,
    MAINTAINED: <CheckCircle2 size={9} />,
    HELD: <LifeBuoy size={9} />,
    OUT: <MinusCircle size={9} />,
};

const HysteresisBadge: React.FC<{ state?: string; exitReason?: string | null }> = ({ state, exitReason }) => {
    const entry = state ? HYSTERESIS_LABELS[state] : undefined;
    if (!entry) return <span className="text-[10px] text-slate-700 font-mono">—</span>;
    return (
        <span
            title={state === 'OUT' && exitReason ? exitReason : entry.title}
            className={`inline-flex items-center gap-1 text-[9px] font-black uppercase px-2 py-0.5 rounded border ${entry.className}`}
        >
            {state ? HYSTERESIS_ICONS[state] : null} {entry.label}
        </span>
    );
};

const Chip = ({ label, value, tone = 'blue' }: { label: string; value: number; tone?: 'blue' | 'emerald' | 'yellow' | 'slate' | 'purple' }) => {
    const tones: Record<string, string> = {
        blue: 'text-blue-400 border-blue-900/50 bg-blue-900/10',
        emerald: 'text-emerald-400 border-emerald-900/50 bg-emerald-900/10',
        yellow: 'text-yellow-400 border-yellow-900/50 bg-yellow-900/10',
        purple: 'text-purple-400 border-purple-900/50 bg-purple-900/10',
        slate: 'text-slate-400 border-slate-700 bg-slate-800/40',
    };
    return (
        <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border font-bold ${tones[tone]}`}>
            {label} <span className="text-white font-black">{value}</span>
        </span>
    );
};
