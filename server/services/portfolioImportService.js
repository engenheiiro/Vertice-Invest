
import AssetTransaction from '../models/AssetTransaction.js';
import UserAsset from '../models/UserAsset.js';
import MarketAsset from '../models/MarketAsset.js';
import ImportBatch from '../models/ImportBatch.js';
import { financialService } from './financialService.js';
import { runTransaction } from '../utils/dbTransaction.js';
import { toDateKey } from '../utils/dateUtils.js';
import {
    addQty,
    QUANTITY_EPSILON,
    safeAdd,
    safeCurrency,
    safeFloat,
    safePrice,
    safeQuantity,
    safeSub,
    safeValue,
    subQty,
} from '../utils/mathUtils.js';
import AppError from '../utils/AppError.js';
import logger from '../config/logger.js';

/**
 * Importação de carteira em lote (Investidor10 / extrato B3 / planilha modelo).
 *
 * O parsing do arquivo acontece no NAVEGADOR; o que chega aqui já são linhas
 * normalizadas. A responsabilidade deste serviço é o que o cliente não pode
 * fazer: resolver ticker contra o catálogo, detectar duplicata contra o que já
 * está na carteira, e gravar o lote de forma que o recálculo rode uma vez só.
 *
 * ## Por que não reaproveitar o POST /wallet/add em laço
 *
 * Três motivos, todos medidos no código atual:
 *  - `walletWriteLimiter` corta em 50 escritas/15min — um import de 60 morre no meio;
 *  - `addAssetTransaction` chama `rebuildUserHistory` a cada lançamento com data
 *    passada, e um import histórico é feito só de datas passadas;
 *  - `recalculatePosition` relê TODAS as transações do ticker a cada chamada, o
 *    que é quadrático dentro de um mesmo ticker.
 *
 * Aqui: insere tudo → recalcula uma vez por ticker distinto → reconstrói o
 * histórico uma vez.
 */

/** Situação de uma linha na tela de conferência. */
export const ROW_STATUS = {
    OK: 'ok',
    DUPLICADO: 'duplicado',
    ATENCAO: 'atencao',
    NAO_RECONHECIDO: 'nao_reconhecido',
};

/** Forma de um papel da B3 (`PETR4`, `MXRF11`, `PETR4F`). */
const TICKER_SHAPE = /^[A-Z]{4}\d{1,2}[A-Z]?$/;

/** Teto do rótulo preservado quando ele não é um código de negociação. */
const LABEL_MAX = 40;

/**
 * Extrai o código de negociação de um rótulo de extrato.
 *
 * A B3 escreve o produto como `"PETR4 - PETROLEO BRASILEIRO S.A. PETROBRAS"`, e
 * o Investidor10 às vezes cola o ticker junto do nome. O parser do cliente já
 * separa código e nome, mas isto aqui é a fronteira: nada garante que a linha
 * chegou por lá.
 *
 * O primeiro token só é aceito como código quando dá para ter certeza: tem forma
 * de papel da B3, veio com o separador ` - `, ou é o rótulo inteiro (uma palavra
 * só). Fora disso preservamos o rótulo — reduzir `Tesouro Selic 2029` e
 * `Tesouro IPCA+ 2035` ao primeiro token fundia os dois num `TESOURO` só, com
 * quantidade e custo somados de títulos diferentes. Preservado, cada um cai como
 * "não reconhecido" na revisão em vez de virar um ticker inventado.
 */
export const extractTicker = (raw) => {
    if (!raw) return '';
    const cleaned = String(raw).replace(/\s+/g, ' ').trim().toUpperCase();
    if (!cleaned) return '';

    const hasSeparator = / - /.test(cleaned);
    const firstSpace = cleaned.indexOf(' ');
    const head = firstSpace === -1 ? cleaned : cleaned.slice(0, firstSpace);
    const tail = firstSpace === -1 ? '' : cleaned.slice(firstSpace + 1).replace(/^-\s*/, '').trim();

    const token = head.replace(/[^A-Z0-9.]/g, '');

    // Ticker fracionário da B3 (`PETR4F`) é o MESMO ativo do lote padrão. Sem
    // essa normalização a carteira nasce com duas posições da mesma empresa.
    const fractional = /^([A-Z]{4}\d{1,2})F$/.exec(token);
    const code = fractional ? fractional[1] : token;

    const isCode = TICKER_SHAPE.test(code)
        || (!!code && !tail)
        || (!!code && hasSeparator && /^[A-Z0-9.]{1,10}$/.test(code));

    return isCode ? code : cleaned.slice(0, LABEL_MAX);
};

