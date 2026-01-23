import React from 'react';
import { createPortal } from 'react-dom';
import { X, TrendingUp, Target, Shield, AlertTriangle, CheckCircle2, BarChart3, Info, HeartPulse } from 'lucide-react';
import { RankingItem } from '../../services/research';

interface AssetDetailModalProps {
    isOpen: boolean;
    onClose: () => void;
    asset: RankingItem | null;
}

export const AssetDetailModal: React.FC<AssetDetailModalProps> = ({ isOpen, onClose, asset }) => {
    if (!isOpen || !asset) return null;

    const m = asset.metrics;

    const formatCurrency = (val: number) => 
        new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

    const getAltmanStatus = (z: number) => {
        if (z > 3) return { label: 'Z-SAFE', color: 'text-emerald-400', desc: 'Saúde financeira excelente.' };
        if (z > 1.8) return { label: 'Z-ALERT', color: 'text-yellow-400', desc: 'Saúde estável, mas requer atenção.' };
        return { label: 'Z-DISTRESS', color: 'text-red-400', desc: 'Risco elevado de insolvência.' };
    };

    const altman = getAltmanStatus(m.altmanZScore);

    return createPortal(
        <div className="relative z-[100]" role="dialog" aria-modal="true">
            <div className="fixed inset-0 bg-black/90 backdrop-blur-md animate-fade-in" onClick={onClose}></div>

            <div className="fixed inset-0 z-10 overflow-y-auto">
                <div className="flex min-h-full items-center justify-center p-4">
                    <div className="relative w-full max-w-3xl bg-[#080C14] border border-slate-700 rounded-3xl overflow-hidden shadow-2xl animate-fade-in">
                        
                        {/* Header Técnico */}
                        <div className="p-8 border-b border-slate-800 bg-gradient-to-r from-slate-900 to-[#080C14]">
                            <div className="flex justify-between items-start mb-6">
                                <div>
                                    <div className="flex items-center gap-3 mb-1">
                                        <h2 className="text-4xl font-black text-white">{asset.ticker}</h2>
                                        <span className="px-3 py-1 rounded bg-blue-600 text-white text-[10px] font-black uppercase">
                                            {asset.thesis}
                                        </span>
                                    </div>
                                    <p className="text-slate-500 font-medium">{asset.name}</p>
                                </div>
                                <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-full text-slate-500 transition-colors">
                                    <X size={24} />
                                </button>
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <MetricBox label="Score Vértice" value={`${asset.score}/100`} color="text-blue-400" />
                                <MetricBox label="Prob. Sucesso" value={`${asset.probability}%`} color="text-emerald-400" />
                                <MetricBox label="Alvo Estimado" value={formatCurrency(asset.targetPrice)} />
                                <MetricBox label="Earnings Yield" value={`${m.earningsYield}%`} color={m.earningsYield > 12 ? 'text-emerald-400' : 'text-white'} />
                            </div>
                        </div>

                        {/* Corpo Quantitativo */}
                        <div className="p-8">
                            <div className="grid md:grid-cols-2 gap-8">
                                
                                {/* Coluna 1: Valuation & Solvência */}
                                <div className="space-y-6">
                                    <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                                        <BarChart3 size={14} /> Modelagem de Valor
                                    </h3>
                                    
                                    <div className="p-5 bg-slate-900/50 border border-slate-800 rounded-2xl">
                                        <div className="flex justify-between items-center mb-4">
                                            <span className="text-sm font-bold text-slate-300">Graham Fair Value</span>
                                            <span className="text-lg font-mono font-bold text-emerald-400">{formatCurrency(m.grahamPrice)}</span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-sm font-bold text-slate-300">PEG Ratio</span>
                                            <span className={`text-lg font-mono font-bold ${m.pegRatio < 1 ? 'text-emerald-400' : 'text-white'}`}>{m.pegRatio}</span>
                                        </div>
                                        <p className="text-[10px] text-slate-500 mt-4 leading-relaxed">
                                            *PEG Ratio abaixo de 1.0 indica crescimento subavaliado pelo mercado.
                                        </p>
                                    </div>

                                    <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                                        <HeartPulse size={14} /> Análise de Solvência
                                    </h3>
                                    <div className="p-5 bg-slate-900/50 border border-slate-800 rounded-2xl">
                                        <div className="flex items-center justify-between mb-2">
                                            <span className={`text-lg font-black ${altman.color}`}>{altman.label}</span>
                                            <span className="text-sm font-mono text-slate-400">Score: {m.altmanZScore}</span>
                                        </div>
                                        <p className="text-xs text-slate-300">{altman.desc}</p>
                                    </div>
                                </div>

                                {/* Coluna 2: Risco & Eficiência */}
                                <div className="space-y-6">
                                    <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                                        <Shield size={14} /> Eficiência e Risco
                                    </h3>
                                    
                                    <div className="space-y-4">
                                        <SimpleMetric label="Sharpe Ratio (Eficiência)" value={m.sharpeRatio} sub="Retorno p/ risco" />
                                        <SimpleMetric label="ROE (Rentabilidade)" value={`${m.roe}%`} sub="Retorno s/ Patrimônio" />
                                        <SimpleMetric label="Dividend Yield" value={`${m.dy}%`} sub="Proventos 12m" />
                                        <SimpleMetric label="P/L" value={m.pl} sub="Preço s/ Lucro" />
                                    </div>

                                    <div className="bg-blue-900/10 border border-blue-900/20 p-4 rounded-xl">
                                        <div className="flex gap-3">
                                            <Info size={16} className="text-blue-400 shrink-0" />
                                            <p className="text-[10px] text-blue-300 leading-relaxed italic">
                                                "O modelo quantitativo Vértice integra fundamentos clássicos com algoritmos de risco para mitigar armadilhas de valor (Value Traps)."
                                            </p>
                                        </div>
                                    </div>
                                </div>

                            </div>
                        </div>

                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};

const MetricBox = ({ label, value, color = "text-white" }: any) => (
    <div className="bg-[#0B101A] p-3 rounded-xl border border-slate-800">
        <p className="text-[9px] font-bold text-slate-500 uppercase mb-1">{label}</p>
        <p className={`text-sm font-black font-mono ${color}`}>{value}</p>
    </div>
);

const SimpleMetric = ({ label, value, sub }: any) => (
    <div className="flex items-center justify-between p-3 border-b border-slate-800/50">
        <div>
            <p className="text-xs font-bold text-slate-200">{label}</p>
            <p className="text-[9px] text-slate-500">{sub}</p>
        </div>
        <span className="text-sm font-mono font-bold text-white">{value}</span>
    </div>
);