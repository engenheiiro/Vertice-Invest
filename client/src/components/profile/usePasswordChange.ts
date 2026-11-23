/**
 * Troca de senha da tela de Segurança: formulário expansível, validação local
 * (tamanho e confirmação) antes de chamar o servidor, e recolhimento 2 s depois
 * do sucesso.
 */
import React, { useState } from 'react';
import { authService } from '../../services/auth';
import { getErrorMessage } from '../../utils/errorMessages';

export type PasswordMsg = { type: 'success' | 'error'; text: string } | null;
export type PasswordForm = { oldPassword: string; newPassword: string; confirmPassword: string };

const EMPTY_FORM: PasswordForm = { oldPassword: '', newPassword: '', confirmPassword: '' };

/** Mensagem do primeiro problema local do formulário, ou null se pode ir ao servidor. */
export function validateNewPassword(data: PasswordForm): string | null {
    if (data.newPassword.length < 6) return 'A nova senha deve ter no mínimo 6 caracteres.';
    if (data.newPassword !== data.confirmPassword) return 'As novas senhas não conferem.';
    return null;
}

export function usePasswordChange() {
    const [isChangingPassword, setIsChangingPassword] = useState(false);
    const [pwdData, setPwdData] = useState<PasswordForm>(EMPTY_FORM);
    const [loadingPwd, setLoadingPwd] = useState(false);
    const [pwdMsg, setPwdMsg] = useState<PasswordMsg>(null);

    const openForm = () => { if (!isChangingPassword) setIsChangingPassword(true); };
    const closeForm = () => { setIsChangingPassword(false); setPwdMsg(null); };

    const handleChangePwd = (e: React.ChangeEvent<HTMLInputElement>) => {
        setPwdData({ ...pwdData, [e.target.name]: e.target.value });
        if (pwdMsg) setPwdMsg(null);
    };

    const submitChangePassword = async (e: React.FormEvent) => {
        e.preventDefault();

        const invalid = validateNewPassword(pwdData);
        if (invalid) {
            setPwdMsg({ type: 'error', text: invalid });
            return;
        }

        setLoadingPwd(true);
        try {
            await authService.changePassword({
                oldPassword: pwdData.oldPassword,
                newPassword: pwdData.newPassword
            });
            setPwdMsg({ type: 'success', text: 'Senha alterada com sucesso!' });
            setPwdData(EMPTY_FORM);
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

    return { isChangingPassword, pwdData, loadingPwd, pwdMsg, openForm, closeForm, handleChangePwd, submitChangePassword };
}

export type PasswordChange = ReturnType<typeof usePasswordChange>;
