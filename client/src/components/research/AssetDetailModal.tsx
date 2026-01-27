
import React from 'react';
import { createPortal } from 'react-dom';
import { X, Shield, Activity, Target, Zap, TrendingUp, AlertTriangle, AlertOctagon, ThumbsUp, ThumbsDown, BarChart2, DollarSign, Database } from 'lucide-react';
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
    const type = asset.type || 'STOCK';

    const formatCurrency = (val: number | undefined | null, currency: 'BRL' | 'USD' = 'BRL') => {
        if (val === undefined || val === null || isNaN(val)) return '-';
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency, notation: 'compact' }).format(val);
    };

    const formatMoneyShort = (val: number | undefined | null) => {
        if (!val && val !== 0) return '-';
        if (Math.abs(val) >= 1_000_000_000) return `R$ ${(val / 1_000_000_000).toFixed(1)}B`;
        if (Math.abs(val) >= 1_000_000) return `R$ ${(val / 1_000_000).toFixed(1)}M`;
        return `R$ ${val.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
    };

    const formatPercent = (val: number | undefined | null) => {
        if (val === undefined || val === null) return '-';
        return `${val.toFixed(2)}%`;
    };

    const formatNumber = (val: number | undefined | null) => {
        if (val === undefined || val === null) return '-';
        return val.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
    };

    const getMetricStatus = (key: string, value: number | null | undefined): MetricStatus => {
        if (value === undefined || value === null) return 'neutral';

        switch (key) {
            case 'ROE': return value > 15 ? 'good' : (value < 5 ? 'bad' : 'neutral');
            case 'ROIC': return value > 12 ? 'good' : (value < 5 ? 'bad' : 'neutral');
            case 'NET_MARGIN': return value > 10 ? 'good' : (value < 0 ? 'bad' : 'neutral');
            case 'DEBT_EQUITY': 
                const val = value > 10 ? value / 100 : value; 
                return val < 1.0 ? 'good' : (val > 2.0 ? 'bad' : 'warning');
            case 'P_VP': return (value > 0 && value < 1.15) ? 'good' : (value > 1.3 ? 'warning' : 'neutral');
            case 'DY': return value > 8 ? 'good' : (value < 4 ? 'neutral' : 'info');
            case 'VACANCY': return value > 15 ? 'bad' : (value < 5 ? 'good' : 'warning');
            case 'CAP_RATE': return value > 8 ? 'good' : (value < 6 ? 'warning' : 'neutral');
            case 'FFO_YIELD': return value > 8 ? 'good' : (value < 6 ? 'warning' : 'neutral');
            case 'EV_EBITDA': return (value > 0 && value < 8) ? 'good' : (value > 15 ? 'warning' : 'neutral');
            default: return 'neutral';
        }
    };

    const renderMetricsByType = () => {
        if (type === 'FII') {
            return (
                <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                    <DetailRow label="Dividend Yield (12m)" value={formatPercent(m.dy)} status={getMetricStatus('DY', m.dy)} />
                    <DetailRow label="P/VP" value={formatNumber(m.pvp)} status={getMetricStatus('P_VP', m.pvp)} />
                    <DetailRow label="Vacância Física" value={formatPercent(m.vacancy)} status={getMetricStatus('VACANCY', m.vacancy)} />
                    <DetailRow label="Cap Rate Impl." value={formatPercent(m.capRate)} status={getMetricStatus('CAP_RATE', m.capRate)} />
                    <DetailRow label="FFO Yield" value={formatPercent(m.ffoYield)} status={getMetricStatus('FFO_YIELD', m.ffoYield)} />
                    <DetailRow label="Qtd. Imóveis" value={formatNumber(m.qtdImoveis)} status='neutral' />
                    <DetailRow label="Valor Patrimonial" value={formatMoneyShort(m.patrimLiq)} status='neutral' />
                    <DetailRow label="Liquidez Diária" value={formatMoneyShort(m.avgLiquidity)} status='neutral' />
                </div>
            );
        } else if (type === 'CRYPTO') {
            return (
                <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                    <DetailRow label="Market Cap" value={formatMoneyShort(m.marketCap || m.mktCap)} status='info' />
                    <DetailRow label="Preço Atual" value={formatCurrency(asset.currentPrice, 'USD')} status='neutral' />
                    <DetailRow label="Liquidez Est." value={formatMoneyShort(m.avgLiquidity)} status='neutral' />
                    <DetailRow label="Score Estrutural" value={asset.score.toString()} status={asset.score > 70 ? 'good' : 'warning'} />
                </div>
            );
        } else {
            // AÇÕES BR e US
            return (
                <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                    <DetailRow label="P/L" value={formatNumber(m.pl)} status='neutral' />
                    <DetailRow label="P/VP" value={formatNumber(m.pvp)} status={getMetricStatus('P_VP', m.pvp)} />
                    <DetailRow label="ROE" value={formatPercent(m.roe)} status={getMetricStatus('ROE', m.roe)} />
                    <DetailRow label="Margem Líquida" value={formatPercent(m.netMargin)} status={getMetricStatus('NET_MARGIN', m.netMargin)} />
                    <DetailRow label="Dívida Líq/PL" value={formatNumber(m.debtToEquity)} status={getMetricStatus('DEBT_EQUITY', m.debtToEquity)} />
                    <DetailRow label="EV/EBITDA" value={formatNumber(m.evEbitda)} status={getMetricStatus('EV_EBITDA', m.evEbitda)} />
                    <DetailRow label="Div. Yield" value={formatPercent(m.dy)} status={getMetricStatus('DY', m.dy)} />
                    <DetailRow label="Cresc. Rec. (5a)" value={formatPercent(m.revenueGrowth || 0)} status={(m.revenueGrowth || 0) > 10 ? 'good' : 'neutral'} />
                </div>
            );
        }
    };

    const renderFinancialData = () => {
        if (type !== 'STOCK' && type !== 'STOCK_US') return null;
        
        return (
            <div className="mb-8 bg-[#0B101A] p-4 rounded-xl border border-slate-800/50">
                <div className="flex items-center gap-2 mb-5 pb-2 border-b border-slate-800">
                    <Database size={16} className="text-blue-500" />
                    <h4 className="text-xs font-bold text-white uppercase tracking-wide">Financials (LTM)</h4>
                </div>
                <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                    <DetailRow label="Valor de Mercado" value={formatMoneyShort(m.marketCap)} status='info' />
                    <DetailRow label="Dívida Líquida" value={formatMoneyShort(m.netDebt)} status={m.netDebt && m.netDebt > (m.marketCap || 0) ? 'warning' : 'neutral'} />
                    <DetailRow label="Receita Líquida" value={formatMoneyShort(m.netRevenue)} status='neutral' />
                    <DetailRow label="Lucro Líquido" value={formatMoneyShort(m.netIncome)} status={m.netIncome && m.netIncome > 0 ? 'good' : 'bad'} />
                    <DetailRow label="Patrimônio Líquido" value={formatMoneyShort(m.patrimLiq)} status='neutral' />
                    <DetailRow label="Ativos Totais" value={formatMoneyShort(m.totalAssets)} status='neutral' />
                </div>
            </div>
        );
    };

    const hasBullThesis = asset.bullThesis && asset.bullThesis.length > 0;
    const hasBearThesis = asset.bearThesis && asset.bearThesis.length > 0;

    return createPortal(
        <div className="relative z-[100]" role="dialog" aria-modal="true">
            <div className="fixed inset-0 bg-black/90 backdrop-blur-md animate-fade-in" onClick={onClose}></div>

            <div className="fixed inset-0 z-10 overflow-y-auto">
                <div className="flex min-h-full items-center justify-center p-4">
                    <div className="relative w-full max-w-5xl bg-[#080C14] border border-slate-700 rounded-3xl overflow-hidden shadow-2xl animate-fade-in flex flex-col md:flex-row max-h-[90vh]">
                        
                        {/* SIDEBAR - IDENTIDADE E SCORES */}
                        <div className="w-full md:w-[320px] bg-[#0B101A] border-r border-slate-800 p-6 flex flex-col overflow-y-auto">
                            <div className="mb-6">
                                <div className="flex items-center gap-2 mb-2">
                                    <span className="text-[10px] font-bold bg-slate-800 text-slate-400 px-2 py-0.5 rounded uppercase">{asset.type}</span>
                                    <span className="text-[10px] font-bold bg-slate-800 text-slate-400 px-2 py-0.5 rounded uppercase">{asset.sector || 'Geral'}</span>
                                </div>
                                <h2 className="text-4xl font-black text-white tracking-tighter mb-1">{asset.ticker}</h2>
                                <p className="text-slate-500 text-sm font-medium leading-tight">{asset.name}</p>
                                
                                <div className="mt-6 p-4 bg-slate-900/50 rounded-xl border border-slate-800 text-center">
                                    <p className="text-[10px] uppercase text-slate-500 font-bold mb-1">Recomendação IA</p>
                                    <div className={`text-xl font-black uppercase ${
                                        asset.action === 'BUY' ? 'text-emerald-500' : 
                                        asset.action === 'SELL' ? 'text-red-500' : 'text-yellow-500'
                                    }`}>
                                        {asset.action === 'BUY' ? 'COMPRA FORTE' : asset.action === 'SELL' ? 'VENDA' : 'AGUARDAR'}
                                    </div>
                                    <div className="h-1 w-20 mx-auto bg-slate-800 rounded-full mt-2 overflow-hidden">
                                        <div className={`h-full ${asset.action === 'BUY' ? 'bg-emerald-500' : 'bg-slate-500'} w-full`}></div>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-5 flex-1">
                                <ScoreBar label="Qualidade" value={s.quality} color="bg-blue-500" icon={<Zap size={14} />} />
                                <ScoreBar label="Valuation" value={s.valuation} color="bg-emerald-500" icon={<Target size={14} />} />
                                <ScoreBar label="Segurança" value={s.risk} color="bg-purple-500" icon={<Shield size={14} />} />
                            </div>

                            <div className="mt-6 pt-6 border-t border-slate-800">
                                <p className="text-[10px] text-slate-500 uppercase font-bold mb-3 flex items-center gap-1"><Target size={12}/> Preço Justo (Estimado)</p>
                                <div className="space-y-3">
                                    <div className="flex justify-between items-center">
                                        <span className="text-xs text-slate-400">Atual</span>
                                        <span className="text-sm font-mono text-white font-bold">{formatCurrency(asset.currentPrice, type === 'CRYPTO' || type === 'STOCK_US' ? 'USD' : 'BRL')}</span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-xs text-slate-400">Teto (Graham/Bazin)</span>
                                        <span className="text-sm font-mono text-emerald-400 font-bold">{formatCurrency(asset.targetPrice, type === 'CRYPTO' || type === 'STOCK_US' ? 'USD' : 'BRL')}</span>
                                    </div>
                                    <div className={`text-right text-xs font-bold ${((asset.targetPrice / asset.currentPrice) - 1) > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                        Upside: {asset.currentPrice > 0 ? (((asset.targetPrice / asset.currentPrice) - 1) * 100).toFixed(1) : '-'}%
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* MAIN CONTENT - SCROLLABLE */}
                        <div className="flex-1 bg-[#080C14] flex flex-col overflow-hidden">
                            <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-[#0B101A]">
                                <h3 className="text-sm font-bold text-white uppercase tracking-widest flex items-center gap-2">
                                    <Activity size={16} className="text-blue-500" /> Dossiê do Investidor
                                </h3>
                                <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-full text-slate-500 transition-colors">
                                    <X size={20} />
                                </button>
                            </div>

                            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                                
                                {/* TESE DE INVESTIMENTO (BULL/BEAR) */}
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10">
                                    {/* BULL CASE */}
                                    <div className="bg-emerald-900/10 border border-emerald-900/30 rounded-2xl p-5 relative overflow-hidden">
                                        <div className="absolute top-0 right-0 p-4 opacity-10">
                                            <ThumbsUp size={60} className="text-emerald-500" />
                                        </div>
                                        <div className="flex items-center gap-2 mb-4 text-emerald-400 relative z-10">
                                            <ThumbsUp size={18} />
                                            <h4 className="text-sm font-black uppercase tracking-wide">Por que Investir?</h4>
                                        </div>
                                        {hasBullThesis ? (
                                            <ul className="space-y-2.5 relative z-10">
                                                {asset.bullThesis!.map((point, i) => (
                                                    <li key={i} className="text-xs text-slate-300 leading-relaxed flex items-start gap-2">
                                                        <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>
                                                        {point}
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <p className="text-xs text-slate-500 italic relative z-10">Aguardando geração de tese positiva pelo algoritmo.</p>
                                        )}
                                    </div>

                                    {/* BEAR CASE */}
                                    <div className="bg-red-900/10 border border-red-900/30 rounded-2xl p-5 relative overflow-hidden">
                                        <div className="absolute top-0 right-0 p-4 opacity-10">
                                            <AlertTriangle size={60} className="text-red-500" />
                                        </div>
                                        <div className="flex items-center gap-2 mb-4 text-red-400 relative z-10">
                                            <AlertTriangle size={18} />
                                            <h4 className="text-sm font-black uppercase tracking-wide">Riscos & Atenção</h4>
                                        </div>
                                        {hasBearThesis ? (
                                            <ul className="space-y-2.5 relative z-10">
                                                {asset.bearThesis!.map((point, i) => (
                                                    <li key={i} className="text-xs text-slate-300 leading-relaxed flex items-start gap-2">
                                                        <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-red-500 shrink-0"></span>
                                                        {point}
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <p className="text-xs text-slate-500 italic relative z-10">Nenhum risco crítico detectado automaticamente.</p>
                                        )}
                                    </div>
                                </div>

                                {/* FUNDAMENTOS & DATA */}
                                <div className="mb-8">
                                    <div className="flex items-center gap-2 mb-5 pb-2 border-b border-slate-800">
                                        <BarChart2 size={18} className="text-blue-500" />
                                        <h4 className="text-sm font-bold text-white uppercase tracking-wide">Quadro de Indicadores</h4>
                                    </div>
                                    {renderMetricsByType()}
                                </div>

                                {/* DADOS FINANCEIROS ENRIQUECIDOS */}
                                {renderFinancialData()}

                                {/* FOOTER INFO */}
                                <div className="bg-slate-900/30 p-4 rounded-xl border border-slate-800/50 flex items-start gap-3">
                                    <div className="p-2 bg-slate-800 rounded-lg text-blue-400">
                                        <Activity size={16} />
                                    </div>
                                    <div>
                                        <h5 className="text-xs font-bold text-white mb-1">Tese Algorítmica Vértice</h5>
                                        <p className="text-[11px] text-slate-400 leading-relaxed">
                                            {asset.reason || "Análise baseada em fluxo de caixa descontado, múltiplos históricos e eficiência operacional comparativa."}
                                        </p>
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

const ScoreBar = ({ label, value, color, icon }: any) => (
    <div>
        <div className="flex justify-between text-xs font-bold text-slate-400 mb-1.5">
            <span className="flex items-center gap-1.5">{icon} {label}</span>
            <span className="text-white">{value}/100</span>
        </div>
        <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
            <div className={`h-full ${color} transition-all duration-1000`} style={{ width: `${value}%` }}></div>
        </div>
    </div>
);

const DetailRow = ({ label, value, status }: { label: string, value: string, status: MetricStatus }) => {
    let colorClass = 'text-white';
    
    if (value === '-') {
        colorClass = 'text-slate-500';
    } else {
        if (status === 'good') colorClass = 'text-emerald-400';
        else if (status === 'bad') colorClass = 'text-red-500 font-black';
        else if (status === 'warning') colorClass = 'text-yellow-400';
        else if (status === 'info') colorClass = 'text-blue-400';
    }

    return (
        <div className="flex justify-between items-center text-xs border-b border-slate-800/50 pb-2 last:border-0 group hover:bg-slate-800/20 px-2 rounded transition-colors">
            <span className="text-slate-400 font-medium group-hover:text-slate-200">{label}</span>
            <span className={`font-mono font-bold flex items-center gap-1 ${colorClass}`}>
                {value !== '-' && status === 'bad' && <AlertTriangle size={10} />}
                {value !== '-' && status === 'warning' && <AlertOctagon size={10} />}
                {value}
            </span>
        </div>
    );
};
