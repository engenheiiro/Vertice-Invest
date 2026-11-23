import React, { useMemo } from 'react';
import { Trophy, BarChart2, Wallet, PieChart, PlusCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { RankingItem } from '../../services/research';
import { useWallet } from '../../contexts/WalletContext';
import {
    COLORS, RISK_LABELS, cryptoAvgCapText, donutDash, pickSectorSlices, pickStats, scoreTextColor, walletSectorSlices,
    type RiskFilter, type SectorSlice,
} from './topPicksView';

const SliceLegend = ({ slices, maxHeight, nameWidth }: { slices: SectorSlice[]; maxHeight: string; nameWidth: string }) => (
    <div className={`flex-1 grid grid-cols-1 gap-y-1 content-center overflow-y-auto ${maxHeight} custom-scrollbar pr-1`}>
        {slices.map((sector, i) => (
            <div key={sector.name} className="flex items-center justify-between text-[9px] group w-full">
                <div className="flex items-center gap-1.5 overflow-hidden">
                    <div className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }}></div>
                    <span className={`text-slate-400 truncate ${nameWidth} group-hover:text-slate-200 transition-colors`} title={sector.name}>{sector.name}</span>
                </div>
                <span className="font-bold text-slate-300 tabular-nums ml-1">{Math.round(sector.percent)}%</span>
            </div>
        ))}
    </div>
);

const UserWalletSectorChart = ({ assetClass }: { assetClass: string }) => {
    const { assets } = useWallet();
    const navigate = useNavigate();
    const slices = useMemo(() => walletSectorSlices(assets, assetClass), [assets, assetClass]);

    if (!slices) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-center p-4">
                <div className="w-10 h-10 bg-slate-900 rounded-full flex items-center justify-center mb-2 border border-slate-800">
                    <Wallet size={16} className="text-slate-500" />
                </div>
                <p className="text-[10px] text-slate-500 font-bold mb-3">Sem ativos nesta categoria.</p>
                <button onClick={() => navigate('/wallet')} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold rounded-lg transition-colors">
                    <PlusCircle size={12} /> Adicionar
                </button>
            </div>
        );
    }

    return (
        <div className="flex flex-row items-center gap-4 w-full h-full px-2">
            <div className="relative w-24 h-24 shrink-0">
                <svg viewBox="0 0 42 42" className="w-full h-full transform -rotate-90">
                    <circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="#1e293b" strokeWidth="6"></circle>
                    {slices.map((sector, i) => {
                        const { dash, offset } = donutDash(slices, i);
                        return (
                            <circle key={sector.name} cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke={COLORS[i % COLORS.length]} strokeWidth="6" strokeDasharray={dash} strokeDashoffset={offset} className="transition-all duration-1000 ease-out hover:stroke-[8] cursor-pointer"><title>{sector.name}: {Math.round(sector.percent)}%</title></circle>
                        );
                    })}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-[9px] text-slate-500 uppercase font-bold">Você</span>
                </div>
            </div>
            <div className="flex-1 flex flex-col h-full">
                <SliceLegend slices={slices} maxHeight="max-h-[140px]" nameWidth="max-w-[80px]" />
            </div>
        </div>
    );
};

const SectorDistribution = ({ picks }: { picks: RankingItem[] }) => {
    const slices = useMemo(() => pickSectorSlices(picks), [picks]);

    // Pode ficar vazio quando todos os ativos da seleção estão em AGUARDAR (nenhum COMPRAR).
    if (slices.length === 0) return <p className="text-[10px] text-slate-500 text-center mt-10">Nenhum ativo COMPRAR nesta seleção.</p>;

    return (
        <div className="flex flex-row items-center gap-4 w-full h-full">
            <div className="relative w-20 h-20 shrink-0 ml-2">
                <svg viewBox="0 0 42 42" className="w-full h-full transform -rotate-90">
                    <circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="#1e293b" strokeWidth="8"></circle>
                    {slices.map((sector, i) => {
                        const { dash, offset } = donutDash(slices, i);
                        return (
                            <circle key={sector.name} cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke={COLORS[i % COLORS.length]} strokeWidth="8" strokeDasharray={dash} strokeDashoffset={offset} className="transition-all duration-1000 ease-out"></circle>
                        );
                    })}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-xs font-black text-white">{picks.length}</span>
                </div>
            </div>

            <SliceLegend slices={slices} maxHeight="max-h-[160px]" nameWidth="max-w-[90px]" />
        </div>
    );
};

const StatTile = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="bg-card border border-slate-800 p-2.5 rounded-xl text-center">
        <p className="text-[8px] text-slate-500 font-bold uppercase mb-0.5">{label}</p>
        {children}
    </div>
);

