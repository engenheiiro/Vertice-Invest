import mongoose from 'mongoose';
import {
    PRIORITY_RANK,
    TICKET_CATEGORIES,
    TICKET_PRIORITIES,
    TICKET_STATUSES,
} from '../utils/supportRules.js';

/**
 * Ticket de suporte: a conversa entre um usuário e o atendimento.
 *
 * Três decisões de modelagem que valem explicação:
 *
 * 1. `messages[]` é embutido porque a thread é curta por natureza (unidade de
 *    leitura: abriu, respondeu, resolveu) e nunca é lida sem o ticket. Os
 *    binários ficam fora, em `SupportAttachment` — ver o comentário de lá.
 *
 * 2. `userEmail`/`userName`/`planAtOpen` são desnormalizados de propósito. O
 *    plano congelado responde "ele era ELITE quando reclamou?" mesmo depois de
 *    um downgrade, e o e-mail mantém o histórico legível quando a conta é
 *    excluída (a exclusão anonimiza `user`, não apaga o atendimento).
 *
 * 3. Sem TTL. O ErrorLog expira em 14 dias porque erro velho não é sinal; ticket
 *    é registro comercial e fica.
 */

// Contexto técnico da abertura. Invisível para o usuário (`serializeTicketForUser`
// remove o campo) e existe para matar a ida e volta do "em que tela foi?".
const TicketContextSchema = new mongoose.Schema({
    route: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    platform: { type: String, default: '' },
    viewport: { type: String, default: '' },
    timezone: { type: String, default: '' },
    appVersion: { type: String, default: '' },
    // Últimas falhas de API da sessão do usuário, capturadas no cliente.
    recentErrors: [{
        _id: false,
        at: { type: Date },
        status: { type: Number },
        path: { type: String },
        message: { type: String },
    }],
}, { _id: false });

const TicketMessageSchema = new mongoose.Schema({
    authorRole: { type: String, enum: ['USER', 'ADMIN'], required: true },
    // Quem escreveu. Null em mensagem do sistema (reabertura, encerramento).
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    authorName: { type: String, default: '' },
    body: { type: String, required: true },
    // Nota interna: nunca sai na serialização do usuário. Só o admin escreve.
    isInternal: { type: Boolean, default: false },
    attachments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'SupportAttachment' }],
    createdAt: { type: Date, default: Date.now },
});

const SupportTicketSchema = new mongoose.Schema({
    // Código legível ("VT-0042") — é como você e o usuário citam o ticket.
    code: { type: String, required: true, unique: true },

    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    userEmail: { type: String, default: '' },
    userName: { type: String, default: '' },
    planAtOpen: { type: String, default: 'GUEST' },

    category: { type: String, enum: TICKET_CATEGORIES, required: true },
    subject: { type: String, required: true },
    // Sem `index: true`: o composto abaixo começa por `status` e um índice
    // composto atende também as consultas pelo seu prefixo. Declarar nos dois
    // lugares criaria um segundo índice, pago em toda escrita e usado em nenhuma
    // leitura — mesmo cuidado documentado no ErrorLog.
    status: { type: String, enum: TICKET_STATUSES, default: 'ABERTO' },
    priority: { type: String, enum: TICKET_PRIORITIES, default: 'NORMAL', index: true },
    // Espelho numérico da prioridade, derivado no `pre('save')`.
    //
    // Existe porque o Mongo ordena string em ordem ALFABÉTICA: `sort({ priority: -1 })`
    // colocaria NORMAL na frente de ALTA — exatamente o oposto do que o painel
    // precisa, e do jeito silencioso que passa despercebido numa lista curta.
    priorityRank: { type: Number, default: 1, index: true },

    context: { type: TicketContextSchema, default: () => ({}) },
    messages: { type: [TicketMessageSchema], default: [] },
    // Tamanho da thread, desnormalizado no `pre('save')`. Existe para a fila do
    // Admin e o CSV poderem projetar `-messages`: sem ele, contar mensagens
    // obrigaria a baixar todas elas só para exibir um número.
    messageCount: { type: Number, default: 0 },

    // Etiquetas internas de triagem (só admin vê e escreve).
    internalTags: [{ type: String }],

    // Ticket que originou este, quando a janela de reabertura já havia fechado.
    relatedTicket: { type: mongoose.Schema.Types.ObjectId, ref: 'SupportTicket', default: null },

    // Relógios da fila. `lastUserMessageAt` é o que mede espera — ver
    // `compareTicketsForQueue`.
    lastUserMessageAt: { type: Date, default: Date.now },
    lastAdminMessageAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },

    // O usuário tem resposta nova que ainda não abriu (bolinha no botão flutuante).
    hasUnreadForUser: { type: Boolean, default: false },

    // Quando a limpeza apagou as imagens deste ticket (retenção de 30 dias após
    // o encerramento). Preenchido = as miniaturas vazias são POLÍTICA, não
    // defeito — e a tela consegue dizer isso em vez de mostrar erro.
    attachmentsPurgedAt: { type: Date, default: null },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});

// Fila do Admin: prioridade + espera. Cobre a ordenação padrão do painel.
SupportTicketSchema.index({ status: 1, priorityRank: -1, lastUserMessageAt: 1 });
// "Meus tickets" do usuário, mais recentes primeiro.
SupportTicketSchema.index({ user: 1, createdAt: -1 });
// Não existe índice de texto aqui de propósito. A busca do painel é por regex
// case-insensitive sobre código, assunto, nome e e-mail — um índice `text` não
// seria usado por ela, e ainda assim custaria análise linguística de TODO corpo
// de mensagem a cada gravação. Se um dia a busca virar $text, ele volta junto.

SupportTicketSchema.pre('save', function markUpdated(next) {
    this.updatedAt = new Date();
    // Fonte única: quem escreve é `priority`; `priorityRank` só acompanha. Deixar
    // os dois a cargo do chamador é como eles se separam.
    this.priorityRank = PRIORITY_RANK[this.priority] ?? 1;
    this.messageCount = this.messages.length;
    next();
});

const SupportTicket = mongoose.models.SupportTicket
    || mongoose.model('SupportTicket', SupportTicketSchema);

export default SupportTicket;
