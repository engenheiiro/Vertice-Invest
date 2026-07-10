import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Landmark, Info, TrendingUp, ShieldCheck, RefreshCcw, AlertTriangle } from 'lucide-react';
import { researchService, TreasuryBondItem } from '../../services/research';
import { SkeletonCard } from '../ui';

// Vitrine informativa de Renda Fixa (Tesouro Direto). NÃO é ranking competitivo:
// renda fixa não compete por score como ação/FII. Mostra taxa contratada, vencimento,
// rendimento nominal/real estimado e comparação vs CDI. Moeda sempre em R$.

type GroupKey = 'IPCA' | 'RENDAMAIS' | 'EDUCA' | 'SELIC' | 'PREFIXADO';

// Ordem de exibição/filtro dos grupos. Educa+ e Renda+ são IPCA-indexados, mas têm
// produto/objetivo próprios (educação / aposentadoria) — grupo próprio, não "IPCA+".
const GROUP_ORDER: GroupKey[] = ['IPCA', 'RENDAMAIS', 'EDUCA', 'SELIC', 'PREFIXADO'];

const GROUP_META: Record<GroupKey, { label: string; sub: string; accent: string }> = {
    IPCA: { label: 'Tesouro IPCA+', sub: 'Protege da inflação (juro real + IPCA)', accent: 'text-emerald-400' },
    RENDAMAIS: { label: 'Tesouro Renda+', sub: 'Aposentadoria — renda mensal (juro real + IPCA)', accent: 'text-emerald-400' },
    EDUCA: { label: 'Tesouro Educa+', sub: 'Educação — renda mensal (juro real + IPCA)', accent: 'text-emerald-400' },
    SELIC: { label: 'Tesouro Selic', sub: 'Pós-fixado, acompanha a Selic/CDI', accent: 'text-blue-400' },
    PREFIXADO: { label: 'Tesouro Prefixado', sub: 'Taxa nominal travada até o vencimento', accent: 'text-purple-400' },
};

const groupOf = (type: TreasuryBondItem['type']): GroupKey => {
    if (type === 'SELIC') return 'SELIC';
    if (type === 'PREFIXADO') return 'PREFIXADO';
    if (type === 'RENDAMAIS') return 'RENDAMAIS';
    if (type === 'EDUCA') return 'EDUCA';
    return 'IPCA';
};

const fmtPct = (v: number | null | undefined) =>
    v === null || v === undefined ? '-' : `${v.toFixed(2).replace('.', ',')}%`;

const fmtSigned = (v: number | null | undefined) => {
    if (v === null || v === undefined) return '-';
    const sign = v > 0 ? '+' : '';
    return `${sign}${v.toFixed(2).replace('.', ',')} pp`;
};

const fmtBRL = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

const MacroPill: React.FC<{ label: string; value: number }> = ({ label, value }) => (
    <div className="bg-card border border-slate-800 rounded-xl px-4 py-2 text-center">
        <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">{label}</p>
        <p className="text-sm font-black text-white tabular-nums">{fmtPct(value)}</p>
    </div>
);

