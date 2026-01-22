import React from 'react';
import { TrendingUp, Minus, Trophy, BadgeAlert, ArrowUpRight, Crown } from 'lucide-react';

interface RankingItem {
    position: number;
    ticker: string;
    name: string;
    type?: string;
    action: 'BUY' | 'SELL' | 'WAIT';
    targetPrice: number;
    score: number;
    reason: string;
}

interface TopPicksCardProps {
    picks: RankingItem[];
    assetClass: string;
}

export const TopPicksCard: React.FC<TopPicksCardProps> = ({ picks, assetClass }) => {
    const formatCurrency = (val: number) => 
        new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

    return (
        <div className="max-w-6xl mx-auto animate-fade-in space-y-10">
            <div className="text-center md:text-left">
                <div className="flex items-center justify-center md:justify-start gap-4 mb-2">
                    <Trophy className="text-[#D4AF37]" size={32} />
                    <h2 className="text-3xl font-black text-white tracking-tighter">
                        RANKING DE ELITE: {assetClass.replace('_', ' ')}
                    </h2>
                </div>
                <p className="text-slate-500 text-sm font-medium">Os 10 ativos com maior assimetria de valor identificados pela Neural Engine.</p>
            </div>

            <div className="grid gap-4">
                {picks.map((pick, idx) => (
                    <div key={idx} className="bg-[#080C14] border border-slate-800 rounded-3xl p-5 md:p-6 flex flex-col md:flex-row items-center gap-6 hover:bg-slate-800/20 transition-all hover:border-slate-600 group relative">
                        
                        {/* Posição com Efeito de Medalha */}
                        <div className="w-16 h-16 shrink-0 flex items-center justify-center relative">
                            {idx < 3 ? (
                                <>
                                    <div className="absolute inset-0 bg-blue-500/20 blur-xl rounded-full group-hover:bg-blue-500/40 transition-all"></div>
                                    <div className={`w-full h-full rounded-2xl flex items-center justify-center font-black text-2xl relative z-10 ${
                                        idx === 0 ? 'bg-gradient-to-br from-[#D4AF37] to-[#8A6D1B] text-black' :
                                        idx === 1 ? 'bg-slate-300 text-slate-900' :
                                        'bg-[#CD7F32] text-white'
                                    }`}>
                                        {idx === 0 && <Crown size={14} className="absolute -top-2 -right-2 text-white fill-current" />}
                                        {idx + 1}º
                                    </div>
                                </>
                            ) : (
                                <div className="text-slate-700 font-black text-3xl">{idx + 1}º</div>
                            )}
                        </div>

                        {/* Dados Ativo */}
                        <div className="flex-1 text-center md:text-left">
                            <div className="flex flex-col md:flex-row items-center gap-3 mb-2">
                                <h4 className="text-2xl font-black text-white tracking-tight">{pick.ticker}</h4>
                                <span className="text-[10px] text-slate-500 font-black uppercase tracking-widest bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
                                    {pick.type || 'ATIVO'}
                                </span>
                                {pick.score >= 95 && (
                                    <span className="text-[9px] font-black text-blue-400 bg-blue-400/10 px-2 py-1 rounded border border-blue-400/20 animate-pulse">ALPHA PICK</span>
                                )}
                            </div>
                            <p className="text-sm text-slate-400 font-medium line-clamp-2 md:line-clamp-1">{pick.reason}</p>
                        </div>

                        {/* Recomendação IA */}
                        <div className="flex flex-row md:flex-col items-center justify-center px-8 border-y md:border-y-0 md:border-x border-slate-800/50 py-4 md:py-0 gap-8 md:gap-1">
                            <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Ação Sugerida</span>
                            <div className={`flex items-center gap-2 text-xs font-black px-4 py-1.5 rounded-xl border ${
                                pick.action === 'BUY' 
                                ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20 shadow-lg shadow-emerald-500/5' 
                                : 'bg-slate-800 text-slate-400 border-slate-700'
                            }`}>
                                {pick.action === 'BUY' ? <TrendingUp size={14} /> : <Minus size={14} />}
                                {pick.action === 'BUY' ? 'COMPRAR AGORA' : 'AGUARDAR'}
                            </div>
                        </div>

                        {/* Target & Score */}
                        <div className="flex items-center gap-8 md:gap-12 min-w-[180px] justify-center md:justify-end">
                            <div className="text-right">
                                <span className="text-[10px] font-black text-slate-600 uppercase block mb-1">Preço Alvo</span>
                                <span className="text-xl font-black text-emerald-400 font-mono flex items-center justify-end gap-1">
                                    {formatCurrency(pick.targetPrice)}
                                    <ArrowUpRight size={18} />
                                </span>
                            </div>
                            <div className="text-right">
                                <span className="text-[10px] font-black text-slate-600 uppercase block mb-1">Score IA</span>
                                <div className="text-2xl font-black text-blue-500 font-mono">{pick.score}</div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Disclaimer */}
            <div className="p-6 bg-slate-900/30 border border-slate-800 rounded-3xl flex items-start gap-4">
                <BadgeAlert size={24} className="text-blue-500 shrink-0 mt-1" />
                <div className="space-y-2">
                    <p className="text-xs text-slate-500 font-medium leading-relaxed">
                        Este ranking é gerado por algoritmos proprietários de Machine Learning. <strong>Investir envolve riscos.</strong> Os preços alvos são projeções matemáticas e não garantias de retorno. Mantenha seu stop-loss ativo e siga sua estratégia de risco.
                    </p>
                    <p className="text-[10px] text-slate-600 uppercase font-black">Próxima Atualização: AMANHÃ ÀS 08:30 AM</p>
                </div>
            </div>
        </div>
    );
};