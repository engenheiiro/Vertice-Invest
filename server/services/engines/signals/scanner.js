// Partes da varredura do Radar Alpha (`signalEngine.runScanner`): mapa de
// histórico, os três checks por ativo (RSI, divergência, Deep Value) e a
// persistência (upsert, auto-invalidação e metadados do scan).
// `engine` é o próprio signalEngine: os cálculos continuam passando por ele.

import logger from '../../../config/logger.js';
import QuantSignal from '../../../models/QuantSignal.js';
import SystemConfig from '../../../models/SystemConfig.js';

const BLOCKED = 'BLOCKED';

// Filtro dos ativos elegíveis à varredura.
export function eligibleAssetsFilter() {
    return {
        isActive: true,
        isIgnored: false,
        isBlacklisted: false,
        type: { $in: ['STOCK', 'FII', 'STOCK_US'] },
        $or: [
            { liquidity: { $gt: 500000 } },
            { avgLiquidity: { $gt: 500000 } }
        ]
    };
}

// ticker → histórico do mais recente para o mais antigo (só séries com > 15 pregões).
export function buildHistoryMap(allHistories) {
    const historyMap = new Map();
    allHistories.forEach(h => {
        if (h.history && h.history.length > 15) {
            historyMap.set(h.ticker, h.history.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
        }
    });
    return historyMap;
}

export function newScanState() {
    return {
        processedPairs: new Set(), // pares (ticker-type) que AINDA atendem condições
        scannedTickers: new Set(), // tickers com histórico efetivamente analisados
        upsertOps: [],
        correlationBlocks: 0,
    };
}

// Downtrend moderado: preço mais de 15% abaixo da SMA200.
function isTrendBlocked(asset, currentPrice) {
    return asset.sma200 > 0 && currentPrice < asset.sma200 * 0.85;
}

// `timestamp` é a data de EMISSÃO e só entra na inserção. Quando ia no $set,
// toda varredura de 15 min o renovava: a idade do sinal no backtest nunca
// passava do horizonte (o sinal não expirava e o preço de entrada, fixo no
// $setOnInsert, ficava com outra data), e o atraso do plano ESSENTIAL
// (`timestamp <= agora - atraso`) nunca alcançava um sinal ainda ativo.
function signalOutcome(ctx, type, set, riskProfile) {
    const { asset } = ctx;
    return {
        pair: `${asset.ticker}-${type}`,
        op: {
            updateOne: {
                filter: { ticker: asset.ticker, type, status: 'ACTIVE' },
                update: {
                    $set: set,
                    $setOnInsert: {
                        timestamp: new Date(),
                        ticker: asset.ticker,
                        type,
                        assetType: asset.type,
                        riskProfile,
                        sector: asset.sector || 'Outros',
                        priceAtSignal: ctx.currentPrice,
                        status: 'ACTIVE'
                    }
                },
                upsert: true
            }
        }
    };
}

// Cada sinal passa pelo filtro macro com o PRÓPRIO tipo: o veto de dia de crash
// isenta só o RSI_OVERSOLD.
const correlationOk = (engine, ctx, type) =>
    engine.isValidCorrelation(ctx.asset.ticker, type, ctx.macroContext, ctx.asset.type).valid;

// CHECK 1: RSI OVERSOLD (GOLD only: RSI < 30 + reversão + volume).
function rsiOversoldCheck(engine, ctx) {
    const { asset, closes } = ctx;
    if (!(asset.netMargin > -5)) return null;
    const rsi = engine.calculateRSI(closes, 14);
    // Exige que o preço de hoje esteja acima de ontem (rebate confirmado, não faca caindo)
    const isReverting = closes.length >= 3 && closes[0] > closes[1];
    if (!(rsi !== null && rsi < 30 && isReverting && ctx.hasVolumeConfirmation)) return null;
    if (isTrendBlocked(asset, ctx.currentPrice)) return BLOCKED;
    if (!correlationOk(engine, ctx, 'RSI_OVERSOLD')) return BLOCKED;

    const urgencyLevel = engine._rsiUrgency(rsi);
    const message = `${rsi < 20 ? 'Sobrevenda Extrema' : 'Sobrevenda Técnica'}: RSI em ${rsi.toFixed(0)}. Anomalia estatística detectada.`;
    return signalOutcome(ctx, 'RSI_OVERSOLD',
        { quality: 'GOLD', value: rsi, message, urgencyLevel, volumeRatio: ctx.volumeRatio }, ctx.riskProfile);
}

// CHECK 3: DIVERGÊNCIA ALTISTA, com a mesma trava de qualidade do RSI.
function divergenceCheck(engine, ctx) {
    const { asset } = ctx;
    if (!(asset.netMargin > -5 && ctx.hasVolumeConfirmation)) return null;
    const divergence = engine.detectBullishDivergence(ctx.closes, 14);
    const trendBlock = isTrendBlocked(asset, ctx.currentPrice);
    if (!divergence || trendBlock) return null;
    if (!correlationOk(engine, ctx, 'BULLISH_DIVERGENCE')) return BLOCKED;

    const urgencyLevel = engine._divergenceUrgency(divergence.rsiAtLow);
    const rsiPair = `${divergence.rsiAtLow.toFixed(0)} vs ${divergence.priorRsiLow.toFixed(0)}`;
    const message = `Divergência Altista: preço em novo fundo, mas RSI subindo (${rsiPair}). Possível virada.`;
    return signalOutcome(ctx, 'BULLISH_DIVERGENCE',
        { quality: 'GOLD', value: divergence.rsiAtLow, message, urgencyLevel, volumeRatio: ctx.volumeRatio }, ctx.riskProfile);
}

// `roe` gravado em texto: vale o número só se o texto for numérico finito;
// qualquer outro texto é ROE ausente.
function readRoe(roe) {
    if (typeof roe !== 'string') return roe;
    const n = roe.trim() === '' ? NaN : Number(roe);
    return Number.isFinite(n) ? n : null;
}

function isDeepValueCandidate(asset, roe, currentPrice) {
    const inDowntrend = asset.sma200 > 0 && currentPrice < asset.sma200;
    return asset.pl > 0 && asset.p_vp > 0 && asset.type === 'STOCK' && roe > 0 && !inDowntrend;
}

// CHECK 2: DEEP VALUE Graham (GOLD only: desconto < 70% + ROE > 0 + sem downtrend).
function deepValueCheck(engine, ctx) {
    const { asset, currentPrice } = ctx;
    const roe = readRoe(asset.roe);
    if (!isDeepValueCandidate(asset, roe, currentPrice)) return null;
    const grahamNumber = Math.sqrt(22.5 * (currentPrice / asset.pl) * (currentPrice / asset.p_vp));
    const discount = currentPrice / grahamNumber;
    if (!(grahamNumber > 0 && discount < 0.70)) return null;

    const urgencyLevel = engine._grahamUrgency(discount);
    const message = `Deep Value: Negociando a ${(discount * 100).toFixed(0)}% do Valor Intrínseco. ROE: ${roe.toFixed(1)}%.`;
    return signalOutcome(ctx, 'DEEP_VALUE', { quality: 'GOLD', value: grahamNumber, message, urgencyLevel }, 'DEFENSIVE');
}

function recordOutcome(scan, outcome) {
    if (outcome === BLOCKED) scan.correlationBlocks++;
    else if (outcome) {
        scan.processedPairs.add(outcome.pair);
        scan.upsertOps.push(outcome.op);
    }
}

// Os checks gravam um a um: se um deles lançar, o que os anteriores gravaram fica.
function analyzeAsset(engine, asset, history, macroContext, scan) {
    const closes = history.map(h => h.adjClose || h.close).filter(v => v > 0);
    const currentPrice = asset.lastPrice;
    const riskProfile = engine.determineRiskProfile(asset);
    // Confirmação de volume (7.3): volume atual >= 1.2x média dos últimos 20
    // pregões. Degrada com segurança se não houver dado.
    const volume = engine._volumeStats(history);
    const ctx = {
        asset, closes, currentPrice, riskProfile, macroContext,
        hasVolumeConfirmation: volume.confirmed,
        volumeRatio: volume.ratio,
    };
    recordOutcome(scan, rsiOversoldCheck(engine, ctx));
    recordOutcome(scan, divergenceCheck(engine, ctx));
    recordOutcome(scan, deepValueCheck(engine, ctx));
}

export function scanAsset(engine, asset, historyMap, macroContext, scan) {
    try {
        const history = historyMap.get(asset.ticker);
        if (!history) return;
        scan.scannedTickers.add(asset.ticker);
        analyzeAsset(engine, asset, history, macroContext, scan);
    } catch {
        // Exceção no meio da análise: as condições do ativo NÃO foram
        // avaliadas. Fica fora de scannedTickers, senão a auto-invalidação
        // encerraria os sinais ativos dele como "condição revertida".
        scan.scannedTickers.delete(asset.ticker);
    }
}

// AUTO-INVALIDAÇÃO — fecha sinais cujas condições não são mais válidas, só
// dos tickers efetivamente analisados nesta varredura.
async function closeStaleSignals(activeSignals, scan) {
    const scannedTickersArr = [...scan.scannedTickers];
    const staleSignals = activeSignals.filter(
        s => scannedTickersArr.includes(s.ticker) && !scan.processedPairs.has(`${s.ticker}-${s.type}`)
    );
    if (staleSignals.length === 0) return 0;
    await QuantSignal.updateMany(
        { _id: { $in: staleSignals.map(s => s._id) } },
        { $set: { status: 'NEUTRAL', auditDate: new Date(), message: 'Condição revertida durante varredura.' } }
    );
    return staleSignals.length;
}

// Persistência (UPSERT atômico: máximo 1 ACTIVE por ticker/tipo), invalidação,
// metadados do scan para o frontend e o resumo devolvido.
export async function persistScan(assets, activeSignals, scan, startTime) {
    const { upsertOps } = scan;
    if (upsertOps.length > 0) {
        await QuantSignal.bulkWrite(upsertOps, { ordered: false });
    }

    const staleCount = await closeStaleSignals(activeSignals, scan);

    const totalActiveAfter = await QuantSignal.countDocuments({ status: 'ACTIVE' });
    await SystemConfig.findOneAndUpdate(
        { key: 'RADAR_SCAN_META' },
        {
            $set: {
                value: {
                    lastScanAt: new Date(),
                    assetsScanned: assets.length,
                    assetsWithHistory: scan.scannedTickers.size,
                    upsertedSignals: upsertOps.length,
                    staleSignalsClosed: staleCount,
                    activeSignalsTotal: totalActiveAfter
                }
            }
        },
        { upsert: true }
    );

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.info(`✅ [Radar Alpha] ${duration}s. Upserts: ${upsertOps.length} | Inativados: ${staleCount}`
        + ` | Ativos: ${totalActiveAfter} | Bloqueados: ${scan.correlationBlocks}`);

    return {
        success: true,
        signals: upsertOps.length,
        staleInactivated: staleCount,
        blocked: scan.correlationBlocks,
        analyzed: assets.length,
        ignored: 0
    };
}
