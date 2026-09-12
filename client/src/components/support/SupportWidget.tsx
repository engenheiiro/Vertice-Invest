import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { LifeBuoy } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { supportService } from '../../services/support';
import { SupportCenter } from './SupportCenter';

/**
 * Botão flutuante de suporte, presente em toda a área logada.
 *
 * A porta de entrada é um botão sempre à mão porque o momento em que a pessoa
 * consegue descrever o problema é o momento em que ele acontece — dois cliques
 * depois, dentro de um menu, ela já esqueceu em que tela estava (e o contexto
 * técnico que vai junto no ticket apontaria para a tela errada).
 *
 * Não aparece em `/suporte` nem em `/admin`: na primeira a central já está
 * aberta em página inteira, e na segunda quem está na tela é o atendimento, não
 * quem precisa dele. Nos dois casos o botão seria um atalho para onde a pessoa
 * já está.
 */
export const SupportWidget: React.FC = () => {
    const { isAuthenticated } = useAuth();
    const { pathname } = useLocation();
    const [open, setOpen] = useState(false);

    // Calculado antes da query: escondido também significa não perguntar.
    const hidden = !isAuthenticated || pathname === '/suporte' || pathname.startsWith('/admin');

    // A lista serve a duas coisas: alimentar a bolinha de resposta nova e já
    // deixar os tickets em cache quando o painel abrir.
    const { data: tickets = [] } = useQuery({
        queryKey: ['support', 'tickets'],
        queryFn: supportService.listMyTickets,
        enabled: !hidden,
        refetchInterval: 120_000,
        refetchOnWindowFocus: true,
        staleTime: 60_000,
    });

    const unread = tickets.filter((t) => t.hasUnreadForUser).length;

    // Fechar no Esc: o painel é modal, e modal que só fecha no X prende quem
    // abriu por engano.
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open]);

    if (hidden) return null;

    return (
        <>
            <button
                onClick={() => setOpen(true)}
                // z-40: abaixo dos modais do app (z-[100]) e da BottomNav (z-50).
                // Um botão de suporte flutuando por cima de um modal de
                // confirmação seria uma armadilha de clique.
                //
                // Abaixo de xl a BottomNav ocupa a base da tela, então o botão
                // sobe para não cobrir a navegação (nem ser coberto por ela).
                //
                // Azul-600 sólido com ícone BRANCO: é literalmente a gramática da
                // logo (quadrado azul, escudo branco). Um ícone colorido sobre
                // fundo azul seria uma terceira cor sem motivo — e o botão passa
                // o dia inteiro em cima da tela de todo mundo.
                className="group fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] xl:bottom-6 right-4 xl:right-6 z-40 flex items-center h-12 px-3.5 rounded-full bg-blue-600 hover:bg-blue-500 text-white ring-1 ring-inset ring-white/15 shadow-[0_10px_30px_-8px_rgba(37,99,235,0.75)] hover:shadow-[0_14px_36px_-8px_rgba(37,99,235,0.9)] hover:-translate-y-0.5 active:translate-y-0 transition-all duration-300"
                aria-label="Abrir suporte"
                title="Suporte"
            >
                <LifeBuoy size={20} className="shrink-0 transition-transform duration-500 group-hover:rotate-45" />

                {/* O rótulo cresce no hover em vez de ficar sempre aberto: em
                    repouso o botão é um alvo redondo e discreto; ao mirar nele,
                    ele mesmo diz o que é. Em telas de toque não há hover, e o
                    ícone de boia já é o vocabulário universal de ajuda. */}
                <span className="hidden xl:block max-w-0 opacity-0 group-hover:max-w-[80px] group-hover:opacity-100 group-hover:ml-2 overflow-hidden whitespace-nowrap text-[13px] font-bold leading-none transition-all duration-300">
                    Suporte
                </span>

                {unread > 0 && (
                    <>
                        {/* O anel pulsante é o que faz a resposta ser notada sem
                            o usuário estar olhando para o canto da tela. */}
                        <span className="absolute inset-0 rounded-full ring-2 ring-emerald-400/60 animate-ping pointer-events-none" />
                        <span
                            className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1.5 rounded-full bg-emerald-400 text-[10px] font-black text-emerald-950 flex items-center justify-center ring-2 ring-deep"
                            title={`${unread} resposta(s) nova(s)`}
                        >
                            {unread}
                        </span>
                    </>
                )}
            </button>

            {open && createPortal(
                <div
                    className="fixed inset-0 z-[100] backdrop-blur-md bg-black/95 flex items-end sm:items-center justify-center sm:justify-end p-0 sm:p-6"
                    onClick={() => setOpen(false)}
                >
                    <div
                        className="relative w-full sm:w-[420px] max-h-[92vh] bg-panel border border-slate-800 rounded-t-2xl sm:rounded-2xl overflow-hidden flex flex-col animate-fade-in"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <SupportCenter onClose={() => setOpen(false)} />
                    </div>
                </div>,
                document.body,
            )}
        </>
    );
};
