import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Anchor, Crown, Info, Lock, Landmark, Building2, ChevronDown } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

import { Header } from '../components/dashboard/Header';
// Extraido desta pagina quando o semanal ganhou retencao de assento: as duas
// estrategias explicam saidas da mesma forma.
import { ExitList } from '../components/research/ExitList';
import { AnchorAssetCard } from '../components/research/AnchorAssetCard';
import { AnchorSectorMix } from '../components/research/AnchorSectorMix';
import { anchorStatusIcon, anchorTone } from '../components/research/anchorStatusTheme';
import { SkeletonCard } from '../components/ui';
import type { SectorGranularity } from '../utils/sectorAllocation';
import { STALE_TIME } from '../config/queryConfig';
import { useAuth } from '../contexts/AuthContext';
import {
    anchorStatusById,
    averageAnchorScore,
    groupByAnchorStatus,
    type AnchorStatus,
    type AnchorStatusId,
} from '../utils/anchorStatus';
import {
    researchService,
    AnchorReportError,
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
 * confundem — por isso a página fala de portão e, principalmente, do que separa
 * quem está fora do COMPRAR: uma âncora boa esperando ponto de entrada, um
 * fundo barrado pelo teto de composição da carteira e um ativo sem convicção
 * são três coisas diferentes, e a tela as separa em vez de chamar tudo de
 * AGUARDAR (ver `utils/anchorStatus.ts`).
 */

const TABS = [
    { id: 'STOCK', label: 'Ações', icon: Landmark },
    { id: 'FII', label: 'FIIs', icon: Building2 },
] as const;

type TabId = (typeof TABS)[number]['id'];

/**
 * Seções que ganham a repartição por setor.
 *
 * São as três que o assinante lê como uma cesta — o que comprar hoje, o que
 * acompanhar e o que ainda amadurece — e onde a concentração muda a decisão.
 * Fora ficam as duas seções de bloqueio: "fora por composição" é, por definição,
 * o excedente de um balde já cheio (a pizza repetiria o próprio critério) e
 * "renda não operacional" é uma lista de defeitos de tese, não uma carteira.
 */
const SECTOR_MIX_SECTIONS = new Set<AnchorStatusId>(['BUY', 'PRICE', 'CONVICTION']);

const PLAN_LEVELS: Record<string, number> = { GUEST: 0, ESSENTIAL: 1, PRO: 2, ELITE: 3, BLACK: 4 };
/** Gate PRO reusando a feature `research_general` — a mesma das abas de Research. */
const MIN_PLAN = 'PRO';

const decimal = (value: number, digits = 1) => new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
}).format(value);

const dateLabel = (value?: string | null) => (
    value ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(value)) : '—'
);

/** Célula do painel de apuração. Números grandes, rótulo pequeno, uma cor só. */
const Stat = ({ label, value, tone }: { label: string; value: string; tone: string }) => (
    <div className="bg-card px-4 py-3.5">
        <div className={`text-[10px] uppercase tracking-[0.12em] font-bold ${tone}`}>{label}</div>
        <div className="text-2xl font-black text-slate-100 tabular-nums mt-1 leading-none">{value}</div>
    </div>
);

/** Cabeçalho de seção: régua colorida, título e a linha que explica o grupo. */
const SectionHeading = ({ status, count }: { status: AnchorStatus; count: number }) => {
    const tone = anchorTone(status.tone);
    const Icon = anchorStatusIcon(status.id);
    return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-4">
            <span className={`w-[3px] h-[18px] rounded-sm shrink-0 ${tone.rule}`} aria-hidden />
            <h2 className={`flex items-center gap-2 text-base font-bold ${tone.score}`}>
                <Icon size={15} /> {status.section}
                <span className="text-slate-500 font-black tabular-nums">{count}</span>
            </h2>
            <p className="text-xs text-slate-500 leading-relaxed basis-full lg:basis-auto lg:flex-1 lg:min-w-[16rem]">
                {status.description}
            </p>
        </div>
    );
};

/**
 * Método da lista, recolhido. O texto longo explicando portão, eixos e histerese
 * é o que dá credibilidade à palavra COMPRAR, mas não pode ser a primeira coisa
 * que o assinante lê — a chamada da página tem que caber em duas linhas, como a
 * da Carteira.
 */
