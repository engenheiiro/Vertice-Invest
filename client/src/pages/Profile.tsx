import React, { Suspense } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Header } from '../components/dashboard/Header';
import { ProfileIdentity } from '../components/profile/ProfileIdentity';
import { ProfileSettings } from '../components/profile/ProfileSettings';
import { SecuritySection } from '../components/profile/SecuritySection';
import { SubscriptionCard } from '../components/profile/SubscriptionCard';

export const Profile = () => {
    return (
        <div className="min-h-screen bg-[#02040a] text-white font-sans selection:bg-blue-500/30">
            <Header />

            <main className="max-w-[1200px] mx-auto p-6 animate-fade-in">
                {/* Breadcrumb / Back Navigation */}
                <div className="mb-6">
                    <Link to="/dashboard" className="inline-flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-white transition-colors group">
                        <ArrowLeft size={14} className="group-hover:-translate-x-1 transition-transform" />
                        Voltar ao Terminal
                    </Link>
                </div>

                <div className="flex flex-col lg:flex-row gap-6">
                    
                    {/* COLUNA ESQUERDA: Identidade (Sticky) */}
                    <div className="w-full lg:w-[320px] shrink-0">
                        <div className="sticky top-24">
                            <ProfileIdentity />
                        </div>
                    </div>

                    {/* COLUNA DIREITA: Conteúdo */}
                    <div className="flex-1 space-y-6">
                        
                        {/* Seção de Assinatura */}
                        <SubscriptionCard />

                        {/* Dados Pessoais */}
                        <ProfileSettings />

                        {/* Segurança */}
                        <SecuritySection />

                        {/* Danger Zone (Mock) */}
                        <div className="p-6 rounded-2xl border border-red-900/30 bg-red-950/10">
                            <h4 className="text-sm font-bold text-red-500 mb-1">Zona de Perigo</h4>
                            <p className="text-xs text-slate-500 mb-4">Ações irreversíveis relacionadas à sua conta.</p>
                            <button className="px-4 py-2 border border-red-900/50 text-red-500 text-xs font-bold rounded-lg hover:bg-red-950/30 transition-colors">
                                Desativar Conta
                            </button>
                        </div>

                    </div>
                </div>
            </main>
        </div>
    );
};

export default Profile;