/** Ancora a data no meio-dia UTC, mesma convenção de `parseCalendarDate`. */
const anchorImportDate = (value) => {
    const key = toDateKey(value);
    return key ? new Date(`${key}T12:00:00.000Z`) : null;
};

/** Chave de dedup de um lançamento — o que torna dois lançamentos "o mesmo". */
const dedupKey = ({ ticker, date, side, quantity, price }) =>
    [
        String(ticker).toUpperCase(),
        toDateKey(date),
        side,
        safeQuantity(quantity),
        safeCurrency(price),
    ].join('|');

/**
 * Resolve um lote de linhas contra o catálogo e contra a carteira do usuário,
 * SEM escrever nada. É o que alimenta a tela de conferência.
 *
 * Devolve `{ rows, summary }`, onde cada linha ganha `type`, `currency`, `name`,
 * `status` e `reason`, e o summary traz a posição resultante por ticker — é com
 * ela que o usuário confere se o import bate com o que ele vê no Investidor10.
 */
export const resolveRows = async ({ userId, walletId, rows }) => {
    const normalized = rows.map((row) => ({
        ...row,
        ticker: extractTicker(row.ticker),
        date: anchorImportDate(row.date),
    }));

    const tickers = [...new Set(normalized.map((r) => r.ticker).filter(Boolean))];

    // Duas consultas para o lote inteiro, não uma por linha.
    const [catalog, existingPositions, existingTransactions] = await Promise.all([
        MarketAsset.find({ ticker: { $in: tickers } })
            .select('ticker name type currency')
            .lean(),
        UserAsset.find({ user: userId, wallet: walletId, ticker: { $in: tickers } })
            .select('ticker quantity type currency')
            .lean(),
        AssetTransaction.find({ wallet: walletId, ticker: { $in: tickers } })
            .select('ticker date type quantity price')
            .lean(),
    ]);

    const catalogByTicker = new Map(catalog.map((a) => [a.ticker, a]));
    const positionByTicker = new Map(existingPositions.map((a) => [a.ticker, a]));
    const alreadyThere = new Set(
        existingTransactions.map((tx) =>
            dedupKey({ ticker: tx.ticker, date: tx.date, side: tx.type, quantity: tx.quantity, price: tx.price })
        )
    );

    // Saldo corrente por ticker, partindo da posição já existente na carteira.
    // Serve para detectar venda sem lastro — o erro que faria a posição ficar
    // negativa e contaminar preço médio, TWRR e IR de uma vez só.
    const runningQty = new Map(
        tickers.map((t) => [t, safeQuantity(positionByTicker.get(t)?.quantity || 0)])
    );

    // Duplicata DENTRO do próprio arquivo (usuário colou o mesmo bloco duas vezes).
    const seenInBatch = new Set();

    // Ordena por data para que a simulação de saldo faça sentido; o índice
    // original volta depois para não embaralhar a tela de conferência.
    const chronological = normalized
        .map((row, index) => ({ row, index }))
        .sort((a, b) => (a.row.date?.getTime() || 0) - (b.row.date?.getTime() || 0));

    const resolvedByIndex = new Array(normalized.length);

    for (const { row, index } of chronological) {
        const known = catalogByTicker.get(row.ticker);
        const position = positionByTicker.get(row.ticker);

        // Precedência de tipo/moeda: escolha explícita do parser > catálogo >
        // posição já existente na carteira. Nunca chuta por formato de ticker —
        // "termina em 11" é FII, ETF ou unit, e errar isso desloca o ativo de
        // classe na alocação inteira.
        const type = row.type || known?.type || position?.type || null;
        const currency = row.currency || known?.currency || position?.currency || 'BRL';
        const name = row.name || known?.name || null;

        const key = dedupKey({ ...row, side: row.side });
        let status = ROW_STATUS.OK;
        let reason = null;

        if (!row.ticker || !row.date) {
            status = ROW_STATUS.NAO_RECONHECIDO;
            reason = 'Linha sem ticker ou data válida.';
        } else if (!type) {
            status = ROW_STATUS.NAO_RECONHECIDO;
            reason = 'Ativo fora do nosso catálogo. Escolha a classe para importar.';
        } else if (alreadyThere.has(key)) {
            status = ROW_STATUS.DUPLICADO;
            reason = 'Lançamento idêntico já existe nesta carteira.';
        } else if (seenInBatch.has(key)) {
            status = ROW_STATUS.DUPLICADO;
            reason = 'Linha repetida dentro do próprio arquivo.';
        } else if (row.side === 'BUY' && row.price === 0) {
            status = ROW_STATUS.ATENCAO;
            reason = 'Compra com preço zerado — confira antes de importar.';
        }

        seenInBatch.add(key);

        // Só falta a CLASSE — que é escolhida nesta mesma tela. A linha vai
        // entrar, então conta no saldo e no resumo.
        const soFaltaClasse = status === ROW_STATUS.NAO_RECONHECIDO && !!row.ticker && !!row.date;

        // Simulação de saldo: só conta o que de fato entraria.
        if (status === ROW_STATUS.OK || status === ROW_STATUS.ATENCAO || soFaltaClasse) {
            const current = runningQty.get(row.ticker) ?? 0;
            // Sem o `soFaltaClasse` aqui, o aviso de venda sem lastro sobrescreveria
            // o "escolha a classe" — e a classe é o que destrava a linha.
            if (row.side === 'SELL' && row.quantity > current + QUANTITY_EPSILON && !soFaltaClasse) {
                status = ROW_STATUS.ATENCAO;
                reason = 'Venda maior que a posição acumulada até esta data — falta a compra correspondente.';
            }
            runningQty.set(
                row.ticker,
                row.side === 'BUY' ? addQty(current, row.quantity) : subQty(current, row.quantity)
            );
        }

        resolvedByIndex[index] = { ...row, type, currency, name, status, reason };
    }

    // Posição resultante por ticker — o material da conferência contra a origem.
    //
    // Linha que só espera a classe entra na conta. Fora dela, um Tesouro ou
    // qualquer ativo fora do catálogo aparecia com quantidade e valor ZERO na
    // tela de conferência — justamente o número que o usuário abriu a tela para
    // conferir, e que o commit ia gravar certo de qualquer jeito.
    const summary = tickers.map((ticker) => {
        const linhas = resolvedByIndex.filter((r) => r.ticker === ticker);
        const importaveis = linhas.filter(
            (r) => r.status === ROW_STATUS.OK
                || r.status === ROW_STATUS.ATENCAO
                || (r.status === ROW_STATUS.NAO_RECONHECIDO && !!r.ticker && !!r.date)
        );
        let quantity = safeQuantity(positionByTicker.get(ticker)?.quantity || 0);
        let cost = 0;
        for (const linha of importaveis) {
            if (linha.side === 'BUY') {
                quantity = addQty(quantity, linha.quantity);
                cost = safeAdd(cost, safeValue(linha.quantity, linha.price));
            } else {
                const avg = safePrice(cost, quantity);
                cost = safeSub(cost, safeValue(linha.quantity, avg));
                quantity = subQty(quantity, linha.quantity);
            }
        }
        return {
            ticker,
            type: importaveis[0]?.type || catalogByTicker.get(ticker)?.type || null,
            name: catalogByTicker.get(ticker)?.name || null,
            currency: importaveis[0]?.currency || 'BRL',
            rows: linhas.length,
            quantity: safeQuantity(quantity),
            averagePrice: quantity > 0 ? safeCurrency(safePrice(cost, quantity)) : 0,
            totalCost: safeCurrency(cost),
            hadPosition: positionByTicker.has(ticker),
        };
    });

    return { rows: resolvedByIndex, summary };
};

