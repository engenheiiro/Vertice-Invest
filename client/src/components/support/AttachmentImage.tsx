import React, { useEffect, useState } from 'react';
import { ImageOff, Loader2 } from 'lucide-react';
import { supportService } from '../../services/support';

/**
 * Miniatura de um anexo, carregada com o token da sessão.
 *
 * Existe porque `<img src="/api/support/attachments/...">` não manda header de
 * autorização e voltaria 401 — o access token vive só na memória da aba. Aqui a
 * imagem é buscada, virada em object URL e só então exibida.
 *
 * Anexo de conta excluída some do banco (LGPD) mas continua referenciado na
 * mensagem; por isso o estado de erro é uma mensagem honesta, não um ícone
 * quebrado.
 */
export const AttachmentImage: React.FC<{ id: string; onOpen?: (url: string) => void }> = ({ id, onOpen }) => {
    const [url, setUrl] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let alive = true;
        supportService.loadAttachment(id)
            .then((objectUrl) => { if (alive) setUrl(objectUrl); })
            .catch(() => { if (alive) setFailed(true); });
        return () => { alive = false; };
    }, [id]);

    if (failed) {
        return (
            <div className="w-20 h-20 rounded-lg border border-slate-800 bg-slate-900/50 flex flex-col items-center justify-center gap-1 text-slate-600">
                <ImageOff size={16} />
                <span className="text-[9px]">removido</span>
            </div>
        );
    }

    if (!url) {
        return (
            <div className="w-20 h-20 rounded-lg border border-slate-800 bg-slate-900/50 flex items-center justify-center">
                <Loader2 size={16} className="animate-spin text-slate-600" />
            </div>
        );
    }

    return (
        <button
            type="button"
            onClick={() => onOpen?.(url)}
            className="w-20 h-20 rounded-lg border border-slate-800 overflow-hidden hover:border-blue-700 transition-colors"
            title="Ampliar"
        >
            <img src={url} alt="Anexo do ticket" className="w-full h-full object-cover" />
        </button>
    );
};
