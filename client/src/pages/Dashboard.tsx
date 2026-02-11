
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
import { Lock } from 'lucide-react';

export const Dashboard = () => {
  const { 
      portfolio, 
      signals, 
      dividends, 
      marketIndices, 
      isLoading, 
      isResearchLoading,
      systemHealth // Pegando systemHealth do hook
  } = useDashboardData();
  
  const { isPrivacyMode, kpis } = useWallet();
  const { isDemoMode } = useDemo();

  // Estados do Modal de Relatório
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [reportText, setReportText] = useState('');
  const [reportDate, setReportDate] = useState('');
  const [isReportLoading, setIsReportLoading] = useState(false);

  const formatCurrency = (val: number) => {
      if (isPrivacyMode) return 'R$ ••••••••';
      return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
  };

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
          setReportText("Erro ao conectar com o Neural Engine.");
      } finally {
          setIsReportLoading(false);
      }
  };

  const displayDividends = dividends > 0 ? dividends : (kpis.projectedDividends || 0);
  const isProjected = dividends === 0 && kpis.projectedDividends > 0;

  return (
    <div className="min-h-screen bg-[#02040a] text-white font-sans selection:bg-blue-500/30">
      
      <Header />
      <MarketStatusBar indices={marketIndices} />

      <main className="max-w-[1600px] mx-auto p-6 animate-fade-in relative">
        
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
                        lastUpdated={systemHealth?.lastSync} // Passando data de atualização
                    />
                </div>

                {/* ID para o Tutorial: tour-dividends */}
                <div id="tour-dividends" className={`bg-gradient-to-b from-[#0F1729] to-[#080C14] border border-slate-800 rounded-2xl p-5 relative overflow-hidden group transition-opacity duration-500 ${isDemoMode && 'relative z-[100] ring-2 ring-[#D4AF37] shadow-[0_0_30px_-5px_rgba(212,175,55,0.3)]'}`}>
                    <div className="absolute inset-0 bg-blue-600/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                    <div className="relative z-10">
                        <div className="flex justify-between items-start mb-3">
                            <div className="w-8 h-8 bg-blue-900/30 rounded-lg flex items-center justify-center text-blue-400 border border-blue-500/20">
                                <Lock size={16} />
                            </div>
                            {isProjected && (
                                <span className="text-[9px] font-bold bg-slate-800 px-2 py-0.5 rounded text-slate-400 border border-slate-700">ESTIMATIVA MENSAL</span>
                            )}
                        </div>
                        
                        <h4 className="font-bold text-slate-200 text-sm mb-1">Cofre de Dividendos</h4>
                        {isLoading ? (
                            <div className="h-4 w-32 bg-slate-800 rounded animate-pulse mt-1 mb-4"></div>
                        ) : (
                            <p className="text-xs text-slate-500 mb-4 leading-relaxed">
                                {isProjected ? 'Fluxo mensal estimado:' : 'Provisões confirmadas:'} <br/>
                                <span className="text-white font-bold text-lg block mt-1">{formatCurrency(displayDividends)}</span>
                            </p>
                        )}
                        <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-500 w-[65%] shadow-[0_0_10px_rgba(59,130,246,0.5)]"></div>
                        </div>
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