/**
 * Grava o lote e devolve o resultado.
 *
 * A escrita dos lançamentos é atômica; o RECÁLCULO roda depois do commit, de
 * propósito. Recalcular dentro da transação estouraria o timeout de 30s num lote
 * grande, e o recálculo é derivável — `recalculatePosition` reconstrói a posição
 * a partir das transações, então repeti-lo é inofensivo e `autoHealPositions` já
 * cobre o caso de uma falha no meio. O que NÃO pode ficar pela metade é o
 * conjunto de lançamentos, e esse está dentro da transação.
 */
export const applyImport = async ({ userId, walletId, rows, source }) => {
    const normalized = rows.map((row) => ({ ...row, ticker: extractTicker(row.ticker) }));
    const tickers = [...new Set(normalized.map((r) => r.ticker))];

    // Classe e moeda decididas na conferência. `recalculatePosition` usa esses
    // dois como `forcedType`/`forcedCurrency` ao CRIAR a posição — sem eles, um
    // ativo fora do catálogo nasceria como 'STOCK'/'BRL' por default e cairia na
    // classe errada da alocação (o default está em financialService.js:1105).
    const classByTicker = new Map(
        tickers.map((ticker) => {
            const first = normalized.find((r) => r.ticker === ticker);
            return [ticker, { type: first?.type || null, currency: first?.currency || 'BRL' }];
        })
    );

    // --- Pré-voo: nenhum ticker pode terminar com saldo negativo ---
    // `recalculatePosition` LANÇA "Saldo insuficiente" quando a quantidade final
    // fica negativa (financialService.js:1076). Descobrir isso depois do
    // insertMany deixaria o lote gravado com a posição quebrada, então a checagem
    // vem antes de qualquer escrita e derruba o commit inteiro.
    const existing = await UserAsset.find({ user: userId, wallet: walletId, ticker: { $in: tickers } })
        .select('ticker quantity')
        .lean();
    const saldo = new Map(existing.map((a) => [a.ticker, safeQuantity(a.quantity)]));
    for (const row of normalized) {
        const atual = saldo.get(row.ticker) ?? 0;
        saldo.set(row.ticker, row.side === 'BUY' ? addQty(atual, row.quantity) : subQty(atual, row.quantity));
    }
    const negativo = [...saldo.entries()].find(([, qty]) => qty < -QUANTITY_EPSILON);
    if (negativo) {
        throw AppError.badRequest(
            `As vendas de ${negativo[0]} somam mais do que as compras. Inclua as compras que faltam ou remova essas vendas antes de importar.`
        );
    }

    let batchId = null;

    await runTransaction(async (session) => {
        const [batch] = await ImportBatch.create(
            [{ user: userId, wallet: walletId, source, rowCount: normalized.length, tickers }],
            { session }
        );
        batchId = String(batch._id);

        const docs = normalized.map((row) => {
            const ticker = row.ticker;
            const quantity = safeQuantity(Math.abs(Number(row.quantity)));
            const price = safeFloat(Math.abs(Number(row.price)));
            return {
                user: userId,
                wallet: walletId,
                ticker,
                type: row.side,
                quantity,
                price,
                totalValue: safeValue(quantity, price),
                // Moeda nativa carimbada já na criação: o import conhece a moeda
                // (resolvida no preview), então não precisa do segundo save que o
                // fluxo de lançamento avulso faz. O `fxRate` fica de fora — quem
                // carimba é `recalculatePosition`, com a série histórica do dia
                // de cada compra (regra do câmbio congelado, CLAUDE.md §8).
                currency: row.currency || 'BRL',
                date: anchorImportDate(row.date),
                importBatchId: batchId,
                importSource: source,
                notes: row.name ? `Importado — ${row.name}` : 'Importado',
            };
        });

        await AssetTransaction.insertMany(docs, { session, ordered: true });
    });

    // --- Fora da transação: recálculo derivável (ver comentário do JSDoc) ---
    const failures = [];
    for (const ticker of tickers) {
        const { type, currency } = classByTicker.get(ticker) || {};
        try {
            await financialService.recalculatePosition(userId, ticker, type, null, currency, walletId);
        } catch (error) {
            failures.push({ ticker, message: error.message });
            logger.warn('[Import] Recálculo de posição falhou após importação', {
                userId: String(userId), walletId: String(walletId), ticker, error: error.message,
            });
        }
    }

    // Uma vez só, no fim — não uma vez por lançamento.
    try {
        await financialService.rebuildUserHistory(userId, walletId);
    } catch (error) {
        logger.warn('[Import] Rebuild de histórico falhou após importação', {
            userId: String(userId), walletId: String(walletId), batchId, error: error.message,
        });
    }

    // Proventos dos tickers importados, em background (não bloqueia a resposta).
    // Espelha o que `addAssetTransaction` faz a cada lançamento avulso, só que uma
    // vez para o lote inteiro.
    //
    // Sem isto, quem importa numa carteira que JÁ tem proventos espera até o cron
    // das 04:00: o self-heal da aba Proventos só dispara quando tudo está zerado
    // (walletController.js:1232), então uma carteira parcialmente populada não o
    // aciona. Carteira nova era coberta; carteira existente, não.
    const pagadores = tickers
        .filter((ticker) => {
            const type = classByTicker.get(ticker)?.type;
            return type && !['CRYPTO', 'FIXED_INCOME', 'CASH'].includes(type);
        })
        .map((ticker) => ({ ticker, type: classByTicker.get(ticker).type }));

    if (pagadores.length > 0) {
        financialService.syncDividends(pagadores).catch((error) => {
            logger.warn('[Import] Sync de proventos em background falhou após importação', {
                userId: String(userId), walletId: String(walletId), batchId, error: error.message,
            });
        });
    }

    return { batchId, inserted: normalized.length, tickers, failures };
};

