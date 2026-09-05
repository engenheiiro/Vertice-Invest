/**
 * REPARO DO CANDLE DIÁRIO DA CRIPTO, PELAS BARRAS HORÁRIAS DO MESMO DIA.
 *
 * Em 04/09/2026 o Yahoo publicou a barra DIÁRIA de toda a cripto com
 * `close: null` — BTC, ETH e USDC pararam em 03/09 — enquanto as barras HORÁRIAS
 * daquele mesmo dia estavam lá, 23 das 24 válidas. É o buraco já conhecido nos
 * ETFs da B3 (ver `walletDayCandleService`), com uma diferença que decide o
 * desenho daqui: ação e FII têm o arquivo oficial do pregão para socorrê-los, e
 * a cripto não tem arquivo nenhum.
 *
 * VARREDURA DE JANELA, e não da ponta. Enquanto a série termina no dia anterior
 * ao buraco, a ponta ainda o enxerga; assim que o candle do dia seguinte chega,
 * ele fecha a ponta por cima e a lacuna some do radar para sempre. Foi assim que
 * 27 e 28/08 viraram cicatriz permanente nas séries da B3, e é por isso que aqui
 * a pergunta é "que dias faltam na janela?", nunca "a série está atrasada?".
 *
 * O QUE ELE NÃO FAZ: inventar candle. Dia que a fonte não cobre com barras
 * horárias suficientes continua sendo buraco — a decisão de aceitar a
 * aproximação tem limites, e eles estão em `fetchDailyCloseFromHourly`
 * (cobertura mínima do dia + última barra no fim do dia). Buraco é melhor que
 * número inventado.
 *
 * Só CRIPTO. Em papel de bolsa o "fechamento" é um evento do pregão, com hora e
 * leilão, e derivá-lo da última barra horária seria trocar um dado oficial por
 * uma estimativa — para esses o socorro certo é o arquivo da B3. Na cripto não
 * existe fechamento oficial: o "close" diário já é, por convenção, o preço num
 * instante (00:00Z), então tomá-lo da barra horária mais próxima desse instante
 * é a MESMA medida, do MESMO provedor, com menos resolução.
 */
import logger from '../config/logger.js';
import AssetHistory from '../models/AssetHistory.js';
import MarketAsset from '../models/MarketAsset.js';
import { historyStorageKey, mergeCandleSeries } from '../utils/assetHistory.js';
import { externalMarketService } from './externalMarketService.js';

/**
 * Janela de varredura, em dias corridos. Curta de propósito: o reparo custa uma
 * chamada por (ativo × dia faltante), e buraco antigo já entrou nas médias — o
 * que importa é não deixar cicatriz nova.
 */
export const CRYPTO_REPAIR_WINDOW_DAYS = 5;

/**
 * Teto de buscas por execução. Fonte com semanas fora vira custo, não conserto.
 *
 * 120 e não 40: no dia do incidente eram 42 buracos (a barra diária falhou para
 * quase toda a coorte, não só para os 3 ativos em carteira) e o teto de 40 obrigou
 * uma segunda passada — num job diário, isso é um dia inteiro de espera para
 * fechar os dois que sobraram. 120 cobre a coorte atual (49 séries) com margem
 * para um apagão de dois dias, e continua limitado.
 */
