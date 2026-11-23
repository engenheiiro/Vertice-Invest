import React from 'react';
import { Bot, Newspaper, Trophy, Lock, RefreshCcw } from 'lucide-react';
import { RESEARCH_ASSETS } from './researchPageView';

const toggleClass = (active: boolean) => (active ? 'bg-base text-white shadow-sm' : 'text-slate-500 hover:text-slate-300');

interface ResearchToolbarProps {
    planLine: string;
    selectedAsset: string;
    canAccess: (assetId: string) => boolean;
    onSelectAsset: (assetId: string) => void;
    viewMode: 'ANALYSIS' | 'RANKING';
    onViewMode: (mode: 'ANALYSIS' | 'RANKING') => void;
    /** Renda Fixa não tem Top 10/Semanal nem relatório para atualizar. */
    isFixedIncome: boolean;
    isFetching: boolean;
    canRefresh: boolean;
    onRefresh: () => void;
}

const AssetTabs = ({ selectedAsset, canAccess, onSelectAsset }: Pick<ResearchToolbarProps, 'selectedAsset' | 'canAccess' | 'onSelectAsset'>) => (
    <div className="flex bg-deep border border-slate-800 p-1 rounded-xl overflow-x-auto no-scrollbar gap-0.5 shadow-inner w-full md:w-auto">
        {RESEARCH_ASSETS.map(asset => {
            const allowed = canAccess(asset.id);
            return (
                <button
                    key={asset.id}
                    onClick={() => onSelectAsset(asset.id)}
                    className={`px-3 md:px-3.5 py-2 rounded-lg text-xs font-black whitespace-nowrap transition-all flex items-center gap-1.5 ${
                        selectedAsset === asset.id
                            ? `${asset.color} text-white shadow-lg`
                            : 'text-slate-500 hover:text-slate-300'
                    } ${!allowed ? 'opacity-50 grayscale' : ''}`}
                >
                    {asset.label}
                    {!allowed && <Lock size={11} />}
                </button>
            );
        })}
    </div>
);

/** Título, abas de classe, alternância Top 10/Semanal e o botão de atualizar. */
export const ResearchToolbar = ({
    planLine, selectedAsset, canAccess, onSelectAsset, viewMode, onViewMode, isFixedIncome, isFetching, canRefresh, onRefresh,
}: ResearchToolbarProps) => (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 md:mb-12">
        <div className="shrink-0">
            <h1 className="text-2xl md:text-4xl font-black text-white tracking-tighter flex items-center gap-3 md:gap-4">
                <div className="w-10 h-10 md:w-12 md:h-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-600/20 shrink-0">
                    <Bot size={22} className="md:hidden" />
                    <Bot size={28} className="hidden md:block" />
                </div>
                RESEARCH CENTER
            </h1>
            <p className="text-slate-500 text-xs md:text-sm font-medium mt-1 md:mt-2">
                {planLine}
            </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
            <AssetTabs selectedAsset={selectedAsset} canAccess={canAccess} onSelectAsset={onSelectAsset} />

            <div className={`flex bg-deep border border-slate-800 p-1 rounded-xl gap-0.5 shadow-inner shrink-0 ${isFixedIncome ? 'hidden' : ''}`}>
                <button
                    onClick={() => onViewMode('RANKING')}
                    className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-black whitespace-nowrap transition-all ${toggleClass(viewMode === 'RANKING')}`}
                >
                    <Trophy size={14} className="text-yellow-400" /> Top 10
                </button>
                <button
                    onClick={() => onViewMode('ANALYSIS')}
                    className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-black whitespace-nowrap transition-all ${toggleClass(viewMode === 'ANALYSIS')}`}
                >
                    <Newspaper size={14} className="text-blue-400" /> Semanal
                </button>
            </div>

            {!isFixedIncome && (
                <button
                    onClick={onRefresh}
                    disabled={isFetching || !canRefresh}
                    className="bg-base border border-slate-800 p-2.5 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white transition-colors disabled:opacity-50 shrink-0"
                    title="Atualizar Dados"
                    aria-label="Atualizar dados"
                >
                    <RefreshCcw size={16} className={isFetching ? 'animate-spin' : ''} />
                </button>
            )}
        </div>
    </div>
);
