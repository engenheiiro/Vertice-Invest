import React, { useEffect, useState } from 'react';
import { ImageOff, Loader2 } from 'lucide-react';
import { supportService, SupportRequestError } from '../../services/support';

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
    const [failure, setFailure] = useState<'none' | 'gone' | 'transient'>('none');
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let alive = true;
        setFailure('none');
        supportService.loadAttachment(id)
            .then((objectUrl) => { if (alive) setUrl(objectUrl); })
            .catch((err) => {
                if (!alive) return;
                // 404 é o servidor dizendo "não existe mais" — imagem apagada pela
                // retenção de 30 dias ou por exclusão de conta. Qualquer outra
                // coisa é "não consegui buscar agora", e tem conserto na hora.
                const gone = err instanceof SupportRequestError && err.status === 404;
                setFailure(gone ? 'gone' : 'transient');
            });
        return () => { alive = false; };
    }, [id, attempt]);

    if (failure === 'gone') {
        return (
            <div
                className="w-20 h-20 rounded-lg border border-slate-800 bg-slate-900/50 flex flex-col items-center justify-center gap-1 text-slate-600"
                title="Anexo não está mais disponível. Imagens de tickets encerrados são apagadas 30 dias depois."
            >
                <ImageOff size={16} />
                <span className="text-[9px]">expirado</span>
            </div>
        );
    }

    if (failure === 'transient') {
        // Aqui NÃO se afirma exclusão: a rede pode ter caído. Dizer "removido"
        // numa falha passageira faz o atendimento concluir que o print nunca
        // existiu.
        return (
            <button
                type="button"
                onClick={() => setAttempt((n) => n + 1)}
                className="w-20 h-20 rounded-lg border border-slate-800 bg-slate-900/50 flex flex-col items-center justify-center gap-1 text-slate-600 hover:text-slate-400 hover:border-slate-700 transition-colors"
                title="Não foi possível carregar este anexo. Clique para tentar de novo."
            >
                <ImageOff size={16} />
                <span className="text-[9px]">recarregar</span>
            </button>
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
