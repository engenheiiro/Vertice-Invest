
import React, { useState, useMemo, useId } from 'react';
import { createPortal } from 'react-dom';
import { X, Calculator, Search, List, Activity, DollarSign, Shield, Target, Zap, Filter, RefreshCw } from 'lucide-react';
import { ResearchReport, RankingItem } from '../../services/research';
import {
    AuditViewMode, RiskProfileFilter, selectAuditItems, formatAuditCurrency, formatAuditDy, formatAuditRatio, displayProfile,
    riskColorClass, scoreBadgeClass, actionBadgeClass, gradeRingClass, gradeLetter, verdictText, structuralDisplay,
    splitAuditLog, toggleClass,
} from './auditDetailView';

interface AuditDetailModalProps {
    isOpen: boolean;
    onClose: () => void;
    report: ResearchReport | null;
}

const RiskIcon: React.FC<{ profile: string; size: number }> = ({ profile, size }) => {
    if (profile === 'DEFENSIVE') return <Shield size={size} />;
    if (profile === 'MODERATE') return <Target size={size} />;
    return <Zap size={size} />;
};

const PROFILE_FILTERS: ReadonlyArray<{ key: Exclude<RiskProfileFilter, 'ALL'>; label: string; active: string; idle: string }> = [
    { key: 'DEFENSIVE', label: 'Defensiva', active: 'bg-emerald-900/30 text-emerald-400 border-emerald-500/50', idle: 'hover:border-emerald-900' },
    { key: 'MODERATE', label: 'Moderada', active: 'bg-blue-900/30 text-blue-400 border-blue-500/50', idle: 'hover:border-blue-900' },
    { key: 'BOLD', label: 'Arrojada', active: 'bg-purple-900/30 text-purple-400 border-purple-500/50', idle: 'hover:border-purple-900' },
];

const FILTER_BASE = 'px-3 py-1 rounded border text-[10px] font-bold uppercase transition-all';
const FILTER_IDLE = 'bg-transparent text-slate-500 border-slate-800';
const FILTER_ALL_ACTIVE = 'bg-slate-700 text-white border-slate-600';
const LOG_ROW = 'p-3 rounded-xl flex items-center justify-between transition-all';
const TAB_BASE = 'px-4 py-1.5 rounded-md text-xs font-bold transition-all';
const TAB_ACTIVE = 'bg-blue-600 text-white shadow-md';
const TAB_IDLE = 'text-slate-400 hover:text-white';

const LoadingDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => createPortal(
    <div className="relative z-[100]" role="dialog" aria-modal="true" aria-label="Carregando auditoria">
        <div className="fixed inset-0 bg-black/95 backdrop-blur-md animate-fade-in" role="presentation" onClick={onClose} />
        <div className="fixed inset-0 z-10 flex items-center justify-center p-4">
            <div className="w-full max-w-7xl bg-base border border-slate-700 rounded-3xl flex items-center justify-center h-48 shadow-2xl animate-fade-in">
                <div className="flex flex-col items-center gap-3">
                    <RefreshCw size={22} className="animate-spin text-blue-500" />
                    <p className="text-sm font-bold text-slate-400">Carregando auditoria...</p>
                </div>
            </div>
        </div>
    </div>,
    document.body
);

interface ControlsProps {
    viewMode: AuditViewMode;
    riskFilter: RiskProfileFilter;
    onViewMode: (mode: AuditViewMode) => void;
    onRiskFilter: (filter: RiskProfileFilter) => void;
}

const AuditControls: React.FC<ControlsProps> = ({ viewMode, riskFilter, onViewMode, onRiskFilter }) => (
    <div className="bg-panel border-b border-slate-800 p-3 flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex bg-slate-900/50 p-1 rounded-lg border border-slate-800">
            <button
                onClick={() => onViewMode('TOP10')}
                className={`${TAB_BASE} ${toggleClass(viewMode === 'TOP10', TAB_ACTIVE, TAB_IDLE)}`}
            >
                Ranking (Selecionados)
            </button>
            <button
                onClick={() => { onViewMode('FULL'); onRiskFilter('ALL'); }}
                className={`${TAB_BASE} ${toggleClass(viewMode === 'FULL', TAB_ACTIVE, TAB_IDLE)}`}
            >
                Auditoria Completa (Logs)
            </button>
        </div>

        {viewMode === 'TOP10' && (
            <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1">
                    <Filter size={10} /> Filtros:
                </span>
                <button
                    onClick={() => onRiskFilter('ALL')}
                    className={`${FILTER_BASE} ${toggleClass(riskFilter === 'ALL', FILTER_ALL_ACTIVE, `${FILTER_IDLE} hover:border-slate-600`)}`}
                >Todos</button>
                {PROFILE_FILTERS.map(f => (
                    <button
                        key={f.key}
                        onClick={() => onRiskFilter(f.key)}
                        className={`${FILTER_BASE} flex items-center gap-1 ${toggleClass(riskFilter === f.key, f.active, `${FILTER_IDLE} ${f.idle}`)}`}
                    ><RiskIcon profile={f.key} size={8} /> {f.label}</button>
                ))}
            </div>
        )}
    </div>
);

