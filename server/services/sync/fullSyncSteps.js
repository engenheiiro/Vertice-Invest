// Etapas do sync completo (`syncService._runFullSync`) que não dependem da
// ingestão do Fundamentus: estatísticas do run, seed de cripto, backfills
// pós-gravação, cotações em lote e rotinas diárias com guarda de 23h.
import logger from '../../config/logger.js';
import MarketAsset from '../../models/MarketAsset.js';
import SystemConfig from '../../models/SystemConfig.js';
import { CRYPTO_ASSETS } from '../../config/cryptoList.js';
import { appendSnapshots } from '../fundamentalHistoryService.js';
import { backfillSectors } from '../sectorBackfillService.js';
import { marketDataService } from '../marketDataService.js';
import { classifyUsAsset } from '../../utils/usClassification.js';
import { withMongoRetry } from '../../utils/mongoResilience.js';

// Filtro novo a cada chamada, como era no sync: nada garante que o driver não o altere.
const macroKey = () => ({ key: 'MACRO_INDICATORS' });
const DAILY_GUARD_MS = 23 * 60 * 60 * 1000;
const QUOTE_BATCH_SIZE = 50;

/** Grava `lastSyncStats` de um run que não chegou a persistir fundamentos. */
export const saveFailedSyncStats = ({ typosFixed, errorCode, fundamentals, timestamp }) => SystemConfig.findOneAndUpdate(
    macroKey(),
    { $set: { lastSyncStats: {
        typosFixed,
        assetsProcessed: 0,
        fundamentalsHealthy: false,
        errorCode,
        fundamentals,
        timestamp,
    } } },
    { upsert: true },
);

/**
 * Fail closed antes de qualquer bulkWrite: uma queda abrupta na taxa
 * parseado→aceito indica layout deslocado ou fonte parcial. Não mistura
 * operações externas no denominador e não persiste fundamentos suspeitos.
 */
export const reportDegradedIngestion = async (ingestionHealth, typosFixed, timestamp) => {
    logger.error(`❌ [Sync] Fundamentos degradados: ${ingestionHealth.reason}`, {
        errorCode: ingestionHealth.code,
        fundamentals: ingestionHealth.stats,
    });
    await saveFailedSyncStats({
        typosFixed, errorCode: ingestionHealth.code, fundamentals: ingestionHealth.stats, timestamp,
    });
    return {
        success: false,
        error: ingestionHealth.reason,
        errorCode: ingestionHealth.code,
        fundamentals: ingestionHealth.stats,
    };
};

// Aposentados, lidos UMA vez por sync. A blacklist é estado TERMINAL, mas a
// fonte não sabe disso: o Fundamentus segue listando o papel (com a liquidez
// velha, que passa no filtro de 5k) e o $set gravava
// `isActive: true, failCount: 0` — ou seja, o sync desfazia a aposentadoria a
// cada run. Era assim que `isBlacklisted=true` + `isActive=true` nascia: em
// 05/09/2026 eram 23 ativos nesse estado, e o painel de Saúde ("Aposentado
// que ainda é cotado") mostrava o resultado, não a origem. Fonte listar papel
// morto não desfaz a baixa: quem saiu, saiu.
export const loadRetiredTickers = async () => new Set(
    (await MarketAsset.find({ isBlacklisted: true }).select('ticker').lean())
        .map((a) => a.ticker),
);

// TICKER QUE JÁ TEM DONO DE OUTRA CLASSE NÃO É SEMEADO NEM COTADO.
//
// `MarketAsset.ticker` é único: a sigla é um namespace global, e a
// classe é campo da linha, não parte da chave. Este seed usa
// `filter: { ticker }` + `$setOnInsert` — quando a sigla já pertence a
// outra classe, o upsert CASA com a linha alheia, não insere nada e
// segue em silêncio. Até 16/09/2026 o loop empurrava a moeda para a
// fila de cotação assim mesmo, e a gravação (também por `{ ticker }`)
// punha o preço da MOEDA na linha da AÇÃO: `STX` era Stacks aqui e
// Seagate no S&P 500, e a linha da Seagate ia a US$ 0,24 todo run até
// o `refreshQuotesBatch` seguinte devolvê-la a US$ 771,81. O único
// sintoma era o juiz de magnitude acusando 319888% — que parece erro
// de fonte e era, na verdade, duas identidades numa linha só.
//
// O catálogo em si está travado por `tests/ticker_namespace.spec.js`
// (ver `config/tickerNamespace.js`), mas a linha do banco pode ter
// vindo de onde nenhum catálogo alcança — holding de usuário, ticker
// herdado, renome. Por isso a régua aqui é o BANCO, e ela é
// fail-closed: na dúvida a moeda fica de fora, nomeada no log. Ficar
// de fora custa uma moeda ausente do ranking; entrar custa o preço
// errado num ativo que alguém tem em carteira.
const loadForeignOwnedCryptoTickers = async () => {
    const foreignOwned = new Map(
        (await MarketAsset.find({
            ticker: { $in: CRYPTO_ASSETS.map(c => c.ticker) },
            type: { $ne: 'CRYPTO' },
        }).select('ticker type name').lean()).map(d => [d.ticker, d]),
    );
    if (foreignOwned.size > 0) {
        logger.warn(
            `⚠️ [Sync] ${foreignOwned.size} moeda(s) do catálogo têm o ticker ocupado por outra classe — não semeadas nem cotadas: ` +
            [...foreignOwned.values()].map(d => `${d.ticker} (${d.type}: ${d.name})`).join(', '),
            { colisaoDeTicker: [...foreignOwned.keys()] },
        );
    }
    return foreignOwned;
};