/** Card de resumo: título da seleção e as médias (score, yield ou market cap, nº de ativos). */
const SummaryCard = ({ picks, assetClass, riskFilter }: { picks: RankingItem[]; assetClass: string; riskFilter: RiskFilter }) => {
    const stats = useMemo(() => pickStats(picks), [picks]);
    const isCrypto = assetClass === 'CRYPTO';
    const title = assetClass === 'BRASIL_10' ? 'TOP 10 BRASIL' : assetClass.replace('_', ' ');
    return (
        <div className="lg:col-span-4 bg-base border border-slate-800 rounded-3xl p-6 relative overflow-hidden flex flex-col justify-between shadow-2xl min-h-[240px]">
            <div className="absolute top-0 right-0 p-6 opacity-5 pointer-events-none">
                <Trophy size={120} className="text-white" />
            </div>
            <div>
                <div className="flex items-center gap-3 mb-2">
                    <div className="w-8 h-8 bg-blue-600/20 rounded-lg flex items-center justify-center border border-blue-600/30">
                        <BarChart2 size={16} className="text-blue-500" />
                    </div>
                    <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest bg-blue-900/10 px-2 py-0.5 rounded border border-blue-900/20">
                        Vértice Quant 2.0
                    </span>
                </div>
                <h2 className="text-xl font-black text-white tracking-tight uppercase leading-none truncate" title={title}>
                    {title}
                </h2>
                <span className="text-sm text-slate-500 font-medium normal-case block mt-1">{RISK_LABELS[riskFilter]} Selection</span>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-4">
                <StatTile label="Score">
                    <p className={`text-sm font-black ${scoreTextColor(stats.avgScore)}`}>{stats.avgScore}</p>
                </StatTile>
                <StatTile label={isCrypto ? 'Avg Cap' : 'Yield 12m'}>
                    <p className="text-sm font-black text-emerald-400">{isCrypto ? cryptoAvgCapText(picks) : `${stats.avgDy}%`}</p>
                </StatTile>
                <StatTile label="Ativos">
                    <p className="text-sm font-black text-white">{stats.count}</p>
                </StatTile>
            </div>
        </div>
    );
};

interface TopPicksOverviewProps {
    picks: RankingItem[];
    buyPicks: RankingItem[];
    assetClass: string;
    riskFilter: RiskFilter;
}

/** Grade 4-4-4: resumo da seleção, alocação do usuário e exposição ideal (só COMPRAR). */
export const TopPicksOverview = ({ picks, buyPicks, assetClass, riskFilter }: TopPicksOverviewProps) => (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <SummaryCard picks={picks} assetClass={assetClass} riskFilter={riskFilter} />

        <div className="lg:col-span-4 bg-base border border-slate-800 rounded-3xl p-5 flex flex-col relative overflow-hidden min-h-[240px]">
            <div className="flex items-center gap-2 mb-4 relative z-10 shrink-0 border-b border-slate-800/50 pb-2">
                <Wallet size={14} className="text-emerald-500" />
                <h3 className="text-[10px] font-black text-white uppercase tracking-widest">Minha Alocação</h3>
            </div>
            <div className="flex-1 flex flex-col justify-center relative z-10">
                <UserWalletSectorChart assetClass={assetClass} />
            </div>
        </div>

        <div className="lg:col-span-4 bg-base border border-slate-800 rounded-3xl p-5 flex flex-col relative overflow-hidden min-h-[240px]">
            <div className="flex items-center justify-between gap-2 mb-4 relative z-10 shrink-0 border-b border-slate-800/50 pb-2">
                <div className="flex items-center gap-2 min-w-0">
                    <PieChart size={14} className="text-purple-500 shrink-0" />
                    <h3 className="text-[10px] font-black text-white uppercase tracking-widest truncate">Exposição Ideal</h3>
                </div>
                {/* Deixa explícito que a alocação-alvo desconsidera os AGUARDAR. */}
                <span
                    title="A carteira ideal considera apenas os ativos COMPRAR; os AGUARDAR ficam de fora."
                    className="text-[8px] font-black text-emerald-400 bg-emerald-900/10 px-1.5 py-0.5 rounded border border-emerald-900/20 uppercase tracking-wider whitespace-nowrap shrink-0"
                >
                    Só COMPRAR
                </span>
            </div>
            <div className="flex-1 flex flex-col justify-center relative z-10">
                <SectorDistribution picks={buyPicks} />
            </div>
            <div className="absolute -bottom-10 -right-10 w-32 h-32 bg-purple-900/10 rounded-full blur-[50px]"></div>
        </div>
    </div>
);