interface RowProps {
    item: RankingItem;
    idx: number;
    isSelected: boolean;
    onSelect: (item: RankingItem) => void;
}

const AuditRow: React.FC<RowProps> = ({ item, idx, isSelected, onSelect }) => {
    const profile = displayProfile(item.riskProfile);
    return (
        <tr
            onClick={() => onSelect(item)}
            className={`hover:bg-slate-900/50 transition-colors cursor-pointer group ${isSelected ? 'bg-blue-600/10 border-l-2 border-l-blue-500' : ''}`}
        >
            {/* Posição real do objeto se existir, senão o índice visual */}
            <td className="p-4 text-center font-bold text-slate-600 group-hover:text-blue-400">
                {item.position || idx + 1}
            </td>
            <td className="p-4">
                <div className="font-black text-white">{item.ticker}</div>
                <div className="text-[9px] text-slate-500 truncate max-w-[80px]">{item.name}</div>
            </td>
            <td className="p-4 text-center">
                <div className={`flex items-center justify-center gap-1 font-bold ${riskColorClass(profile)}`}>
                    <RiskIcon profile={profile} size={10} />
                    {item.riskProfile || '-'}
                </div>
            </td>
            <td className="p-4 text-center">
                <span className={`px-1.5 py-0.5 rounded font-black ${scoreBadgeClass(item.score)}`}>
                    {item.score}
                </span>
            </td>
            <td className="p-4 text-right font-bold text-slate-200">{formatAuditCurrency(item.currentPrice)}</td>
            <td className="p-4 text-right text-emerald-400/80">{formatAuditCurrency(item.metrics?.grahamPrice)}</td>
            <td className="p-4 text-right text-blue-400/80">{formatAuditCurrency(item.metrics?.bazinPrice)}</td>
            <td className="p-4 text-right font-bold text-emerald-500">{formatAuditDy(item.metrics?.dy)}</td>
            <td className="p-4 text-right text-slate-400">{formatAuditRatio(item.metrics?.pl, 1)}</td>
            <td className="p-4 text-right text-slate-400">{formatAuditRatio(item.metrics?.pvp, 2)}</td>
            <td className="p-4 text-center">
                <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded ${actionBadgeClass(item.action)}`}>{item.action}</span>
            </td>
        </tr>
    );
};

const TABLE_HEADERS: ReadonlyArray<[string, string]> = [
    ['#', 'p-4 w-12 text-center'], ['Ativo', 'p-4'], ['Perfil', 'p-4 text-center'], ['Score', 'p-4 text-center'],
    ['Preço Atual', 'p-4 text-right'], ['Graham (VI)', 'p-4 text-right'], ['Bazin (Teto)', 'p-4 text-right'],
    ['DY %', 'p-4 text-right'], ['P/L', 'p-4 text-right'], ['P/VP', 'p-4 text-right'], ['Ação', 'p-4 text-center'],
];

const GradeCard: React.FC<{ score: number }> = ({ score }) => (
    <div className="bg-card rounded-2xl p-6 border border-slate-700 relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-4">
            <div
                className={'w-16 h-16 rounded-full border-4 flex items-center justify-center font-black text-2xl rotate-12 shadow-2xl '
                    + `transition-transform group-hover:scale-110 ${gradeRingClass(score)}`}
            >
                {gradeLetter(score)}
            </div>
        </div>

        <div className="relative z-10">
            <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-4">Resultado da Avaliação</h4>
            <div className="flex items-baseline gap-2">
                <span className="text-5xl font-black text-white">{score}</span>
                <span className="text-slate-500 font-bold">/ 100</span>
            </div>
            <p className="text-xs text-slate-400 mt-2 font-medium">{verdictText(score)}</p>
        </div>
    </div>
);

const StructuralTile: React.FC<{ label: string; value: number | undefined; highClass: string }> = ({ label, value, highClass }) => {
    const view = structuralDisplay(value, highClass);
    return (
        <div className="bg-slate-900/50 p-3 rounded-xl border border-slate-800 text-center">
            <div className="text-[8px] text-slate-500 font-black uppercase mb-1">{label}</div>
            <div className={`text-lg font-black ${view.className}`}>{view.value}</div>
        </div>
    );
};

const AuditLogSection: React.FC<{ log: RankingItem['auditLog'] }> = ({ log }) => {
    const { positives, negatives, isEmpty } = splitAuditLog(log);
    return (
        <div className="space-y-3">
            {positives.length > 0 && (
                <div className="space-y-2">
                    <p className="text-[9px] font-black text-emerald-500 uppercase ml-1 opacity-70">Critérios Atendidos (+)</p>
                    {positives.map((entry, i) => (
                        <div
                            key={`plus-${i}`}
                            className={`bg-emerald-500/5 border border-emerald-500/10 ${LOG_ROW} hover:bg-emerald-500/10`}
                        >
                            <div className="flex flex-col gap-0.5">
                                <span className="text-[7px] font-black text-emerald-600 uppercase tracking-tighter">{entry.category}</span>
                                <span className="text-[11px] text-slate-200 font-semibold italic">"{entry.factor}"</span>
                            </div>
                            <div className="text-[10px] font-black text-emerald-400 whitespace-nowrap ml-4">+{entry.points}</div>
                        </div>
                    ))}
                </div>
            )}

            {negatives.length > 0 && (
                <div className="space-y-2 mt-4">
                    <p className="text-[9px] font-black text-red-500 uppercase ml-1 opacity-70">Falhas e Penalidades (-)</p>
                    {negatives.map((entry, i) => (
                        <div
                            key={`minus-${i}`}
                            className={`bg-red-500/5 border border-red-500/10 ${LOG_ROW} hover:bg-red-500/10`}
                        >
                            <div className="flex flex-col gap-0.5">
                                <span className="text-[7px] font-black text-red-600 uppercase tracking-tighter">{entry.category}</span>
                                <span className="text-[11px] text-slate-300 font-medium">❌ {entry.factor}</span>
                            </div>
                            <div className="text-[10px] font-black text-red-400 whitespace-nowrap ml-4">{entry.points}</div>
                        </div>
                    ))}
                </div>
            )}

            {isEmpty && (
                <div className="text-center py-8 text-slate-600 italic text-xs">
                    Ativo em base histórica. Re-crunch para logs detalhados.
                </div>
            )}
        </div>
    );
};

const DetailPanel: React.FC<{ asset: RankingItem; onClose: () => void }> = ({ asset, onClose }) => (
    <div className="absolute inset-y-0 right-0 w-full md:w-96 bg-card border-l border-slate-700 shadow-2xl animate-slide-in-right z-20 flex flex-col">
        <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-panel">
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-600/20 rounded-xl flex items-center justify-center text-blue-400 border border-blue-500/30 font-black">
                    {asset.ticker.slice(0, 2)}
                </div>
                <div>
                    <h3 className="text-sm font-black text-white uppercase">{asset.ticker}</h3>
                    <p className="text-[10px] text-slate-500 font-bold uppercase">Diário de Auditoria</p>
                </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-full text-slate-500">
                <X size={20} />
            </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
            <GradeCard score={asset.score} />

            <div className="grid grid-cols-3 gap-2">
                <StructuralTile label="Qualidade" value={asset.metrics?.structural?.quality} highClass="text-emerald-400" />
                <StructuralTile label="Valuation" value={asset.metrics?.structural?.valuation} highClass="text-blue-400" />
                <StructuralTile label="Resiliência" value={asset.metrics?.structural?.risk} highClass="text-purple-400" />
            </div>

            <div className="space-y-4">
                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <List size={12} className="text-blue-500" /> Detalhes do Desempenho
                </h4>
                <AuditLogSection log={asset.auditLog} />
            </div>

            <div className="space-y-4">
                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <Activity size={12} className="text-emerald-500" /> Tese de Investimento
                </h4>
                <div className="space-y-2">
                    {asset.bullThesis?.map((t, i) => (
                        <div key={i} className="text-[10px] text-emerald-400/80 bg-emerald-500/5 p-2 rounded-lg border border-emerald-500/10">✓ {t}</div>
                    ))}
                    {asset.bearThesis?.map((t, i) => (
                        <div key={i} className="text-[10px] text-red-400/80 bg-red-500/5 p-2 rounded-lg border border-red-500/10">⚠ {t}</div>
                    ))}
                </div>
            </div>
        </div>

        <div className="p-6 border-t border-slate-800 bg-panel">
            <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-black text-slate-500 uppercase">Score Final</span>
                <span className="text-2xl font-black text-white">{asset.score}</span>
            </div>
            <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 transition-all duration-1000" style={{ width: `${asset.score}%` }} />
            </div>
        </div>
    </div>
);

export const AuditDetailModal: React.FC<AuditDetailModalProps> = ({ isOpen, onClose, report }) => {
    // Hooks incondicionais no topo; retornos antecipados só depois deles.
    const [viewMode, setViewMode] = useState<AuditViewMode>('TOP10');
    const [riskFilter, setRiskFilter] = useState<RiskProfileFilter>('ALL');
    const [selectedAsset, setSelectedAsset] = useState<RankingItem | null>(null);
    const titleId = useId();

    const itemsToShow = useMemo(() => selectAuditItems(report, viewMode, riskFilter), [viewMode, riskFilter, report]);

    if (!isOpen) return null;
    if (!report) return <LoadingDialog onClose={onClose} />;

    return createPortal(
        <div className="relative z-[100]" role="dialog" aria-modal="true" aria-labelledby={titleId}>
            <div className="fixed inset-0 bg-black/95 backdrop-blur-md animate-fade-in" role="presentation" onClick={onClose}></div>

            <div className="fixed inset-0 z-10 overflow-y-auto">
                <div className="flex min-h-full items-center justify-center p-4">
                    <div
                        className={'relative w-full max-w-7xl bg-base border border-slate-700 rounded-3xl overflow-hidden shadow-2xl '
                            + 'animate-fade-in flex flex-col max-h-[95vh]'}
                    >

                        {/* HEADER */}
                        <div className="p-6 border-b border-slate-800 bg-card flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-blue-600/20 rounded-xl flex items-center justify-center text-blue-500 border border-blue-600/30">
                                    <Search size={20} />
                                </div>
                                <div>
                                    <h2 id={titleId} className="text-lg font-black text-white uppercase tracking-tight">Auditoria: {report.assetClass}</h2>
                                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                                        Motor Quant v3 • {itemsToShow.length} Ativos Listados
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={onClose}
                                aria-label="Fechar"
                                className={'min-h-[44px] min-w-[44px] flex items-center justify-center hover:bg-slate-800 rounded-full '
                                    + 'text-slate-500 transition-colors'}
                            >
                                <X size={24} />
                            </button>
                        </div>

                        <AuditControls viewMode={viewMode} riskFilter={riskFilter} onViewMode={setViewMode} onRiskFilter={setRiskFilter} />

                        {/* TABELA */}
                        <div className="p-0 overflow-y-auto custom-scrollbar flex-1 bg-deep">
                            <table className="w-full text-left border-collapse">
                                <thead className="sticky top-0 z-10 bg-card border-b border-slate-800 text-[9px] font-black uppercase text-slate-500">
                                    <tr>
                                        {TABLE_HEADERS.map(([label, className]) => <th key={label} scope="col" className={className}>{label}</th>)}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800/50 text-[11px] font-mono text-slate-300">
                                    {itemsToShow.length === 0 ? (
                                        <tr>
                                            <td colSpan={11} className="p-8 text-center text-slate-500 italic">
                                                Nenhum ativo encontrado com este filtro.
                                            </td>
                                        </tr>
                                    ) : itemsToShow.map((item, idx) => (
                                        <AuditRow
                                            key={idx}
                                            item={item}
                                            idx={idx}
                                            isSelected={selectedAsset?.ticker === item.ticker}
                                            onSelect={setSelectedAsset}
                                        />
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div className="p-4 border-t border-slate-800 bg-card flex gap-6 overflow-x-auto no-scrollbar">
                            <div className="flex items-center gap-2 text-[9px] text-slate-500 shrink-0">
                                <Calculator size={10} className="text-emerald-500" />
                                <span className="font-bold">GRAHAM:</span> <span>Valor Intrínseco (22.5 * LPA * VPA)</span>
                            </div>
                            <div className="flex items-center gap-2 text-[9px] text-slate-500 shrink-0">
                                <DollarSign size={10} className="text-blue-500" />
                                <span className="font-bold">BAZIN:</span> <span>Preço Teto (Div / 6%)</span>
                            </div>
                        </div>

                        {selectedAsset && <DetailPanel asset={selectedAsset} onClose={() => setSelectedAsset(null)} />}
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};