/**
 * Desfaz um lote inteiro. Mesma sequência do apply, ao contrário: apaga os
 * lançamentos, recalcula cada ticker tocado e reconstrói o histórico.
 *
 * O `ImportBatch` NÃO é apagado — ganha `undoneAt`. Um lote revertido continua
 * sendo um fato que aconteceu, e o suporte precisa poder vê-lo.
 */
export const undoImport = async ({ userId, walletId, batchId }) => {
    const batch = await ImportBatch.findOne({ _id: batchId, user: userId, wallet: walletId });
    if (!batch) return null;

    const { deletedCount } = await AssetTransaction.deleteMany({
        wallet: walletId,
        importBatchId: String(batch._id),
    });

    for (const ticker of batch.tickers) {
        try {
            await financialService.recalculatePosition(userId, ticker, null, null, null, walletId);
        } catch (error) {
            logger.warn('[Import] Recálculo falhou ao desfazer importação', {
                userId: String(userId), walletId: String(walletId), ticker, error: error.message,
            });
        }
    }

    // Desfazer tem que apagar o rastro, não só zerar. `recalculatePosition` deixa
    // a posição com quantity=0 em vez de removê-la (é o comportamento correto para
    // uma venda total — vira "posição encerrada" e conta para o IR). Mas um ativo
    // que só existia por causa do import não deve sobrar como posição encerrada
    // fantasma, então some quando não resta nenhuma transação dele na carteira.
    const remaining = await AssetTransaction.find({ wallet: walletId, ticker: { $in: batch.tickers } })
        .distinct('ticker');
    const orphans = batch.tickers.filter((t) => !remaining.includes(t));
    if (orphans.length > 0) {
        await UserAsset.deleteMany({
            user: userId,
            wallet: walletId,
            ticker: { $in: orphans },
            quantity: { $lte: QUANTITY_EPSILON },
        });
    }

    try {
        await financialService.rebuildUserHistory(userId, walletId);
    } catch (error) {
        logger.warn('[Import] Rebuild de histórico falhou ao desfazer importação', {
            userId: String(userId), walletId: String(walletId), batchId, error: error.message,
        });
    }

    batch.undoneAt = new Date();
    await batch.save();

    return { batchId: String(batch._id), removed: deletedCount, tickers: batch.tickers };
};

export const portfolioImportService = { extractTicker, resolveRows, applyImport, undoImport, ROW_STATUS };
