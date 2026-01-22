
import React from 'react';
import { ResearchReport } from '../../services/research';
import { TopPicksCard } from './TopPicksCard';
import { ShieldCheck, Share2, TrendingUp, Zap } from 'lucide-react';

interface ResearchViewerProps {
    report: ResearchReport;
    view: 'ANALYSIS' | 'RANKING';
}

export const ResearchViewer: React.FC<ResearchViewerProps> = ({ report, view }) => {
    
    const formatPremiumText = (text: string) => {
        if (!text) return null;

        const cleanLines = text
            .split('\n')
            .filter(line => line.trim().length > 0);

        return cleanLines.map((line, i) => {
            const trimmed = line.trim();
            const isTitle = trimmed.length < 80 && (trimmed.includes(':') || trimmed.toUpperCase() === trimmed) && !trimmed.endsWith('.');
            
            return (
                <p key={i} className={`mb-6 leading-relaxed ${
                    isTitle 
                    ? 'text-white font-black text-2xl tracking-tight mt-10 mb-4 border-l-4 border-blue-600 pl-4 bg-blue-600/5 py-2' 
                    : 'text-slate-400 text-lg text-justify'
                }`}>
                    {trimmed}
                </p>
            );
        });
    };

    const rankingData = report.content?.ranking || [];

    if (view === 'RANKING') {
        return <TopPicksCard picks={rankingData} assetClass={report.assetClass} />;
    }

    return (
        <div className="max-w-4xl mx-auto animate-fade-in pb-20">
            <div className="bg-[#080C14] border border-slate-800 rounded-3xl overflow-hidden shadow-2xl">
                <div className="h-64 bg-gradient-to-br from-blue-900/40 via-slate-900 to-[#080C14] relative p-10 flex flex-col justify-end border-b border-slate-800/50">
                    <div className="absolute top-0 right-0 p-10 opacity-10">
                        <Zap size={150} className="text-blue-500" />
                    </div>
                    
                    <div className="relative z-10">
                        <div className="flex items-center gap-3 mb-4">
                            <span className="px-3 py-1 rounded bg-blue-600 text-white text-[10px] font-black tracking-widest uppercase">RELATÓRIO INSTITUCIONAL</span>
                            <span className="px-3 py-1 rounded bg-slate-800 text-slate-400 text-[10px] font-bold uppercase tracking-widest border border-slate-700">
                                {report.assetClass}
                            </span>
                        </div>
                        <h1 className="text-5xl font-black text-white tracking-tighter leading-none mb-4">
                            Morning Call <br/> <span className="text-blue-500">Vértice Research</span>
                        </h1>
                    </div>
                </div>

                <div className="p-10 lg:p-14">
                    <div className="p-6 bg-blue-500/5 border border-blue-500/20 rounded-2xl mb-12 flex flex-col sm:flex-row items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-400">
                                <TrendingUp size={24} />
                            </div>
                            <div>
                                <h4 className="text-sm font-bold text-white uppercase tracking-widest">Sentiment Index v4.2</h4>
                                <p className="text-xs text-slate-500">Dados globais processados em tempo real.</p>
                            </div>
                        </div>
                        <div className="text-right shrink-0">
                            <span className="text-[10px] text-slate-500 font-bold uppercase block">Data da Análise</span>
                            <span className="text-xs text-white font-mono">{new Date(report.date || report.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</span>
                        </div>
                    </div>

                    <div className="max-w-none">
                        {formatPremiumText(report.content?.morningCall)}
                    </div>
                </div>

                <div className="bg-[#0B101A] p-8 border-t border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                        <ShieldCheck size={14} className="text-emerald-500" />
                        Verificado por Algoritmo Vértice Sênior
                    </div>
                    <button className="flex items-center gap-2 text-xs font-bold text-blue-500 hover:text-white transition-all bg-blue-500/10 px-4 py-2 rounded-lg border border-blue-500/20">
                        <Share2 size={14} /> Compartilhar
                    </button>
                </div>
            </div>
        </div>
    );
};