export const CRYPTO_REPAIR_MAX_FETCHES = 120;

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Dia-UTC imediatamente anterior, sem depender do fuso da máquina. */
export const previousUtcDay = (dayStr) => {
    const d = new Date(`${dayStr}T12:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
};

/**
 * Dias-UTC da janela, do mais antigo ao mais recente, terminando em `throughDay`.
 * Dias CORRIDOS: cripto negocia 24/7, e pular fim de semana aqui deixaria dois
 * buracos legítimos por semana fora do radar.
 */
export const calendarWindowDays = (throughDay, maxDays = CRYPTO_REPAIR_WINDOW_DAYS) => {
    if (!DAY_KEY_RE.test(String(throughDay || ''))) return [];
    const dias = [];
    let cursor = throughDay;
    for (let i = 0; i < maxDays; i += 1) {
        dias.push(cursor);
        cursor = previousUtcDay(cursor);
    }
    return dias.reverse();
};

/**
 * Dias da janela que faltam numa série.
 *
 * Nunca antes do PRIMEIRO candle guardado: série que começou anteontem não tem
 * buraco em dias anteriores ao seu início, e pedi-los à fonte seria gastar
 * chamada para receber "não existe" — foi o que transformaria um ativo recém
 * listado em 5 buscas inúteis por execução.
 */
export const missingCalendarDays = (existingDates = [], throughDay, maxDays = CRYPTO_REPAIR_WINDOW_DAYS) => {
    const janela = calendarWindowDays(throughDay, maxDays);
    if (janela.length === 0) return [];
    const tem = new Set(existingDates);
    if (tem.size === 0) return [];
    const primeiro = [...tem].sort()[0];
    return janela.filter((dia) => dia >= primeiro && !tem.has(dia));
};

/**
 * Fecha os buracos recentes das séries de cripto.
 *
 * @param {{throughDay?:string, maxDays?:number, now?:Date}} [options]
 *   `throughDay` default = ontem em UTC: o dia corrente ainda não fechou, e o
 *   candle dele só existiria como barra parcial.
 * @returns {Promise<{scanned:number, gaps:number, repaired:number, unresolved:number, byTicker:Object}>}
 */
export const repairCryptoCandleGaps = async ({
    throughDay = null,
    maxDays = CRYPTO_REPAIR_WINDOW_DAYS,
    now = new Date(),
} = {}) => {
    const alvoFinal = throughDay || previousUtcDay(now.toISOString().slice(0, 10));
    const vazio = { scanned: 0, gaps: 0, repaired: 0, unresolved: 0, byTicker: {} };
    if (!DAY_KEY_RE.test(alvoFinal)) return vazio;

    // Coorte pelo UNIVERSO, não pelo conteúdo de AssetHistory: a coleção guarda
    // chaves de cripto que saíram da fonte (MATIC, RNDR, IMX, GRT, TAO) e varrer
    // tudo gastaria chamadas atrás de série que ninguém consulta mais.
    const ativos = await MarketAsset.find({
        type: 'CRYPTO',
        isActive: true,
        isBlacklisted: { $ne: true },
    }).select('ticker type').lean();
    if (ativos.length === 0) return vazio;

    const chaves = new Map();
    for (const a of ativos) {
        const key = historyStorageKey(a.ticker, a.type);
        if (key && !chaves.has(key)) chaves.set(key, a.ticker);
    }

    const janela = calendarWindowDays(alvoFinal, maxDays);
    let faltantesPorChave = new Map();
    try {
        // Lê só as DATAS da janela, não os ~2.400 candles de cada série.
        const rows = await AssetHistory.aggregate([
            { $match: { ticker: { $in: [...chaves.keys()] } } },
            {
                $project: {
                    ticker: 1,
                    dates: {
                        $map: {
                            input: {
                                $filter: {
                                    input: { $ifNull: ['$history', []] },
                                    as: 'h',
                                    cond: { $and: [{ $gte: ['$$h.date', janela[0]] }, { $lte: ['$$h.date', alvoFinal] }] },
                                },
                            },
                            as: 'h',
                            in: '$$h.date',
                        },
                    },
                },
            },
        ]);
        for (const row of rows) {
            const dias = missingCalendarDays(row.dates, alvoFinal, maxDays);
            if (dias.length > 0) faltantesPorChave.set(row.ticker, dias);
        }
    } catch (e) {
        // Fail-open: sem a leitura não há varredura, e quem chamou segue com o que tinha.
        logger.warn(`[CryptoCandle] Varredura não pôde ler as séries: ${e.message}`);
        return vazio;
    }

    const scanned = chaves.size;
    if (faltantesPorChave.size === 0) return { ...vazio, scanned };

    const totalBuracos = [...faltantesPorChave.values()].reduce((s, d) => s + d.length, 0);
    const docs = await AssetHistory.find({ ticker: { $in: [...faltantesPorChave.keys()] } }).lean();
    const guardadaPorChave = new Map(docs.map((d) => [d.ticker, d.history || []]));

    let buscas = 0;
    let repaired = 0;
    let unresolved = 0;
    const byTicker = {};

    for (const [storageKey, dias] of faltantesPorChave) {
        const novos = [];
        for (const dia of dias) {
            if (buscas >= CRYPTO_REPAIR_MAX_FETCHES) break;
            buscas += 1;
            // A chave de armazenamento da cripto JÁ é o símbolo do provedor (BTC-USD).
            const candle = await externalMarketService.fetchDailyCloseFromHourly(storageKey, dia);
            if (candle) novos.push(candle);
            else unresolved += 1;
        }
        if (novos.length === 0) continue;
        try {
            const merged = mergeCandleSeries(guardadaPorChave.get(storageKey) || [], novos, {
                type: 'CRYPTO',
                now,
            });
            await AssetHistory.updateOne(
                { ticker: storageKey },
                // lastCheckedAt intocado: ele mede a VISITA do timeSeriesWorker, e
                // renová-lo aqui mascararia a cobertura daquele run.
                { $set: { history: merged, lastUpdated: new Date() } },
            );
            repaired += novos.length;
            byTicker[storageKey] = novos.map((c) => c.date);
        } catch (e) {
            logger.warn(`[CryptoCandle] Falha ao gravar reparo de ${storageKey}: ${e.message}`);
        }
    }

    if (repaired > 0) {
        // Info e não debug: é dado APROXIMADO entrando na série, e a linha do log é
        // o que permite auditar depois de onde veio cada fechamento.
        logger.info('[CryptoCandle] Buraco da barra diária fechado pelas barras horárias', {
            through: alvoFinal, gaps: totalBuracos, repaired, unresolved, assets: byTicker,
        });
    } else if (totalBuracos > 0) {
        logger.warn('[CryptoCandle] Buraco na série de cripto que a fonte não cobriu', {
            through: alvoFinal, gaps: totalBuracos, unresolved,
        });
    }

    return { scanned, gaps: totalBuracos, repaired, unresolved, byTicker };
};
