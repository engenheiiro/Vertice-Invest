
import React, { useId } from 'react';
import { Lock } from 'lucide-react';
import { useMfaFlow } from './useMfaFlow';
import { usePasswordChange } from './usePasswordChange';
import { BackupCodesPanel, MfaCard, PasswordCard } from './SecuritySectionParts';

export const SecuritySection = () => {
    // --- MFA / 2FA (I14) ---
    const mfa = useMfaFlow();
    // --- Alteração de Senha ---
    const passwordFormId = useId();
    const pwd = usePasswordChange();

    return (
        <div className="bg-base border border-slate-800 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-1">
                <Lock size={16} className="text-blue-500" />
                <h3 className="text-base font-bold text-white">Segurança & Acesso</h3>
            </div>
            <p className="text-xs text-slate-500 mb-6">Gerencie suas credenciais e camadas de proteção.</p>

            <div className="space-y-4">
                {/* 2FA — fluxo real (I14) */}
                <MfaCard mfa={mfa} />
                {/* Painel de BACKUP CODES (mostrado uma única vez após ativar) */}
                <BackupCodesPanel mfa={mfa} />
                {/* Password Change - Expansível */}
                <PasswordCard pwd={pwd} formId={passwordFormId} />
            </div>
        </div>
    );
};
