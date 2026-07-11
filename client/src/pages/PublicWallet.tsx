import React, { useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, TrendingUp, Lock, PieChart as PieIcon, ArrowUpRight } from 'lucide-react';
import {
    PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
    AreaChart, Area, XAxis, YAxis,
} from 'recharts';
import { publicWalletService, type PublicWalletData } from '../services/publicWallet';
import { formatCurrency, formatPercent } from '../utils/format';

// Cores/labels espelham AllocationChart (mantidos locais: a página pública é
// standalone e não deve arrastar dependências da área autenticada).
const CLASS_COLORS: Record<string, string> = {
    STOCK: '#3B82F6', FII: '#10B981', STOCK_US: '#06B6D4', ETF: '#14B8A6',
    CRYPTO: '#E879F9', FIXED_INCOME: '#F59E0B', OURO: '#EAB308', CASH: '#64748B',
};
const CLASS_LABELS: Record<string, string> = {
    STOCK: 'Ações BR', FII: 'FIIs', STOCK_US: 'Exterior', ETF: 'ETFs',
    CRYPTO: 'Cripto', FIXED_INCOME: 'Renda Fixa', OURO: 'Ouro', CASH: 'Reserva',
};
const classColor = (c: string) => CLASS_COLORS[c] || '#64748B';
const classLabel = (c: string) => CLASS_LABELS[c] || c;

const shortDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
};

const Shell: React.FC<React.PropsWithChildren> = ({ children }) => (
    <div className="min-h-screen bg-deep text-slate-100">
        <header className="border-b border-slate-800/80">
            <div className="max-w-[1100px] mx-auto px-4 py-3 flex items-center justify-between">
                <Link to="/" className="flex items-center gap-2 font-bold">
                    <ShieldCheck className="text-blue-400" size={20} />
                    <span>Vértice <span className="text-slate-500 font-medium">Invest</span></span>
                </Link>
                <Link
                    to="/register"
                    className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg px-3.5 py-2 text-xs transition-colors"
                >
                    Criar minha carteira <ArrowUpRight size={14} />
                </Link>
            </div>
        </header>
        <main className="max-w-[1100px] mx-auto px-4 py-6 md:py-8">{children}</main>
        <footer className="max-w-[1100px] mx-auto px-4 pb-10 pt-4">
            <p className="text-[11px] text-slate-600 leading-relaxed">
                Página informativa gerada pelo próprio investidor. Composição e rentabilidade
                não constituem recomendação ou oferta de investimento. Desempenho passado não
                garante resultados futuros.
            </p>
        </footer>
    </div>
);

