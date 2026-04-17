
import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, Calculator, Search, List, Activity, DollarSign, BarChart2, Shield, Target, Zap, Filter } from 'lucide-react';
import { ResearchReport, RankingItem } from '../../services/research';

interface AuditDetailModalProps {
    isOpen: boolean;
    onClose: () => void;
    report: ResearchReport | null;
}

type RiskProfileFilter = 'ALL' | 'DEFENSIVE' | 'MODERATE' | 'BOLD';

export const AuditDetailModal: React.FC<AuditDetailModalProps> = ({ isOpen, onClose, report }) => {
    // 1. Hooks devem ser chamados incondicionalmente no topo
    const [viewMode, setViewMode] = useState<'TOP10' | 'FULL'>('TOP10');
    const [riskFilter, setRiskFilter] = useState<RiskProfileFilter>('ALL');
    const [selectedAsset, setSelectedAsset] = useState<RankingItem | null>(null);

    const itemsToShow = useMemo(() => {
        // Proteção interna
        if (!report) return [];

        let baseList = viewMode === 'FULL' 
            ? (report.content.fullAuditLog || report.content.ranking) 
            : report.content.ranking;

        // Clone para evitar mutação e garantir re-render
        let filtered = [...baseList];

        if (viewMode === 'TOP10' && riskFilter !== 'ALL') {
            filtered = filtered.filter(item => item.riskProfile === riskFilter);
        }

        // Ordenação Global por Score (Expectativa do Usuário: Score Maior = Topo)
        return filtered.sort((a, b) => (b.score || 0) - (a.score || 0));
    }, [viewMode, riskFilter, report]);

    // 2. Retorno antecipado DEPOIS dos hooks
    if (!isOpen || !report) return null;

    // Helpers
    const formatCurrency = (val: number | undefined | null) => {
        if (val === undefined || val === null || isNaN(val)) return '-';
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
    };

    const getRiskColor = (profile: string) => {
        if (profile === 'DEFENSIVE') return 'text-emerald-400';
        if (profile === 'MODERATE') return 'text-blue-400';
        return 'text-purple-400';
    };

    const getRiskIcon = (profile: string) => {
        if (profile === 'DEFENSIVE') return <Shield size={10} />;
        if (profile === 'MODERATE') return <Target size={10} />;
        return <Zap size={10} />;
    };

    return createPortal(
        <div className="relative z-[100]" role="dialog" aria-modal="true">
            <div className="fixed inset-0 bg-black/95 backdrop-blur-md animate-fade-in" onClick={onClose}></div>
            
            <div className="fixed inset-0 z-10 overflow-y-auto">
                <div className="flex min-h-full items-center justify-center p-4">
                    <div className="relative w-full max-w-7xl bg-[#080C14] border border-slate-700 rounded-3xl overflow-hidden shadow-2xl animate-fade-in flex flex-col max-h-[95vh]">
                        
                        {/* HEADER */}
                        <div className="p-6 border-b border-slate-800 bg-[#0B101A] flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-blue-600/20 rounded-xl flex items-center justify-center text-blue-500 border border-blue-600/30">
                                    <Search size={20} />
                                </div>
                                <div>
                                    <h2 className="text-lg font-black text-white uppercase tracking-tight">Auditoria: {report.assetClass}</h2>
                                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                                        Motor Quant v3 • {itemsToShow?.length || 0} Ativos Listados
                                    </p>
                                </div>
                            </div>
                            <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-full text-slate-500 transition-colors">
                                <X size={24} />
                            </button>
                        </div>

                        {/* CONTROLES */}
                        <div className="bg-[#0F131E] border-b border-slate-800 p-3 flex flex-col md:flex-row justify-between items-center gap-4">
                            <div className="flex bg-slate-900/50 p-1 rounded-lg border border-slate-800">
                                <button 
                                    onClick={() => setViewMode('TOP10')} 
                                    className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${viewMode === 'TOP10' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}
                                >
                                    Ranking (Selecionados)
                                </button>
                                <button 
                                    onClick={() => { setViewMode('FULL'); setRiskFilter('ALL'); }} 
                                    className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${viewMode === 'FULL' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}
                                >
                                    Auditoria Completa (Logs)
                                </button>
                            </div>

                            {viewMode === 'TOP10' && (
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1">
                                        <Filter size={10} /> Filtros:
                                    </span>
                                    <button onClick={() => setRiskFilter('ALL')} className={`px-3 py-1 rounded border text-[10px] font-bold uppercase transition-all ${riskFilter === 'ALL' ? 'bg-slate-700 text-white border-slate-600' : 'bg-transparent text-slate-500 border-slate-800 hover:border-slate-600'}`}>Todos</button>
                                    <button onClick={() => setRiskFilter('DEFENSIVE')} className={`px-3 py-1 rounded border text-[10px] font-bold uppercase transition-all flex items-center gap-1 ${riskFilter === 'DEFENSIVE' ? 'bg-emerald-900/30 text-emerald-400 border-emerald-500/50' : 'bg-transparent text-slate-500 border-slate-800 hover:border-emerald-900'}`}><Shield size={8}/> Defensiva</button>
                                    <button onClick={() => setRiskFilter('MODERATE')} className={`px-3 py-1 rounded border text-[10px] font-bold uppercase transition-all flex items-center gap-1 ${riskFilter === 'MODERATE' ? 'bg-blue-900/30 text-blue-400 border-blue-500/50' : 'bg-transparent text-slate-500 border-slate-800 hover:border-blue-900'}`}><Target size={8}/> Moderada</button>
                                    <button onClick={() => setRiskFilter('BOLD')} className={`px-3 py-1 rounded border text-[10px] font-bold uppercase transition-all flex items-center gap-1 ${riskFilter === 'BOLD' ? 'bg-purple-900/30 text-purple-400 border-purple-500/50' : 'bg-transparent text-slate-500 border-slate-800 hover:border-purple-900'}`}><Zap size={8}/> Arrojada</button>
                                </div>
                            )}
                        </div>

                        {/* TABELA */}
                        <div className="p-0 overflow-y-auto custom-scrollbar flex-1 bg-[#05070A]">
                            <table className="w-full text-left border-collapse">
                                <thead className="sticky top-0 z-10 bg-[#0B101A] border-b border-slate-800 text-[9px] font-black uppercase text-slate-500">
                                    <tr>
                                        <th className="p-4 w-12 text-center">#</th>
                                        <th className="p-4">Ativo</th>
                                        <th className="p-4 text-center">Perfil</th>
                                        <th className="p-4 text-center">Score</th>
                                        <th className="p-4 text-right">Preço Atual</th>
                                        <th className="p-4 text-right">Graham (VI)</th>
                                        <th className="p-4 text-right">Bazin (Teto)</th>
                                        <th className="p-4 text-right">DY %</th>
                                        <th className="p-4 text-right">P/L</th>
                                        <th className="p-4 text-right">P/VP</th>
                                        <th className="p-4 text-center">Ação</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800/50 text-[11px] font-mono text-slate-300">
                                    {itemsToShow.length === 0 ? (
                                        <tr>
                                            <td colSpan={11} className="p-8 text-center text-slate-500 italic">
                                                Nenhum ativo encontrado com este filtro.
                                            </td>
                                        </tr>
                                    ) : (
                                        itemsToShow.map((item, idx) => (
                                            <tr 
                                                key={idx} 
                                                onClick={() => setSelectedAsset(item)}
                                                className={`hover:bg-slate-900/50 transition-colors cursor-pointer group ${selectedAsset?.ticker === item.ticker ? 'bg-blue-600/10 border-l-2 border-l-blue-500' : ''}`}
                                            >
                                                {/* CORREÇÃO: Mostra posição real do objeto se existir, senão usa índice visual */}
                                                <td className="p-4 text-center font-bold text-slate-600 group-hover:text-blue-400">
                                                    {item.position || idx + 1}
                                                </td>
                                                <td className="p-4">
                                                    <div className="font-black text-white">{item.ticker}</div>
                                                    <div className="text-[9px] text-slate-500 truncate max-w-[80px]">{item.name}</div>
                                                </td>
                                                <td className="p-4 text-center">
                                                    <div className={`flex items-center justify-center gap-1 font-bold ${getRiskColor(item.riskProfile || 'MODERATE')}`}>
                                                        {getRiskIcon(item.riskProfile || 'MODERATE')}
                                                        {item.riskProfile || '-'}
                                                    </div>
                                                </td>
                                                <td className="p-4 text-center">
                                                    <span className={`px-1.5 py-0.5 rounded font-black ${item.score > 70 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-400'}`}>
                                                        {item.score}
                                                    </span>
                                                </td>
                                                <td className="p-4 text-right font-bold text-slate-200">
                                                    {formatCurrency(item.currentPrice)}
                                                </td>
                                                <td className="p-4 text-right text-emerald-400/80">
                                                    {formatCurrency(item.metrics?.grahamPrice)}
                                                </td>
                                                <td className="p-4 text-right text-blue-400/80">
                                                    {formatCurrency(item.metrics?.bazinPrice)}
                                                </td>
                                                <td className="p-4 text-right font-bold text-emerald-500">
                                                    {item.metrics?.dy ? `${item.metrics.dy.toFixed(1)}%` : '0%'}
                                                </td>
                                                <td className="p-4 text-right text-slate-400">
                                                    {item.metrics?.pl?.toFixed(1) || '-'}
                                                </td>
                                                <td className="p-4 text-right text-slate-400">
                                                    {item.metrics?.pvp?.toFixed(2) || '-'}
                                                </td>
                                                <td className="p-4 text-center">
                                                    <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded ${
                                                        item.action === 'BUY' ? 'bg-emerald-500 text-black' : 
                                                        item.action === 'SELL' ? 'bg-red-500 text-white' : 'bg-slate-700'
                                                    }`}>{item.action}</span>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>

                        <div className="p-4 border-t border-slate-800 bg-[#0B101A] flex gap-6 overflow-x-auto no-scrollbar">
                            <div className="flex items-center gap-2 text-[9px] text-slate-500 shrink-0">
                                <Calculator size={10} className="text-emerald-500" />
                                <span className="font-bold">GRAHAM:</span> <span>Valor Intrínseco (22.5 * LPA * VPA)</span>
                            </div>
                            <div className="flex items-center gap-2 text-[9px] text-slate-500 shrink-0">
                                <DollarSign size={10} className="text-blue-500" />
                                <span className="font-bold">BAZIN:</span> <span>Preço Teto (Div / 6%)</span>
                            </div>
                        </div>

                        {/* PANEL DE DETALHES (AUDIT LOG) */}
                        {selectedAsset && (
                            <div className="absolute inset-y-0 right-0 w-full md:w-96 bg-[#0B101A] border-l border-slate-700 shadow-2xl animate-slide-in-right z-20 flex flex-col">
                                <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-[#0F131E]">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 bg-blue-600/20 rounded-xl flex items-center justify-center text-blue-400 border border-blue-500/30 font-black">
                                            {selectedAsset.ticker.slice(0, 2)}
                                        </div>
                                        <div>
                                            <h3 className="text-sm font-black text-white uppercase">{selectedAsset.ticker}</h3>
                                            <p className="text-[10px] text-slate-500 font-bold uppercase">Diário de Auditoria</p>
                                        </div>
                                    </div>
                                    <button onClick={() => setSelectedAsset(null)} className="p-2 hover:bg-slate-800 rounded-full text-slate-500">
                                        <X size={20} />
                                    </button>
                                </div>

                                <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                                    {/* NOTA FINAL (ESTILO PROVA) */}
                                    <div className="bg-[#0D121F] rounded-2xl p-6 border border-slate-700 relative overflow-hidden group">
                                        <div className="absolute top-0 right-0 p-4">
                                            <div className={`w-16 h-16 rounded-full border-4 flex items-center justify-center font-black text-2xl rotate-12 shadow-2xl transition-transform group-hover:scale-110 ${
                                                selectedAsset.score >= 90 ? 'border-emerald-500 text-emerald-500 bg-emerald-500/10' :
                                                selectedAsset.score >= 80 ? 'border-blue-500 text-blue-500 bg-blue-500/10' :
                                                selectedAsset.score >= 70 ? 'border-slate-400 text-slate-400 bg-slate-400/10' :
                                                'border-red-500 text-red-500 bg-red-500/10'
                                            }`}>
                                                {selectedAsset.score >= 95 ? 'A+' : 
                                                 selectedAsset.score >= 90 ? 'A' :
                                                 selectedAsset.score >= 80 ? 'B+' :
                                                 selectedAsset.score >= 70 ? 'B' :
                                                 selectedAsset.score >= 60 ? 'C' : 'F'}
                                            </div>
                                        </div>

                                        <div className="relative z-10">
                                            <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-4">Resultado da Avaliação</h4>
                                            <div className="flex items-baseline gap-2">
                                                <span className="text-5xl font-black text-white">{selectedAsset.score}</span>
                                                <span className="text-slate-500 font-bold">/ 100</span>
                                            </div>
                                            <p className="text-xs text-slate-400 mt-2 font-medium">
                                                {selectedAsset.score >= 80 ? 'Recomendação Forte para o perfil atual.' :
                                                 selectedAsset.score >= 65 ? 'Ativo com fundamentos sólidos, mas pontuação média.' :
                                                 'Ativo descartado pelo Motor de Decisão por falta de critérios.'}
                                            </p>
                                        </div>
                                    </div>

                                    {/* RESUMO ESTRUTURAL */}
                                    <div className="grid grid-cols-3 gap-2">
                                        <div className="bg-slate-900/50 p-3 rounded-xl border border-slate-800 text-center">
                                            <div className="text-[8px] text-slate-500 font-black uppercase mb-1">Qualidade</div>
                                            <div className={`text-lg font-black ${(selectedAsset.metrics?.structural?.quality || 0) > 70 ? 'text-emerald-400' : 'text-white'}`}>
                                                {selectedAsset.metrics?.structural?.quality || 0}
                                            </div>
                                        </div>
                                        <div className="bg-slate-900/50 p-3 rounded-xl border border-slate-800 text-center">
                                            <div className="text-[8px] text-slate-500 font-black uppercase mb-1">Valuation</div>
                                            <div className={`text-lg font-black ${(selectedAsset.metrics?.structural?.valuation || 0) > 70 ? 'text-blue-400' : 'text-white'}`}>
                                                {selectedAsset.metrics?.structural?.valuation || 0}
                                            </div>
                                        </div>
                                        <div className="bg-slate-900/50 p-3 rounded-xl border border-slate-800 text-center">
                                            <div className="text-[8px] text-slate-500 font-black uppercase mb-1">Resiliência</div>
                                            <div className={`text-lg font-black ${(selectedAsset.metrics?.structural?.risk || 0) > 70 ? 'text-purple-400' : 'text-white'}`}>
                                                {selectedAsset.metrics?.structural?.risk || 0}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Ganhos vs Perdas */}
                                    <div className="space-y-4">
                                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                            <List size={12} className="text-blue-500" /> Detalhes do Desempenho
                                        </h4>
                                        
                                        <div className="space-y-3">
                                            {/* POSITIVOS */}
                                            {selectedAsset.auditLog && selectedAsset.auditLog.filter(l => l.points > 0).length > 0 && (
                                                <div className="space-y-2">
                                                    <p className="text-[9px] font-black text-emerald-500 uppercase ml-1 opacity-70">Critérios Atendidos (+)</p>
                                                    {selectedAsset.auditLog.filter(l => l.points > 0).map((log, i) => (
                                                        <div key={`plus-${i}`} className="bg-emerald-500/5 border border-emerald-500/10 p-3 rounded-xl flex items-center justify-between transition-all hover:bg-emerald-500/10">
                                                            <div className="flex flex-col gap-0.5">
                                                                <span className="text-[7px] font-black text-emerald-600 uppercase tracking-tighter">{log.category}</span>
                                                                <span className="text-[11px] text-slate-200 font-semibold italic">"{log.factor}"</span>
                                                            </div>
                                                            <div className="text-[10px] font-black text-emerald-400 whitespace-nowrap ml-4">
                                                                +{log.points}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            {/* NEGATIVOS */}
                                            {selectedAsset.auditLog && selectedAsset.auditLog.filter(l => l.points < 0).length > 0 && (
                                                <div className="space-y-2 mt-4">
                                                    <p className="text-[9px] font-black text-red-500 uppercase ml-1 opacity-70">Falhas e Penalidades (-)</p>
                                                    {selectedAsset.auditLog.filter(l => l.points < 0).map((log, i) => (
                                                        <div key={`minus-${i}`} className="bg-red-500/5 border border-red-500/10 p-3 rounded-xl flex items-center justify-between transition-all hover:bg-red-500/10">
                                                            <div className="flex flex-col gap-0.5">
                                                                <span className="text-[7px] font-black text-red-600 uppercase tracking-tighter">{log.category}</span>
                                                                <span className="text-[11px] text-slate-300 font-medium">❌ {log.factor}</span>
                                                            </div>
                                                            <div className="text-[10px] font-black text-red-400 whitespace-nowrap ml-4">
                                                                {log.points}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            {(!selectedAsset.auditLog || selectedAsset.auditLog.length === 0) && (
                                                <div className="text-center py-8 text-slate-600 italic text-xs">
                                                    Ativo em base histórica. Re-crunch para logs detalhados.
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* TESES DINÂMICAS */}
                                    <div className="space-y-4">
                                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                            <Activity size={12} className="text-emerald-500" /> Tese de Investimento
                                        </h4>
                                        <div className="space-y-2">
                                            {selectedAsset.bullThesis?.map((t, i) => (
                                                <div key={i} className="text-[10px] text-emerald-400/80 bg-emerald-500/5 p-2 rounded-lg border border-emerald-500/10">
                                                    ✓ {t}
                                                </div>
                                            ))}
                                            {selectedAsset.bearThesis?.map((t, i) => (
                                                <div key={i} className="text-[10px] text-red-400/80 bg-red-500/5 p-2 rounded-lg border border-red-500/10">
                                                    ⚠ {t}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="p-6 border-t border-slate-800 bg-[#0F131E]">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-[10px] font-black text-slate-500 uppercase">Score Final</span>
                                        <span className="text-2xl font-black text-white">{selectedAsset.score}</span>
                                    </div>
                                    <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                                        <div 
                                            className="h-full bg-blue-500 transition-all duration-1000" 
                                            style={{ width: `${selectedAsset.score}%` }}
                                        />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};
