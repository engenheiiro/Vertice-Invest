
import React from 'react';
import { createPortal } from 'react-dom';
import { X, TrendingUp, Target, Shield, AlertTriangle, CheckCircle2, BookOpen } from 'lucide-react';
import { RankingItem } from '../../services/research';

interface AssetDetailModalProps {
    isOpen: boolean;
    onClose: () => void;
    asset: RankingItem | null;
}

export const AssetDetailModal: React.FC<AssetDetailModalProps> = ({ isOpen, onClose, asset }) => {
    if (!isOpen || !asset) return null;

    const details = asset.detailedAnalysis || {
        summary: "Análise detalhada indisponível para este ativo no momento.",
        pros: [],
        cons: [],
        valuationMethod: "Standard Model"
    };

    const formatCurrency = (val: number) => 
        new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

    return createPortal(
        <div className="relative z-[100]" role="dialog" aria-modal="true">
            {/* Backdrop */}
            <div className="fixed inset-0 bg-black/80 backdrop-blur-md transition-opacity animate-fade-in" onClick={onClose}></div>

            {/* Modal */}
            <div className="fixed inset-0 z-10 overflow-y-auto">
                <div className="flex min-h-full items-center justify-center p-4">
                    <div className="relative w-full max-w-2xl transform overflow-hidden rounded-2xl bg-[#080C14] border border-slate-700 shadow-2xl transition-all animate-fade-in">
                        
                        {/* Header */}
                        <div className="relative h-32 bg-gradient-to-r from-slate-900 to-[#0F1729] border-b border-slate-800 p-6 flex flex-col justify-end">
                            <div className="absolute top-0 right-0 p-6">
                                <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors bg-black/20 p-2 rounded-full hover:bg-white/10">
                                    <X size={20} />
                                </button>
                            </div>
                            
                            <div className="flex items-end justify-between">
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <h2 className="text-3xl font-black text-white tracking-tight">{asset.ticker}</h2>
                                        {asset.thesis && (
                                            <span className="px-2 py-0.5 rounded border border-blue-500/30 bg-blue-500/10 text-blue-400 text-[10px] font-bold uppercase tracking-wider">
                                                {asset.thesis}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-sm text-slate-400 font-medium">{asset.name}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-[10px] text-slate-500 uppercase font-bold mb-0.5">Target</p>
                                    <p className="text-2xl font-bold text-emerald-400 font-mono">{formatCurrency(asset.targetPrice)}</p>
                                </div>
                            </div>
                        </div>

                        {/* Body */}
                        <div className="p-6 md:p-8 space-y-8">
                            
                            {/* Score Bar */}
                            <div className="flex items-center gap-4 p-4 bg-slate-900/50 rounded-xl border border-slate-800">
                                <div className="flex-1">
                                    <div className="flex justify-between text-xs font-bold mb-2">
                                        <span className="text-slate-300 flex items-center gap-2"><Target size={14} /> Score de Convicção IA</span>
                                        <span className={asset.score > 80 ? "text-emerald-400" : "text-yellow-400"}>{asset.score}/100</span>
                                    </div>
                                    <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                                        <div 
                                            className={`h-full rounded-full ${asset.score > 80 ? 'bg-emerald-500' : 'bg-yellow-500'}`}
                                            style={{ width: `${asset.score}%` }}
                                        ></div>
                                    </div>
                                </div>
                                <div className="text-right min-w-[80px]">
                                    <span className="text-[10px] text-slate-500 block">Probabilidade</span>
                                    <span className="text-sm font-bold text-white">{asset.probability}%</span>
                                </div>
                            </div>

                            {/* Summary Thesis */}
                            <div>
                                <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
                                    <BookOpen size={16} className="text-blue-500" /> Tese de Investimento
                                </h3>
                                <p className="text-sm text-slate-300 leading-relaxed text-justify">
                                    {details.summary}
                                </p>
                            </div>

                            {/* Pros & Cons Grid */}
                            <div className="grid md:grid-cols-2 gap-6">
                                <div className="bg-emerald-900/10 border border-emerald-900/30 rounded-xl p-4">
                                    <h4 className="text-xs font-bold text-emerald-400 uppercase mb-3 flex items-center gap-2">
                                        <Shield size={14} /> Pontos Fortes (Bull Case)
                                    </h4>
                                    <ul className="space-y-2">
                                        {details.pros?.length > 0 ? details.pros.map((pro, i) => (
                                            <li key={i} className="flex items-start gap-2 text-xs text-slate-300">
                                                <CheckCircle2 size={12} className="text-emerald-500 mt-0.5 shrink-0" />
                                                <span>{pro}</span>
                                            </li>
                                        )) : <li className="text-xs text-slate-500">Nenhum destaque específico.</li>}
                                    </ul>
                                </div>

                                <div className="bg-red-900/10 border border-red-900/30 rounded-xl p-4">
                                    <h4 className="text-xs font-bold text-red-400 uppercase mb-3 flex items-center gap-2">
                                        <AlertTriangle size={14} /> Riscos (Bear Case)
                                    </h4>
                                    <ul className="space-y-2">
                                        {details.cons?.length > 0 ? details.cons.map((con, i) => (
                                            <li key={i} className="flex items-start gap-2 text-xs text-slate-300">
                                                <div className="w-1 h-1 rounded-full bg-red-500 mt-1.5 shrink-0"></div>
                                                <span>{con}</span>
                                            </li>
                                        )) : <li className="text-xs text-slate-500">Sem riscos críticos detectados.</li>}
                                    </ul>
                                </div>
                            </div>

                            {/* Footer Info */}
                            <div className="pt-4 border-t border-slate-800 text-[10px] text-slate-500 flex justify-between">
                                <span>Metodologia: <strong className="text-slate-400">{details.valuationMethod}</strong></span>
                                <span>Ref: Neural Engine v2.4</span>
                            </div>

                        </div>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};
