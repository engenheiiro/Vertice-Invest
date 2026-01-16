import React, { useState } from 'react';
import { Lock, Smartphone, ShieldAlert, ChevronRight } from 'lucide-react';

export const SecuritySection = () => {
    const [mfaEnabled, setMfaEnabled] = useState(true);

    return (
        <div className="bg-[#080C14] border border-slate-800 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-1">
                <Lock size={16} className="text-blue-500" />
                <h3 className="text-base font-bold text-white">Segurança & Acesso</h3>
            </div>
            <p className="text-xs text-slate-500 mb-6">Gerencie suas credenciais e camadas de proteção.</p>

            <div className="space-y-4">
                {/* 2FA Toggle */}
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

                {/* Password Change */}
                <div className="flex items-center justify-between p-4 bg-[#0B101A] border border-slate-800 rounded-xl hover:border-slate-700 transition-colors cursor-pointer group">
                    <div className="flex items-start gap-3">
                        <div className="p-2 rounded-lg bg-slate-800 text-slate-400 group-hover:text-white transition-colors">
                            <ShieldAlert size={18} />
                        </div>
                        <div>
                            <p className="text-sm font-bold text-slate-200">Alterar Senha</p>
                            <p className="text-xs text-slate-500 mt-0.5">Última alteração: há 3 meses</p>
                        </div>
                    </div>
                    <ChevronRight size={16} className="text-slate-600 group-hover:text-blue-500 transition-colors" />
                </div>
            </div>
        </div>
    );
};