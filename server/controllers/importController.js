
import { resolveRows, applyImport, undoImport, ROW_STATUS } from '../services/portfolioImportService.js';
import ImportBatch from '../models/ImportBatch.js';
import AppError from '../utils/AppError.js';
import { toDateKey } from '../utils/dateUtils.js';
import logger from '../config/logger.js';

/**
 * Importação de carteira. Fica fora do `walletController.js` de propósito —
 * aquele arquivo já passa de 1300 linhas.
 *
 * Autorização vem inteira do `resolveWallet`: estes handlers só leem
 * `req.walletId`, nunca `req.body.walletId` cru.
 */

// Dia-calendário de hoje no fuso de Brasília. Mesma regra do lançamento avulso
// (`addAssetTransaction`): a data de referência é o dia civil brasileiro, não o
// instante UTC do servidor.
const brazilTodayKey = () =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

/** Rejeita lançamentos no futuro — mesma regra de negócio do POST /wallet/add. */
const assertNoFutureDates = (rows) => {
    const hoje = brazilTodayKey();
    const futura = rows.find((row) => {
        const key = toDateKey(row.date);
        return key && key > hoje;
    });
    if (futura) {
        throw AppError.badRequest(
            `Há lançamentos com data futura (${toDateKey(futura.date)}). Corrija as datas antes de importar.`
        );
    }
};

/**
 * POST /api/wallet/import/preview
 *
 * Resolve tickers, classes e duplicatas e devolve a posição resultante. Não
 * escreve absolutamente nada — é o material da tela de conferência, e o usuário
 * ainda pode desistir depois de ver o resultado.
 */
export const previewImport = async (req, res, next) => {
    try {
        const { rows } = req.body;
        const { rows: resolved, summary } = await resolveRows({
            userId: req.user.id,
            walletId: req.walletId,
            rows,
        });

        const counts = resolved.reduce((acc, row) => {
            acc[row.status] = (acc[row.status] || 0) + 1;
            return acc;
        }, {});

        res.json({
            rows: resolved,
            summary,
            counts: {
                total: resolved.length,
                ok: counts[ROW_STATUS.OK] || 0,
                duplicado: counts[ROW_STATUS.DUPLICADO] || 0,
                atencao: counts[ROW_STATUS.ATENCAO] || 0,
                naoReconhecido: counts[ROW_STATUS.NAO_RECONHECIDO] || 0,
            },
        });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /api/wallet/import/commit
 *
 * Grava o lote. O cliente manda apenas as linhas que o usuário confirmou na
 * conferência — descartadas e duplicatas não chegam aqui.
 */
export const commitImport = async (req, res, next) => {
    try {
        const { rows, source } = req.body;
        assertNoFutureDates(rows);

        const result = await applyImport({
            userId: req.user.id,
            walletId: req.walletId,
            rows,
            source,
        });

        logger.info('[Import] Carteira importada', {
            userId: String(req.user.id),
            walletId: String(req.walletId),
            source,
            batchId: result.batchId,
            rows: result.inserted,
            tickers: result.tickers.length,
            failures: result.failures.length,
        });

        res.status(201).json({
            message: `${result.inserted} lançamento(s) importado(s).`,
            ...result,
        });
    } catch (error) {
        next(error);
    }
};

/**
 * DELETE /api/wallet/import/:batchId
 *
 * Desfaz um lote inteiro. Existe porque um import é uma ação grande e de uma
 * tacada só: sem a volta, o usuário que errou a fonte teria que apagar
 * lançamento por lançamento.
 */
export const revertImport = async (req, res, next) => {
    try {
        const result = await undoImport({
            userId: req.user.id,
            walletId: req.walletId,
            batchId: req.params.batchId,
        });

        if (!result) throw AppError.notFound('Importação não encontrada nesta carteira.');

        logger.info('[Import] Importação desfeita', {
            userId: String(req.user.id),
            walletId: String(req.walletId),
            batchId: result.batchId,
            removed: result.removed,
        });

        res.json({ message: `${result.removed} lançamento(s) removido(s).`, ...result });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /api/wallet/import — histórico de importações da carteira ativa.
 * Alimenta o botão "desfazer" e o rastro de suporte.
 */
export const listImports = async (req, res, next) => {
    try {
        const batches = await ImportBatch.find({ user: req.user.id, wallet: req.walletId })
            .sort({ createdAt: -1 })
            .limit(20)
            .lean();

        res.json(
            batches.map((b) => ({
                id: String(b._id),
                source: b.source,
                rowCount: b.rowCount,
                tickers: b.tickers,
                createdAt: b.createdAt,
                undoneAt: b.undoneAt,
            }))
        );
    } catch (error) {
        next(error);
    }
};
