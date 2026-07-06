
import React, { useState } from 'react';
import { useDashboardData } from '../hooks/useDashboardData';
import { researchService } from '../services/research';
import { Header } from '../components/dashboard/Header';
import { MarketStatusBar } from '../components/dashboard/MarketStatusBar';
import { EquitySummary } from '../components/dashboard/EquitySummary';
import { AssetTable } from '../components/dashboard/AssetTable';
import { AiRadar } from '../components/dashboard/AiRadar';
import { InstantReportModal } from '../components/dashboard/InstantReportModal';
import { useWallet } from '../contexts/WalletContext';
import { useDemo } from '../contexts/DemoContext';
import { Lock, Target } from 'lucide-react';
import { FitText } from '../components/ui';
import { formatCurrency as fmtCurrency } from '../utils/format';
import { friendlyError } from '../utils/errorMessages';
import { useNavigate } from 'react-router-dom';

export const Dashboard = () => {
  const {
      portfolio,
      signals,
      radarMeta,
      dividends,
      dividendGoal,
      marketIndices,
      isLoading,
      isResearchLoading,
      systemHealth
  } = useDashboardData();
  const navigate = useNavigate();
  
  const { isPrivacyMode, kpis } = useWallet();
  const { isDemoMode } = useDemo();

  // Estados do Modal de Relatório
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [reportText, setReportText] = useState('');
  const [reportDate, setReportDate] = useState('');
  const [isReportLoading, setIsReportLoading] = useState(false);

  const formatCurrency = (val: number) => fmtCurrency(val, 'BRL', { privacy: isPrivacyMode });

  const handleGenerateReport = async () => {
      setIsReportModalOpen(true);
      setIsReportLoading(true);
      try {
          const report = await researchService.getLatest('BRASIL_10', 'BUY_HOLD');
          
          if (report && report.content?.morningCall) {
              setReportText(report.content.morningCall);
              setReportDate(new Date(report.date || report.createdAt).toLocaleDateString('pt-BR'));
          } else {
              setReportText("Ainda não há um Morning Call gerado para hoje. Tente novamente mais tarde.");
              setReportDate(new Date().toLocaleDateString('pt-BR'));
          }
      } catch (e) {
          setReportText(friendlyError(e));
      } finally {
          setIsReportLoading(false);
      }
  };

  const displayDividends = dividends > 0 ? dividends : (kpis.projectedDividends || 0);
  const isProjected = dividends === 0 && kpis.projectedDividends > 0;

  return (
    <div className="min-h-screen bg-deep text-white font-sans selection:bg-blue-500/30">
      
      <Header />
      <MarketStatusBar indices={marketIndices} />

      <main id="main-content" tabIndex={-1} className="max-w-[1360px] mx-auto p-4 md:p-6 animate-fade-in relative">
        
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            
            {/* AREA 1: EQUITY & SUMMARY (Col-span-3) */}
            <div className="lg:col-span-3 space-y-6 flex flex-col">
                
                {/* ID para o Tutorial: tour-equity */}
                <div id="tour-equity" className={`transition-opacity duration-500 ${isDemoMode && 'relative z-[100]'}`}>
                    <EquitySummary />
                </div>

                {/* ID para o Tutorial: tour-allocation (A tabela contém info de alocação implícita) */}
                <div id="tour-allocation" className={`flex-1 transition-opacity duration-500 ${isDemoMode && 'relative z-[100]'}`}>
                    <AssetTable items={portfolio} isLoading={isLoading} isResearchLoading={isResearchLoading} />
                </div>
            </div>

            {/* AREA 2: SIDEBAR WIDGETS (Col-span-1) */}
            <div className="space-y-6">
                
                {/* ID para o Tutorial: tour-radar */}
                <div id="tour-radar" className={`transition-opacity duration-500 ${isDemoMode && 'relative z-[100]'}`}>
                    <AiRadar
                        signals={signals}
                        isLoading={isResearchLoading}
                        meta={radarMeta}
                    />
                </div>

                {/* ID para o Tutorial: tour-dividends */}
                <div id="tour-dividends" className={`bg-base border border-slate-800 rounded-2xl p-5 relative overflow-hidden group transition-colors hover:border-slate-700 duration-500 ${isDemoMode && 'relative z-[100] ring-2 ring-[#D4AF37] shadow-[0_0_30px_-5px_rgba(212,175,55,0.3)]'}`}>
                    <div className="absolute right-[-30px] top-[-30px] w-[130px] h-[130px] rounded-full bg-gold/[0.07] blur-[50px] pointer-events-none"></div>
                    <div className="relative z-10">
                        <div className="flex justify-between items-start mb-3">
                            <span className="w-[30px] h-[30px] rounded-[9px] bg-gold/10 text-gold flex items-center justify-center">
                                <Lock size={16} />
                            </span>
                            {isProjected && (
                                <span className="text-[9px] font-bold bg-gold/10 px-2 py-0.5 rounded-full text-gold border border-gold/20">ESTIMATIVA MENSAL</span>
                            )}
                        </div>

                        <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Cofre de Dividendos</h4>
                        {isLoading ? (
                            <div className="h-4 w-32 bg-slate-800 rounded animate-pulse mt-1 mb-4"></div>
                        ) : (
                            <div className="mb-4">
                                <FitText className="font-extrabold tracking-tight text-white" max={24} min={14}>
                                    {formatCurrency(displayDividends)}
                                </FitText>
                                <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                                    {isProjected ? 'Fluxo mensal estimado' : 'Provisões confirmadas'}
                                </p>
                            </div>
                        )}
                        {dividendGoal && dividendGoal.target > 0 ? (
                            <>
                                <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-gold shadow-[0_0_10px_rgba(212,175,55,0.5)]"
                                        style={{ width: `${Math.min(100, dividendGoal.progressPercent ?? 0)}%` }}
                                    ></div>
                                </div>
                                <p className="text-[10px] text-slate-500 mt-2">
                                    {Math.round(dividendGoal.progressPercent ?? 0)}% de {formatCurrency(dividendGoal.target)}/mês
                                </p>
                            </>
                        ) : (
                            <button
                                onClick={() => navigate('/wallet')}
                                className="flex items-center gap-1.5 text-[11px] font-semibold text-gold hover:brightness-110 transition-all"
                            >
                                <Target size={12} /> Definir meta de renda passiva
                            </button>
                        )}
                    </div>
                </div>

            </div>
        </div>
      </main>

      <InstantReportModal 
          isOpen={isReportModalOpen} 
          onClose={() => setIsReportModalOpen(false)} 
          isLoading={isReportLoading}
          reportText={reportText}
          date={reportDate}
      />
    </div>
  );
};
