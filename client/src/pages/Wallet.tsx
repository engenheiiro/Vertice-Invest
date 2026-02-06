
import React, { useState, useEffect } from 'react';
import { Header } from '../components/dashboard/Header';
import { WalletSummary } from '../components/wallet/WalletSummary';
import { AssetList } from '../components/wallet/AssetList';
import { AddAssetModal } from '../components/wallet/AddAssetModal';
import { EvolutionChart } from '../components/wallet/EvolutionChart';
import { PerformanceChart } from '../components/wallet/PerformanceChart'; 
import { MonthlyReturnsTable } from '../components/wallet/MonthlyReturnsTable'; 
import { DividendDashboard } from '../components/wallet/DividendDashboard'; 
import { CashFlowHistory } from '../components/wallet/CashFlowHistory'; 
import { AllocationChart } from '../components/wallet/AllocationChart';
import { SmartContributionModal } from '../components/wallet/SmartContributionModal';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { Plus, Download, Lock, Crown, RefreshCw, TrendingUp, PlusCircle, Trash2, BarChart2, PieChart, Coins, FileText, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useWallet } from '../contexts/WalletContext';
import { useDemo } from '../contexts/DemoContext'; 
// @ts-ignore
import { useNavigate } from 'react-router-dom';
import { authService } from '../services/auth';
import { FEATURE_LIMITS } from '../constants/subscription';