export const PublicWallet: React.FC = () => {
    const { token = '' } = useParams();

    const { data, isLoading, isError, error } = useQuery<PublicWalletData>({
        queryKey: ['publicWallet', token],
        queryFn: () => publicWalletService.get(token),
        retry: (count, err: any) => err?.message !== 'NOT_FOUND' && count < 2,
        staleTime: 60_000,
    });

    const donut = useMemo(
        () => (data?.allocation || []).map((a) => ({ name: classLabel(a.class), value: a.weightPct, color: classColor(a.class) })),
        [data?.allocation],
    );

    if (isLoading) {
        return (
            <Shell>
                <div className="animate-pulse space-y-4">
                    <div className="h-8 w-64 bg-slate-800 rounded" />
                    <div className="h-28 bg-card border border-slate-800 rounded-2xl" />
                    <div className="h-64 bg-card border border-slate-800 rounded-2xl" />
                </div>
            </Shell>
        );
    }

    if (isError || !data) {
        const notFound = (error as any)?.message === 'NOT_FOUND';
        return (
            <Shell>
                <div className="bg-card border border-slate-800 rounded-2xl p-10 text-center">
                    <Lock className="mx-auto text-slate-600 mb-3" size={32} />
                    <h1 className="text-lg font-bold text-slate-200">
                        {notFound ? 'Carteira não encontrada' : 'Não foi possível carregar'}
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">
                        {notFound
                            ? 'Este link pode ter sido desativado pelo dono ou nunca ter existido.'
                            : 'Tente novamente em instantes.'}
                    </p>
                    <Link to="/" className="inline-block mt-5 text-blue-400 hover:text-blue-300 text-sm font-semibold">
                        Conhecer o Vértice →
                    </Link>
                </div>
            </Shell>
        );
    }

    const { wallet, showValues, composition, performance, kpis } = data;
    const ret = performance.totalReturnPct;
    const retPositive = ret >= 0;

    return (
        <Shell>
            {/* Cabeçalho da carteira */}
            <div className="mb-6">
                <p className="text-[11px] uppercase tracking-wider text-blue-400/80 font-bold mb-1">Carteira pública</p>
                <h1 className="text-2xl md:text-3xl font-bold text-slate-100">{wallet.name}</h1>
                {wallet.ownerFirstName && (
                    <p className="text-sm text-slate-500 mt-1">por {wallet.ownerFirstName}</p>
                )}
            </div>

            {/* Destaque de performance */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
                <div className="bg-card border border-slate-800 rounded-2xl p-5 md:col-span-1">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold flex items-center gap-1.5">
                        <TrendingUp size={12} /> Rentabilidade total
                    </p>
                    <p className={`text-3xl font-bold mt-2 tabular-nums ${retPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                        {formatPercent(ret, { sign: true })}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
                        Hoje: <span className={performance.dayVariationPercent >= 0 ? 'text-emerald-500' : 'text-red-500'}>
                            {formatPercent(performance.dayVariationPercent, { sign: true })}
                        </span>
                    </p>
                </div>

                {showValues && kpis ? (
                    <>
                        <div className="bg-card border border-slate-800 rounded-2xl p-5">
                            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Patrimônio</p>
                            <p className="text-2xl font-bold text-slate-100 mt-2 tabular-nums">{formatCurrency(kpis.totalEquity)}</p>
                        </div>
                        <div className="bg-card border border-slate-800 rounded-2xl p-5">
                            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Resultado</p>
                            <p className={`text-2xl font-bold mt-2 tabular-nums ${kpis.totalResult >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {formatCurrency(kpis.totalResult)}
                            </p>
                        </div>
                    </>
                ) : (
                    <div className="bg-card border border-slate-800 rounded-2xl p-5 md:col-span-2 flex items-center gap-3">
                        <Lock className="text-slate-600 shrink-0" size={20} />
                        <p className="text-xs text-slate-500">
                            O dono optou por manter os valores em R$ privados. A composição e a
                            rentabilidade são exibidas apenas em percentual.
                        </p>
                    </div>
                )}
            </div>

            {/* Curva de rentabilidade (%) */}
            {performance.curve.length > 1 && (
                <div className="bg-card border border-slate-800 rounded-2xl p-5 mb-6">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-3">Evolução da rentabilidade (%)</p>
                    <div className="h-56">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={performance.curve} margin={{ top: 5, right: 8, left: -12, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="pubReturn" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#10B981" stopOpacity={0.35} />
                                        <stop offset="100%" stopColor="#10B981" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 10, fill: '#64748B' }} minTickGap={40} axisLine={false} tickLine={false} />
                                <YAxis tickFormatter={(v) => `${v.toFixed(0)}%`} tick={{ fontSize: 10, fill: '#64748B' }} width={44} axisLine={false} tickLine={false} />
                                <Tooltip
                                    formatter={(v: any) => [formatPercent(Number(v), { sign: true }), 'Retorno']}
                                    labelFormatter={(l) => shortDate(String(l))}
                                    contentStyle={{ background: '#141922', border: '1px solid #202631', borderRadius: 8, fontSize: 12 }}
                                />
                                <Area type="monotone" dataKey="returnPct" stroke="#10B981" strokeWidth={2} fill="url(#pubReturn)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                {/* Alocação por classe */}
                <div className="bg-card border border-slate-800 rounded-2xl p-5 lg:col-span-2">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-3 flex items-center gap-1.5">
                        <PieIcon size={12} /> Alocação por classe
                    </p>
                    {donut.length > 0 ? (
                        <>
                            <div className="h-48">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie data={donut} dataKey="value" nameKey="name" innerRadius={48} outerRadius={72} paddingAngle={2} stroke="none">
                                            {donut.map((d, i) => <Cell key={i} fill={d.color} />)}
                                        </Pie>
                                        <Tooltip
                                            formatter={(v: any, n: any) => [formatPercent(Number(v)), n]}
                                            contentStyle={{ background: '#141922', border: '1px solid #202631', borderRadius: 8, fontSize: 12 }}
                                        />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                            <div className="mt-3 space-y-1.5">
                                {donut.map((d, i) => (
                                    <div key={i} className="flex items-center justify-between text-xs">
                                        <span className="flex items-center gap-2 text-slate-400">
                                            <span className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} />
                                            {d.name}
                                        </span>
                                        <span className="tabular-nums font-semibold text-slate-300">{formatPercent(d.value)}</span>
                                    </div>
                                ))}
                            </div>
                        </>
                    ) : (
                        <p className="text-xs text-slate-500 py-8 text-center">Carteira sem ativos.</p>
                    )}
                </div>

                {/* Composição por ativo */}
                <div className="bg-card border border-slate-800 rounded-2xl p-5 lg:col-span-3">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-3">Ativos ({composition.length})</p>
                    <div className="space-y-2.5">
                        {composition.map((c) => (
                            <div key={c.ticker} className="flex items-center gap-3">
                                <div className="w-16 shrink-0">
                                    <p className="font-bold text-slate-200 text-sm truncate">{c.ticker}</p>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                                        <div className="h-full rounded-full" style={{ width: `${Math.min(c.weightPct, 100)}%`, background: classColor(c.type) }} />
                                    </div>
                                </div>
                                <div className="text-right shrink-0 w-20">
                                    <p className="tabular-nums font-semibold text-slate-300 text-sm">{formatPercent(c.weightPct)}</p>
                                    {showValues && typeof c.value === 'number' && (
                                        <p className="text-[10px] text-slate-500 tabular-nums">{formatCurrency(c.value)}</p>
                                    )}
                                </div>
                            </div>
                        ))}
                        {composition.length === 0 && (
                            <p className="text-xs text-slate-500 py-8 text-center">Nenhum ativo para exibir.</p>
                        )}
                    </div>
                </div>
            </div>
        </Shell>
    );
};

export default PublicWallet;
