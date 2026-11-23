/**
 * Peças visuais da tela de Segurança & Acesso. A lógica mora em `useMfaFlow`
 * e `usePasswordChange`; aqui só se desenha o estado que eles devolvem.
 */
import React from 'react';
import { Smartphone, ShieldAlert, ChevronRight, X, Loader2, Copy, Check } from 'lucide-react';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import type { MfaFlow } from './useMfaFlow';
import type { PasswordChange } from './usePasswordChange';

const PANEL = 'mt-5 pt-4 border-t border-slate-800/50 animate-fade-in';
const ERROR_BOX = 'mt-3 p-2 text-xs font-bold text-center rounded-lg text-red-400 bg-red-900/20';
const toneClass = (type: 'success' | 'error') => (type === 'success'
    ? 'text-emerald-400 bg-emerald-900/20'
    : 'text-red-400 bg-red-900/20');

// `disabled` só vai ao Button quando informado: o Button espalha as props DEPOIS
// do próprio `disabled` de carregamento, então até `disabled={undefined}` o anularia
// (o "Ativar 2FA" fica travado enquanto carrega; "Continuar"/"Desativar" seguem a
// regra do próprio campo — comportamento de hoje, mantido).
const MfaActions = ({ mfa, label, onConfirm, disabled }: {
    mfa: MfaFlow; label: string; onConfirm: () => void; disabled?: boolean;
}) => {
    const confirmProps = disabled === undefined ? {} : { disabled };
    return (
        <div className="mt-4 flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={mfa.resetMfaFlow} className="w-auto px-4 py-2 text-xs">Cancelar</Button>
            <Button type="button" status={mfa.mfaBusy ? 'loading' : 'idle'} onClick={onConfirm} {...confirmProps} className="w-auto px-6 py-2 text-xs">{label}</Button>
        </div>
    );
};

const MfaToggle = ({ mfa }: { mfa: MfaFlow }) => {
    const { mfaEnabled } = mfa;
    const pending = mfa.mfaBusy || mfa.mfaStatusLoading;
    return (
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
                onClick={mfa.toggleMfa}
                disabled={pending}
                aria-label={mfaEnabled ? 'Desativar 2FA' : 'Ativar 2FA'}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${mfaEnabled ? 'bg-blue-600' : 'bg-slate-700'}`}
            >
                {pending
                    ? <Loader2 size={12} className="mx-auto animate-spin text-white" />
                    : <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${mfaEnabled ? 'translate-x-6' : 'translate-x-1'}`} />}
            </button>
        </div>
    );
};

const MfaPasswordStep = ({ mfa }: { mfa: MfaFlow }) => (
    <div className={PANEL}>
        <p className="text-xs text-slate-400 mb-3">
            Confirme sua senha atual antes de configurar o segundo fator.
        </p>
        <Input
            label="Senha atual"
            type="password"
            autoComplete="current-password"
            value={mfa.setupPassword}
            onChange={(e) => mfa.changeSetupPassword(e.target.value)}
            containerClassName="mb-0"
        />
        {mfa.mfaMsg && (
            <div className={ERROR_BOX}>
                {mfa.mfaMsg.text}
            </div>
        )}
        <MfaActions mfa={mfa} label="Continuar" onConfirm={mfa.confirmSetupPassword} disabled={!mfa.setupPassword} />
    </div>
);

