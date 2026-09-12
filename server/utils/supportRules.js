/**
 * Regras puras do atendimento (tickets de suporte).
 *
 * Tudo aqui é função sem I/O: recebe estado, devolve decisão. O serviço lê o
 * banco e aplica; estas funções só respondem "pode?" e "vira o quê?". É o que
 * torna a máquina de estados testável sem Mongo.
 *
 * A separação importa porque a transição de status tem duas gramáticas
 * diferentes — a do usuário e a do admin — e misturá-las no controller é como
 * essas regras costumam apodrecer.
 */
import { basePlanOf, PLAN_HIERARCHY } from '../config/subscription.js';

// ─── Vocabulário ─────────────────────────────────────────────────────────────

export const TICKET_CATEGORIES = ['BUG', 'DADO_INCORRETO', 'DUVIDA', 'SUGESTAO', 'COBRANCA', 'OUTRO'];

export const TICKET_STATUSES = ['ABERTO', 'EM_ANALISE', 'RESPONDIDO', 'RESOLVIDO', 'FECHADO'];

export const TICKET_PRIORITIES = ['NORMAL', 'MEDIA', 'ALTA'];

// Status que contam como "na sua mesa" — alimentam o badge do Admin e o teto de
// tickets abertos por usuário.
export const OPEN_STATUSES = ['ABERTO', 'EM_ANALISE', 'RESPONDIDO'];

// Teto de tickets simultâneos por usuário. Não é anti-fraude, é anti-enxurrada:
// quem abre cinco tickets sobre o mesmo assunto fragmenta o atendimento.
export const MAX_OPEN_TICKETS_PER_USER = 3;

// Janela em que uma resposta do usuário ressuscita um ticket RESOLVIDO. Depois
// disso a conversa virou arqueologia e a resposta vira ticket novo, ligado ao
// antigo por `relatedTicket`.
export const REOPEN_WINDOW_DAYS = 7;

// Anexos: 3 por mensagem, 8 no ticket inteiro. O teto do ticket existe porque o
// limite por mensagem sozinho é burlável respondendo dez vezes.
export const MAX_ATTACHMENTS_PER_MESSAGE = 3;
export const MAX_ATTACHMENTS_PER_TICKET = 8;

// ~1MB por imagem DEPOIS da compressão no navegador. O base64 infla ~33% sobre
// o binário, então o teto é medido na string que chega — é ela que ocupa o banco.
export const MAX_ATTACHMENT_BYTES = 1_400_000;

export const ALLOWED_ATTACHMENT_MIME = ['image/png', 'image/jpeg', 'image/webp'];

// Mesma disciplina do avatar: data-URL fechada por regex, nunca `startsWith`.
export const ATTACHMENT_DATAURL_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

// ─── Prioridade ──────────────────────────────────────────────────────────────

/**
 * Prioridade derivada do plano. A /pricing vende "suporte prioritário" para
 * ELITE e BLACK — quem paga por fila preferencial entra na frente sem depender
 * de alguém lembrar disso na hora de triar.
 *
 * Deriva da hierarquia (não de uma lista de nomes) para que um plano novo acima
 * do ELITE nasça com prioridade correta em vez de cair no `NORMAL` por omissão.
 */
export function priorityFromPlan(plan) {
  const level = PLAN_HIERARCHY[basePlanOf(plan)] ?? 0;
  if (level >= PLAN_HIERARCHY.ELITE) return 'ALTA';
  if (level >= PLAN_HIERARCHY.PRO) return 'MEDIA';
  return 'NORMAL';
}

// Posto numérico da prioridade. O modelo espelha este valor em `priorityRank`
// porque o Mongo ordena string em ordem alfabética, e "NORMAL" > "ALTA".
export const PRIORITY_RANK = { ALTA: 3, MEDIA: 2, NORMAL: 1 };

/**
 * Ordem da fila do Admin: prioridade primeiro, depois quem espera há mais tempo.
 *
 * "Espera" é medida pela última mensagem DO USUÁRIO, não pela criação: um ticket
 * de março em que ele respondeu hoje está esperando desde hoje, e um de ontem
 * que já foi respondido não está esperando nada.
 */
export function compareTicketsForQueue(a, b) {
  const rank = (PRIORITY_RANK[b.priority] ?? 1) - (PRIORITY_RANK[a.priority] ?? 1);
  if (rank !== 0) return rank;

  const waitA = new Date(a.lastUserMessageAt ?? a.createdAt ?? 0).getTime();
  const waitB = new Date(b.lastUserMessageAt ?? b.createdAt ?? 0).getTime();
  return waitA - waitB; // mais antigo primeiro
}

// ─── Máquina de estados ──────────────────────────────────────────────────────

