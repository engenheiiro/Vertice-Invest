
import React from 'react';
import { createPortal } from 'react-dom';
import { X, Activity } from 'lucide-react';
import type { RankingItem } from '../../services/research';
import { AssetDetailSidebar } from './AssetDetailSidebar';
import { AssetDetailDossier } from './AssetDetailDossier';

interface AssetDetailModalProps {
    isOpen: boolean;
    onClose: () => void;
    asset: RankingItem | null;
}

const PANEL = 'relative w-full max-w-5xl bg-base border border-slate-700 rounded-3xl overflow-y-auto md:overflow-hidden shadow-2xl '
    + 'animate-fade-in flex flex-col md:flex-row max-h-[90vh]';
const DESKTOP_CLOSE = 'hidden md:flex min-h-[44px] min-w-[44px] items-center justify-center hover:bg-slate-800 rounded-full text-slate-500 '
    + 'transition-colors';

/**
 * Dossiê de um ativo do ranking. A derivação (formatos, semáforo, nota, recorte
 * da auditoria pelo perfil) mora em `assetDetailView.ts`; aqui só a moldura.
 */
export const AssetDetailModal: React.FC<AssetDetailModalProps> = ({ isOpen, onClose, asset }) => {
    if (!isOpen || !asset) return null;

    return createPortal(
        <div className="relative z-[100]" role="dialog" aria-modal="true" aria-labelledby="asset-detail-title">
            <div className="fixed inset-0 bg-black/95 backdrop-blur-md animate-fade-in" role="presentation" onClick={onClose}></div>

            <div className="fixed inset-0 z-10 overflow-y-auto">
                <div className="flex min-h-full items-center justify-center p-2 sm:p-4">
                    {/* Mobile: UMA rolagem só no painel. Antes, sidebar e conteúdo eram dois
                        flex-children com scroll próprio dentro de max-h-[90vh] — cada um ficava
                        com meia tela e o dossiê aparecia espremido no meio do modal. */}
                    <div className={PANEL}>
                        <AssetDetailSidebar asset={asset} onClose={onClose} />

                        <div className="flex-1 bg-base flex flex-col md:overflow-hidden">
                            <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-card">
                                <h3 className="text-sm font-bold text-white uppercase tracking-widest flex items-center gap-2">
                                    <Activity size={16} className="text-blue-500" /> Dossiê do Investidor
                                </h3>
                                <button onClick={onClose} aria-label="Fechar" className={DESKTOP_CLOSE}>
                                    <X size={20} />
                                </button>
                            </div>
                            <AssetDetailDossier asset={asset} />
                        </div>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};