export const Wallet = () => {
    const { user } = useAuth();
    const { assets, kpis, resetWallet, isLoading, isRefreshing } = useWallet();
    const { isDemoMode, currentStep } = useDemo();
    const navigate = useNavigate();
    
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isSmartModalOpen, setIsSmartModalOpen] = useState(false);
    const [isResetModalOpen, setIsResetModalOpen] = useState(false);
    const [limitModalOpen, setLimitModalOpen] = useState(false);
    const [limitMessage, setLimitMessage] = useState('');

    const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'PERFORMANCE' | 'DIVIDENDS' | 'STATEMENT'>('OVERVIEW');

    // --- AUTOMAÇÃO DO TUTORIAL ---
    useEffect(() => {
        if (!isDemoMode) return;
        if (currentStep <= 3) setActiveTab('OVERVIEW');
        else if (currentStep === 4) setActiveTab('PERFORMANCE');
        else if (currentStep === 5) setActiveTab('DIVIDENDS');
        else if (currentStep === 6) setActiveTab('STATEMENT');
        else if (currentStep >= 7) setActiveTab('OVERVIEW');
    }, [isDemoMode, currentStep]);

    // CHECK DE PERMISSÃO: APORTE INTELIGENTE
    const handleOpenSmartContribution = () => {
        const plan = user?.plan || 'GUEST';
        const limit = FEATURE_LIMITS['smart_contribution'][plan];
        
        if (limit === 0) {
            setLimitMessage("O Aporte Inteligente é um recurso exclusivo dos planos Pro e Black.");
            setLimitModalOpen(true);
            return;
        }
        setIsSmartModalOpen(true);
    };

    // CHECK DE PERMISSÃO: REBALANCEAMENTO (BLACK)
    const handleRebalance = () => {
        const plan = user?.plan || 'GUEST';
        // Apenas para exemplo, usando lógica direta pois rebalance é feature flag simples
        if (plan !== 'BLACK') {
            setLimitMessage("O Rebalanceamento Automático com IA é um recurso exclusivo do plano Black Elite.");
            setLimitModalOpen(true);
            return;
        }
        alert("Iniciando motor de rebalanceamento... (Mock)");
    };

    return (
        <div className="min-h-screen bg-[#02040a] text-white font-sans selection:bg-blue-500/30">
            <Header />
            
            <main className="max-w-[1600px] mx-auto p-6 animate-fade-in relative">
                
                {/* Header Actions */}
                <div id="tour-wallet-intro" className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 mb-8">
                    <div>
                        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
                            Minha Carteira
                            {isRefreshing && (
                                <div className="flex items-center gap-2 px-2 py-1 bg-blue-900/20 rounded-full border border-blue-900/50 animate-fade-in">
                                    <Loader2 size={14} className="text-blue-400 animate-spin" />
                                    <span className="text-[10px] text-blue-400 font-bold uppercase tracking-wider">Atualizando...</span>
                                </div>
                            )}
                        </h1>
                        <p className="text-slate-400 text-sm">Gerencie seus ativos e acompanhe a evolução patrimonial.</p>
                    </div>
                    
                    <div id="tour-wallet-actions" className={`flex flex-wrap items-center gap-3 transition-opacity duration-500 ${isDemoMode && 'relative z-[100]'}`}>
                        <button className="flex items-center gap-2 px-5 py-2.5 h-10 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20 border border-transparent whitespace-nowrap transition-all active:scale-95" onClick={() => setIsAddModalOpen(true)}>
                            <PlusCircle size={16} /> Nova Transação
                        </button>
                        
                        {/* Botão Aporte Inteligente */}
                        <button className="flex items-center gap-2 px-5 py-2.5 h-10 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/20 border border-transparent whitespace-nowrap transition-all active:scale-95" onClick={handleOpenSmartContribution}>
                            {(user?.plan === 'GUEST' || user?.plan === 'ESSENTIAL') && <Lock size={12} />}
                            <TrendingUp size={16} /> Aporte Inteligente
                        </button>
                        
                        {/* Botão Rebalanceamento (Black) */}
                        <button className="flex items-center gap-2 px-5 py-2.5 h-10 rounded-xl text-xs font-bold bg-gradient-to-r from-[#D4AF37] via-[#F2D06B] to-[#D4AF37] text-black hover:brightness-110 shadow-lg shadow-[#D4AF37]/20 border-none whitespace-nowrap transition-all active:scale-95" onClick={handleRebalance}>
                            {user?.plan !== 'BLACK' ? <Lock size={12} className="text-black/80" /> : <RefreshCw size={16} className="text-black/80" />} 
                            Rebalanceamento IA
                        </button>
                        
                        <div className="w-px h-8 bg-slate-800 hidden lg:block mx-1"></div>
                        <button onClick={() => assets.length > 0 && setIsResetModalOpen(true)} className={`flex items-center justify-center w-10 h-10 rounded-xl transition-all border ${assets.length === 0 ? 'opacity-50 cursor-not-allowed border-slate-800 text-slate-600' : 'bg-red-900/10 border-red-900/30 text-red-500 hover:bg-red-900/30 hover:text-red-400 hover:border-red-800'}`} title="Resetar Carteira" disabled={assets.length === 0}>
                            <Trash2 size={16} />
                        </button>
                    </div>
                </div>

                <div id="tour-wallet-kpis" className={`transition-opacity duration-500 ${isDemoMode && 'relative z-[100]'}`}>
                    <WalletSummary />
                </div>

                <div className={`flex gap-2 mb-6 border-b border-slate-800/60 pb-1 overflow-x-auto no-scrollbar transition-opacity duration-500 ${isDemoMode && 'relative z-[100]'}`}>
                    <TabButton id="tour-tab-overview" active={activeTab === 'OVERVIEW'} onClick={() => setActiveTab('OVERVIEW')} icon={<PieChart size={14} />} label="Visão Geral" />
                    <TabButton id="tour-tab-performance" active={activeTab === 'PERFORMANCE'} onClick={() => setActiveTab('PERFORMANCE')} icon={<BarChart2 size={14} />} label="Rentabilidade" />
                    <TabButton id="tour-tab-dividends" active={activeTab === 'DIVIDENDS'} onClick={() => setActiveTab('DIVIDENDS')} icon={<Coins size={14} />} label="Proventos" />
                    <TabButton id="tour-tab-statement" active={activeTab === 'STATEMENT'} onClick={() => setActiveTab('STATEMENT')} icon={<FileText size={14} />} label="Extrato" />
                </div>

                {isLoading ? (
                    <div className="animate-pulse space-y-6">
                        <div className="h-64 bg-slate-800/30 rounded-2xl"></div>
                        <div className="h-40 bg-slate-800/30 rounded-2xl"></div>
                    </div>
                ) : (
                    <div id="tour-wallet-content" className={`transition-opacity duration-500 ${isDemoMode && 'relative z-[100]'}`}>
                        {activeTab === 'OVERVIEW' && (
                            <>
                                <div id="tour-wallet-charts" className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8 animate-fade-in">
                                    <div className="lg:col-span-2">
                                        <EvolutionChart />
                                    </div>
                                    <div className="lg:col-span-1">
                                        <AllocationChart />
                                    </div>
                                </div>
                                <div id="tour-wallet-list" className="mb-8 animate-fade-in">
                                    <AssetList />
                                </div>
                            </>
                        )}

                        {activeTab === 'PERFORMANCE' && (
                            <div className="animate-fade-in">
                                <div className="grid grid-cols-1 gap-6 mb-8">
                                    <PerformanceChart />
                                    <MonthlyReturnsTable />
                                </div>
                                <div className="p-6 bg-slate-900/30 border border-slate-800 rounded-xl text-center text-slate-500 text-xs">
                                    * O benchmark comparativo considera a data do primeiro aporte como base 100.
                                </div>
                            </div>
                        )}

                        {activeTab === 'DIVIDENDS' && (
                            <div className="animate-fade-in">
                                <DividendDashboard />
                            </div>
                        )}

                        {activeTab === 'STATEMENT' && (
                            <div className="animate-fade-in max-w-4xl mx-auto">
                                <CashFlowHistory />
                            </div>
                        )}
                    </div>
                )}
                
                <AddAssetModal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} />
                <SmartContributionModal isOpen={isSmartModalOpen} onClose={() => setIsSmartModalOpen(false)} />
                
                <ConfirmModal 
                    isOpen={limitModalOpen} 
                    onClose={() => setLimitModalOpen(false)} 
                    onConfirm={() => navigate('/pricing')}
                    title="Acesso Restrito" 
                    message={`${limitMessage}\n\nDeseja fazer um upgrade agora?`}
                    confirmText="Ver Planos"
                    isDestructive={false}
                />

                <ConfirmModal 
                    isOpen={isResetModalOpen} 
                    onClose={() => setIsResetModalOpen(false)} 
                    onConfirm={resetWallet} 
                    title="Excluir Carteira Permanentemente?" 
                    message="ATENÇÃO: Esta ação é irreversível. Todo o histórico será apagado." 
                    isDestructive={true} 
                    confirmText="Sim, Excluir Tudo"
                />

            </main>
        </div>
    );
};

const TabButton = ({ active, onClick, icon, label, id }: any) => (
    <button
        id={id}
        onClick={onClick}
        className={`
            flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap
            ${active 
                ? 'bg-slate-800 text-white shadow-sm border border-slate-700' 
                : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 border border-transparent'
            }
        `}
    >
        {icon} {label}
    </button>
);
