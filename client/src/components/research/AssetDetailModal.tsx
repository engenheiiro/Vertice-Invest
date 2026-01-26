import React from 'react';
import { createPortal } from 'react-dom';
import { X, Shield, Activity, Target, Zap, TrendingUp, AlertTriangle, AlertOctagon } from 'lucide-react';
import { RankingItem } from '../../services/research';

interface AssetDetailModalProps {
    isOpen: boolean;
    onClose: () => void;
    asset: RankingItem | null;
}

type MetricStatus = 'good' | 'bad' | 'neutral' | 'warning' | 'info';

export const AssetDetailModal: React.FC<AssetDetailModalProps> = ({ isOpen, onClose, asset }) => {
    if (!isOpen || !asset) return null;

    const m = asset.metrics;
    const s = m.structural || { quality: 50, valuation: 50, risk: 50 };
    const isFII = asset.type === 'FII';

    const formatCurrency = (val: number) => 
        new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

    // Helper: Formata valor ou retorna traço se for null/undefined
    const formatValueOrDash = (val: number | null | undefined, suffix: string = '', multiplier: number = 1) => {
        if (val === null || val === undefined) return '-';
        const finalVal = val * multiplier;
        return `${finalVal.toFixed(2)}${suffix}`;
    };

    const getMetricStatus = (key: string, value: number | null | undefined): MetricStatus => {
        if (value === undefined || value === null) return 'neutral';

        switch (key) {
            case 'ROE':
                if (value > 15) return 'good';
                if (value < 5) return 'bad';
                return 'neutral';
            case 'NET_MARGIN':
                if (value > 10) return 'good';
                if (value < 0) return 'bad';
                return 'neutral';
            case 'REVENUE_GROWTH':
                if (value > 0.10) return 'good'; 
                if (value < 0) return 'bad';
                return 'neutral';
            case 'DEBT_EQUITY':
                // Normalizando para escala onde 1.0 ou 100 é o pivot.
                const val = value > 10 ? value / 100 : value; 
                if (val < 1.0) return 'good'; // Baixa alavancagem
                if (val > 2.0) return 'bad';  // Alta alavancagem
                return 'warning';
            case 'CURRENT_RATIO':
                if (value > 1.5) return 'good';
                if (value < 1.0) return 'bad';
                return 'warning';
            case 'ALTMAN':
                if (value > 2.99) return 'good'; 
                if (value < 1.81) return 'bad';  
                return 'warning';
            case 'P_L':
                if (value < 0) return 'bad'; // Prejuízo
                if (value > 0 && value < 15) return 'good'; // Barato
                if (value > 30) return 'warning'; // Caro
                return 'neutral';
            case 'P_VP':
                if (value < 0) return 'bad'; 
                if (value > 0 && value < 1.15) return 'good';
                if (value > 1.30) return 'warning';
                return 'neutral';
            case 'DY':
                if (value > 8) return 'good'; 
                if (value < 4) return 'neutral';
                return 'info';
            default:
                return 'neutral';
        }
    };

    return createPortal(
        <div className="relative z-[100]" role="dialog" aria-modal="true">
            <div className="fixed inset-0 bg-black/90 backdrop-blur-md animate-fade-in" onClick={onClose}></div>

            <div className="fixed inset-0 z-10 overflow-y-auto">
                <div className="flex min-h-full items-center justify-center p-4">
                    <div className="relative w-full max-w-4xl bg-[#080C14] border border-slate-700 rounded-3xl overflow-hidden shadow-2xl animate-fade-in flex flex-col md:flex-row">
                        
                        {/* SIDEBAR */}
                        <div className="w-full md:w-1/3 bg-[#0B101A] border-r border-slate-800 p-8 flex flex-col">
                            <div className="mb-8">
                                <h2 className="text-3xl font-black text-white tracking-tighter mb-1">{asset.ticker}</h2>
                                <p className="text-slate-500 text-sm font-medium">{asset.name}</p>
                                <div className="mt-4 flex items-center gap-2">
                                    <span className={`px-3 py-1 rounded text-xs font-black uppercase ${
                                        asset.action === 'BUY' ? 'bg-emerald-500 text-black' : 
                                        asset.action === 'SELL' ? 'bg-red-500 text-white' : 'bg-slate-700 text-slate-300'
                                    }`}>
                                        {asset.action}
                                    </span>
                                    <span className="text-xs text-slate-400 font-mono">Score: {asset.score}</span>
                                </div>
                            </div>

                            <div className="space-y-6 flex-1">
                                <ScoreBar label={isFII ? "Qualidade (Ativos)" : "Qualidade (Moat)"} value={s.quality} color="bg-blue-500" icon={<Zap size={14} />} />
                                <ScoreBar label="Valuation" value={s.valuation} color="bg-emerald-500" icon={<Target size={14} />} />
                                <ScoreBar label={isFII ? "Segurança (Liquidez)" : "Segurança (Risco)"} value={s.risk} color="bg-purple-500" icon={<Shield size={14} />} />
                            </div>

                            <div className="mt-8 pt-6 border-t border-slate-800">
                                <p className="text-[10px] text-slate-500 uppercase font-bold mb-2">Target Price (Justo)</p>
                                <p className="text-2xl font-mono text-white font-bold">{formatCurrency(asset.targetPrice)}</p>
                                <p className={`text-xs mt-1 ${((asset.targetPrice / asset.currentPrice) - 1) > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                    Upside: {asset.currentPrice > 0 ? (((asset.targetPrice / asset.currentPrice) - 1) * 100).toFixed(1) : '-'}%
                                </p>
                            </div>
                        </div>

                        {/* MAIN CONTENT */}
                        <div className="flex-1 p-8 relative">
                            <button onClick={onClose} className="absolute top-4 right-4 p-2 hover:bg-slate-800 rounded-full text-slate-500 transition-colors">
                                <X size={24} />
                            </button>

                            <div className="mb-8">
                                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                    <Activity size={16} /> Tese de Investimento
                                </h3>
                                <div className="bg-blue-900/10 border border-blue-900/30 p-5 rounded-2xl">
                                    <ul className="space-y-2">
                                        {asset.reason.split('•').map((point, i) => (
                                            <li key={i} className="text-sm text-slate-300 leading-relaxed flex items-start gap-2">
                                                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0"></span>
                                                {point.trim()}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-6">
                                <div>
                                    <h4 className="text-xs font-bold text-slate-500 uppercase mb-3">Eficiência & Retorno</h4>
                                    <div className="space-y-3">
                                        {/* FIIs não têm ROE ou Margem Líquida da mesma forma que Ações */}
                                        {isFII ? (
                                            <>
                                                <DetailRow 
                                                    label="Dividend Yield" 
                                                    value={formatValueOrDash(m.dy, '%', 1)} 
                                                    status={getMetricStatus('DY', m.dy)} 
                                                />
                                                <DetailRow 
                                                    label="P/VP" 
                                                    value={formatValueOrDash(m.pvp)} 
                                                    status={getMetricStatus('P_VP', m.pvp)} 
                                                />
                                                <DetailRow 
                                                    label="Liquidez Média" 
                                                    value={`R$ ${(m.avgLiquidity ? (m.avgLiquidity/1000).toFixed(0) : '0')}k`}
                                                    status='neutral'
                                                />
                                            </>
                                        ) : (
                                            <>
                                                <DetailRow 
                                                    label="ROE (Retorno s/ PL)" 
                                                    value={formatValueOrDash(m.roe, '%', 1)} 
                                                    status={getMetricStatus('ROE', m.roe)} 
                                                />
                                                <DetailRow 
                                                    label="Margem Líquida" 
                                                    value={formatValueOrDash(m.netMargin, '%', 1)} 
                                                    status={getMetricStatus('NET_MARGIN', m.netMargin)} 
                                                />
                                                <DetailRow 
                                                    label="Cresc. Receita" 
                                                    value={formatValueOrDash(m.revenueGrowth, '%', 100)} 
                                                    status={getMetricStatus('REVENUE_GROWTH', m.revenueGrowth)}
                                                />
                                            </>
                                        )}
                                    </div>
                                </div>
                                <div>
                                    <h4 className="text-xs font-bold text-slate-500 uppercase mb-3">Saúde Financeira</h4>
                                    <div className="space-y-3">
                                        {isFII ? (
                                            <div className="p-3 rounded bg-slate-900/50 border border-slate-800 text-xs text-slate-500 text-center">
                                                Fundos Imobiliários não possuem dívida corporativa tradicional. Avaliação baseada em portfólio.
                                            </div>
                                        ) : (
                                            <>
                                                <DetailRow 
                                                    label="Dívida/PL" 
                                                    value={formatValueOrDash(m.debtToEquity, '%', 1)} 
                                                    status={getMetricStatus('DEBT_EQUITY', m.debtToEquity)}
                                                />
                                                <DetailRow 
                                                    label="Liquidez Corr." 
                                                    value={formatValueOrDash(m.currentRatio)} 
                                                    status={getMetricStatus('CURRENT_RATIO', m.currentRatio)}
                                                />
                                                <DetailRow 
                                                    label="Altman Z-Score" 
                                                    value={formatValueOrDash(m.altmanZScore)} 
                                                    status={getMetricStatus('ALTMAN', m.altmanZScore)}
                                                    suffix={m.altmanZScore !== null && m.altmanZScore < 1.8 ? ' (Risco)' : ''}
                                                />
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="mt-8 pt-6 border-t border-slate-800">
                                <h4 className="text-xs font-bold text-slate-500 uppercase mb-3">Valuation Implícito</h4>
                                <div className="grid grid-cols-3 gap-4">
                                    <ValuationBox 
                                        label={isFII ? "P/VP" : "P/L"} 
                                        value={isFII ? formatValueOrDash(m.pvp) : formatValueOrDash(m.pl)} 
                                        status={isFII ? getMetricStatus('P_VP', m.pvp) : getMetricStatus('P_L', m.pl)}
                                    />
                                    <ValuationBox 
                                        label={isFII ? "V. Patrimonial" : "P/VP"} 
                                        value={isFII ? formatCurrency(m.bvps || 0) : formatValueOrDash(m.pvp)} 
                                        status={getMetricStatus('P_VP', m.pvp)}
                                    />
                                    <ValuationBox 
                                        label="Div. Yield (12m)" 
                                        value={formatValueOrDash(m.dy, '%', 1)} 
                                        status={getMetricStatus('DY', m.dy)}
                                        highlight 
                                    />
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

const ScoreBar = ({ label, value, color, icon }: any) => (
    <div>
        <div className="flex justify-between text-xs font-bold text-slate-400 mb-1.5">
            <span className="flex items-center gap-1.5">{icon} {label}</span>
            <span className="text-white">{value}/100</span>
        </div>
        <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
            <div className={`h-full ${color} transition-all duration-1000`} style={{ width: `${value}%` }}></div>
        </div>
    </div>
);

const DetailRow = ({ label, value, status, suffix }: { label: string, value: string, status: MetricStatus, suffix?: string }) => {
    let colorClass = 'text-white';
    
    // Se o valor for '-', a cor deve ser neutra, ignorando o status
    if (value === '-') {
        colorClass = 'text-slate-500';
    } else {
        if (status === 'good') colorClass = 'text-emerald-400';
        else if (status === 'bad') colorClass = 'text-red-500 font-black';
        else if (status === 'warning') colorClass = 'text-yellow-400';
        else if (status === 'info') colorClass = 'text-blue-400';
    }

    return (
        <div className="flex justify-between items-center text-sm border-b border-slate-800/50 pb-2 last:border-0">
            <span className="text-slate-400">{label}</span>
            <span className={`font-mono font-bold flex items-center gap-1 ${colorClass}`}>
                {value !== '-' && status === 'bad' && <AlertTriangle size={12} />}
                {value !== '-' && status === 'warning' && <AlertOctagon size={12} />}
                {value} {suffix}
            </span>
        </div>
    );
};

const ValuationBox = ({ label, value, highlight, status }: { label: string, value: string, highlight?: boolean, status: MetricStatus }) => {
    let borderColor = 'border-slate-800';
    let bgColor = highlight ? 'bg-slate-900/80' : 'bg-slate-900/50';
    let textColor = 'text-white';

    if (value !== '-') {
        if (status === 'good') {
            borderColor = 'border-emerald-500/30';
            textColor = 'text-emerald-400';
            if (highlight) bgColor = 'bg-emerald-900/10';
        } else if (status === 'bad') {
            borderColor = 'border-red-500/30';
            textColor = 'text-red-500';
            if (highlight) bgColor = 'bg-red-900/10';
        }
    } else {
        textColor = 'text-slate-500';
    }

    return (
        <div className={`p-3 rounded-xl border ${borderColor} ${bgColor}`}>
            <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">{label}</p>
            <p className={`text-lg font-mono font-bold ${textColor}`}>{value}</p>
        </div>
    );
};