const MethodDisclosure = ({ entryScore, holdScore }: { entryScore: number; holdScore: number }) => {
    const [open, setOpen] = useState(false);
    return (
        <div className="mt-2">
            <button
                type="button"
                onClick={() => setOpen(value => !value)}
                aria-expanded={open}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors"
            >
                Como a lista é montada
                <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
                <p className="text-xs text-slate-400 leading-relaxed max-w-2xl mt-2 animate-fade-in">
                    Segurança é <span className="text-slate-300 font-semibold">portão, não nota</span>: setor previsível,
                    porte e liquidez de sobra, dívida sob controle e resultado através do ciclo. Quem não passa não
                    aparece, por mais barato que esteja. Quem passa é medido em três eixos — durabilidade, resiliência e
                    consistência — e o preço entra só como <span className="text-slate-300 font-semibold">freio</span>,
                    nunca como bônus. A lista é revista uma vez por mês e tem inércia deliberada: um ativo entra com
                    score {entryScore} e só sai abaixo de {holdScore}, para não girar por oscilação de medição.
                </p>
            )}
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

    const thresholds = data?.inputManifest?.thresholds;
    const entryScore = thresholds?.entryScore ?? 70;
    const holdScore = thresholds?.holdScore ?? 62;

    const ranking = useMemo(() => data?.content?.ranking || [], [data]);
    const groups = useMemo(() => groupByAnchorStatus(ranking, entryScore), [ranking, entryScore]);
    const buyCount = useMemo(() => ranking.filter(item => item.action === 'BUY').length, [ranking]);
    const averageScore = useMemo(() => averageAnchorScore(ranking), [ranking]);
    const exits = useMemo(() => data?.anchorExits || [], [data]);

    // Ação é repartida pelo SUBSETOR do próprio ativo (Energia Elétrica,
    // Saneamento Básico, Telecomunicações), não pelo macro-setor da Carteira:
    // numa lista de seleção o rótulo do gráfico tem que bater com o do cartão.
    const sectorKind: SectorGranularity = tab === 'FII' ? 'FII' : 'STOCK_SUBSECTOR';

    const forbidden = error instanceof AnchorReportError && error.kind === 'FORBIDDEN';

    return (
        <div className="min-h-screen bg-deep text-white font-sans pb-[calc(4rem+env(safe-area-inset-bottom))] xl:pb-0">
            <Header />

            <main id="main-content" tabIndex={-1} className="max-w-[1360px] mx-auto p-4 md:p-6 animate-fade-in">
                {/* Título e ícone na MESMA régua do Research — as duas listas são
                    irmãs e trocar de escala tipográfica entre elas faria a página
                    parecer de outro produto. */}
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 md:gap-6 mb-5 md:mb-8">
                    <div className="min-w-0">
                        <h1 className="text-2xl md:text-4xl font-black text-white tracking-tighter flex items-center gap-3 md:gap-4">
                            <div className="w-10 h-10 md:w-12 md:h-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-600/20 shrink-0">
                                <Anchor size={22} className="md:hidden" />
                                <Anchor size={28} className="hidden md:block" />
                            </div>
                            Buy-and-Hold
                        </h1>
                        <p className="text-slate-400 text-sm leading-relaxed max-w-xl mt-2">
                            A lista para carregar por décadas: ativos que passam num portão de segurança, com o que
                            ainda falta escrito em cada um. Para a melhor oportunidade de agora existe o{' '}
                            <Link to="/research" className="text-slate-300 font-semibold hover:text-blue-400 transition-colors">
                                Research
                            </Link>.
                        </p>
                        <MethodDisclosure entryScore={entryScore} holdScore={holdScore} />
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        {TABS.map(({ id, label, icon: Icon }) => (
                            <button
                                key={id}
                                type="button"
                                onClick={() => setTab(id)}
                                className={`inline-flex items-center gap-2 px-4 py-2 h-10 rounded-xl text-sm font-bold transition-colors border ${
                                    tab === id
                                        ? 'bg-blue-600 text-white border-blue-500'
                                        : 'bg-card text-slate-400 border-slate-800 hover:text-slate-200'
                                }`}
                            >
                                <Icon size={15} /> {label}
                            </button>
                        ))}
                    </div>
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
                        {/* Painel da apuração: o gap-px vira a divisória entre as
                            células, sem contas de borda por breakpoint. */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-slate-800 border border-slate-800 rounded-2xl overflow-hidden mb-3">
                            <Stat label="Para comprar" value={String(buyCount)} tone="text-emerald-400" />
                            <Stat label="Aguardando" value={String(ranking.length - buyCount)} tone="text-yellow-400" />
                            <Stat label="Saíram" value={String(exits.length)} tone="text-slate-400" />
                            <Stat
                                label="Score médio da lista"
                                value={averageScore === null ? '—' : decimal(averageScore)}
                                tone="text-blue-400"
                            />
                        </div>
                        <p className="text-xs text-slate-500 mb-8">
                            Publicada em <span className="text-slate-300 font-semibold">{dateLabel(data?.createdAt || data?.date)}</span>
                            {' · '}revista no primeiro dia de cada mês
                        </p>

                        {/* A página abre por "Para comprar" mesmo quando ninguém
                            passa: sem o cabeçalho, uma apuração sem COMPRAR
                            parece uma apuração que não rodou. */}
                        {buyCount === 0 && (
                            <section className="mb-10">
                                <SectionHeading status={anchorStatusById('BUY')} count={0} />
                                <p className="text-sm text-slate-500 rounded-xl border border-slate-800 bg-card px-4 py-6 text-center">
                                    Nenhum ativo reúne segurança e preço justo neste momento. Esperar é uma posição.
                                </p>
                            </section>
                        )}

                        {groups.map(({ status, items }) => (
                            <section key={status.id} className="mb-10">
                                <SectionHeading status={status} count={items.length} />
                                {SECTOR_MIX_SECTIONS.has(status.id) && (
                                    <AnchorSectorMix items={items} kind={sectorKind} section={status.section} />
                                )}
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                                    {items.map(item => (
                                        <AnchorAssetCard key={item.ticker} item={item} status={status} sectorKind={sectorKind} />
                                    ))}
                                </div>
                            </section>
                        ))}


                        {/* Numa lista âncora, "ninguém saiu" é o resultado esperado
                            e informa tanto quanto uma saída: some a seção e o
                            assinante não sabe se a lista foi estável ou se a
                            página deixou de contar. */}
                        <ExitList
                            exits={exits}
                            subtitle="Quem estava na lista anterior e não está mais nesta — com o motivo escrito e o score de antes e de agora."
                            emptyMessage="Nenhum ativo saiu da lista nesta apuração — a carteira anterior segue de pé."
                        />
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
