import React from 'react';
import { Bot, Crown, Info } from 'lucide-react';
import type { ResearchReport } from '../../services/research';
import { SkeletonCard, SkeletonTableRows } from '../ui';
import { ExplainableAIRenderer } from './ExplainableAIRenderer';
import { pickAnalysisText, type AnalysisProfile } from './researchPageView';

export const ResearchLoading = () => (
    <div className="space-y-4 animate-fade-in" aria-busy="true" aria-label="Carregando análise Vértice">
        <SkeletonCard className="h-28" />
        <div className="bg-card border border-slate-800 rounded-2xl p-5">
            <SkeletonTableRows rows={6} />
        </div>
    </div>
);

export const ResearchLocked = ({ planLabel, assetLabel, onUpgrade }: { planLabel: string; assetLabel?: string; onUpgrade: () => void }) => (
    <div className="flex flex-col items-center justify-center py-20 bg-base border border-slate-800 rounded-3xl p-10 text-center">
        <Crown size={40} className="text-blue-500 mb-6" />
        <h2 className="text-2xl font-black text-white mb-3">Conteúdo Exclusivo {planLabel}</h2>
        <p className="text-slate-400 max-w-sm mb-8">
            A análise estratégica de {assetLabel} é reservada para assinantes do plano {planLabel} ou superior.
        </p>
        <button onClick={onUpgrade} className="px-8 py-3 bg-blue-600 text-white font-black rounded-xl hover:bg-blue-700 transition-colors shadow-lg shadow-blue-900/20">
            Fazer Upgrade
        </button>
    </div>
);

/** Caixa tracejada de "ainda não há nada aqui" (relatório ausente ou não publicado). */
export const ResearchNotice = ({ title, text }: { title: string; text: string }) => (
    <div className="flex flex-col items-center justify-center py-20 bg-base border border-dashed border-slate-800 rounded-3xl text-center">
        <Info size={48} className="text-slate-700 mb-4" />
        <h3 className="text-xl font-black text-slate-500 uppercase">{title}</h3>
        <p className="text-slate-600 text-sm mt-2 max-w-sm">{text}</p>
    </div>
);

interface WeeklyAnalysisProps {
    report: ResearchReport;
    profile: AnalysisProfile;
    onProfile: (profile: AnalysisProfile) => void;
}

/** Aba "Semanal": a narrativa da IA, com seletor quando há texto para mais de um perfil. */
export const ResearchWeeklyAnalysis = ({ report, profile, onProfile }: WeeklyAnalysisProps) => {
    const { profilesWithText, effectiveProfile, activeText } = pickAnalysisText(report, profile);
    return (
        <div className="animate-fade-in space-y-8 pb-20">
            {report.isExplainableAIPublished && activeText ? (
                <div className="bg-base border border-indigo-900/30 rounded-3xl overflow-hidden shadow-xl">
                    <div className="p-6 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                        <div>
                            <h2 className="text-lg font-black text-white flex items-center gap-3">
                                <Bot size={20} className="text-indigo-400" />
                                Análise Explainable IA
                            </h2>
                            <p className="text-slate-500 text-xs mt-1">Gerado por inteligência artificial com base nos dados quantitativos</p>
                        </div>
                        {profilesWithText.length > 1 && (
                            <div className="flex bg-base border border-slate-800 p-1 rounded-xl gap-1 shrink-0">
                                {profilesWithText.map(p => (
                                    <button
                                        key={p.id}
                                        onClick={() => onProfile(p.id)}
                                        className={`px-4 py-1.5 rounded-lg text-xs font-black transition-all ${
                                            effectiveProfile === p.id ? 'bg-indigo-900/40 text-indigo-300' : 'text-slate-500 hover:text-slate-300'
                                        }`}
                                    >
                                        {p.label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="p-6">
                        <ExplainableAIRenderer text={activeText} />
                    </div>
                </div>
            ) : null}

            {!report.isExplainableAIPublished && (
                <ResearchNotice title="Relatório ainda não publicado" text="O admin ainda não publicou o relatório semanal desta categoria." />
            )}
        </div>
    );
};
