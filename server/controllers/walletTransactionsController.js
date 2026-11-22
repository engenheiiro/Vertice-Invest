// Lançamentos, posições, metas, busca e extrato por ativo. Extraído de walletController.js.
import { runTransaction, txError } from '../utils/dbTransaction.js';
import Wallet from '../models/Wallet.js';
import UserAsset from '../models/UserAsset.js';
import AssetTransaction from '../models/AssetTransaction.js';
import MarketAsset from '../models/MarketAsset.js';
import TreasuryBond from '../models/TreasuryBond.js';
import WalletSnapshot from '../models/WalletSnapshot.js';
import { financialService } from '../services/financialService.js';
import { safeFloat, safeUnitPrice, safeValue, safeQuantity } from '../utils/mathUtils.js';
import { brazilDateKey, toDateKey, parseCalendarDate } from '../utils/dateUtils.js';
import { resolveFixedIncomeIndexing } from '../utils/fixedIncomeIndexing.js';
import { escapeRegex } from '../utils/regexEscape.js';
import { resolveAssetCurrency, resolveTransactionCurrency, needsCurrencyFallback } from '../utils/assetCurrency.js';
import logger from '../config/logger.js';
import AppError from '../utils/AppError.js';

// Carimba a moeda NATIVA do lançamento. Só dá para fazer depois do
// recálculo: é `recalculatePosition` que resolve a moeda autoritativa
// (cadastro explícito > MarketAsset > BRL), e um ETF só se distingue
// por ela (BOVA11 é R$, VOO é US$). Mesma sessão → atômico com o resto.
const stampTransactionCurrency = async (newTx, updatedAsset, session) => {
    const txCurrency = resolveAssetCurrency(updatedAsset);
    if (newTx.currency !== txCurrency) {
        newTx.currency = txCurrency;
        await newTx.save({ session });
    }
};

