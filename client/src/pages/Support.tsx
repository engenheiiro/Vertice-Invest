import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { LifeBuoy } from 'lucide-react';
import { Header } from '../components/dashboard/Header';
import { SupportCenter } from '../components/support/SupportCenter';

/**
 * Central de atendimento em página inteira.
 *
 * É o endereço para onde o e-mail de resposta aponta (`/suporte?ticket=VT-0042`).
 * A entrada do dia a dia continua sendo o botão flutuante — esta rota existe
 * porque um link de e-mail precisa de um lugar estável para aterrissar, e porque
 * uma conversa longa se lê melhor com a tela inteira do que num painel lateral.
 *
 * O conteúdo é o MESMO componente do painel: uma tela, duas molduras.
 */
const Support: React.FC = () => {
    const [params] = useSearchParams();

    return (
        <div className="min-h-screen bg-deep text-white pb-[calc(5rem+env(safe-area-inset-bottom))] xl:pb-8">
            <Header />
            <main id="main-content" className="max-w-[900px] mx-auto p-4 md:p-6">
                <div className="mb-6">
                    <h1 className="text-xl md:text-2xl font-bold text-slate-100 flex items-center gap-2">
                        <LifeBuoy className="text-blue-400" size={24} /> Suporte
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">
                        Relate um problema, tire uma dúvida e acompanhe suas conversas com a equipe.
                    </p>
                </div>

                <div className="bg-panel border border-slate-800 rounded-2xl overflow-hidden">
                    <SupportCenter variant="page" initialTicketCode={params.get('ticket')} />
                </div>
            </main>
        </div>
    );
};

export default Support;