const MfaQrStep = ({ mfa, setup }: { mfa: MfaFlow; setup: { secret: string; qr: string } }) => (
    <div className={PANEL}>
        <p className="text-xs text-slate-400 mb-3">
            1. Escaneie o QR Code no seu app autenticador (Google Authenticator, Authy...).
        </p>
        <div className="flex flex-col items-center gap-3 mb-4">
            <img src={setup.qr} alt="QR Code do MFA" className="w-40 h-40 rounded-lg bg-white p-2" />
            <div className="text-center">
                <p className="text-[10px] text-slate-500 uppercase tracking-wide">Ou insira a chave manualmente</p>
                <code className="text-[11px] text-slate-300 font-mono break-all">{setup.secret}</code>
            </div>
        </div>
        <p className="text-xs text-slate-400 mb-2">2. Digite o código gerado para confirmar.</p>
        <Input
            label="Código de 6 dígitos"
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={mfa.mfaCode}
            onChange={(e) => mfa.changeMfaCode(e.target.value)}
            containerClassName="mb-0"
            className="text-center tracking-widest"
        />
        {mfa.mfaMsg && (
            <div className={`mt-3 p-2 text-xs font-bold text-center rounded-lg ${toneClass(mfa.mfaMsg.type)}`}>
                {mfa.mfaMsg.text}
            </div>
        )}
        <MfaActions mfa={mfa} label="Ativar 2FA" onConfirm={mfa.confirmEnable} />
    </div>
);

const MfaDisableStep = ({ mfa }: { mfa: MfaFlow }) => (
    <div className={PANEL}>
        {/* O servidor exige o SEGUNDO FATOR para desativar: só a senha não basta —
            quem roubou a senha não pode tirar a proteção que existe contra isso. */}
        <p className="text-xs text-slate-400 mb-3">Confirme com um código do app autenticador <span className="text-slate-500">ou</span> um código de recuperação para desativar.</p>
        <div className="space-y-3">
            <Input
                label="Código do app ou de recuperação"
                type="text"
                inputMode="numeric"
                maxLength={11}
                value={mfa.mfaCode}
                onChange={(e) => mfa.changeMfaCode(e.target.value)}
                containerClassName="mb-0"
                className="text-center tracking-widest"
            />
        </div>
        {mfa.mfaMsg && (
            <div className={ERROR_BOX}>{mfa.mfaMsg.text}</div>
        )}
        <MfaActions mfa={mfa} label="Desativar" onConfirm={mfa.confirmDisable} disabled={!mfa.mfaCode.trim()} />
    </div>
);

/** Painel do segundo fator: chave liga/desliga e o passo corrente (senha, QR ou desativação). */
export const MfaCard = ({ mfa }: { mfa: MfaFlow }) => {
    const { mode, setupData } = mfa;
    return (
        <div className="p-4 bg-card border border-slate-800 rounded-xl transition-colors">
            <MfaToggle mfa={mfa} />
            {/* Painel de SETUP (escanear QR + confirmar código) */}
            {mode === 'setup' && !setupData && <MfaPasswordStep mfa={mfa} />}
            {mode === 'setup' && setupData && <MfaQrStep mfa={mfa} setup={setupData} />}
            {/* Painel de DISABLE (confirmar com código ou senha) */}
            {mode === 'disable' && <MfaDisableStep mfa={mfa} />}
        </div>
    );
};

/** Códigos de backup, mostrados uma única vez depois de ativar. */
export const BackupCodesPanel = ({ mfa }: { mfa: MfaFlow }) => {
    if (!mfa.backupCodes) return null;
    return (
        <div className="p-4 bg-emerald-950/10 border border-emerald-900/40 rounded-xl animate-fade-in">
            <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-bold text-emerald-400">2FA ativado! Guarde seus códigos de backup</p>
                <button
                    type="button"
                    onClick={mfa.closeBackup}
                    aria-label="Fechar códigos de backup"
                    className="text-slate-500 hover:text-white"
                >
                    <X size={16} />
                </button>
            </div>
            <p className="text-[11px] text-slate-400 mb-3">
                Cada código funciona uma vez e serve para entrar caso você perca o acesso ao app. Guarde-os em local seguro — não serão exibidos novamente.
            </p>
            <div className="grid grid-cols-2 gap-2 mb-3">
                {mfa.backupCodes.map((c) => (
                    <code key={c} className="text-xs font-mono text-slate-200 bg-card border border-slate-800 rounded px-2 py-1 text-center">{c}</code>
                ))}
            </div>
            <button onClick={mfa.copyBackup} className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-400 hover:text-emerald-300">
                {mfa.copied ? <Check size={14} /> : <Copy size={14} />}
                {mfa.copied ? 'Copiado!' : 'Copiar todos'}
            </button>
        </div>
    );
};

