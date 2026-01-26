
import React, { useState } from 'react';
import { Header } from '../components/dashboard/Header';
import { WalletSummary } from '../components/wallet/WalletSummary';
import { AssetList } from '../components/wallet/AssetList';
import { AddAssetModal } from '../components/wallet/AddAssetModal';
import { EvolutionChart } from '../components/wallet/EvolutionChart';
import { AllocationChart } from '../components/wallet/AllocationChart';
import { SmartContributionModal } from '../components/wallet/SmartContributionModal';
import { Button } from '../components/ui/Button';
import { Plus, Download, Lock, Crown } from 'lucide-react';
import { useAuth, UserPlan } from '../contexts/AuthContext';
import { useWallet } from '../contexts/WalletContext';
import { useNavigate } from 'react-router-dom';

export const Wallet = () => {
    const { user } = useAuth();
    const { assets, kpis } = useWallet();
    const navigate = useNavigate();
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isSmartModalOpen, setIsSmartModalOpen] = useState(false);

    /**
     * MOCK: Verificação de Limites de Uso Genérica
     */
    const checkFeatureAccess = async (feature: 'smart_contribution' | 'report') => {
        if (!user) return false;
        
        const plan = user.plan || 'GUEST';
        
        // Definição de limites por feature e plano
        const limitsConfig: Record<string, Record<UserPlan, number>> = {
            'smart_contribution': {
                'GUEST': 0,
                'ESSENTIAL': 1,
                'PRO': 2,
                'BLACK': 9999 
            },
            'report': {
                'GUEST': 0,
                'ESSENTIAL': 1,
                'PRO': 9999, 
                'BLACK': 9999 
            }
        };

        const limit = limitsConfig[feature][plan];
        const storageKey = `mock_db_usage_${user.id}_${feature}_${new Date().getMonth()}`; 
        const currentUsage = parseInt(localStorage.getItem(storageKey) || '0');

        if (currentUsage >= limit) {
            const msg = limit === 0 
                ? `O recurso "${feature === 'report' ? 'Relatórios' : 'Aporte Inteligente'}" não está disponível no plano ${plan}.`
                : `Limite mensal do plano ${plan} atingido (${currentUsage}/${limit}).`;

            if (confirm(`${msg}\n\nDeseja fazer upgrade para ter acesso liberado?`)) {
                navigate('/pricing');
            }
            return false;
        }

        localStorage.setItem(storageKey, (currentUsage + 1).toString());
        return true;
    };

    const handleOpenSmartContribution = async () => {
        const hasAccess = await checkFeatureAccess('smart_contribution');
        if (hasAccess) {
            setIsSmartModalOpen(true);
        }
    };

    const handleGenerateReport = async () => {
        const hasAccess = await checkFeatureAccess('report');
        if (!hasAccess) return;

        // LÓGICA DE DATABUMP (Exportação)
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
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                    <div>
                        <h1 className="text-2xl font-bold text-white">Minha Carteira</h1>
                        <p className="text-slate-400 text-sm">Gerencie seus ativos e acompanhe a evolução patrimonial.</p>
                    </div>
                    
                    {/* Botões de Ação - Layout Horizontal Fixo */}
                    <div className="flex items-center gap-3 overflow-x-auto pb-2 md:pb-0 no-scrollbar">
                        
                        {/* Botão Relatório */}
                        <button 
                            disabled={isReportLocked}
                            onClick={handleGenerateReport}
                            className={`
                                flex items-center gap-2 px-4 py-2 h-10 rounded-xl text-xs font-bold transition-all border whitespace-nowrap shrink-0
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
                        
                        {/* Botão Aporte Inteligente - Premium */}
                        <button 
                            className="flex items-center gap-2 px-5 py-2 h-10 rounded-xl text-xs font-bold bg-gradient-to-r from-[#D4AF37] via-[#F2D06B] to-[#D4AF37] text-black hover:brightness-110 shadow-lg shadow-[#D4AF37]/20 border-none whitespace-nowrap shrink-0 transition-transform active:scale-95"
                            onClick={handleOpenSmartContribution}
                        >
                            <Crown size={14} className="text-black/80" fill="currentColor" /> 
                            Aporte Inteligente
                        </button>

                        {/* Botão Novo Ativo */}
                        <button 
                            className="flex items-center gap-2 px-5 py-2 h-10 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-600/20 border border-transparent whitespace-nowrap shrink-0 transition-colors"
                            onClick={() => setIsAddModalOpen(true)}
                        >
                            <Plus size={16} /> 
                            Novo Ativo
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

            </main>
        </div>
    );
};

export default Wallet;
