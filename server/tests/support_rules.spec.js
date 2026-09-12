/**
 * Regras puras do atendimento: prioridade por plano, máquina de estados,
 * janela de reabertura, teto de anexos e o recorte que o usuário enxerga.
 *
 * O relógio é congelado no `describe` da reabertura: fixture com data absoluta
 * apodrece contra qualquer regra que compare com `Date.now()` — o teste passaria
 * hoje e falharia em oito dias por velhice, não por defeito.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import {
    priorityFromPlan,
    compareTicketsForQueue,
    canTransition,
    statusAfterUserReply,
    canReopen,
    validateAttachments,
    serializeTicketForUser,
    allowedTransitionsFrom,
    TICKET_STATUSES,
    MAX_ATTACHMENTS_PER_TICKET,
    MAX_ATTACHMENT_BYTES,
} from '../utils/supportRules.js';

const pngUrl = (bytes = 100) => `data:image/png;base64,${'A'.repeat(bytes)}`;

describe('priorityFromPlan', () => {
    it('coloca ELITE e BLACK na frente — é o que a /pricing vende', () => {
        expect(priorityFromPlan('ELITE')).toBe('ALTA');
        expect(priorityFromPlan('BLACK')).toBe('ALTA');
    });

    it('dá prioridade intermediária ao PRO', () => {
        expect(priorityFromPlan('PRO')).toBe('MEDIA');
    });

    it('trata ESSENTIAL, GUEST e plano desconhecido como fila normal', () => {
        expect(priorityFromPlan('ESSENTIAL')).toBe('NORMAL');
        expect(priorityFromPlan('GUEST')).toBe('NORMAL');
        expect(priorityFromPlan(undefined)).toBe('NORMAL');
        expect(priorityFromPlan('PLANO_QUE_NAO_EXISTE')).toBe('NORMAL');
    });

    it('enxerga o plano anual como o plano base (ELITE_ANNUAL continua ELITE)', () => {
        expect(priorityFromPlan('ELITE_ANNUAL')).toBe('ALTA');
        expect(priorityFromPlan('PRO_ANNUAL')).toBe('MEDIA');
    });
});

describe('compareTicketsForQueue', () => {
    it('prioridade vence idade', () => {
        const antigoNormal = { priority: 'NORMAL', lastUserMessageAt: '2026-01-01T00:00:00Z' };
        const novoAlta = { priority: 'ALTA', lastUserMessageAt: '2026-09-01T00:00:00Z' };
        expect([antigoNormal, novoAlta].sort(compareTicketsForQueue)[0]).toBe(novoAlta);
    });

    it('dentro da mesma prioridade, quem espera há mais tempo vem primeiro', () => {
        const a = { priority: 'MEDIA', lastUserMessageAt: '2026-09-01T00:00:00Z' };
        const b = { priority: 'MEDIA', lastUserMessageAt: '2026-09-05T00:00:00Z' };
        expect([b, a].sort(compareTicketsForQueue)[0]).toBe(a);
    });

    it('mede espera pela última mensagem DO USUÁRIO, não pela criação', () => {
        // Aberto em março, mas o usuário só voltou a falar hoje: espera pouco.
        const velhoQueFalouAgora = {
            priority: 'NORMAL',
            createdAt: '2026-03-01T00:00:00Z',
            lastUserMessageAt: '2026-09-10T00:00:00Z',
        };
        const novoEsquecido = {
            priority: 'NORMAL',
            createdAt: '2026-09-02T00:00:00Z',
            lastUserMessageAt: '2026-09-02T00:00:00Z',
        };
        expect([velhoQueFalouAgora, novoEsquecido].sort(compareTicketsForQueue)[0]).toBe(novoEsquecido);
    });
});

describe('canTransition', () => {
    it('permite o caminho normal de triagem', () => {
        expect(canTransition('ABERTO', 'EM_ANALISE').ok).toBe(true);
        expect(canTransition('EM_ANALISE', 'RESPONDIDO').ok).toBe(true);
        expect(canTransition('RESPONDIDO', 'RESOLVIDO').ok).toBe(true);
        expect(canTransition('RESOLVIDO', 'FECHADO').ok).toBe(true);
    });

    it('dá ao admin UMA saída do FECHADO — sem ela, um clique errado tranca o ticket para sempre', () => {
        expect(canTransition('FECHADO', 'EM_ANALISE').ok).toBe(true);
    });

    it('e só essa: FECHADO não volta direto para aberto nem resolvido', () => {
        expect(canTransition('FECHADO', 'ABERTO').ok).toBe(false);
        expect(canTransition('FECHADO', 'RESOLVIDO').ok).toBe(false);
        expect(canTransition('FECHADO', 'RESPONDIDO').ok).toBe(false);
    });

    it('para o USUÁRIO o FECHADO continua terminal — a saída é só do admin', () => {
        expect(statusAfterUserReply({ status: 'FECHADO' })).toBeNull();
        expect(canTransition('FECHADO', 'EM_ANALISE', 'USER').ok).toBe(false);
    });

    it('recusa status que não existe', () => {
        expect(canTransition('ABERTO', 'ARQUIVADO').ok).toBe(false);
    });

    it('não deixa o usuário mexer no status', () => {
        const r = canTransition('ABERTO', 'RESOLVIDO', 'USER');
        expect(r.ok).toBe(false);
        expect(r.reason).toMatch(/suporte/i);
    });

    it('aceita transição para o mesmo status (salvar sem mudar nada)', () => {
        expect(canTransition('EM_ANALISE', 'EM_ANALISE').ok).toBe(true);
    });
});

describe('reabertura', () => {
    // 12/09/2026 12:00 UTC. Congelado: a regra compara com o agora.
    const NOW = new Date('2026-09-12T12:00:00Z');

    beforeAll(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
    });
    afterAll(() => vi.useRealTimers());

    const resolvedDaysAgo = (days) => ({
        status: 'RESOLVIDO',
        resolvedAt: new Date(NOW.getTime() - days * 86_400_000),
    });

    it('aceita resposta dentro dos 7 dias', () => {
        expect(canReopen(resolvedDaysAgo(3))).toBe(true);
        expect(canReopen(resolvedDaysAgo(6.9))).toBe(true);
    });

    it('recusa fora da janela', () => {
        expect(canReopen(resolvedDaysAgo(7.1))).toBe(false);
        expect(canReopen(resolvedDaysAgo(40))).toBe(false);
    });

    it('dá o benefício da dúvida quando não há carimbo de resolução', () => {
        expect(canReopen({ status: 'RESOLVIDO', resolvedAt: null })).toBe(true);
    });

    it('só se aplica a ticket RESOLVIDO', () => {
        expect(canReopen({ status: 'ABERTO', resolvedAt: null })).toBe(false);
        expect(canReopen({ status: 'FECHADO', resolvedAt: NOW })).toBe(false);
    });

    it('resposta do usuário devolve a bola para o suporte', () => {
        expect(statusAfterUserReply({ status: 'RESPONDIDO' })).toBe('ABERTO');
        expect(statusAfterUserReply({ status: 'EM_ANALISE' })).toBe('ABERTO');
        expect(statusAfterUserReply(resolvedDaysAgo(2))).toBe('ABERTO');
    });

    it('devolve null quando a thread está encerrada — a resposta vira ticket novo', () => {
        expect(statusAfterUserReply({ status: 'FECHADO' })).toBeNull();
        expect(statusAfterUserReply(resolvedDaysAgo(30))).toBeNull();
    });
});

describe('validateAttachments', () => {
    it('aceita lista vazia', () => {
        expect(validateAttachments([]).ok).toBe(true);
        expect(validateAttachments().ok).toBe(true);
    });

    it('aceita até 3 imagens válidas', () => {
        expect(validateAttachments([pngUrl(), pngUrl(), pngUrl()]).ok).toBe(true);
    });

    it('recusa a quarta imagem da mesma mensagem', () => {
        const r = validateAttachments([pngUrl(), pngUrl(), pngUrl(), pngUrl()]);
        expect(r.ok).toBe(false);
        expect(r.reason).toMatch(/3 imagens/);
    });

    it('recusa quando o ticket já está no teto — o limite por mensagem sozinho é burlável', () => {
        const r = validateAttachments([pngUrl()], MAX_ATTACHMENTS_PER_TICKET);
        expect(r.ok).toBe(false);
        expect(r.reason).toMatch(/limite/i);
    });

    it('recusa formato fora da lista', () => {
        expect(validateAttachments(['data:image/gif;base64,AAAA']).ok).toBe(false);
        expect(validateAttachments(['data:application/pdf;base64,AAAA']).ok).toBe(false);
        expect(validateAttachments(['https://exemplo.com/foto.png']).ok).toBe(false);
    });

    it('recusa payload com javascript embutido disfarçado de imagem', () => {
        expect(validateAttachments(['data:image/png;base64,<script>alert(1)</script>']).ok).toBe(false);
    });

    it('recusa imagem acima do teto de tamanho', () => {
        const r = validateAttachments([pngUrl(MAX_ATTACHMENT_BYTES + 1)]);
        expect(r.ok).toBe(false);
        expect(r.reason).toMatch(/grande/i);
    });
});

describe('serializeTicketForUser', () => {
    const ticket = {
        code: 'VT-0001',
        subject: 'Preço errado',
        context: { userAgent: 'Firefox', route: '/wallet' },
        internalTags: ['candle'],
        messages: [
            { authorRole: 'USER', body: 'o preço está errado', isInternal: false },
            { authorRole: 'ADMIN', body: 'nota: é o bug do candle', isInternal: true },
            { authorRole: 'ADMIN', body: 'corrigido, obrigado!', isInternal: false },
        ],
    };

    it('remove a nota interna do que trafega para o usuário', () => {
        const out = serializeTicketForUser(ticket);
        expect(out.messages).toHaveLength(2);
        expect(JSON.stringify(out)).not.toMatch(/nota: é o bug/);
    });

    it('não expõe nem a flag isInternal nas mensagens visíveis', () => {
        const out = serializeTicketForUser(ticket);
        expect(out.messages.every((m) => !('isInternal' in m))).toBe(true);
    });

    it('esconde contexto técnico e etiquetas de triagem', () => {
        const out = serializeTicketForUser(ticket);
        expect(out.context).toBeUndefined();
        expect(out.internalTags).toBeUndefined();
    });

    it('preserva o que o usuário precisa ver', () => {
        const out = serializeTicketForUser(ticket);
        expect(out.code).toBe('VT-0001');
        expect(out.subject).toBe('Preço errado');
    });
});

/**
 * Achados da auditoria de 12/09/2026. Cada bloco aqui existe porque o defeito
 * correspondente não quebrava nada de forma visível.
 */
