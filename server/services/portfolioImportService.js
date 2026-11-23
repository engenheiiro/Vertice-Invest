
import AssetTransaction from '../models/AssetTransaction.js';
import UserAsset from '../models/UserAsset.js';
import MarketAsset from '../models/MarketAsset.js';
import ImportBatch from '../models/ImportBatch.js';
import { financialService } from './financialService.js';
import { runTransaction } from '../utils/dbTransaction.js';
import { toDateKey } from '../utils/dateUtils.js';
import { addQty, QUANTITY_EPSILON, safeQuantity, safeUnitPrice, safeValue } from '../utils/mathUtils.js';
import { ROW_STATUS, classifyInDateOrder, dedupKey, summarizeTicker } from '../utils/importPreview.js';
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

export { ROW_STATUS };

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

/**
 * Primeiro (ticker, dia) em que o saldo fica NEGATIVO, varrendo em ordem de data
 * os lançamentos já gravados mais os do arquivo. `null` se não houver.
 *
 * A régua é a mesma de `recalculatePosition`: o saldo é checado na VIRADA DE DIA
 * (dentro do mesmo dia a ordem de digitação não importa — day trade com a venda
 * lançada primeiro continua aceito). A checagem antiga somava compras e vendas
 * sem olhar a data: VENDA em janeiro + COMPRA em fevereiro fechava em zero,
 * passava, era inserida, e só então o recálculo recusava — deixando o lote
 * gravado e a posição sem recalcular.
 */
export const findChronologicalShortfall = (existingTransactions, rows) => {
    const byTicker = new Map();
    const push = (ticker, date, side, quantity) => {
        const dayKey = toDateKey(date);
        if (!ticker || !dayKey) return;
        if (!byTicker.has(ticker)) byTicker.set(ticker, []);
        byTicker.get(ticker).push({ dayKey, delta: side === 'SELL' ? -Math.abs(Number(quantity)) : Math.abs(Number(quantity)) });
    };
    for (const tx of existingTransactions || []) push(tx.ticker, tx.date, tx.type, tx.quantity);
    for (const row of rows || []) push(row.ticker, anchorImportDate(row.date), row.side, row.quantity);

    for (const [ticker, moves] of byTicker) {
        moves.sort((a, b) => (a.dayKey < b.dayKey ? -1 : a.dayKey > b.dayKey ? 1 : 0));
        let balance = 0;
        for (let i = 0; i < moves.length; i++) {
            balance = addQty(balance, moves[i].delta);
            const endOfDay = i === moves.length - 1 || moves[i + 1].dayKey !== moves[i].dayKey;
            if (endOfDay && balance < -QUANTITY_EPSILON) {
                return { ticker, dayKey: moves[i].dayKey, shortfall: safeQuantity(-balance) };
            }
        }
    }
    return null;
};

/** `YYYY-MM-DD` → `DD/MM/YYYY`, para a mensagem ao usuário. */
const formatDayBr = (dayKey) => dayKey.split('-').reverse().join('/');

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

    const maps = {
        catalogByTicker: new Map(catalog.map((a) => [a.ticker, a])),
        positionByTicker: new Map(existingPositions.map((a) => [a.ticker, a])),
        alreadyThere: new Set(
            existingTransactions.map((tx) =>
                dedupKey({ ticker: tx.ticker, date: tx.date, side: tx.type, quantity: tx.quantity, price: tx.price })
            )
        ),
    };

    // Ordem de data para que a simulação de saldo faça sentido; duplicata DENTRO
    // do próprio arquivo (usuário colou o mesmo bloco duas vezes) também é pega aí.
    const resolvedByIndex = classifyInDateOrder(normalized, maps);
    for (const ticker of tickers) flagUnbackedSales(resolvedByIndex, ticker, existingTransactions);
    for (const r of resolvedByIndex) delete r.soFaltaClasse;

    const summary = tickers.map((ticker) =>
        summarizeTicker(ticker, resolvedByIndex.filter((r) => r.ticker === ticker), maps));

    return { rows: resolvedByIndex, summary };
};

/**
 * Venda sem lastro — a MESMA régua do commit (`findChronologicalShortfall`):
 * cronológica, na virada de cada dia, partindo dos lançamentos JÁ GRAVADOS do
 * ticker. A simulação antiga partia da posição de HOJE: uma venda antiga podia
 * passar na prévia como OK e o commit recusar o arquivo inteiro (ou o inverso).
 * Só conta o que de fato entraria, e o aviso não sobrescreve o "escolha a
 * classe" — é a classe que destrava a linha.
 */
