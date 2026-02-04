
import React, { useState } from 'react';
import { Lock, Smartphone, ShieldAlert, ChevronRight, X, Check, Eye, EyeOff } from 'lucide-react';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { authService } from '../../services/auth';

export const SecuritySection = () => {
    const [mfaEnabled, setMfaEnabled] = useState(true);
    
    // Estado para Alteração de Senha
    const [isChangingPassword, setIsChangingPassword] = useState(false);
    const [pwdData, setPwdData] = useState({ oldPassword: '', newPassword: '', confirmPassword: '' });
    const [loadingPwd, setLoadingPwd] = useState(false);
    const [pwdMsg, setPwdMsg] = useState<{type: 'success' | 'error', text: string} | null>(null);

    const handleChangePwd = (e: React.ChangeEvent<HTMLInputElement>) => {
        setPwdData({ ...pwdData, [e.target.name]: e.target.value });
        if (pwdMsg) setPwdMsg(null);
    };

    const submitChangePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        
        if (pwdData.newPassword.length < 6) {
            setPwdMsg({ type: 'error', text: 'A nova senha deve ter no mínimo 6 caracteres.' });
            return;
        }
        if (pwdData.newPassword !== pwdData.confirmPassword) {
            setPwdMsg({ type: 'error', text: 'As novas senhas não conferem.' });
            return;
        }

        setLoadingPwd(true);
        try {
            await authService.changePassword({
                oldPassword: pwdData.oldPassword,
                newPassword: pwdData.newPassword
            });
            setPwdMsg({ type: 'success', text: 'Senha alterada com sucesso!' });
            setPwdData({ oldPassword: '', newPassword: '', confirmPassword: '' });
            setTimeout(() => {
                setIsChangingPassword(false);
                setPwdMsg(null);
            }, 2000);
        } catch (error: any) {
            setPwdMsg({ type: 'error', text: error.message || 'Erro ao alterar senha.' });
        } finally {
            setLoadingPwd(false);
        }
    };

    return (
        <div className="bg-[#080C14] border border-slate-800 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-1">
                <Lock size={16} className="text-blue-500" />
                <h3 className="text-base font-bold text-white">Segurança & Acesso</h3>
            </div>
            <p className="text-xs text-slate-500 mb-6">Gerencie suas credenciais e camadas de proteção.</p>

            <div className="space-y-4">
                {/* 2FA Toggle (Mock visual mantido) */}
                <div className="flex items-center justify-between p-4 bg-[#0B101A] border border-slate-800 rounded-xl hover:border-slate-700 transition-colors">
                    <div className="flex items-start gap-3">
                        <div className={`p-2 rounded-lg ${mfaEnabled ? 'bg-emerald-900/20 text-emerald-500' : 'bg-slate-800 text-slate-500'}`}>
                            <Smartphone size={18} />
                        </div>
                        <div>
                            <p className="text-sm font-bold text-slate-200">Autenticação em Dois Fatores (2FA)</p>
                            <p className="text-xs text-slate-500 mt-0.5">Adiciona uma camada extra de segurança via App Autenticador.</p>
                        </div>
                    </div>
                    <button 
                        onClick={() => setMfaEnabled(!mfaEnabled)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${mfaEnabled ? 'bg-blue-600' : 'bg-slate-700'}`}
                    >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${mfaEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                </div>

                {/* Password Change - Expansível */}
                <div className={`p-4 bg-[#0B101A] border border-slate-800 rounded-xl transition-all ${isChangingPassword ? 'border-blue-900/50 bg-blue-900/5' : 'hover:border-slate-700'}`}>
                    
                    {/* Header do Card de Senha */}
                    <div 
                        className="flex items-center justify-between cursor-pointer group"
                        onClick={() => !isChangingPassword && setIsChangingPassword(true)}
                    >
                        <div className="flex items-start gap-3">
                            <div className="p-2 rounded-lg bg-slate-800 text-slate-400 group-hover:text-white transition-colors">
                                <ShieldAlert size={18} />
                            </div>
                            <div>
                                <p className="text-sm font-bold text-slate-200">Alterar Senha</p>
                                <p className="text-xs text-slate-500 mt-0.5">
                                    {isChangingPassword ? 'Preencha os campos abaixo' : 'Clique para redefinir sua senha de acesso'}
                                </p>
                            </div>
                        </div>
                        {!isChangingPassword ? (
                            <ChevronRight size={16} className="text-slate-600 group-hover:text-blue-500 transition-colors" />
                        ) : (
                            <button onClick={(e) => { e.stopPropagation(); setIsChangingPassword(false); setPwdMsg(null); }} className="text-slate-500 hover:text-white">
                                <X size={16} />
                            </button>
                        )}
                    </div>

                    {/* Formulário Expansível */}
                    {isChangingPassword && (
                        <form onSubmit={submitChangePassword} className="mt-6 pt-4 border-t border-slate-800/50 animate-fade-in">
                            <div className="space-y-4">
                                <Input 
                                    label="Senha Atual" 
                                    type="password" 
                                    name="oldPassword"
                                    value={pwdData.oldPassword}
                                    onChange={handleChangePwd}
                                    containerClassName="mb-0"
                                />
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <Input 
                                        label="Nova Senha" 
                                        type="password" 
                                        name="newPassword"
                                        value={pwdData.newPassword}
                                        onChange={handleChangePwd}
                                        containerClassName="mb-0"
                                    />
                                    <Input 
                                        label="Confirmar Nova Senha" 
                                        type="password" 
                                        name="confirmPassword"
                                        value={pwdData.confirmPassword}
                                        onChange={handleChangePwd}
                                        containerClassName="mb-0"
                                    />
                                </div>
                            </div>

                            {pwdMsg && (
                                <div className={`mt-4 p-2 text-xs font-bold text-center rounded-lg ${pwdMsg.type === 'success' ? 'text-emerald-400 bg-emerald-900/20' : 'text-red-400 bg-red-900/20'}`}>
                                    {pwdMsg.text}
                                </div>
                            )}

                            <div className="mt-6 flex justify-end gap-3">
                                <Button 
                                    type="button" 
                                    variant="ghost" 
                                    onClick={() => { setIsChangingPassword(false); setPwdMsg(null); }}
                                    className="w-auto px-4 py-2 text-xs"
                                >
                                    Cancelar
                                </Button>
                                <Button 
                                    type="submit" 
                                    status={loadingPwd ? 'loading' : 'idle'}
                                    className="w-auto px-6 py-2 text-xs"
                                >
                                    Atualizar Senha
                                </Button>
                            </div>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
};
