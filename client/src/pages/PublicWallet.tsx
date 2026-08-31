import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, Lock, ArrowUpRight } from 'lucide-react';
import { PublicWalletProvider } from '../contexts/PublicWalletProvider';
import { WalletView } from '../components/wallet/WalletView';
import { publicWalletQueryOptions, type PublicWalletData } from '../services/publicWallet';
import { PageMeta } from '../components/seo/PageMeta';

/**
 * (C4) Carteira pública — o link compartilhado renderiza a MESMA página Carteira
 * do dono (WalletView), alimentada pelo PublicWalletProvider em modo leitura.
 * Esta página monta apenas a moldura do visitante: ele não está logado, então no
 * lugar do Header da área logada entram a marca, o convite para criar conta e o
 * aviso legal do rodapé.
 */

const Shell: React.FC<React.PropsWithChildren> = ({ children }) => (
    <div className="min-h-screen bg-deep text-white font-sans selection:bg-blue-500/30">
        {/* O token é secreto por design: quem compartilha manda para alguém, não
            para o mundo. O robots.txt pede que não rastreiem /p/, mas robots.txt
            é pedido — o noindex é o que impede a página de virar resultado de
            busca se alguém publicar o link em algum lugar. Fica no Shell para
            valer nos três estados, inclusive no erro. */}
        <PageMeta title="Carteira compartilhada" noindex />
        <header className="border-b border-slate-800/80">
            <div className="max-w-[1360px] mx-auto px-4 md:px-6 py-3 flex items-center justify-between">
                <Link to="/" className="flex items-center gap-2 font-bold">
                    <ShieldCheck className="text-blue-400" size={20} />
                    <span>Vértice <span className="text-slate-500 font-medium">Invest</span></span>
                </Link>
                <Link
                    to="/register"
                    className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg px-3.5 py-2 text-xs transition-colors"
                >
                    Criar minha carteira <ArrowUpRight size={14} />
                </Link>
            </div>
        </header>
        {children}
        <footer className="max-w-[1360px] mx-auto px-4 md:px-6 pb-10 pt-2">
            <p className="text-[11px] text-slate-600 leading-relaxed">
                Página informativa gerada pelo próprio investidor. Composição e rentabilidade
                não constituem recomendação ou oferta de investimento. Desempenho passado não
                garante resultados futuros.
            </p>
        </footer>
    </div>
);

const Message: React.FC<{ title: string; description: string }> = ({ title, description }) => (
    <main className="max-w-[1360px] mx-auto px-4 md:px-6 py-10">
        <div className="bg-card border border-slate-800 rounded-2xl p-10 text-center">
            <Lock className="mx-auto text-slate-600 mb-3" size={32} />
            <h1 className="text-lg font-bold text-slate-200">{title}</h1>
            <p className="text-sm text-slate-500 mt-1">{description}</p>
            <Link to="/" className="inline-block mt-5 text-blue-400 hover:text-blue-300 text-sm font-semibold">
                Conhecer o Vértice →
            </Link>
        </div>
    </main>
);

export const PublicWallet: React.FC = () => {
    const { token = '' } = useParams();
    // Mesma chave da query do provider: uma única requisição alimenta os dois.
    const { data, isLoading, isError, error } = useQuery<PublicWalletData>(publicWalletQueryOptions(token));

    if (isLoading) {
        return (
            <Shell>
                <main className="max-w-[1360px] mx-auto px-4 md:px-6 py-8">
                    <div className="animate-pulse space-y-4">
                        <div className="h-8 w-64 bg-slate-800 rounded" />
                        <div className="h-28 bg-card border border-slate-800 rounded-2xl" />
                        <div className="h-64 bg-card border border-slate-800 rounded-2xl" />
                    </div>
                </main>
            </Shell>
        );
    }

    if (isError || !data) {
        const notFound = (error as any)?.message === 'NOT_FOUND';
        return (
            <Shell>
                <Message
                    title={notFound ? 'Carteira não encontrada' : 'Não foi possível carregar'}
                    description={notFound
                        ? 'Este link pode ter sido desativado pelo dono ou nunca ter existido.'
                        : 'Tente novamente em instantes.'}
                />
            </Shell>
        );
    }

    return (
        <Shell>
            <PublicWalletProvider token={token}>
                <WalletView ownerFirstName={data.wallet.ownerFirstName} />
            </PublicWalletProvider>
        </Shell>
    );
};

export default PublicWallet;