const flagUnbackedSales = (resolvedByIndex, ticker, existingTransactions) => {
    const entram = resolvedByIndex.filter((r) => r.ticker === ticker
        && (r.status === ROW_STATUS.OK || r.status === ROW_STATUS.ATENCAO || r.soFaltaClasse));
    const furo = findChronologicalShortfall(existingTransactions.filter((t) => t.ticker === ticker), entram);
    if (!furo) return;
    for (const r of entram) {
        if (r.side === 'SELL' && !r.soFaltaClasse && toDateKey(r.date) === furo.dayKey) {
            r.status = ROW_STATUS.ATENCAO;
            r.reason = 'Venda maior que a posição acumulada até esta data — falta a compra correspondente.';
        }
    }
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

    // --- Pré-voo: nenhum ticker pode ficar com saldo negativo em NENHUM dia ---
    // `recalculatePosition` LANÇA "Saldo insuficiente" quando o saldo fica negativo
    // na virada de qualquer dia. Descobrir isso depois do insertMany deixaria o
    // lote gravado com a posição quebrada, então a checagem vem antes de qualquer
    // escrita e derruba o commit inteiro. Por isso a simulação é CRONOLÓGICA e
    // parte dos lançamentos já gravados do ticker (não da posição final de hoje):
    // uma venda importada pode cair antes de compras que já estão na carteira.
    const existing = await AssetTransaction.find({ user: userId, wallet: walletId, ticker: { $in: tickers } })
        .select('ticker date type quantity')
        .lean();
    const furo = findChronologicalShortfall(existing, normalized);
    if (furo) {
        throw AppError.badRequest(
            `As vendas de ${furo.ticker} ficam maiores que as compras em ${formatDayBr(furo.dayKey)} `
            + `(faltam ${furo.shortfall} até essa data). Inclua as compras anteriores que faltam ou remova essas vendas antes de importar.`
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
            const price = safeUnitPrice(Math.abs(Number(row.price)));
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

    // Apagar, recalcular e limpar órfãos numa transação SÓ. Antes cada passo
    // corria solto e a falha do recálculo era só logada: importar COMPRA 100,
    // lançar à mão VENDA 50 e desfazer apagava a compra, o recálculo recusava
    // ("Saldo insuficiente"), a posição ficava em 100 com só a VENDA 50 no
    // extrato — e o lote ainda saía marcado como desfeito, sem erro nenhum.
    // Agora qualquer recálculo que falhe desfaz tudo e a pessoa recebe o motivo.
    let deletedCount = 0;
    try {
        await runTransaction(async (session) => {
            ({ deletedCount } = await AssetTransaction.deleteMany({
                wallet: walletId,
                importBatchId: String(batch._id),
            }, { session }));

            for (const ticker of batch.tickers) {
                await financialService.recalculatePosition(userId, ticker, null, session, null, walletId);
            }

            // Desfazer tem que apagar o rastro, não só zerar. `recalculatePosition` deixa
            // a posição com quantity=0 em vez de removê-la (é o comportamento correto para
            // uma venda total — vira "posição encerrada" e conta para o IR). Mas um ativo
            // que só existia por causa do import não deve sobrar como posição encerrada
            // fantasma, então some quando não resta nenhuma transação dele na carteira.
            const remaining = await AssetTransaction.find(
                { wallet: walletId, ticker: { $in: batch.tickers } }, null, { session },
            ).distinct('ticker');
            const orphans = batch.tickers.filter((t) => !remaining.includes(t));
            if (orphans.length > 0) {
                await UserAsset.deleteMany({
                    user: userId,
                    wallet: walletId,
                    ticker: { $in: orphans },
                    quantity: { $lte: QUANTITY_EPSILON },
                }, { session });
            }
        });
    } catch (error) {
        logger.warn('[Import] Desfazer importação revertido: recálculo recusou o estado final', {
            userId: String(userId), walletId: String(walletId), batchId, error: error.message,
        });
        if (error.httpStatus) {
            throw AppError.conflict(`Não foi possível desfazer esta importação: ${error.message} Remova antes os lançamentos manuais que dependem dela.`);
        }
        throw error;
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