describe('orçamento do anexo (auditoria)', () => {
    it('cabe no parser de 3mb que o app.js monta para /api/support', () => {
        // Este é o teste que faltava quando o teto era 1,4MB: três imagens no
        // limite somavam 4,2MB e o Express devolvia 413 ANTES da rota, com o
        // usuário vendo só "não foi possível".
        const orcamento = MAX_ATTACHMENT_BYTES * 3;
        expect(orcamento).toBeLessThan(3 * 1024 * 1024);
    });

    it('recusa imagem acima do teto', () => {
        const r = validateAttachments([`data:image/png;base64,${'A'.repeat(MAX_ATTACHMENT_BYTES + 1)}`]);
        expect(r.ok).toBe(false);
        expect(r.reason).toMatch(/recorte/i);
    });
});

describe('assinatura do atendimento (auditoria)', () => {
    const comResposta = {
        messages: [
            { authorRole: 'USER', author: 'u1', authorName: 'Maria', body: 'oi', isInternal: false },
            { authorRole: 'ADMIN', author: 'admin-1', authorName: 'Matheus Ambrózio', body: 'resolvido', isInternal: false },
        ],
    };

    it('o usuário lê "Suporte Vértice", não o nome de quem atendeu', () => {
        const out = serializeTicketForUser(comResposta);
        const resposta = out.messages.find((m) => m.authorRole === 'ADMIN');

        expect(resposta.authorName).toBe('Suporte Vértice');
        expect(JSON.stringify(out)).not.toMatch(/Matheus/);
    });

    it('nem o id de quem atendeu vai junto', () => {
        const out = serializeTicketForUser(comResposta);
        expect(out.messages.find((m) => m.authorRole === 'ADMIN').author).toBeNull();
    });

    it('o próprio nome do usuário continua intacto na mensagem dele', () => {
        const out = serializeTicketForUser(comResposta);
        expect(out.messages.find((m) => m.authorRole === 'USER').authorName).toBe('Maria');
    });
});

describe('transições oferecidas ao painel (auditoria)', () => {
    it('o painel só pode oferecer o que a regra aceita', () => {
        // O select do Admin listava os cinco status sempre: metade das escolhas
        // voltava 400. Agora a lista sai da mesma tabela que valida.
        for (const status of TICKET_STATUSES) {
            for (const alvo of allowedTransitionsFrom(status)) {
                expect(canTransition(status, alvo, 'ADMIN').ok).toBe(true);
            }
        }
    });

    it('nenhum status fica sem saída', () => {
        for (const status of TICKET_STATUSES) {
            expect(allowedTransitionsFrom(status).length).toBeGreaterThan(0);
        }
    });
});
