import React, { Suspense, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Eye, EyeOff } from 'lucide-react';
import { Header } from '../components/dashboard/Header';
import { ProfileIdentity } from '../components/profile/ProfileIdentity';
import { ProfileSettings } from '../components/profile/ProfileSettings';
import { SecuritySection } from '../components/profile/SecuritySection';
import { SubscriptionCard } from '../components/profile/SubscriptionCard';
import { useAuth } from '../contexts/AuthContext';
import { authService } from '../services/auth';
import { useToast } from '../contexts/ToastContext';

export const Profile = () => {
    const { logout } = useAuth();
    const { addToast } = useToast();
    const navigate = useNavigate();

    const [showDeactivate, setShowDeactivate] = useState(false);
    const [deactivatePassword, setDeactivatePassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [isDeactivating, setIsDeactivating] = useState(false);

    const handleDeactivate = async () => {
        if (!deactivatePassword) return;
        setIsDeactivating(true);
        try {
            await authService.deactivateAccount(deactivatePassword);
            addToast('Conta desativada. Até logo!', 'success');
            await logout();
            navigate('/login');
        } catch (err: any) {
            addToast(err.message || 'Erro ao desativar conta.', 'error');
        } finally {
            setIsDeactivating(false);
        }
    };

    return (
        <div className="min-h-screen bg-deep text-white font-sans selection:bg-blue-500/30">
            <Header />

            <main id="main-content" tabIndex={-1} className="max-w-[1200px] mx-auto p-4 md:p-6 animate-fade-in">
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

                        {/* Danger Zone */}
                        <div className="p-6 rounded-2xl border border-red-900/30 bg-red-950/10">
                            <h4 className="text-sm font-bold text-red-500 mb-1">Zona de Perigo</h4>
                            <p className="text-xs text-slate-500 mb-4">Ações irreversíveis relacionadas à sua conta.</p>

                            {!showDeactivate ? (
                                <button
                                    onClick={() => setShowDeactivate(true)}
                                    className="px-4 py-2 border border-red-900/50 text-red-500 text-xs font-bold rounded-lg hover:bg-red-950/30 transition-colors"
                                >
                                    Desativar Conta
                                </button>
                            ) : (
                                <div className="space-y-3 border border-red-900/40 rounded-xl p-4 bg-red-950/20 animate-fade-in">
                                    <p className="text-xs text-red-400 font-semibold">Confirme sua senha para desativar a conta. Esta ação encerrará todas as sessões ativas.</p>
                                    <div className="relative">
                                        <input
                                            type={showPassword ? 'text' : 'password'}
                                            value={deactivatePassword}
                                            onChange={e => setDeactivatePassword(e.target.value)}
                                            placeholder="Sua senha atual"
                                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-red-700 pr-10"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPassword(v => !v)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                                            tabIndex={-1}
                                        >
                                            {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                                        </button>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={handleDeactivate}
                                            disabled={!deactivatePassword || isDeactivating}
                                            className="flex items-center gap-1.5 px-4 py-2 bg-red-700 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg transition-colors"
                                        >
                                            {isDeactivating && <Loader2 size={12} className="animate-spin" />}
                                            Confirmar Desativação
                                        </button>
                                        <button
                                            onClick={() => { setShowDeactivate(false); setDeactivatePassword(''); }}
                                            className="px-4 py-2 border border-slate-700 text-slate-400 text-xs font-bold rounded-lg hover:bg-slate-800 transition-colors"
                                        >
                                            Cancelar
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                    </div>
                </div>
            </main>
        </div>
    );
};

export default Profile;