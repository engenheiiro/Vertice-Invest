import React, { useState, useRef } from 'react';
import { useAuth, BannerPreset } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { authService } from '../../services/auth';
import { getErrorMessage } from '../../utils/errorMessages';
import { AVATAR_SIZE, avatarFileError, bannerSavedMessage } from './profileIdentityView';

// (3.17) Redimensiona/comprime a imagem escolhida para um quadrado 256×256
// (crop "cover") e devolve uma data-URL pequena. Prefere WebP; cai para JPEG
// se o navegador não suportar WebP no canvas. O resize no cliente mantém o
// payload enviado ao backend pequeno (sem libs externas).
const drawCover = (img: HTMLImageElement): string => {
    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas indisponível.');
    // Crop "cover": usa o menor lado para preencher o quadrado sem distorcer.
    const side = Math.min(img.width, img.height);
    const sx = (img.width - side) / 2;
    const sy = (img.height - side) / 2;
    ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
    const url = canvas.toDataURL('image/webp', 0.82);
    return url.startsWith('data:image/webp') ? url : canvas.toDataURL('image/jpeg', 0.82);
};

const resizeToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Falha ao ler a imagem.'));
        reader.onload = () => {
            const img = new Image();
            img.onerror = () => reject(new Error('Imagem inválida.'));
            img.onload = () => {
                try { resolve(drawCover(img)); } catch (err) { reject(err); }
            };
            img.src = reader.result as string;
        };
        reader.readAsDataURL(file);
    });

/** Foto de perfil: escolher (valida, recorta e envia) e remover. */
export const useAvatarUpload = () => {
    const { refreshProfile } = useAuth();
    const { addToast } = useToast();
    const [uploadingAvatar, setUploadingAvatar] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const runAvatarChange = async (action: () => Promise<unknown>, success: string, failure: string) => {
        setUploadingAvatar(true);
        try {
            await action();
            await refreshProfile();
            addToast(success, 'success');
        } catch (err: unknown) {
            addToast(getErrorMessage(err, failure), 'error');
        } finally {
            setUploadingAvatar(false);
        }
    };

    const handleAvatarPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = ''; // permite re-selecionar o mesmo arquivo
        if (!file) return;
        const error = avatarFileError(file);
        if (error) { addToast(error, 'error'); return; }
        await runAvatarChange(
            async () => authService.updateAvatar(await resizeToDataUrl(file)),
            'Foto de perfil atualizada.',
            'Não foi possível atualizar a foto.',
        );
    };

    const handleAvatarRemove = async () => {
        if (uploadingAvatar) return;
        await runAvatarChange(() => authService.removeAvatar(), 'Foto de perfil removida.', 'Não foi possível remover a foto.');
    };

    const openFilePicker = () => fileInputRef.current?.click();

    return { uploadingAvatar, fileInputRef, handleAvatarPick, handleAvatarRemove, openFilePicker };
};

/** Seletor de banner (3.20): abrir/fechar e salvar o preset (ou '' = padrão do plano). */
export const useBannerPicker = () => {
    const { user, refreshProfile } = useAuth();
    const { addToast } = useToast();
    const [pickerOpen, setPickerOpen] = useState(false);
    const [saving, setSaving] = useState(false);

    const applyBanner = async (key: BannerPreset | '') => {
        if (saving) return;
        if ((user?.bannerColor || '') === key) { setPickerOpen(false); return; }
        setSaving(true);
        try {
            await authService.updateProfile({ bannerColor: key });
            await refreshProfile();
            addToast(bannerSavedMessage(key), 'success');
            setPickerOpen(false);
        } catch (err: unknown) {
            addToast(getErrorMessage(err, 'Não foi possível atualizar o banner.'), 'error');
        } finally {
            setSaving(false);
        }
    };

    const togglePicker = () => setPickerOpen(o => !o);

    return { pickerOpen, saving, applyBanner, togglePicker };
};
