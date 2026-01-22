
import React from 'react';
import { ResearchReport } from '../../services/research';
import { TopPicksCard } from './TopPicksCard';
import { ShieldCheck, Share2, Zap, AlignLeft } from 'lucide-react';

interface ResearchViewerProps {
    report: ResearchReport;
    view: 'ANALYSIS' | 'RANKING';
}

export const ResearchViewer: React.FC<ResearchViewerProps> = ({ report, view }) => {
    
    // Renderizador seguro de Markdown Básico
    const renderMarkdown = (text: string) => {
        if (!text) return null;

        return text.split('\n').map((line, index) => {
            const trimmed = line.trim();
            if (!trimmed) return <div key={index} className="h-4"></div>;

            // Headers
            if (trimmed.startsWith('###') || (trimmed === trimmed.toUpperCase() && trimmed.length < 50 && !trimmed.includes('**'))) {
                return (
                    <h3 key={index} className="text-xl font-bold text-white mt-8 mb-3 border-l-4 border-blue-500 pl-3">
                        {trimmed.replace(/###/g, '').trim()}
                    </h3>
                );
            }

            // List Items
            if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
                const content = trimmed.substring(2);
                return (
                    <div key={index} className="flex gap-3 mb-2 ml-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-2 shrink-0"></div>
                        <p className="text-slate-300 text-base leading-relaxed">
                            {parseBold(content)}
                        </p>
                    </div>
                );
            }

            // Paragraphs
            return (
                <p key={index} className="text-slate-400 text-base leading-relaxed mb-4 text-justify">
                    {parseBold(trimmed)}
                </p>
            );
        });
    };

    // Helper para processar negrito
    const parseBold = (text: string) => {
        const parts = text.split(/(\*\*.*?\*\*)/g);
        return parts.map((part, i) => {
            if (part.startsWith('**') && part.endsWith('**')) {
                return <strong key={i} className="text-white font-bold">{part.slice(2, -2)}</strong>;
            }
            return part;
        });
    };

    if (view === 'RANKING') {
        return <TopPicksCard picks={report.content?.ranking || []} assetClass={report.assetClass} />;
    }

    return (
        <div className="max-w-4xl mx-auto animate-fade-in pb-20">
            <div className="bg-[#080C14] border border-slate-800 rounded-3xl overflow-hidden shadow-2xl relative">
                
                {/* Header Decorativo */}
                <div className="h-48 bg-gradient-to-r from-blue-900/20 to-[#080C14] border-b border-slate-800/50 p-8 flex flex-col justify-end relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-8 opacity-5 transform rotate-12">
                        <AlignLeft size={180} className="text-white" />
                    </div>
                    <div className="relative z-10">
                        <div className="flex items-center gap-2 mb-2">
                            <span className="px-2 py-0.5 rounded bg-blue-600/20 text-blue-400 text-[10px] font-black tracking-widest uppercase border border-blue-600/30">
                                {report.assetClass}
                            </span>
                            <span className="text-[10px] text-slate-500 font-bold uppercase">
                                {new Date(report.date || report.createdAt).toLocaleDateString('pt-BR', { dateStyle: 'long' })}
                            </span>
                        </div>
                        <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight">
                            Morning Call
                        </h1>
                    </div>
                </div>

                <div className="p-8 md:p-12">
                    <div className="flex items-start gap-4 mb-10 p-4 bg-slate-900/50 rounded-xl border border-slate-800">
                        <Zap className="text-yellow-400 shrink-0 mt-1" size={20} />
                        <div>
                            <h4 className="text-sm font-bold text-white uppercase tracking-wide">Insight Rápido</h4>
                            <p className="text-xs text-slate-400 mt-1">
                                Análise processada com base em dados de fechamento, volume e indicadores técnicos de momento.
                            </p>
                        </div>
                    </div>

                    <div className="prose prose-invert max-w-none">
                        {renderMarkdown(report.content?.morningCall)}
                    </div>
                </div>

                <div className="bg-[#0B101A] p-6 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="flex items-center gap-2 text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                        <ShieldCheck size={14} className="text-emerald-500" />
                        Verificado por Algoritmo Vértice Sênior
                    </div>
                    <button className="flex items-center gap-2 text-xs font-bold text-slate-300 hover:text-white transition-all bg-slate-800 px-4 py-2 rounded-lg border border-slate-700 hover:border-slate-600">
                        <Share2 size={14} /> Exportar PDF
                    </button>
                </div>
            </div>
        </div>
    );
};