// Vencimento do catálogo do Tesouro (string "dd/mm/aaaa") → Date, ou null.
const parseBondMaturity = (raw) => {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(raw).trim());
    if (!m) return null;
    const parsed = new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00.000Z`);
    return isNaN(parsed.getTime()) ? null : parsed;
};

// C2: vencimento — da UI (form) ou, quando ausente, do catálogo
// (string "dd/mm/aaaa"). Nunca reescreve um vencimento já salvo.
const applyMaturityDate = (updatedAsset, maturityDate, bond) => {
    if (maturityDate) {
        const md = new Date(maturityDate);
        if (!isNaN(md.getTime())) updatedAsset.maturityDate = md;
        return;
    }
    if (!updatedAsset.maturityDate && bond?.maturityDate) {
        const parsed = parseBondMaturity(bond.maturityDate);
        if (parsed) updatedAsset.maturityDate = parsed;
    }
};

// Pós-fixados/indexados (Selic/CDI/IPCA): o rendimento é índice vivo +
// spread, não a taxa cheia. Persiste índice+spread p/ accrual correto
// (corrige o bug do Tesouro Selic render só o spread como prefixado).
const applyFixedIncomeIndexing = async (updatedAsset, { ticker, fixedIncomeIndex, fixedIncomeSpread, maturityDate }, session) => {
    const idx = fixedIncomeIndex;
    const spread = fixedIncomeSpread;
    // Catálogo é a fonte autoritativa de índice E vencimento — busca
    // uma vez quando falta qualquer um dos dois (evita 2 queries).
    let bond = null;
    if (!idx || (!maturityDate && !updatedAsset.maturityDate)) {
        bond = await TreasuryBond.findOne({ title: new RegExp(`^${escapeRegex(ticker)}$`, 'i') }).session(session);
    }
    const indexing = resolveFixedIncomeIndexing({ index: idx, spread, bond });
    if (indexing) {
        updatedAsset.fixedIncomeIndex = indexing.index;
        if (indexing.spread !== null) updatedAsset.fixedIncomeSpread = indexing.spread;
    }
    applyMaturityDate(updatedAsset, maturityDate, bond);
};

// Taxa, índice, vencimento, nome, reserva e início da posição de RF/caixa
// recém-recalculada, gravados na MESMA sessão do lançamento.
const applyFixedIncomeOrCashMetadata = async (updatedAsset, fields, session) => {
    const { type, name, fixedIncomeRate, isReserve, transactionType, txDate } = fields;
    if (fixedIncomeRate) updatedAsset.fixedIncomeRate = fixedIncomeRate;
    if (type === 'FIXED_INCOME') await applyFixedIncomeIndexing(updatedAsset, fields, session);
    if (name) updatedAsset.name = name;
    // C1: CASH é reserva por natureza; FIXED_INCOME segue a escolha do
    // usuário ("Guardar como Reserva separada"). Só grava no primeiro
    // aporte (posição nova) ou quando o flag vem explícito — aportes
    // seguintes não devem silenciosamente reclassificar a posição.
    if (type === 'CASH') {
        updatedAsset.isReserve = true;
    } else if (type === 'FIXED_INCOME' && isReserve !== undefined) {
        updatedAsset.isReserve = !!isReserve;
    }
    if (transactionType === 'BUY' && (!updatedAsset.startDate || txDate < updatedAsset.startDate)) {
        updatedAsset.startDate = txDate;
    }
    await updatedAsset.save({ session });
};

export const addAssetTransaction = async (req, res, next) => {
    const userId = req.user.id;
    const walletId = req.walletId;
    const {
        ticker, type, quantity, price, date, fixedIncomeRate, fixedIncomeIndex, fixedIncomeSpread,
        name, usSubType, currency, isReserve, maturityDate,
    } = req.body;
    // `<input type=date>` envia YYYY-MM-DD. Parsing nativo interpreta isso como
    // meia-noite UTC e desloca para o dia anterior em Brasília; tratamos como dia
    // civil e ancoramos ao meio-dia UTC (parseCalendarDate). Sem data, vale o dia
    // de HOJE EM BRASÍLIA pela mesma âncora: `new Date()` depois das 21:00 BRT já é
    // o dia seguinte em UTC, e o rebuild aplicaria a posição e o fluxo um dia tarde.
    const txDate = date ? parseCalendarDate(date) : parseCalendarDate(brazilDateKey());
    const transactionType = quantity >= 0 ? 'BUY' : 'SELL';
    let updatedAsset;
    try {
        if (!ticker || quantity === undefined || price === undefined) throw AppError.badRequest("Dados incompletos.");
        if (!txDate) throw AppError.badRequest("Data inválida.");
        const brazilTodayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
        const transactionDayKey = toDateKey(txDate);
        if (date && transactionDayKey > brazilTodayKey) throw AppError.badRequest("Data futura não permitida.");
        await runTransaction(async (session) => {
            const transactionQuantity = safeQuantity(Math.abs(Number(quantity)));
            const transactionPrice = safeUnitPrice(Math.abs(Number(price)));
            const newTx = new AssetTransaction({
                user: userId, wallet: walletId, ticker: ticker.toUpperCase(), type: transactionType,
                quantity: transactionQuantity,
                price: transactionPrice,
                totalValue: safeValue(transactionQuantity, transactionPrice),
                date: txDate, notes: name ? `Nome: ${name}` : ''
            });
            await newTx.save({ session });
            updatedAsset = await financialService.recalculatePosition(userId, ticker.toUpperCase(), type, session, currency, walletId);
            if (!updatedAsset) return;
            await stampTransactionCurrency(newTx, updatedAsset, session);
            if (type === 'FIXED_INCOME' || type === 'CASH') {
                await applyFixedIncomeOrCashMetadata(updatedAsset, {
                    ticker, type, name, fixedIncomeRate, fixedIncomeIndex, fixedIncomeSpread, maturityDate, isReserve,
                    transactionType, txDate,
                }, session);
            }
            // Exterior: override manual do sub-tipo no cadastro. A auto-heurística
            // já rodou em recalculatePosition; aqui o usuário tem a última palavra.
            if (type === 'STOCK_US' && usSubType) {
                updatedAsset.usSubType = usSubType;
                updatedAsset.usSubTypeManual = true;
                await updatedAsset.save({ session });
            }
        });
    } catch (error) {
        return next(error);
    }
    // Qualquer dia anterior ao dia-calendário atual exige reconstrução. A regra
    // anterior usava "agora - 24h" e podia não recalcular uma compra de ontem.
    if (toDateKey(txDate) < new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())) {
        // Best-effort: a transação já foi persistida. Se o rebuild do histórico
        // falhar, logamos (sem silenciar) — o snapshot é corrigido no próximo
        // recálculo/job diário, mas a falha precisa ficar visível.
        try {
            await financialService.rebuildUserHistory(userId, walletId);
        } catch (err) {
            logger.warn(`[Wallet] Rebuild de histórico falhou após addAssetTransaction (user ${userId}): ${err.message}`);
        }
    }
    // Ingestão de proventos do ticker em background (não bloqueia a resposta).
    // Garante que compras novas já apareçam com proventos sem rodar o script.
    if (transactionType === 'BUY' && !['CRYPTO', 'FIXED_INCOME', 'CASH'].includes(type)) {
        financialService.syncDividends([{ ticker: ticker.toUpperCase(), type }])
            .catch(err => logger.warn(`[Wallet] Sync de proventos em background falhou para ${ticker}: ${err.message}`));
    }
    res.status(201).json({ message: "Transação registrada.", asset: updatedAsset });
};

// Etiquetas, nome e sub-tipo de Exterior editados pelo usuário.
const applyAssetLabelEdits = (asset, { tags, name, usSubType }) => {
    if (tags !== undefined) asset.tags = tags;
    // Renomear cofrinho (Reserva/Caixa) ou título de Renda Fixa.
    if (name !== undefined) asset.name = String(name).trim();
    // Override manual do sub-tipo de Exterior — só faz sentido para STOCK_US.
    // Marca usSubTypeManual para que a auto-heurística não sobrescreva depois.
    if (usSubType !== undefined && asset.type === 'STOCK_US') {
        asset.usSubType = usSubType;
        asset.usSubTypeManual = true;
    }
};

const INDEXED_FIXED_INCOME = new Set(['SELIC', 'CDI', 'IPCA']);

const reclassifyCashAsFixedIncome = (asset, { fixedIncomeRate, fixedIncomeIndex, fixedIncomeSpread, maturityDate, isReserve }) => {
    asset.type = 'FIXED_INCOME';
    if (fixedIncomeRate !== undefined) asset.fixedIncomeRate = fixedIncomeRate;
    if (INDEXED_FIXED_INCOME.has(fixedIncomeIndex)) {
        asset.fixedIncomeIndex = fixedIncomeIndex;
        asset.fixedIncomeSpread = Number(fixedIncomeSpread) || 0;
    } else if (fixedIncomeIndex === 'PRE') {
        asset.fixedIncomeIndex = 'PRE';
    }
    if (maturityDate) {
        const md = new Date(maturityDate);
        if (!isNaN(md.getTime())) asset.maturityDate = md;
    }
    // Ao virar título, passa a ser investimento por padrão (entra no donut
    // e no grupo "Renda Fixa"), salvo se o usuário pedir p/ manter na reserva.
    asset.isReserve = isReserve === undefined ? false : !!isReserve;
};

export const updateAsset = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { tags, name, usSubType, type, fixedIncomeRate, fixedIncomeIndex, fixedIncomeSpread, maturityDate, isReserve } = req.body;
        const userId = req.user.id;

        // wallet no filtro evita que um id de outra carteira do mesmo usuário
        // (ou de outro usuário) resolva aqui — posse é sempre {user, wallet, _id}.
        const asset = await UserAsset.findOne({ _id: id, user: userId, wallet: req.walletId });
        if (!asset) return res.status(404).json({ message: "Ativo não encontrado" });

        applyAssetLabelEdits(asset, { tags, name, usSubType });

        // Reclassificar um Caixa/Reserva (CASH) em Renda Fixa (FIXED_INCOME) —
        // para posições cadastradas como "cofrinho" que na verdade são um título.
        // Só nessa direção: CASH guarda price=1, então o valor principal
        // (quantity×price = quantity) é idêntico à base do accrual de RF — a
        // reclassificação preserva o patrimônio e só troca a curva de rendimento.
        let reclassified = false;
        if (type === 'FIXED_INCOME' && asset.type === 'CASH') {
            reclassifyCashAsFixedIncome(asset, { fixedIncomeRate, fixedIncomeIndex, fixedIncomeSpread, maturityDate, isReserve });
            reclassified = true;
        } else if (isReserve !== undefined && (asset.type === 'FIXED_INCOME' || asset.type === 'CASH')) {
            // Alternar "Reserva separada" sem mudar a classe.
            asset.isReserve = !!isReserve;
        }

        await asset.save();

        // Reclassificar muda a curva de rendimento (100% CDI → taxa do título),
        // inclusive retroativamente: reconstrói o histórico p/ os snapshots baterem.
        if (reclassified) {
            try {
                await financialService.rebuildUserHistory(userId, req.walletId);
            } catch (e) {
                logger.warn(`[Wallet] Rebuild pós-reclassificação falhou (user ${userId}): ${e.message}`);
            }
        }
        res.json({ message: reclassified ? "Ativo convertido em Renda Fixa." : "Ativo atualizado.", asset });
    } catch (error) {
        next(error);
    }
};

export const removeAsset = async (req, res, next) => {
    const userId = req.user.id;
    const walletId = req.walletId;
    const assetId = req.params.id;
    try {
        await runTransaction(async (session) => {
            const asset = await UserAsset.findOne({ _id: assetId, user: userId, wallet: walletId });
            if (!asset) throw txError(404, "Ativo não encontrado");
            await AssetTransaction.deleteMany({ user: userId, wallet: walletId, ticker: asset.ticker }).session(session);
            await UserAsset.deleteOne({ _id: assetId }).session(session);
        });
    } catch (error) {
        if (error.httpStatus) return res.status(error.httpStatus).json({ message: error.message });
        return next(error);
    }
    // Best-effort pós-commit (ver removeAsset/addAssetTransaction): loga em vez de silenciar.
    try {
        await financialService.rebuildUserHistory(userId, walletId);
    } catch (e) {
        logger.warn(`[Wallet] Rebuild de histórico falhou após remover ativo (user ${userId}): ${e.message}`);
    }
    res.json({ message: "Ativo removido." });
};

// Wipe completo da carteira ATIVA (ativos + lançamentos + histórico). Fase 2:
// escopado por wallet — o equivalente para conta inteira/todas as carteiras
// não existe mais aqui; a exclusão de UMA carteira específica vive em
// DELETE /api/wallets/:walletId (walletsController.js).
export const resetWallet = async (req, res, next) => {
    const userId = req.user.id;
    const walletId = req.walletId;
    try {
        await runTransaction(async (session) => {
            await UserAsset.deleteMany({ user: userId, wallet: walletId }).session(session);
            await AssetTransaction.deleteMany({ user: userId, wallet: walletId }).session(session);
            await WalletSnapshot.deleteMany({ user: userId, wallet: walletId }).session(session);
        });
    } catch (error) {
        return next(error);
    }
    res.json({ message: "Carteira resetada." });
};

// PUT /wallet/targets — salva a carteira ideal (alocação-alvo + reserva) DESTA
// carteira (Fase 2: cada carteira tem sua própria, não mais uma por conta).
const TARGET_ALLOCATION_KEYS = ['STOCK', 'FII', 'STOCK_US', 'ETF', 'CRYPTO', 'FIXED_INCOME'];
const TARGET_SUB_ALLOCATION_KEYS = {
    STOCK: ['STOCK', 'ETF'],
    FIXED_INCOME: ['IPCA', 'POS', 'PRE'],
    STOCK_US: ['STOCK', 'REIT', 'ETF', 'DOLLAR'],
};

// { chave: safeFloat(valor || 0) } para cada chave, na ordem dada.
const pickTargetFloats = (source, keys) =>
    Object.fromEntries(keys.map((key) => [key, safeFloat(source[key] || 0)]));

// `$set` da carteira ideal: só os campos enviados, cada um saneado.
const buildTargetsUpdate = ({ targetAllocation, targetReserve, targetMonthlyDividendIncome, targetSubAllocation }) => {
    const update = {};
    if (targetAllocation !== undefined) {
        update.targetAllocation = pickTargetFloats(targetAllocation, TARGET_ALLOCATION_KEYS);
    }
    if (targetReserve !== undefined) {
        update.targetReserve = Math.max(0, safeFloat(targetReserve));
    }
    if (targetMonthlyDividendIncome !== undefined) {
        update.targetMonthlyDividendIncome = Math.max(0, safeFloat(targetMonthlyDividendIncome));
    }
    if (targetSubAllocation !== undefined) {
        update.targetSubAllocation = Object.fromEntries(
            Object.entries(TARGET_SUB_ALLOCATION_KEYS).map(([group, keys]) =>
                [group, pickTargetFloats(targetSubAllocation[group] || {}, keys)]),
        );
    }
    return update;
};

export const updateWalletTargets = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const walletId = req.walletId;
        const { targetAllocation, targetReserve, targetMonthlyDividendIncome, targetSubAllocation } = req.body;

        const update = buildTargetsUpdate({ targetAllocation, targetReserve, targetMonthlyDividendIncome, targetSubAllocation });

        // { _id, user } no filtro: defesa em profundidade além do já validado por
        // resolveWallet (nunca reconfia num walletId cru sem o par correto de user).
        const updated = await Wallet.findOneAndUpdate({ _id: walletId, user: userId }, { $set: update }, { new: true })
            .select('targetAllocation targetReserve targetMonthlyDividendIncome targetSubAllocation').lean();

        res.json({
            message: 'Carteira ideal atualizada.',
            targetAllocation: updated?.targetAllocation,
            targetReserve: updated?.targetReserve,
            targetMonthlyDividendIncome: updated?.targetMonthlyDividendIncome,
            targetSubAllocation: updated?.targetSubAllocation,
        });
    } catch (error) {
        next(error);
    }
};

export const searchAssets = async (req, res, next) => {
    try {
        const { q, type } = req.query;
        if (!q || q.length < 2) return res.json([]);

        // O termo é texto digitado, não padrão: "Tesouro IPCA+ 2037" sem escapar
        // vira `IPCA+` = um ou mais "A", e a busca não devolvia nenhum título.
        const term = escapeRegex(q);

        const marketResults = await MarketAsset.find({
            $or: [{ ticker: { $regex: `^${term}`, $options: 'i' } }, { name: { $regex: term, $options: 'i' } }],
            isIgnored: { $ne: true }
        }).sort({ liquidity: -1 }).limit(8).select('ticker name type lastPrice rate index');

        if (type === 'FIXED_INCOME') {
            const bonds = await TreasuryBond.find({
                title: { $regex: term, $options: 'i' }
            }).sort({ type: 1, maturityDate: 1 }).limit(10);

            const formattedBonds = bonds.map(b => ({
                ticker: b.title,
                name: b.title,
                type: 'FIXED_INCOME',
                lastPrice: b.unitPrice,
                rate: b.rate,
                index: b.index,
                maturityDate: b.maturityDate,
                isTreasury: true
            }));

            return res.json([...marketResults, ...formattedBonds]);
        }

        res.json(marketResults);
    } catch (error) { next(error); }
};

export const ASSET_TRANSACTIONS_MAX_LIMIT = 200;

export const getAssetTransactions = async (req, res, next) => {
    try {
        const { ticker } = req.params;
        // Paginação saneada: `limit` vinha direto da query (`?limit=1000000` puxava o
        // extrato inteiro numa ida só) e `page` ≤ 0 virava skip negativo, que o
        // Mongo rejeita com 500. Teto de 200 por página, página mínima 1.
        const parsedPage = Number.parseInt(req.query.page, 10);
        const parsedLimit = Number.parseInt(req.query.limit, 10);
        const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1;
        const limit = Number.isFinite(parsedLimit) && parsedLimit >= 1
            ? Math.min(ASSET_TRANSACTIONS_MAX_LIMIT, parsedLimit)
            : 10;
        const query = { user: req.user.id, wallet: req.walletId, ticker: ticker.toUpperCase() };
        const transactions = await AssetTransaction.find(query).sort({ date: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit);
        const total = await AssetTransaction.countDocuments(query);
        // Mesma resolução do extrato global: a moeda acompanha o lançamento, para o
        // cliente não precisar reimplementar a regra de dolarização. A posição só é
        // buscada se houver lançamento legado sem moeda gravada (ver getCashFlow).
        const asset = transactions.some(needsCurrencyFallback)
            ? await UserAsset.findOne(query).select('ticker type currency').lean()
            : null;
        res.json({
            transactions: transactions.map(t => ({ ...t.toObject(), currency: resolveTransactionCurrency(t, asset) })),
            pagination: { total, page, pages: Math.ceil(total / limit), hasMore: page * limit < total },
        });
    } catch (error) { next(error); }
};

export const deleteTransaction = async (req, res, next) => {
    const userId = req.user.id;
    const walletId = req.walletId;
    try {
        await runTransaction(async (session) => {
            const tx = await AssetTransaction.findOneAndDelete({ _id: req.params.id, user: userId, wallet: walletId }, { session });
            if (!tx) throw txError(404, "Transação não encontrada");
            // Recalcula a posição na MESMA transação: se o recálculo falhar (ex.: saldo
            // insuficiente), o delete é revertido — sem estado financeiro inconsistente.
            await financialService.recalculatePosition(userId, tx.ticker, null, session, null, walletId);
        });
    } catch (error) {
        if (error.httpStatus) return res.status(error.httpStatus).json({ message: error.message });
        return next(error);
    }
    // Best-effort pós-commit (ver acima): loga em vez de silenciar.
    try {
        await financialService.rebuildUserHistory(userId, walletId);
    } catch (e) {
        logger.warn(`[Wallet] Rebuild de histórico falhou após remover transação (user ${userId}): ${e.message}`);
    }
    res.json({ message: "Transação removida." });
};
