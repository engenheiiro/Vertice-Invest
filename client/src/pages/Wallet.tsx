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
import { useNavigate } from 'react-router-dom';

export const Wallet = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isSmartModalOpen, setIsSmartModalOpen] = useState(false);

    /**
     * MOCK: Verificação de Limites de Uso Genérica
     * 
     * Backend Endpoint Sugerido: GET /api/subscription/usage?feature={feature_name}
     * Retorno: { allowed: boolean, currentUsage: number, limit: number, plan: string }
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
                'PRO': 9999, // Ilimitado
                'BLACK': 9999 // Ilimitado
            }
        };

        const limit = limitsConfig[feature][plan];
        
        // Storage Key única por usuário/mês/feature
        const storageKey = `mock_db_usage_${user.id}_${feature}_${new Date().getMonth()}`; 
        const currentUsage = parseInt(localStorage.getItem(storageKey) || '0');

        if (currentUsage >= limit) {
            // Mensagem personalizada dependendo do limite ser 0 ou atingido
            const msg = limit === 0 
                ? `O recurso "${feature === 'report' ? 'Relatórios' : 'Aporte Inteligente'}" não está disponível no plano ${plan}.`
                : `Limite mensal do plano ${plan} atingido (${currentUsage}/${limit}).`;

            if (confirm(`${msg}\n\nDeseja fazer upgrade para ter acesso liberado?`)) {
                navigate('/pricing');
            }
            return false;
        }

        // MOCK: Incremento
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
        if (hasAccess) {
            // Lógica de geração de relatório (mock)
            alert("Gerando PDF Institucional... (Simulação de Download)");
        }
    };

    const isReportLocked = user?.plan === 'GUEST'; // Apenas Guest bloqueado visualmente, Essential clica e conta

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