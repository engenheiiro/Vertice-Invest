
import React, { useState } from 'react';
import { Header } from '../components/dashboard/Header';
import { WalletSummary } from '../components/wallet/WalletSummary';
import { AssetList } from '../components/wallet/AssetList';
import { AddAssetModal } from '../components/wallet/AddAssetModal';
import { EvolutionChart } from '../components/wallet/EvolutionChart';
import { AllocationChart } from '../components/wallet/AllocationChart';
import { SmartContributionModal } from '../components/wallet/SmartContributionModal';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { Plus, Download, Lock, Crown, RefreshCw, TrendingUp, PlusCircle, Trash2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useWallet } from '../contexts/WalletContext';
import { useNavigate } from 'react-router-dom';
import { authService } from '../services/auth';

export const Wallet = () => {
    const { user } = useAuth();
    const { assets, kpis, resetWallet } = useWallet();
    const navigate = useNavigate();
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isSmartModalOpen, setIsSmartModalOpen] = useState(false);
    const [isResetModalOpen, setIsResetModalOpen] = useState(false);

    /**
     * Verificação de Limites via Backend Seguro
     */
    const checkFeatureAccess = async (feature: 'smart_contribution' | 'report') => {
        try {
            const response = await authService.api(`/api/subscription/check-access?feature=${feature}`);
            const data = await response.json();

            if (!data.allowed) {
                if (confirm(`${data.message}\n\nDeseja fazer upgrade para ter acesso liberado?`)) {
                    navigate('/pricing');
                }
                return false;
            }

            await authService.api('/api/subscription/register-usage', {
                method: 'POST',
                body: JSON.stringify({ feature })
            });

            return true;
        } catch (e) {
            console.error("Erro de validação:", e);
            return false;
        }
    };

    const handleOpenSmartContribution = async () => {
        const hasAccess = await checkFeatureAccess('smart_contribution');
        if (hasAccess) {
            setIsSmartModalOpen(true);
        }
    };

    const handleRebalance = () => {
        if (user?.plan !== 'BLACK') {
            if (confirm("Rebalanceamento Automático é exclusivo do plano Black Elite. Deseja conhecer?")) {
                navigate('/pricing');
            }
            return;
        }
        alert("Iniciando motor de rebalanceamento... (Mock)");
    };

    const handleGenerateReport = async () => {
        const hasAccess = await checkFeatureAccess('report');
        if (!hasAccess) return;

        const date = new Date().toLocaleDateString('pt-BR');
        let content = `VÉRTICE INVEST - RELATÓRIO PATRIMONIAL\n`;
        content += `Gerado em: ${date}\n`;
        content += `Investidor: ${user?.name || 'Cliente Vértice'}\n\n`;
        
        content += `--- RESUMO ---\n`;
        content += `Patrimônio Total: R$ ${kpis.totalEquity.toFixed(2)}\n`;
        content += `Total Investido:  R$ ${kpis.totalInvested.toFixed(2)}\n`;
        content += `Resultado:        R$ ${kpis.totalResult.toFixed(2)} (${kpis.totalResultPercent.toFixed(2)}%)\n`;
        content += `Dividendos Totais: R$ ${kpis.totalDividends.toFixed(2)}\n\n`;
        
        content += `--- DETALHAMENTO DE ATIVOS ---\n`;
        content += `TICKER  | TIPO      | QTD      | PREÇO MÉDIO | PREÇO ATUAL | TOTAL\n`;
        
        assets.forEach(a => {
            const line = `${a.ticker.padEnd(7)} | ${a.type.padEnd(9)} | ${a.quantity.toString().padEnd(8)} | ${a.averagePrice.toFixed(2).padEnd(11)} | ${a.currentPrice.toFixed(2).padEnd(11)} | ${a.totalValue.toFixed(2)}`;
            content += line + '\n';
        });

        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `vertice_wallet_${new Date().toISOString().split('T')[0]}.txt`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const isReportLocked = user?.plan === 'GUEST'; 

    return (
        <div className="min-h-screen bg-[#02040a] text-white font-sans selection:bg-blue-500/30">
            <Header />
            
            <main className="max-w-[1600px] mx-auto p-6 animate-fade-in">
                {/* Header da Página */}
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 mb-8">
                    <div>
                        <h1 className="text-2xl font-bold text-white">Minha Carteira</h1>
                        <p className="text-slate-400 text-sm">Gerencie seus ativos e acompanhe a evolução patrimonial.</p>
                    </div>
                    
                    {/* Botões de Ação - Cores Personalizadas */}
                    <div className="flex flex-wrap items-center gap-3">
                        
                        {/* 1. Nova Transação - Verde (Essential) */}
                        <button 
                            className="flex items-center gap-2 px-5 py-2.5 h-10 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20 border border-transparent whitespace-nowrap transition-all active:scale-95"
                            onClick={() => setIsAddModalOpen(true)}
                        >
                            <PlusCircle size={16} /> 
                            Nova Transação
                        </button>

                        {/* 2. Aporte Inteligente - Azul (Pro) */}
                        <button 
                            className="flex items-center gap-2 px-5 py-2.5 h-10 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/20 border border-transparent whitespace-nowrap transition-all active:scale-95"
                            onClick={handleOpenSmartContribution}
                        >
                            <TrendingUp size={16} /> 
                            Aporte Inteligente
                        </button>

                        {/* 3. Rebalanceamento IA - Dourado (Black) */}
                        <button 
                            className="flex items-center gap-2 px-5 py-2.5 h-10 rounded-xl text-xs font-bold bg-gradient-to-r from-[#D4AF37] via-[#F2D06B] to-[#D4AF37] text-black hover:brightness-110 shadow-lg shadow-[#D4AF37]/20 border-none whitespace-nowrap transition-all active:scale-95"
                            onClick={handleRebalance}
                        >
                            <RefreshCw size={16} className="text-black/80" /> 
                            Rebalanceamento IA
                        </button>

                        <div className="w-px h-8 bg-slate-800 hidden lg:block mx-1"></div>

                        {/* Botão Relatório (Secundário) */}
                        <button 
                            disabled={isReportLocked}
                            onClick={handleGenerateReport}
                            className={`
                                flex items-center gap-2 px-4 py-2 h-10 rounded-xl text-xs font-bold transition-all border whitespace-nowrap
                                ${isReportLocked 
                                    ? 'bg-slate-900/50 border-slate-800 text-slate-600 cursor-not-allowed' 
                                    : 'bg-[#0B101A] border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white'
                                }
                            `}
                            title={isReportLocked ? "Disponível a partir do Essential" : "Baixar Relatório"}
                        >
                            {isReportLocked ? <Lock size={14} /> : <Download size={14} />}
                            Relatório
                        </button>

                        {/* Botão Excluir Carteira (Danger) */}
                        <button 
                            onClick={() => assets.length > 0 && setIsResetModalOpen(true)}
                            className={`flex items-center justify-center w-10 h-10 rounded-xl transition-all border 
                                ${assets.length === 0 
                                    ? 'opacity-50 cursor-not-allowed border-slate-800 text-slate-600' 
                                    : 'bg-red-900/10 border-red-900/30 text-red-500 hover:bg-red-900/30 hover:text-red-400 hover:border-red-800'
                                }`}
                            title="Resetar Carteira (Excluir Tudo)"
                            disabled={assets.length === 0}
                        >
                            <Trash2 size={16} />
                        </button>
                    </div>
                </div>

                {/* ETAPA 1: KPIs Principais */}
                <WalletSummary />

                {/* ETAPA 3: Gráficos de Inteligência Visual */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
                    <div className="lg:col-span-2">
                        <EvolutionChart />
                    </div>
                    <div className="lg:col-span-1">
                        <AllocationChart />
                    </div>
                </div>

                {/* ETAPA 2: Lista de Ativos */}
                <div className="mb-8">
                    <AssetList />
                </div>
                
                {/* Modais */}
                <AddAssetModal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} />
                <SmartContributionModal isOpen={isSmartModalOpen} onClose={() => setIsSmartModalOpen(false)} />
                
                <ConfirmModal 
                    isOpen={isResetModalOpen}
                    onClose={() => setIsResetModalOpen(false)}
                    onConfirm={resetWallet}
                    title="Excluir Carteira Definitivamente"
                    message="Tem certeza que deseja apagar TODOS os ativos e histórico? Esta ação não pode ser desfeita e você perderá todo o acompanhamento de rentabilidade."
                    confirmText="Sim, apagar tudo"
                    isDestructive={true}
                />

            </main>
        </div>
    );
};
