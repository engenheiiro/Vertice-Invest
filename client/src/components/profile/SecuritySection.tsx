
import React, { useState, useEffect } from 'react';
import { Lock, Smartphone, ShieldAlert, ChevronRight, X, Loader2, Copy, Check } from 'lucide-react';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { authService } from '../../services/auth';
import { getErrorMessage } from '../../utils/errorMessages';

type MfaMode = 'idle' | 'setup' | 'disable';
type Msg = { type: 'success' | 'error'; text: string } | null;

export const SecuritySection = () => {
    // --- MFA / 2FA (I14) ---
    const [mfaEnabled, setMfaEnabled] = useState(false);
    const [mfaStatusLoading, setMfaStatusLoading] = useState(true);
    const [mode, setMode] = useState<MfaMode>('idle');
    const [setupData, setSetupData] = useState<{ secret: string; qr: string } | null>(null);
    const [mfaCode, setMfaCode] = useState('');
    const [disablePwd, setDisablePwd] = useState('');
    const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
    const [mfaBusy, setMfaBusy] = useState(false);
    const [mfaMsg, setMfaMsg] = useState<Msg>(null);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        let active = true;
        authService.getMfaStatus()
            .then((s) => { if (active) setMfaEnabled(!!s.mfaEnabled); })
            .catch(() => { /* mantém default desativado */ })
            .finally(() => { if (active) setMfaStatusLoading(false); });
        return () => { active = false; };
    }, []);

    const resetMfaFlow = () => {
        setMode('idle');
        setSetupData(null);
        setMfaCode('');
        setDisablePwd('');
        setMfaMsg(null);
    };

    const startSetup = async () => {
        setMfaBusy(true);
        setMfaMsg(null);
        try {
            const data = await authService.setupMfa();
            setSetupData({ secret: data.secret, qr: data.qr });
            setMode('setup');
        } catch (e: unknown) {
            setMfaMsg({ type: 'error', text: getErrorMessage(e, 'Erro ao iniciar o MFA.') });
        } finally {
            setMfaBusy(false);
        }
    };

    const confirmEnable = async () => {
        setMfaBusy(true);
        setMfaMsg(null);
        try {
            const data = await authService.enableMfa(mfaCode.trim());
            setBackupCodes(data.backupCodes || []);
            setMfaEnabled(true);
            setMode('idle');
            setSetupData(null);
            setMfaCode('');
        } catch (e: unknown) {
            setMfaMsg({ type: 'error', text: getErrorMessage(e, 'Código inválido.') });
        } finally {
            setMfaBusy(false);
        }
    };

    const confirmDisable = async () => {
        setMfaBusy(true);
        setMfaMsg(null);
        try {
            await authService.disableMfa({
                token: mfaCode.trim() || undefined,
                password: disablePwd || undefined,
            });
            setMfaEnabled(false);
            resetMfaFlow();
        } catch (e: unknown) {
            setMfaMsg({ type: 'error', text: getErrorMessage(e, 'Não foi possível desativar.') });
        } finally {
            setMfaBusy(false);
        }
    };

    const toggleMfa = () => {
        if (mfaBusy || mfaStatusLoading) return;
        if (mfaEnabled) setMode('disable');
        else startSetup();
    };

    const copyBackup = () => {
        if (!backupCodes) return;
        navigator.clipboard?.writeText(backupCodes.join('\n'));
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    // --- Alteração de Senha (inalterado) ---
    const [isChangingPassword, setIsChangingPassword] = useState(false);
    const [pwdData, setPwdData] = useState({ oldPassword: '', newPassword: '', confirmPassword: '' });
    const [loadingPwd, setLoadingPwd] = useState(false);
    const [pwdMsg, setPwdMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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
        } catch (error: unknown) {
            setPwdMsg({ type: 'error', text: getErrorMessage(error, 'Erro ao alterar senha.') });
        } finally {
            setLoadingPwd(false);
        }
    };

    return (
        <div className="bg-base border border-slate-800 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-1">
                <Lock size={16} className="text-blue-500" />
                <h3 className="text-base font-bold text-white">Segurança & Acesso</h3>
            </div>
            <p className="text-xs text-slate-500 mb-6">Gerencie suas credenciais e camadas de proteção.</p>

            <div className="space-y-4">
                {/* 2FA — fluxo real (I14) */}
                <div className="p-4 bg-card border border-slate-800 rounded-xl transition-colors">
                    <div className="flex items-center justify-between">
                        <div className="flex items-start gap-3">
                            <div className={`p-2 rounded-lg ${mfaEnabled ? 'bg-emerald-900/20 text-emerald-500' : 'bg-slate-800 text-slate-500'}`}>
                                <Smartphone size={18} />
                            </div>
                            <div>
                                <p className="text-sm font-bold text-slate-200">Autenticação em Dois Fatores (2FA)</p>
                                <p className="text-xs text-slate-500 mt-0.5">
                                    {mfaEnabled ? 'Ativo — exige um código do app a cada login.' : 'Adiciona uma camada extra via App Autenticador.'}
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={toggleMfa}
                            disabled={mfaBusy || mfaStatusLoading}
                            aria-label={mfaEnabled ? 'Desativar 2FA' : 'Ativar 2FA'}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${mfaEnabled ? 'bg-blue-600' : 'bg-slate-700'}`}
                        >
                            {mfaBusy || mfaStatusLoading
                                ? <Loader2 size={12} className="mx-auto animate-spin text-white" />
                                : <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${mfaEnabled ? 'translate-x-6' : 'translate-x-1'}`} />}
                        </button>
                    </div>

                    {/* Painel de SETUP (escanear QR + confirmar código) */}
                    {mode === 'setup' && setupData && (
                        <div className="mt-5 pt-4 border-t border-slate-800/50 animate-fade-in">
                            <p className="text-xs text-slate-400 mb-3">
                                1. Escaneie o QR Code no seu app autenticador (Google Authenticator, Authy...).
                            </p>
                            <div className="flex flex-col items-center gap-3 mb-4">
                                <img src={setupData.qr} alt="QR Code do MFA" className="w-40 h-40 rounded-lg bg-white p-2" />
                                <div className="text-center">
                                    <p className="text-[10px] text-slate-500 uppercase tracking-wide">Ou insira a chave manualmente</p>
                                    <code className="text-[11px] text-slate-300 font-mono break-all">{setupData.secret}</code>
                                </div>
                            </div>
                            <p className="text-xs text-slate-400 mb-2">2. Digite o código gerado para confirmar.</p>
                            <Input
                                label="Código de 6 dígitos"
                                type="text"
                                inputMode="numeric"
                                maxLength={6}
                                value={mfaCode}
                                onChange={(e) => { setMfaCode(e.target.value); setMfaMsg(null); }}
                                containerClassName="mb-0"
                                className="text-center tracking-widest"
                            />
                            {mfaMsg && (
                                <div className={`mt-3 p-2 text-xs font-bold text-center rounded-lg ${mfaMsg.type === 'success' ? 'text-emerald-400 bg-emerald-900/20' : 'text-red-400 bg-red-900/20'}`}>
                                    {mfaMsg.text}
                                </div>
                            )}
                            <div className="mt-4 flex justify-end gap-3">
                                <Button type="button" variant="ghost" onClick={resetMfaFlow} className="w-auto px-4 py-2 text-xs">Cancelar</Button>
                                <Button type="button" status={mfaBusy ? 'loading' : 'idle'} onClick={confirmEnable} className="w-auto px-6 py-2 text-xs">Ativar 2FA</Button>
                            </div>
                        </div>
                    )}

                    {/* Painel de DISABLE (confirmar com código ou senha) */}
                    {mode === 'disable' && (
                        <div className="mt-5 pt-4 border-t border-slate-800/50 animate-fade-in">
                            <p className="text-xs text-slate-400 mb-3">Confirme com um código do app <span className="text-slate-500">ou</span> sua senha para desativar.</p>
                            <div className="space-y-3">
                                <Input
                                    label="Código do app (opcional)"
                                    type="text"
                                    inputMode="numeric"
                                    maxLength={11}
                                    value={mfaCode}
                                    onChange={(e) => { setMfaCode(e.target.value); setMfaMsg(null); }}
                                    containerClassName="mb-0"
                                    className="text-center tracking-widest"
                                />
                                <Input
                                    label="Senha da conta (opcional)"
                                    type="password"
                                    value={disablePwd}
                                    onChange={(e) => { setDisablePwd(e.target.value); setMfaMsg(null); }}
                                    containerClassName="mb-0"
                                />
                            </div>
                            {mfaMsg && (
                                <div className="mt-3 p-2 text-xs font-bold text-center rounded-lg text-red-400 bg-red-900/20">{mfaMsg.text}</div>
                            )}
                            <div className="mt-4 flex justify-end gap-3">
                                <Button type="button" variant="ghost" onClick={resetMfaFlow} className="w-auto px-4 py-2 text-xs">Cancelar</Button>
                                <Button type="button" status={mfaBusy ? 'loading' : 'idle'} onClick={confirmDisable} className="w-auto px-6 py-2 text-xs">Desativar</Button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Painel de BACKUP CODES (mostrado uma única vez após ativar) */}
                {backupCodes && (
                    <div className="p-4 bg-emerald-950/10 border border-emerald-900/40 rounded-xl animate-fade-in">
                        <div className="flex items-center justify-between mb-2">
                            <p className="text-sm font-bold text-emerald-400">2FA ativado! Guarde seus códigos de backup</p>
                            <button onClick={() => setBackupCodes(null)} className="text-slate-500 hover:text-white"><X size={16} /></button>
                        </div>
                        <p className="text-[11px] text-slate-400 mb-3">
                            Cada código funciona uma vez e serve para entrar caso você perca o acesso ao app. Guarde-os em local seguro — não serão exibidos novamente.
                        </p>
                        <div className="grid grid-cols-2 gap-2 mb-3">
                            {backupCodes.map((c) => (
                                <code key={c} className="text-xs font-mono text-slate-200 bg-card border border-slate-800 rounded px-2 py-1 text-center">{c}</code>
                            ))}
                        </div>
                        <button onClick={copyBackup} className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-400 hover:text-emerald-300">
                            {copied ? <Check size={14} /> : <Copy size={14} />}
                            {copied ? 'Copiado!' : 'Copiar todos'}
                        </button>
                    </div>
                )}

                {/* Password Change - Expansível (inalterado) */}
                <div className={`p-4 bg-card border border-slate-800 rounded-xl transition-all ${isChangingPassword ? 'border-blue-900/50 bg-blue-900/5' : 'hover:border-slate-700'}`}>

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
