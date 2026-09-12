import type { TicketCategory, TicketStatus, TicketPriority } from '../../services/support';

/**
 * Vocabulário do atendimento na tela — rótulo, explicação e cor.
 *
 * Fica num arquivo só porque as mesmas seis categorias e cinco status aparecem
 * no formulário do usuário, na lista dele e no painel do Admin. Três cópias da
 * mesma tabela é como "Dado incorreto" vira "Dados incorretos" em uma tela só.
 */

export const CATEGORY_LABEL: Record<TicketCategory, { label: string; hint: string }> = {
    BUG: { label: 'Algo não funciona', hint: 'Botão que não responde, tela que não carrega, erro na tela.' },
    DADO_INCORRETO: { label: 'Dado incorreto', hint: 'Preço, provento, rentabilidade ou indicador diferente do esperado.' },
    DUVIDA: { label: 'Dúvida', hint: 'Como usar alguma coisa, ou o que um número significa.' },
    SUGESTAO: { label: 'Sugestão', hint: 'Ideia de melhoria ou funcionalidade nova.' },
    COBRANCA: { label: 'Assinatura e cobrança', hint: 'Pagamento, plano, nota fiscal, cancelamento.' },
    OUTRO: { label: 'Outro assunto', hint: 'Qualquer coisa que não se encaixa acima.' },
};

export const STATUS_UI: Record<TicketStatus, { label: string; className: string; userHint: string }> = {
    ABERTO: {
        label: 'Aberto',
        className: 'bg-blue-900/20 text-blue-400 border-blue-900/50',
        userHint: 'Recebemos. Em breve alguém olha.',
    },
    EM_ANALISE: {
        label: 'Em análise',
        className: 'bg-purple-900/20 text-purple-400 border-purple-900/50',
        userHint: 'Estamos investigando.',
    },
    RESPONDIDO: {
        label: 'Respondido',
        className: 'bg-emerald-900/20 text-emerald-400 border-emerald-900/50',
        userHint: 'Há uma resposta esperando por você.',
    },
    RESOLVIDO: {
        label: 'Resolvido',
        className: 'bg-slate-800 text-slate-300 border-slate-700',
        userHint: 'Encerrado. Se ainda estiver ruim, é só responder.',
    },
    FECHADO: {
        label: 'Fechado',
        className: 'bg-slate-800/60 text-slate-500 border-slate-800',
        userHint: 'Atendimento encerrado.',
    },
};

export const PRIORITY_UI: Record<TicketPriority, { label: string; className: string }> = {
    ALTA: { label: 'Alta', className: 'text-red-400 bg-red-900/20 border-red-900/50' },
    MEDIA: { label: 'Média', className: 'text-yellow-400 bg-yellow-900/20 border-yellow-900/50' },
    NORMAL: { label: 'Normal', className: 'text-slate-400 bg-slate-800 border-slate-700' },
};

/** "há 3 min", "ontem" — a idade é o que importa numa fila, não a data exata. */
export function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'agora';
    if (mins < 60) return `há ${mins} min`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `há ${hrs}h`;
    const days = Math.floor(hrs / 24);
    if (days === 1) return 'ontem';
    if (days < 30) return `há ${days} dias`;
    return new Date(iso).toLocaleDateString('pt-BR');
}
