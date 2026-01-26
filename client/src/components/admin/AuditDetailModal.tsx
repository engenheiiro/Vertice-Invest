import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Calculator, Search, List, Activity, DollarSign, BarChart2 } from 'lucide-react';
import { ResearchReport } from '../../services/research';

interface AuditDetailModalProps {
    isOpen: boolean;
    onClose: () => void;
    report: ResearchReport | null;
}

export const AuditDetailModal: React.FC<AuditDetailModalProps> = ({ isOpen, onClose, report }) => {
    const [viewMode, setViewMode] = useState<'TOP10' | 'FULL'>('TOP10');

    if (!isOpen || !report) return null;

    const formatCurrency = (val: number | undefined | null) => {
        if (val === undefined || val === null || isNaN(val)) return '-';
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
    };

    const itemsToShow = viewMode === 'FULL' 
        ? (report.content.fullAuditLog || report.content.ranking) 
        : report.content.ranking;

    return createPortal(
        <div className="relative z-[100]" role="dialog" aria-modal="true">
            <div className="fixed inset-0 bg-black/95 backdrop-blur-md animate-fade-in" onClick={onClose}></div>
            
            <div className="fixed inset-0 z-10 overflow-y-auto">
                <div className="flex min-h-full items-center justify-center p-4">
                    <div className="relative w-full max-w-7xl bg-[#080C14] border border-slate-700 rounded-3xl overflow-hidden shadow-2xl animate-fade-in flex flex-col max-h-[95vh]">
                        
                        <div className="p-6 border-b border-slate-800 bg-[#0B101A] flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-blue-600/20 rounded-xl flex items-center justify-center text-blue-500 border border-blue-600/30">
                                    <Search size={20} />
                                </div>
                                <div>
                                    <h2 className="text-lg font-black text-white uppercase tracking-tight">Auditoria: {report.assetClass}</h2>
                                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                                        Motor Quant v3 • {itemsToShow?.length || 0} Ativos
                                    </p>
                                </div>
                            </div>
                            <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-full text-slate-500 transition-colors">
                                <X size={24} />
                            </button>
                        </div>

                        <div className="bg-[#0F131E] border-b border-slate-800 p-3 flex justify-center gap-2">
                            <button onClick={() => setViewMode('TOP10')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${viewMode === 'TOP10' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>Ranking</button>
                            <button onClick={() => setViewMode('FULL')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${viewMode === 'FULL' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>Auditoria Completa</button>
                        </div>

                        <div className="p-0 overflow-y-auto custom-scrollbar flex-1 bg-[#05070A]">
                            <table className="w-full text-left border-collapse">
                                <thead className="sticky top-0 z-10 bg-[#0B101A] border-b border-slate-800 text-[9px] font-black uppercase text-slate-500">
                                    <tr>
                                        <th className="p-4 w-12 text-center">#</th>
                                        <th className="p-4">Ativo</th>
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
                                    {itemsToShow?.map((item, idx) => (
                                        <tr key={idx} className="hover:bg-slate-900/50 transition-colors">
                                            <td className="p-4 text-center font-bold text-slate-600">{idx + 1}</td>
                                            <td className="p-4">
                                                <div className="font-black text-white">{item.ticker}</div>
                                                <div className="text-[9px] text-slate-500 truncate max-w-[80px]">{item.name}</div>
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
                                    ))}
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
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};