const PasswordHeader = ({ pwd, formId }: { pwd: PasswordChange; formId: string }) => {
    const open = pwd.isChangingPassword;
    return (
        /* Header do Card de Senha: o título é o botão; o X fica ao lado dele, não dentro (botão dentro de botão). */
        <div className="flex items-center justify-between gap-3 group">
            <button
                type="button"
                className="flex flex-1 items-center justify-between text-left cursor-pointer"
                tabIndex={open ? -1 : 0}
                aria-expanded={open}
                aria-controls={formId}
                onClick={pwd.openForm}
            >
                <span className="flex items-start gap-3">
                    <span className="p-2 rounded-lg bg-slate-800 text-slate-400 group-hover:text-white transition-colors">
                        <ShieldAlert size={18} />
                    </span>
                    <span className="block">
                        <span className="block text-sm font-bold text-slate-200">Alterar Senha</span>
                        <span className="block text-xs text-slate-500 mt-0.5">
                            {open ? 'Preencha os campos abaixo' : 'Clique para redefinir sua senha de acesso'}
                        </span>
                    </span>
                </span>
                {!open && (
                    <ChevronRight size={16} className="text-slate-600 group-hover:text-blue-500 transition-colors" />
                )}
            </button>
            {open && (
                <button
                    type="button"
                    onClick={pwd.closeForm}
                    aria-label="Fechar alteração de senha"
                    className="text-slate-500 hover:text-white"
                >
                    <X size={16} />
                </button>
            )}
        </div>
    );
};

const PasswordForm = ({ pwd, formId }: { pwd: PasswordChange; formId: string }) => (
    <form id={formId} onSubmit={pwd.submitChangePassword} className="mt-6 pt-4 border-t border-slate-800/50 animate-fade-in">
        <div className="space-y-4">
            <Input
                label="Senha Atual"
                type="password"
                name="oldPassword"
                value={pwd.pwdData.oldPassword}
                onChange={pwd.handleChangePwd}
                containerClassName="mb-0"
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                    label="Nova Senha"
                    type="password"
                    name="newPassword"
                    value={pwd.pwdData.newPassword}
                    onChange={pwd.handleChangePwd}
                    containerClassName="mb-0"
                />
                <Input
                    label="Confirmar Nova Senha"
                    type="password"
                    name="confirmPassword"
                    value={pwd.pwdData.confirmPassword}
                    onChange={pwd.handleChangePwd}
                    containerClassName="mb-0"
                />
            </div>
        </div>

        {pwd.pwdMsg && (
            <div className={`mt-4 p-2 text-xs font-bold text-center rounded-lg ${toneClass(pwd.pwdMsg.type)}`}>
                {pwd.pwdMsg.text}
            </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
            <Button
                type="button"
                variant="ghost"
                onClick={pwd.closeForm}
                className="w-auto px-4 py-2 text-xs"
            >
                Cancelar
            </Button>
            <Button
                type="submit"
                status={pwd.loadingPwd ? 'loading' : 'idle'}
                className="w-auto px-6 py-2 text-xs"
            >
                Atualizar Senha
            </Button>
        </div>
    </form>
);

/** Troca de senha: cabeçalho que expande e o formulário. */
export const PasswordCard = ({ pwd, formId }: { pwd: PasswordChange; formId: string }) => (
    <div className={`p-4 bg-card border border-slate-800 rounded-xl transition-all ${pwd.isChangingPassword ? 'border-blue-900/50 bg-blue-900/5' : 'hover:border-slate-700'}`}>
        <PasswordHeader pwd={pwd} formId={formId} />
        {/* Formulário Expansível */}
        {pwd.isChangingPassword && <PasswordForm pwd={pwd} formId={formId} />}
    </div>
);
