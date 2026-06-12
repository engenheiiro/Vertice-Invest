
import logger from '../config/logger.js';
import MarketAsset from '../models/MarketAsset.js';
import { resolveSector, deriveFiiSubType, isGenericSector } from '../utils/sectorResolver.js';

/**
 * Corrige o campo `sector` (e `fiiSubType` de FIIs) de todos os ativos já
 * persistidos, aplicando a mesma resolução resiliente do sync:
 *   override exato → override por base (ações) → setor atual (se válido) → default.
 *
 * Trata setores INCORRETOS (via overrides) e AUSENTES/genéricos (via base/scraping).
 * Idempotente: só grava quando o setor muda. Assume conexão Mongoose já aberta.
 *
 * @returns {Promise<{ scanned:number, updated:number, changes:Array }>}
 */
export async function backfillSectors({ dryRun = false } = {}) {
    const assets = await MarketAsset.find({}).select('ticker type sector fiiSubType').lean();

    const ops = [];
    const changes = [];

    for (const asset of assets) {
        const current = asset.sector || '';
        // Passa o setor atual como "scrapedSector": o resolver mantém valores
        // válidos e só substitui quando há override ou quando está genérico.
        const resolved = resolveSector({
            ticker: asset.ticker,
            type: asset.type,
            scrapedSector: current,
        });

        const set = {};
        if (resolved !== current) set.sector = resolved;

        if (asset.type === 'FII') {
            const subType = deriveFiiSubType(resolved);
            if (subType && subType !== asset.fiiSubType) set.fiiSubType = subType;
        }

        if (Object.keys(set).length > 0) {
            changes.push({
                ticker: asset.ticker,
                type: asset.type,
                from: current || '(vazio)',
                to: resolved,
                wasGeneric: isGenericSector(current),
            });
            ops.push({ updateOne: { filter: { _id: asset._id }, update: { $set: set } } });
        }
    }

    if (!dryRun && ops.length > 0) {
        await MarketAsset.bulkWrite(ops);
    }

    logger.info(
        `🩹 [BackfillSetores] ${assets.length} ativos analisados, ${ops.length} ${dryRun ? 'seriam atualizados (dryRun)' : 'atualizados'}.`
    );

    return { scanned: assets.length, updated: ops.length, changes };
}
