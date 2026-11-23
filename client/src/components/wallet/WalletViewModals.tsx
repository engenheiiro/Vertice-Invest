import React, { lazy, Suspense } from 'react';
import { AddAssetModal } from './AddAssetModal';
import { SmartContributionModal } from './SmartContributionModal';
import { RebalanceModal } from './RebalanceModal';
import { RenameWalletModal } from './RenameWalletModal';
import { ConfirmModal } from '../ui/ConfirmModal';
// Importação de carteira: lazy porque arrasta o leitor de planilha (fflate) e os
// parsers junto — peso que quem nunca importa não precisa baixar.
const ImportWalletModal = lazy(() => import('./import/ImportWalletModal').then(m => ({ default: m.ImportWalletModal })));

export type WalletModalKey = 'add' | 'import' | 'smart' | 'rebalance' | 'rename' | 'reset' | 'limit';

interface WalletModalsProps {
    open: Record<WalletModalKey, boolean>;
    onClose: (key: WalletModalKey) => void;
    limitMessage: string;
    walletId: React.ComponentProps<typeof RenameWalletModal>['walletId'];
    walletName: React.ComponentProps<typeof RenameWalletModal>['currentName'];
    onUpgrade: () => void;
    onReset: () => void;
}

/** Modais existem só onde há escrita — o link público não os monta. */
export const WalletModals: React.FC<WalletModalsProps> = ({ open, onClose, limitMessage, walletId, walletName, onUpgrade, onReset }) => (
    <>
        <AddAssetModal isOpen={open.add} onClose={() => onClose('add')} />
        {/* Só monta quando aberto: o chunk do leitor de planilha e dos
            parsers não é baixado por quem nunca clica em Importar. */}
        {open.import && (
            <Suspense fallback={null}>
                <ImportWalletModal isOpen onClose={() => onClose('import')} />
            </Suspense>
        )}
        <SmartContributionModal isOpen={open.smart} onClose={() => onClose('smart')} />
        <RebalanceModal isOpen={open.rebalance} onClose={() => onClose('rebalance')} />
        <RenameWalletModal
            isOpen={open.rename}
            mode="rename"
            walletId={walletId}
            currentName={walletName}
            onClose={() => onClose('rename')}
        />

        <ConfirmModal
            isOpen={open.limit}
            onClose={() => onClose('limit')}
            onConfirm={onUpgrade}
            title="Acesso Restrito"
            message={`${limitMessage}\n\nDeseja fazer um upgrade agora?`}
            confirmText="Ver Planos"
            isDestructive={false}
        />

        <ConfirmModal
            isOpen={open.reset}
            onClose={() => onClose('reset')}
            onConfirm={onReset}
            title="Excluir Carteira Permanentemente?"
            message="ATENÇÃO: Esta ação é irreversível. Todo o histórico será apagado."
            isDestructive={true}
            confirmText="Sim, Excluir Tudo"
        />
    </>
);