const cryptoSeedOp = (cripto) => ({
    updateOne: {
        filter: { ticker: cripto.ticker },
        update: {
            $setOnInsert: {
                name: cripto.name,
                type: 'CRYPTO',
                currency: 'USD',
                sector: 'Criptomoeda',
                isIgnored: false,
                isBlacklisted: false
            }
        },
        upsert: true
    }
});

/**
 * Etapa 3: lista de exterior/cripto a cotar e seed do catálogo de cripto
 * (empurrado em `operations`). Devolve os tickers externos válidos.
 */
export const prepareExternalAssets = async (operations) => {
    // isActive filter: ativos delistados já desativados pela blacklist dinâmica
    // não devem ser re-cotados aqui (a reativação tem varredura própria). Sem
    // isto, tickers mortos (SGEN, ABC, MRO...) eram tentados todo sync.
    // isBlacklisted também: os dois campos não andam juntos sozinhos, e ler só
    // `isActive` deixava o aposentado-mas-ativo entrar no lote, ser cotado e
    // sair daqui com `isActive: true` regravado — a mesma ressurreição do
    // caminho de fundamentos, agora no exterior/cripto.
    const assetsForExternal = await MarketAsset.find({
        type: { $in: ['CRYPTO', 'STOCK_US'] },
        isActive: { $ne: false },
        isBlacklisted: { $ne: true }
    }).select('ticker type failCount lastFailDate marketCap liquidity');

    logger.info("ℹ️ [Sync] Verificando/Seeding default cryptocurrencies...");
    // O universo e o SÍMBOLO de cada moeda moram no mesmo lugar
    // (config/cryptoList.js). Eram duas listas inline — esta e uma cópia no
    // externalMarketService — que precisavam concordar e não tinham dono;
    // a cópia de lá montava o símbolo por concatenação e servia o token
    // errado nas siglas disputadas.
    const existingCryptos = new Set(assetsForExternal.filter(a => a.type === 'CRYPTO').map(a => a.ticker));
    const foreignOwned = await loadForeignOwnedCryptoTickers();

    for (const cripto of CRYPTO_ASSETS) {
        const ticker = cripto.ticker;
        if (foreignOwned.has(ticker)) continue;
        operations.push(cryptoSeedOp(cripto));
        if (!existingCryptos.has(ticker)) {
            assetsForExternal.push({ ticker, type: 'CRYPTO' });
        }
    }

    // EXTERIOR/CRIPTO SÃO COTADOS UMA VEZ SÓ, pelo `refreshQuotesBatch` da Etapa 3.
    //
    // Até 22/11/2026 este trecho cotava a mesma lista e gravava por conta
    // própria `lastPrice`, `isActive: true` e `failCount: 0` — sem nenhum dos
    // juízes do caminho oficial (eco, sessão velha, barra sem negócio). Três
    // estragos: (1) o `isActive: true` desfazia a desativação que a própria
    // blacklist dinâmica acabara de fazer, e o ticker morto voltava todo dia;
    // (2) preço ecoado era gravado como sucesso, renovando `updatedAt`; (3) a
    // `liquidity` saía como VOLUME EM AÇÕES, enquanto o `refreshQuotesBatch`
    // grava volume × preço para STOCK_US — o mesmo campo em duas unidades,
    // conforme quem escreveu por último. Agora o seed continua aqui e a lista
    // segue para a segunda passada, que é o único escritor de preço.
    return assetsForExternal
        .map(a => a.ticker)
        .filter(t => typeof t === 'string' && t.trim().length > 0);
};

