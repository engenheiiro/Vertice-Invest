import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    Anchor, Crown, Lock, ShieldCheck, TrendingDown, TrendingUp,
    Clock, Info, Landmark, Building2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Header } from '../components/dashboard/Header';
// Extraido desta pagina quando o semanal ganhou retencao de assento: as duas
// estrategias explicam saidas da mesma forma.
import { ExitList } from '../components/research/ExitList';
import { SkeletonCard } from '../components/ui';
import { STALE_TIME } from '../config/queryConfig';
import { useAuth } from '../contexts/AuthContext';
import {
    researchService,
    AnchorReportError,
    type AnchorRankingItem,
    type AnchorReport,
} from '../services/research';

/**
 * Página da estratégia âncora (BUY_AND_HOLD) — a lista "para carregar por
 * décadas", irmã e não substituta do Research semanal (BUY_HOLD), que segue
 * intacto no /research.
 *
 * A tela existe para comunicar a diferença. O Research semanal responde "quais
 * são as melhores oportunidades agora"; esta responde "o que eu poderia comprar
 * e esquecer". Duas listas com o mesmo verbo COMPRAR e propósitos opostos
 * confundem — por isso a página fala de portão, de eixos e, principalmente, de
 * quem está AGUARDANDO PREÇO: uma âncora boa esperando ponto de entrada é
 * informação útil, não rejeição.
 */

const TABS = [
    { id: 'STOCK', label: 'Ações', icon: Landmark },
    { id: 'FII', label: 'FIIs', icon: Building2 },
] as const;

type TabId = (typeof TABS)[number]['id'];

const PLAN_LEVELS: Record<string, number> = { GUEST: 0, ESSENTIAL: 1, PRO: 2, ELITE: 3, BLACK: 4 };
/** Gate PRO reusando a feature `research_general` — a mesma das abas de Research. */
const MIN_PLAN = 'PRO';

/** Magnitude em pt-BR, sem sinal: o rótulo (Prêmio/Desconto) já diz a direção. */
const pctMagnitude = (value: number) => (
    `${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Math.abs(value))}%`
);

const brl = (value: number | null | undefined) => (
    value === null || value === undefined || !Number.isFinite(value)
        ? '—'
        : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
);

const dateLabel = (value?: string | null) => (
    value ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(value)) : '—'
);

/** Barra de um eixo (0–100). Os três juntos são a leitura rápida da tese. */
const AxisBar = ({ label, value }: { label: string; value?: number }) => {
    const safe = Number.isFinite(value) ? Math.max(0, Math.min(100, value as number)) : 0;
    return (
        <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide text-slate-500 w-24 shrink-0">{label}</span>
            <div className="flex-1 h-1.5 rounded-full bg-slate-700/50 overflow-hidden">
                <div className="h-full rounded-full bg-blue-500/80" style={{ width: `${safe}%` }} />
            </div>
            <span className="text-[11px] font-bold text-slate-300 w-8 text-right tabular-nums">
                {Number.isFinite(value) ? Math.round(value as number) : '—'}
            </span>
        </div>
    );
};

const ActionBadge = ({ action }: { action: string }) => (
    action === 'BUY'
        ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-black bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                <ShieldCheck size={12} /> COMPRAR
            </span>
        )
        : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-black bg-yellow-500/15 text-yellow-400 border border-yellow-500/30">
                <Clock size={12} /> AGUARDAR
            </span>
        )
);

/**
 * Prêmio/desconto sobre o preço justo. É o dado que transforma "AGUARDAR" de
 * rejeição em instrução: a âncora está boa, falta o preço chegar.
 */
