import MarketAnalysis from '../models/MarketAnalysis.js';
import AlgorithmPerformance from '../models/AlgorithmPerformance.js';
import AuditLog from '../models/AuditLog.js';
import SupportTicket from '../models/SupportTicket.js';
import SupportAttachment from '../models/SupportAttachment.js';
import logger from '../config/logger.js';

/**
 * Dias que o print de um ticket sobrevive DEPOIS de o atendimento encerrar.
 *
 * Não são 7 de propósito, e o motivo é uma colisão: a janela de reabertura é de
 * exatamente 7 dias (`REOPEN_WINDOW_DAYS`). Purgar no dia 7 significaria que um
 * usuário reabrindo no último dia encontraria a conversa viva e as imagens
 * apagadas — inclusive as que ELE mandou, e que são a evidência do que está
 * reclamando. 30 dias põem a purga bem depois de a thread ter morrido de vez, e
 * ainda deixam o print disponível enquanto o mesmo defeito costuma reaparecer.
 *
 * O texto do ticket NÃO é apagado: ele é registro de atendimento. Some só o
 * anexo, que é a parte pesada e a que carrega dado pessoal (print de carteira).
 */
export const ATTACHMENT_RETENTION_DAYS = 30;

/**
 * Apaga os anexos de tickets encerrados há mais de `ATTACHMENT_RETENTION_DAYS`.
 *
 * Só olha tickets em estado TERMINAL. Um ticket reaberto tem `resolvedAt` zerado
 * por `applyStatus`, então sai sozinho da mira — a regra não precisa saber o que
 * é reabertura, só precisa não inventar data.
 *
 * `attachmentsPurgedAt` fica no ticket para a tela poder dizer "removido pela
 * política de retenção" em vez de mostrar uma miniatura quebrada e deixar quem
 * lê achando que o usuário nunca mandou print nenhum.
 */
export const purgeSupportAttachments = async (now = new Date()) => {
    const cutoff = new Date(now.getTime() - ATTACHMENT_RETENTION_DAYS * 24 * 60 * 60 * 1000);

    const expired = await SupportTicket.find({
        status: { $in: ['RESOLVIDO', 'FECHADO'] },
        attachmentsPurgedAt: null,
        $or: [
            { closedAt: { $ne: null, $lt: cutoff } },
            { resolvedAt: { $ne: null, $lt: cutoff } },
        ],
    }).select('_id').lean();

    if (!expired.length) return { tickets: 0, attachments: 0 };

    const ids = expired.map((t) => t._id);
    const removed = await SupportAttachment.deleteMany({ ticket: { $in: ids } });
    await SupportTicket.updateMany({ _id: { $in: ids } }, { $set: { attachmentsPurgedAt: now } });

    return { tickets: ids.length, attachments: removed.deletedCount ?? 0 };
};

export const runStorageCleanup = async () => {
    const now = new Date();
    const day7   = new Date(now.getTime() - 7   * 24 * 60 * 60 * 1000);
    const day90  = new Date(now.getTime() - 90  * 24 * 60 * 60 * 1000);
    const day120 = new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000);

    logger.info('🧹 [Cleanup] Iniciando limpeza de armazenamento...');

    // 1. MarketAnalysis > 120 dias: deletar documentos inteiros
    // (backtest olha no máximo 90 dias atrás — 30 dias de buffer)
    const deletedAnalysis = await MarketAnalysis.deleteMany({ createdAt: { $lt: day120 } });

    // 2. MarketAnalysis > 7 dias: remover fullAuditLog (maior campo, ~70% da massa da coleção,
    // usado só na modal admin de deep-dive). O endpoint público já exclui fullAuditLog via
    // .select() e o backtest só lê content.ranking, que fica intacto por 120 dias.
    // EXCEÇÃO: preserva o relatório mais recente de cada (assetClass, strategy) — é o que a
    // modal admin carrega — mesmo que ele já tenha > 7 dias (classe sem run recente).
    const latestPerClass = await MarketAnalysis.aggregate([
        { $sort: { createdAt: -1 } },
        { $group: { _id: { assetClass: '$assetClass', strategy: '$strategy' }, latestId: { $first: '$_id' } } }
    ]);
    const latestIds = latestPerClass.map(g => g.latestId);

    const strippedAnalysis = await MarketAnalysis.updateMany(
        {
            createdAt: { $lt: day7 },
            'content.fullAuditLog.0': { $exists: true },
            _id: { $nin: latestIds }
        },
        { $unset: { 'content.fullAuditLog': 1 } }
    );

    // 3. AlgorithmPerformance > 90 dias: deletar
    // Gráfico de acurácia usa no máximo 90 dias
    const deletedPerf = await AlgorithmPerformance.deleteMany({ date: { $lt: day90 } });

    // 4. AuditLog > 90 dias: deletar (retenção padrão de segurança)
    const deletedAudit = await AuditLog.deleteMany({ timestamp: { $lt: day90 } });

    // 5. Anexos de ticket encerrado há mais de 30 dias: apaga a imagem, mantém a
    // conversa. Ver ATTACHMENT_RETENTION_DAYS para o porquê de não ser 7.
    const purgedAttachments = await purgeSupportAttachments(now);

    const stats = {
        marketAnalysisDeleted: deletedAnalysis.deletedCount,
        marketAnalysisStripped: strippedAnalysis.modifiedCount,
        algorithmPerfDeleted: deletedPerf.deletedCount,
        auditLogDeleted: deletedAudit.deletedCount,
        supportAttachmentsDeleted: purgedAttachments.attachments,
        supportTicketsPurged: purgedAttachments.tickets,
        executedAt: now
    };

    logger.info(
        `✅ [Cleanup] Concluído — MarketAnalysis deletados: ${stats.marketAnalysisDeleted}, ` +
        `fullAuditLog removido de: ${stats.marketAnalysisStripped}, ` +
        `AlgorithmPerformance deletados: ${stats.algorithmPerfDeleted}, ` +
        `AuditLog deletados: ${stats.auditLogDeleted}, ` +
        `anexos de suporte deletados: ${stats.supportAttachmentsDeleted} ` +
        `(${stats.supportTicketsPurged} ticket(s))`
    );

    return stats;
};