const BondRow: React.FC<{ bond: TreasuryBondItem }> = ({ bond }) => (
    <div className="bg-card border border-slate-800 rounded-2xl p-4 hover:border-slate-600 transition-all">
        <div className="flex flex-col lg:flex-row lg:items-center gap-4">
            <div className="flex-1 min-w-0">
                <h4 className="text-sm font-black text-white truncate">{bond.title}</h4>
                <p className="text-[10px] text-slate-500 font-medium mt-0.5">
                    Vence em {bond.maturityDate || '—'}
                    {bond.minInvestment > 0 && <> · Mín. {fmtBRL(bond.minInvestment)}</>}
                </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 shrink-0">
                <div className="text-center sm:text-left">
                    <p className="text-[8px] font-bold text-slate-500 uppercase">Taxa contratada</p>
                    <p className="text-xs font-bold text-white tabular-nums">{fmtPct(bond.rate)}</p>
                </div>
                <div className="text-center sm:text-left">
                    <p className="text-[8px] font-bold text-slate-500 uppercase">Nominal est.</p>
                    <p className="text-xs font-bold text-slate-300 tabular-nums">{fmtPct(bond.nominalEstimate)}</p>
                </div>
                <div className="text-center sm:text-left">
                    <p className="text-[8px] font-bold text-slate-500 uppercase">Acima da inflação</p>
                    <p className={`text-xs font-bold tabular-nums ${bond.realEstimate > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {fmtPct(bond.realEstimate)}
                    </p>
                </div>
                <div className="text-center sm:text-left">
                    <p className="text-[8px] font-bold text-slate-500 uppercase">vs CDI</p>
                    <p className={`text-xs font-bold tabular-nums ${
                        bond.vsCdi === null ? 'text-slate-500' : bond.vsCdi >= 0 ? 'text-emerald-400' : 'text-yellow-400'
                    }`}>
                        {fmtSigned(bond.vsCdi)}
                    </p>
                </div>
            </div>
        </div>
    </div>
);

export const TreasuryPanel: React.FC = () => {
    const { data, isLoading, isError, refetch, isFetching } = useQuery({
        queryKey: ['research', 'fixed-income'],
        queryFn: () => researchService.getFixedIncomeData(),
        staleTime: 15 * 60 * 1000, // macro/Tesouro muda devagar
    });

    const [activeGroup, setActiveGroup] = useState<GroupKey | 'ALL'>('ALL');

    const grouped = useMemo(() => {
        const out: Record<GroupKey, TreasuryBondItem[]> = { IPCA: [], RENDAMAIS: [], EDUCA: [], SELIC: [], PREFIXADO: [] };
        (data?.bonds || []).forEach(b => out[groupOf(b.type)].push(b));
        (Object.keys(out) as GroupKey[]).forEach(k =>
            out[k].sort((a, b) => (a.maturityDate || '').localeCompare(b.maturityDate || ''))
        );
        return out;
    }, [data]);

    if (isLoading) {
        return (
            <div className="max-w-5xl mx-auto space-y-4 animate-fade-in" aria-busy="true">
                <SkeletonCard className="h-24" />
                <SkeletonCard className="h-20" />
                <SkeletonCard className="h-20" />
            </div>
        );
    }

    if (isError || !data) {
        return (
            <div className="max-w-5xl mx-auto flex flex-col items-center justify-center py-20 bg-base border border-dashed border-slate-800 rounded-3xl text-center">
                <AlertTriangle size={40} className="text-yellow-500 mb-4" />
                <h3 className="text-lg font-black text-slate-400 uppercase">Renda Fixa indisponível</h3>
                <p className="text-slate-600 text-sm mt-2 max-w-sm">Não foi possível carregar os títulos do Tesouro. Tente novamente.</p>
                <button onClick={() => refetch()} className="mt-6 flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-xs font-bold rounded-xl hover:bg-blue-700 transition-colors">
                    <RefreshCcw size={14} /> Recarregar
                </button>
            </div>
        );
    }

    const groupsToRender = (activeGroup === 'ALL' ? GROUP_ORDER : [activeGroup]);
    const hasAnyBond = (data.bonds || []).length > 0;

    return (
        <div className="max-w-5xl mx-auto animate-fade-in space-y-6 pb-20">
            {/* Cabeçalho + macro context */}
            <div className="bg-base border border-slate-800 rounded-3xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-lg">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-emerald-600/20 rounded-xl flex items-center justify-center border border-emerald-600/30">
                        <Landmark size={20} className="text-emerald-400" />
                    </div>
                    <div>
                        <h3 className="text-sm font-black text-white uppercase tracking-wide">Renda Fixa · Tesouro Direto</h3>
                        <p className="text-[10px] text-slate-500">Vitrine informativa — comparação de títulos públicos com a inflação e o CDI.</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <MacroPill label="IPCA" value={data.macro.ipca} />
                    <MacroPill label="Selic" value={data.macro.selic} />
                    <MacroPill label="CDI" value={data.macro.cdi} />
                    <button
                        onClick={() => refetch()}
                        disabled={isFetching}
                        className="bg-card border border-slate-800 p-2.5 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white transition-colors disabled:opacity-50"
                        title="Atualizar"
                        aria-label="Atualizar Renda Fixa"
                    >
                        <RefreshCcw size={16} className={isFetching ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            {/* Aviso: renda fixa é informativa, não ranking */}
            <div className="flex items-start gap-3 p-4 bg-blue-900/10 border border-blue-900/30 rounded-2xl">
                <Info size={16} className="text-blue-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-slate-400 leading-relaxed">
                    Renda fixa <strong className="text-slate-200">não entra em ranking competitivo</strong> como ações ou FIIs — não faz sentido
                    pontuar um título do Tesouro contra outro. Aqui você compara <strong className="text-slate-200">taxa, vencimento e rendimento real</strong> para
                    escolher conforme seu objetivo. Use as <strong className="text-slate-200">sub-metas de Renda Fixa</strong> na sua Carteira Ideal para definir
                    quanto alocar em IPCA, Pós-fixado e Prefixado.
                </p>
            </div>

            {/* Filtro por grupo */}
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                {(['ALL', ...GROUP_ORDER] as const).map(key => (
                    <button
                        key={key}
                        onClick={() => setActiveGroup(key)}
                        className={`whitespace-nowrap px-4 py-2 rounded-xl text-xs font-bold transition-all border shrink-0 ${
                            activeGroup === key ? 'bg-emerald-700 border-emerald-600 text-white shadow-lg shadow-emerald-900/20' : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300 hover:bg-slate-800'
                        }`}
                    >
                        {key === 'ALL' ? 'Todos' : GROUP_META[key].label}
                    </button>
                ))}
            </div>

            {!hasAnyBond ? (
                <div className="flex flex-col items-center justify-center py-16 bg-base border border-dashed border-slate-800 rounded-3xl text-center">
                    <Landmark size={40} className="text-slate-700 mb-4" />
                    <h3 className="text-base font-black text-slate-500 uppercase">Sem títulos cadastrados</h3>
                    <p className="text-slate-600 text-sm mt-2 max-w-sm">Rode a sincronização de mercado para carregar os títulos do Tesouro.</p>
                </div>
            ) : (
                <div className="space-y-8">
                    {groupsToRender.map(g => {
                        const bonds = grouped[g];
                        if (bonds.length === 0) return null;
                        const meta = GROUP_META[g];
                        return (
                            <section key={g} className="space-y-3">
                                <div className="flex items-center gap-2 px-1">
                                    {(g === 'IPCA' || g === 'RENDAMAIS' || g === 'EDUCA') ? <ShieldCheck size={14} className={meta.accent} /> : <TrendingUp size={14} className={meta.accent} />}
                                    <h4 className="text-xs font-black text-white uppercase tracking-widest">{meta.label}</h4>
                                    <span className="text-[10px] text-slate-500 font-medium normal-case">· {meta.sub}</span>
                                </div>
                                <div className="space-y-2.5">
                                    {bonds.map(b => <BondRow key={b.title} bond={b} />)}
                                </div>
                            </section>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