const PremiumTag = ({ premiumPct }: { premiumPct?: number | null }) => {
    if (premiumPct === null || premiumPct === undefined || !Number.isFinite(premiumPct)) return null;
    const expensive = premiumPct > 0;
    return (
        <span
            className={`inline-flex items-center gap-1 text-[11px] font-bold ${expensive ? 'text-yellow-400' : 'text-emerald-400'}`}
            title={expensive ? 'Negociando acima do preço justo estimado' : 'Negociando abaixo do preço justo estimado'}
        >
            {expensive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {expensive ? 'Prêmio' : 'Desconto'} {pctMagnitude(premiumPct)}
        </span>
    );
};

const HysteresisTag = ({ item }: { item: AnchorRankingItem }) => {
    const state = item.anchor?.hysteresis?.state;
    if (state === 'HELD') {
        return (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/25">
                mantida na lista
            </span>
        );
    }
    if (state === 'ENTERED') {
        return (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/25">
                entrou agora
            </span>
        );
    }
    return null;
};

const AssetCard = ({ item }: { item: AnchorRankingItem }) => {
    const axes = item.anchor?.axes;
    const isBuy = item.action === 'BUY';
    return (
        <div className={`rounded-2xl border p-4 md:p-5 bg-card transition-colors ${isBuy ? 'border-emerald-500/25' : 'border-slate-800'}`}>
            <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-base font-black text-slate-100">{item.ticker}</span>
                        <HysteresisTag item={item} />
                    </div>
                    <p className="text-xs text-slate-500 truncate max-w-[22rem]">{item.name || item.sector}</p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="text-right">
                        <div className="text-2xl font-black text-slate-100 tabular-nums leading-none">{item.score}</div>
                        <div className="text-[10px] uppercase tracking-wide text-slate-500">score</div>
                    </div>
                    <ActionBadge action={item.action} />
                </div>
            </div>

            <div className="space-y-1.5 mb-3">
                <AxisBar label="Durabilidade" value={axes?.durability} />
                <AxisBar label="Resiliência" value={axes?.resilience} />
                <AxisBar label="Consistência" value={axes?.consistency} />
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2 text-[11px] text-slate-400">
                <PremiumTag premiumPct={item.anchor?.premiumPct} />
                {Number.isFinite(item.currentPrice) && (
                    <span className="tabular-nums">Preço {brl(item.currentPrice)}</span>
                )}
                {Number.isFinite(item.targetPrice) && (
                    <span className="tabular-nums">Justo {brl(item.targetPrice)}</span>
                )}
                {Number.isFinite(item.anchor?.spreadPp as number) && (
                    <span className="tabular-nums">Spread {new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(item.anchor?.spreadPp as number)} p.p.</span>
                )}
                {Number.isFinite(item.anchor?.pFfo as number) && (
                    <span className="tabular-nums">P/FFO {new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(item.anchor?.pFfo as number)}x</span>
                )}
                {item.anchor?.manager && <span>Gestora {item.anchor.manager}</span>}
            </div>

            {/* O motivo em texto é o produto tanto quanto o score: uma lista âncora
                que não explica por que um ativo está fora do COMPRAR obriga o
                assinante a adivinhar se é o negócio ou o preço. */}
            <p className="text-xs text-slate-400 leading-relaxed">{item.reason}</p>
        </div>
    );
};

const PlanGate = () => {
    const navigate = useNavigate();
    return (
        <div className="rounded-2xl border border-slate-800 bg-card p-8 md:p-12 text-center">
            <div className="w-14 h-14 rounded-2xl bg-slate-800 flex items-center justify-center mx-auto mb-4">
                <Lock size={24} className="text-slate-400" />
            </div>
            <h2 className="text-lg font-black text-slate-100 mb-2">Disponível a partir do plano Pro</h2>
            <p className="text-sm text-slate-400 max-w-md mx-auto mb-6 leading-relaxed">
                A lista Buy-and-Hold reúne os ativos que passam no portão de segurança da estratégia âncora —
                os que dá para carregar por décadas, não os melhores da semana.
            </p>
            <button
                type="button"
                onClick={() => navigate('/pricing')}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold transition-colors"
            >
                <Crown size={16} /> Ver planos
            </button>
        </div>
    );
};

export const BuyAndHold = () => {
    // Hooks primeiro, guards depois — sem exceção.
    const { user } = useAuth();
    const [tab, setTab] = useState<TabId>('STOCK');

    const isAdmin = user?.role === 'ADMIN';
    const hasAccess = isAdmin || (PLAN_LEVELS[user?.plan || 'GUEST'] || 0) >= PLAN_LEVELS[MIN_PLAN];

    const { data, isLoading, error } = useQuery<AnchorReport>({
        queryKey: ['anchor-report', tab],
        queryFn: () => researchService.getAnchorReport(tab),
        enabled: hasAccess,
        staleTime: STALE_TIME.HOURLY,
        retry: false,
    });

    const ranking = useMemo(() => data?.content?.ranking || [], [data]);
    const buys = useMemo(() => ranking.filter(item => item.action === 'BUY'), [ranking]);
    const waits = useMemo(() => ranking.filter(item => item.action !== 'BUY'), [ranking]);
    const exits = useMemo(() => data?.anchorExits || [], [data]);
    const thresholds = data?.inputManifest?.thresholds;

    const forbidden = error instanceof AnchorReportError && error.kind === 'FORBIDDEN';

    return (
        <div className="min-h-screen bg-deep text-white font-sans pb-[calc(4rem+env(safe-area-inset-bottom))] xl:pb-0">
            <Header />

            <main id="main-content" tabIndex={-1} className="max-w-[1360px] mx-auto p-4 md:p-8">
                <header className="mb-6 md:mb-8">
                    <h1 className="text-2xl md:text-4xl font-black text-slate-100 tracking-tighter flex items-center gap-3 md:gap-4">
                        <div className="w-10 h-10 md:w-12 md:h-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-600/20 shrink-0">
                            <Anchor size={22} className="text-white" />
                        </div>
                        Buy-and-Hold
                    </h1>
                    {/* A distinção com o Research semanal precisa estar na primeira
                        linha lida — as duas listas usam o verbo COMPRAR. */}
                    <p className="text-sm text-slate-400 mt-3 max-w-3xl leading-relaxed">
                        Não é a lista das melhores oportunidades da semana — para isso existe o{' '}
                        <span className="text-slate-300 font-semibold">Research</span>. Aqui ficam os ativos que
                        passam num portão de segurança e dão para carregar por <span className="text-slate-300 font-semibold">décadas</span>:
                        setor previsível, porte e liquidez de sobra, dívida sob controle, resultado através do ciclo.
                        Segurança é portão, não nota — quem não passa não aparece, por mais barato que esteja.
                        A lista é revista <span className="text-slate-300 font-semibold">uma vez por mês</span> e tem
                        inércia deliberada: um ativo entra com score {thresholds?.entryScore ?? 70} e só sai abaixo
                        de {thresholds?.holdScore ?? 62}, para não girar por oscilação de medição.
                    </p>
                </header>

                <div className="flex items-center gap-2 mb-6">
                    {TABS.map(({ id, label, icon: Icon }) => (
                        <button
                            key={id}
                            type="button"
                            onClick={() => setTab(id)}
                            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-colors border ${
                                tab === id
                                    ? 'bg-blue-600 text-white border-blue-500'
                                    : 'bg-card text-slate-400 border-slate-800 hover:text-slate-200'
                            }`}
                        >
                            <Icon size={15} /> {label}
                        </button>
                    ))}
                </div>

                {!hasAccess || forbidden ? <PlanGate /> : isLoading ? (
                    <div className="space-y-3">
                        <SkeletonCard />
                        <SkeletonCard />
                    </div>
                ) : !ranking.length ? (
                    <div className="rounded-2xl border border-slate-800 bg-card p-8 text-center">
                        <Info size={22} className="text-slate-500 mx-auto mb-3" />
                        <p className="text-sm text-slate-400">
                            Ainda não há lista publicada para esta classe. A apuração roda no primeiro dia de cada mês.
                        </p>
                    </div>
                ) : (
                    <>
                        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-6 text-xs text-slate-500">
                            <span>Publicada em <span className="text-slate-300 font-semibold">{dateLabel(data?.createdAt || data?.date)}</span></span>
                            <span><span className="text-emerald-400 font-bold">{buys.length}</span> para comprar</span>
                            <span><span className="text-yellow-400 font-bold">{waits.length}</span> aguardando</span>
                            {exits.length > 0 && <span><span className="text-slate-300 font-bold">{exits.length}</span> saíram</span>}
                        </div>

                        <section className="mb-10">
                            <h2 className="flex items-center gap-2 text-sm font-bold text-emerald-400 mb-1">
                                <ShieldCheck size={15} /> Para comprar
                            </h2>
                            <p className="text-xs text-slate-500 mb-3">
                                Âncora aprovada no portão e negociando dentro do valor justo.
                            </p>
                            {buys.length ? (
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                    {buys.map(item => <AssetCard key={item.ticker} item={item} />)}
                                </div>
                            ) : (
                                <p className="text-sm text-slate-500 rounded-xl border border-slate-800 bg-card px-4 py-6 text-center">
                                    Nenhum ativo reúne segurança e preço justo neste momento. Esperar é uma posição.
                                </p>
                            )}
                        </section>

                        {waits.length > 0 && (
                            <section>
                                <h2 className="flex items-center gap-2 text-sm font-bold text-yellow-400 mb-1">
                                    <Clock size={15} /> Aguardando
                                </h2>
                                {/* Explicitar que AGUARDAR não é reprovação é metade do
                                    valor da tela: são âncoras boas esperando preço. */}
                                <p className="text-xs text-slate-500 mb-3">
                                    Passaram no portão, mas ainda não reúnem tudo. Quem está aqui só pelo preço é uma
                                    boa âncora esperando ponto de entrada — vale acompanhar, não descartar.
                                </p>
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                    {waits.map(item => <AssetCard key={item.ticker} item={item} />)}
                                </div>
                            </section>
                        )}

                        {exits.length > 0 && <ExitList exits={exits} />}
                    </>
                )}

                {/* Disclaimer — a lista usa termos fortes (COMPRAR / carregar por
                    décadas); a ressalva precisa estar na própria página. */}
                <p className="text-[10px] text-slate-600 text-center mt-10 pb-6 max-w-2xl mx-auto leading-relaxed">
                    {data?.inputManifest?.disclaimer
                        || 'Conteúdo informativo e educacional gerado por análise quantitativa; não constitui recomendação individualizada de investimento. Investimentos envolvem risco de perda de capital.'}
                </p>
            </main>
        </div>
    );
};
