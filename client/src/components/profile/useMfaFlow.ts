/**
 * Estado e passos do MFA/2FA (I14) da tela de Segurança: status inicial,
 * ativação (senha → QR → código → códigos de backup) e desativação pelo
 * segundo fator. A tela só desenha o que este hook devolve.
 */
import { useEffect, useState } from 'react';
import { authService } from '../../services/auth';
import { getErrorMessage } from '../../utils/errorMessages';

export type MfaMode = 'idle' | 'setup' | 'disable';
export type MfaMsg = { type: 'success' | 'error'; text: string } | null;
export type MfaSetupData = { secret: string; qr: string };

function useMfaStatus() {
    const [mfaEnabled, setMfaEnabled] = useState(false);
    const [mfaStatusLoading, setMfaStatusLoading] = useState(true);

    useEffect(() => {
        let active = true;
        authService.getMfaStatus()
            .then((s) => { if (active) setMfaEnabled(!!s.mfaEnabled); })
            .catch(() => { /* mantém default desativado */ })
            .finally(() => { if (active) setMfaStatusLoading(false); });
        return () => { active = false; };
    }, []);

    return { mfaEnabled, setMfaEnabled, mfaStatusLoading };
}

function useBackupCodes() {
    const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
    const [copied, setCopied] = useState(false);

    const copyBackup = () => {
        if (!backupCodes) return;
        navigator.clipboard?.writeText(backupCodes.join('\n'));
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    return { backupCodes, setBackupCodes, copied, copyBackup, closeBackup: () => setBackupCodes(null) };
}

export function useMfaFlow() {
    const { mfaEnabled, setMfaEnabled, mfaStatusLoading } = useMfaStatus();
    const backup = useBackupCodes();
    const [mode, setMode] = useState<MfaMode>('idle');
    const [setupData, setSetupData] = useState<MfaSetupData | null>(null);
    const [setupPassword, setSetupPassword] = useState('');
    const [mfaCode, setMfaCode] = useState('');
    const [mfaBusy, setMfaBusy] = useState(false);
    const [mfaMsg, setMfaMsg] = useState<MfaMsg>(null);

    const resetMfaFlow = () => {
        setMode('idle');
        setSetupData(null);
        setSetupPassword('');
        setMfaCode('');
        setMfaMsg(null);
    };

    // Cada passo: ocupa, limpa a mensagem, chama o servidor e mostra o erro dele.
    const runStep = async (step: () => Promise<void>, fallback: string) => {
        setMfaBusy(true);
        setMfaMsg(null);
        try {
            await step();
        } catch (e: unknown) {
            setMfaMsg({ type: 'error', text: getErrorMessage(e, fallback) });
        } finally {
            setMfaBusy(false);
        }
    };

    const confirmSetupPassword = () => runStep(async () => {
        const data = await authService.setupMfa(setupPassword);
        setSetupData({ secret: data.secret, qr: data.qr });
        setSetupPassword('');
    }, 'Erro ao iniciar o MFA.');

    const confirmEnable = () => runStep(async () => {
        const data = await authService.enableMfa(mfaCode.trim());
        backup.setBackupCodes(data.backupCodes || []);
        setMfaEnabled(true);
        setMode('idle');
        setSetupData(null);
        setMfaCode('');
    }, 'Código inválido.');

    const confirmDisable = () => runStep(async () => {
        await authService.disableMfa({
            token: mfaCode.trim(),
        });
        setMfaEnabled(false);
        resetMfaFlow();
    }, 'Não foi possível desativar.');

    const toggleMfa = () => {
        if (mfaBusy || mfaStatusLoading) return;
        if (mfaEnabled) setMode('disable');
        else {
            setMode('setup');
            setMfaMsg(null);
        }
    };

    const changeSetupPassword = (value: string) => { setSetupPassword(value); setMfaMsg(null); };
    const changeMfaCode = (value: string) => { setMfaCode(value); setMfaMsg(null); };

    return {
        mfaEnabled, mfaStatusLoading, mode, setupData, setupPassword, mfaCode, mfaBusy, mfaMsg,
        backupCodes: backup.backupCodes, copied: backup.copied, copyBackup: backup.copyBackup, closeBackup: backup.closeBackup,
        resetMfaFlow, confirmSetupPassword, confirmEnable, confirmDisable, toggleMfa, changeSetupPassword, changeMfaCode,
    };
}

export type MfaFlow = ReturnType<typeof useMfaFlow>;