// (Fase 3) Anexa a leitura mensal de fundamentos à série temporal (track record).
// Idempotente por mês; falha aqui não pode derrubar o sync.
//
// Perdido no run de 22/08/2026 11:30 por um flap de conexão de ~2min
// ("secureConnect timed out after 60397ms"): a série de fundamentos
// ficou sem a leitura daquele run, e 11s depois o banco já respondia.
// A função inteira é idempotente (lê a série, reescreve o mês), então
// re-tentar o conjunto é seguro.
const appendFundamentalSnapshots = async (snapshotRecords, timestamp) => {
    try {
        const snap = await withMongoRetry(
            () => appendSnapshots(snapshotRecords, timestamp),
            { label: 'snapshots de fundamentos' });
        if (snap.appended > 0) logger.info(`🗂️ [Sync] Snapshots de fundamentos atualizados: ${snap.appended}`);
    } catch (err) {
        logger.error(`❌ [Sync] Append de snapshots de fundamentos falhou: ${err.message}`);
    }
};

// Backfill de setores: corrige setores incorretos/ausentes em
// TODO o acervo (inclusive ativos fora do scraping). Idempotente.
const backfillAllSectors = async () => {
    try {
        const bf = await withMongoRetry(() => backfillSectors(), { label: 'backfill de setores' });
        if (bf.updated > 0) logger.info(`🩹 [Sync] Setores corrigidos no backfill: ${bf.updated}`);
    } catch (err) {
        logger.error(`❌ [Sync] Backfill de setores falhou: ${err.message}`);
    }
};

const usSubTypeOp = (a) => {
    const sub = classifyUsAsset({
        ticker: a.ticker, sector: a.sector, type: a.type,
        currency: a.currency, name: a.name,
    });
    if (!sub || sub === a.usSubType) return null;
    return { updateOne: { filter: { ticker: a.ticker }, update: { $set: { usSubType: sub } } } };
};

// Backfill de sub-tipo de Exterior (STOCK_US): STOCK | ETF | REIT | DOLLAR.
// Idempotente; só grava quando a classificação heurística muda. O sub-tipo
// alimenta os sub-filtros do Research e o viés por sub-meta do rebalance (PR3).
const backfillUsSubTypes = async () => {
    try {
        const usAssets = await withMongoRetry(
            () => MarketAsset.find({ type: 'STOCK_US' })
                .select('ticker sector name currency usSubType type').lean(),
            { label: 'ativos do Exterior' });
        const usOps = usAssets.map(usSubTypeOp).filter(Boolean);
        if (usOps.length > 0) {
            await withMongoRetry(() => MarketAsset.bulkWrite(usOps), { label: 'sub-tipos do Exterior' });
            logger.info(`🩹 [Sync] Sub-tipos de Exterior classificados: ${usOps.length}`);
        }
    } catch (err) {
        logger.error(`❌ [Sync] Backfill de usSubType (Exterior) falhou: ${err.message}`);
    }
};

/** Pós-gravação do acervo: série de fundamentos, setores e sub-tipo do Exterior. */
export const runPostWriteBackfills = async (snapshotRecords, timestamp) => {
    await appendFundamentalSnapshots(snapshotRecords, timestamp);
    await backfillAllSectors();
    await backfillUsSubTypes();
};

/** SALVA ESTATÍSTICAS DE QUALIDADE de um run saudável. */
export const saveHealthySyncStats = (typosFixed, assetsProcessed, fundamentals) => withMongoRetry(
    () => SystemConfig.findOneAndUpdate(
        macroKey(),
        {
            $set: {
                lastSyncStats: {
                    typosFixed,
                    assetsProcessed,
                    fundamentalsHealthy: true,
                    errorCode: null,
                    fundamentals,
                    timestamp: new Date()
                }
            }
        },
        { upsert: true }
    ),
    { label: 'estatísticas do sync' },
);

/** Cotações em lotes de 50, com pausa de 200 ms entre lotes; sem duplicatas. */
export const refreshQuotesInBatches = async (tickers) => {
    const uniqueTickers = [...new Set(tickers)];
    for (let i = 0; i < uniqueTickers.length; i += QUOTE_BATCH_SIZE) {
        const batch = uniqueTickers.slice(i, i + QUOTE_BATCH_SIZE);
        await marketDataService.refreshQuotesBatch(batch, true);
        await new Promise(r => setTimeout(r, 200));
    }
};

const isDueAfter23h = (last) => !last || Date.now() - new Date(last).getTime() > DAILY_GUARD_MS;

/**
 * Rotina diária com guarda de 23h: lê o carimbo `stampField` da macro, roda
 * `run` se venceu e regrava o carimbo. Falha é logada e não derruba o sync.
 */
export const runDailyStep = async ({ stampField, run, skipMessage, stepLabel }) => {
    try {
        const macroConfig = await SystemConfig.findOne(macroKey());
        if (!isDueAfter23h(macroConfig?.[stampField])) {
            logger.info(skipMessage);
            return;
        }
        await run();
        await SystemConfig.findOneAndUpdate(
            macroKey(),
            { $set: { [stampField]: new Date() } },
            { upsert: true }
        );
    } catch (err) {
        logger.error(`❌ [Sync] ${stepLabel} falhou: ${err.message}`);
    }
};