// Transições que o ADMIN pode fazer na mão. O usuário não aparece aqui: ele
// nunca escolhe status, ele só age (responder, resolver o próprio ticket).
const ADMIN_TRANSITIONS = {
  ABERTO:     ['EM_ANALISE', 'RESPONDIDO', 'RESOLVIDO', 'FECHADO'],
  EM_ANALISE: ['ABERTO', 'RESPONDIDO', 'RESOLVIDO', 'FECHADO'],
  RESPONDIDO: ['EM_ANALISE', 'RESOLVIDO', 'FECHADO'],
  RESOLVIDO:  ['EM_ANALISE', 'FECHADO', 'ABERTO'],
  FECHADO:    [], // terminal: o que morreu, morreu — resposta nova vira ticket novo
};

/**
 * @returns {{ ok: boolean, reason?: string }}
 */
export function canTransition(from, to, byRole = 'ADMIN') {
  if (!TICKET_STATUSES.includes(to)) return { ok: false, reason: 'Status inválido.' };
  if (byRole !== 'ADMIN') return { ok: false, reason: 'Apenas o suporte altera o status.' };
  if (from === to) return { ok: true };

  const allowed = ADMIN_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    return { ok: false, reason: `Não é possível ir de ${from} para ${to}.` };
  }
  return { ok: true };
}

/**
 * O que a resposta do USUÁRIO faz com o status.
 *
 * Devolve o status resultante, ou `null` quando a thread está encerrada e a
 * resposta deve virar um ticket novo.
 */
export function statusAfterUserReply(ticket, now = new Date()) {
  if (ticket.status === 'FECHADO') return null;
  if (ticket.status === 'RESOLVIDO') {
    return canReopen(ticket, now) ? 'ABERTO' : null;
  }
  // ABERTO / EM_ANALISE / RESPONDIDO → a bola volta para o suporte.
  return 'ABERTO';
}

/**
 * Ticket RESOLVIDO aceita resposta por 7 dias contados da resolução.
 *
 * O relógio é o `resolvedAt`, não o `updatedAt`: uma edição administrativa
 * qualquer (mudar categoria, anotar nota interna) não pode renovar a janela.
 */
export function canReopen(ticket, now = new Date()) {
  if (ticket.status !== 'RESOLVIDO') return false;
  if (!ticket.resolvedAt) return true; // resolvido sem carimbo: dá o benefício ao usuário

  const elapsedDays = (now.getTime() - new Date(ticket.resolvedAt).getTime()) / 86_400_000;
  return elapsedDays <= REOPEN_WINDOW_DAYS;
}

// ─── Anexos ──────────────────────────────────────────────────────────────────

/**
 * Valida a lista de data-URLs de uma mensagem.
 *
 * @param {string[]} dataUrls
 * @param {number} alreadyInTicket anexos já presentes na thread
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateAttachments(dataUrls = [], alreadyInTicket = 0) {
  if (!Array.isArray(dataUrls)) return { ok: false, reason: 'Anexos inválidos.' };
  if (dataUrls.length === 0) return { ok: true };

  if (dataUrls.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    return { ok: false, reason: `Máximo de ${MAX_ATTACHMENTS_PER_MESSAGE} imagens por mensagem.` };
  }
  if (alreadyInTicket + dataUrls.length > MAX_ATTACHMENTS_PER_TICKET) {
    return { ok: false, reason: `Este ticket já atingiu o limite de ${MAX_ATTACHMENTS_PER_TICKET} imagens.` };
  }

  for (const url of dataUrls) {
    if (typeof url !== 'string' || !ATTACHMENT_DATAURL_RE.test(url)) {
      return { ok: false, reason: 'Formato de imagem não suportado. Use PNG, JPEG ou WEBP.' };
    }
    if (url.length > MAX_ATTACHMENT_BYTES) {
      return { ok: false, reason: 'Imagem muito grande. Envie um print de até 1 MB.' };
    }
  }
  return { ok: true };
}

/** Extrai o MIME declarado na data-URL (já validada por `validateAttachments`). */
export function mimeOfDataUrl(dataUrl) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,/.exec(String(dataUrl ?? ''));
  return match ? match[1] : null;
}

// ─── Serialização ────────────────────────────────────────────────────────────

/**
 * Recorta o ticket para o que o USUÁRIO pode ver.
 *
 * Nota interna e contexto técnico somem AQUI, no servidor. Filtrar na tela
 * deixaria o dado trafegando no JSON — mesma disciplina do link público de
 * carteira, onde o valor sai normalizado da API e não apenas mascarado no front.
 */
export function serializeTicketForUser(ticket) {
  const plain = typeof ticket.toObject === 'function' ? ticket.toObject() : ticket;
  const { context, internalTags, ...visible } = plain;

  return {
    ...visible,
    messages: (plain.messages ?? [])
      .filter((m) => !m.isInternal)
      .map(({ isInternal, ...m }) => m),
  };
}
