import MarketAnalysis from '../models/MarketAnalysis.js';
import AlgorithmPerformance from '../models/AlgorithmPerformance.js';
import AuditLog from '../models/AuditLog.js';
import logger from '../config/logger.js';

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

    const stats = {
        marketAnalysisDeleted: deletedAnalysis.deletedCount,
        marketAnalysisStripped: strippedAnalysis.modifiedCount,
        algorithmPerfDeleted: deletedPerf.deletedCount,
        auditLogDeleted: deletedAudit.deletedCount,
        executedAt: now
    };

    logger.info(
        `✅ [Cleanup] Concluído — MarketAnalysis deletados: ${stats.marketAnalysisDeleted}, ` +
        `fullAuditLog removido de: ${stats.marketAnalysisStripped}, ` +
        `AlgorithmPerformance deletados: ${stats.algorithmPerfDeleted}, ` +
        `AuditLog deletados: ${stats.auditLogDeleted}`
    );

    return stats;
};
