import React from 'react';
import { Lock } from 'lucide-react';
import { useDashboardData } from '../hooks/useDashboardData';
import { Header } from '../components/dashboard/Header';
import { MarketStatusBar } from '../components/dashboard/MarketStatusBar';
import { EquitySummary } from '../components/dashboard/EquitySummary';
import { AssetTable } from '../components/dashboard/AssetTable';
import { AiRadar } from '../components/dashboard/AiRadar';

export const Dashboard = () => {
  const { portfolio, signals, equity, marketIndices } = useDashboardData();

  return (
    <div className="min-h-screen bg-[#02040a] text-white font-sans selection:bg-blue-500/30">
      
      {/* Componente Header */}
      <Header />

      {/* Barra de Mercado (Novo Elemento Pro) */}
      <MarketStatusBar indices={marketIndices} />

      {/* --- MAIN TERMINAL GRID --- */}
      <main className="max-w-[1600px] mx-auto p-6 animate-fade-in">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            
            {/* AREA 1: EQUITY & SUMMARY (Col-span-3) */}
            <div className="lg:col-span-3 space-y-6 flex flex-col">
                
                {/* Widgets de Patrimônio */}
                <EquitySummary data={equity} />

                {/* Tabela de Ativos Inteligente */}
                <div className="flex-1">
                    <AssetTable items={portfolio} />
                </div>
            </div>

            {/* AREA 2: SIDEBAR WIDGETS (Col-span-1) */}
            <div className="space-y-6">
                
                {/* Widget Radar IA */}
                <AiRadar signals={signals} />

                {/* Widget Cofre de Dividendos */}
                <div className="bg-gradient-to-b from-[#0F1729] to-[#080C14] border border-slate-800 rounded-2xl p-5 relative overflow-hidden group">
                    <div className="absolute inset-0 bg-blue-600/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                    <div className="relative z-10">
                        <div className="w-8 h-8 bg-blue-900/30 rounded-lg flex items-center justify-center text-blue-400 mb-3 border border-blue-500/20">
                            <Lock size={16} />
                        </div>
                        <h4 className="font-bold text-slate-200 text-sm mb-1">Cofre de Dividendos</h4>
                        <p className="text-xs text-slate-500 mb-4">Você tem <span className="text-white font-bold">R$ 420,00</span> provisionados para receber esta semana.</p>
                        <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-500 w-[65%] shadow-[0_0_10px_rgba(59,130,246,0.5)]"></div>
                        </div>
                    </div>
                </div>

            </div>
        </div>
      </main>
    </div>
  );
};