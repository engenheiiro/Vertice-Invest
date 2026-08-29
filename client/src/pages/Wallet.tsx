import React from 'react';
import { Header } from '../components/dashboard/Header';
import { WalletView } from '../components/wallet/WalletView';

/**
 * Página Carteira da área logada: moldura (Header + fundo) em volta da
 * WalletView. O corpo vive em WalletView porque o link público compartilhado
 * renderiza exatamente a mesma view, em modo leitura — ver PublicWallet.
 */
export const Wallet = () => (
    <div className="min-h-screen bg-deep text-white font-sans selection:bg-blue-500/30 pb-[calc(4rem+env(safe-area-inset-bottom))] xl:pb-0">
        <Header />
        <WalletView />
    </div>
);
