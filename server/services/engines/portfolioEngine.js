
import { getConcentrationKey } from '../../config/sectorTaxonomy.js';
import { getFiiManager } from '../../config/fiiManagerMap.js';
// (M9) Threshold global centralizado em financialConstants.
import { BUY_THRESHOLD } from '../../config/financialConstants.js';
import { getTunablesSync } from '../configService.js'; // (I13) cap de cripto editável pelo admin

// Composite estrutural = média de quality, valuation e risk (0–100 cada).
// Usado como critério de desempate quando dois ativos têm o mesmo score de perfil.
// Evita que a ordem de inserção no MongoDB determine quem entra no top ranking.
const structuralComposite = (asset) => {
    const s = asset.metrics?.structural;
    if (!s) return 0;
    return (s.quality + s.valuation + s.risk) / 3;
};

const sortByScoreThenComposite = (scoreKey) => (a, b) => {
    const scoreDiff = b.scores[scoreKey] - a.scores[scoreKey];
    if (scoreDiff !== 0) return scoreDiff;
    return structuralComposite(b) - structuralComposite(a);
};

export const portfolioEngine = {
    // options.trace (opcional): array coletor. Quando presente, cada candidato
    // AVALIADO no draft registra { profile, tier, ticker, score, composite, key,
    // outcome } — diagnóstico para entender por que um ativo entrou/foi barrado
    // pelo cap de concentração. Sem custo em produção (só coleta se passado).
    performCompetitiveDraft(allAssets, options = {}) {
        const finalPortfolio = [];
        const usedTickers = new Set();
        const trace = options.trace || null;
        // (I13) Cap de cripto editável em runtime (fallback p/ default do M9).
        const MAX_CRYPTO_PER_PROFILE = getTunablesSync().maxCryptoPerProfile;

        const runDraftCycle = (profile, scoreKey, count) => {
            const TARGET_COUNT = count;
            const profileAssets = [];
            const sectorCounts = {};
            let cryptoCount = 0;

            // Cap global por BALDE DE CONCENTRAÇÃO por perfil. Para ações/ETFs o balde
            // é o macro-setor (risco sistêmico correlacionado); para FIIs é o SEGMENTO
            // (shopping ≠ logística ≠ papel ≠ fiagro), permitindo diversificar uma
            // carteira 100% FII em vez de colapsá-la em ~3 macro-setores.
            const MAX_PER_SECTOR_STRICT = profile === 'DEFENSIVE' ? 3 : 2;
            const MAX_PER_SECTOR_FLEX = 3;

            // Tenta encaixar um candidato respeitando o cap do balde corrente.
            const tryAdd = (asset, tier, sectorCap, thesis) => {
                const key = getConcentrationKey(asset);
                const isCrypto = asset.type === 'CRYPTO';
                const currentCount = sectorCounts[key] || 0;
                const canAdd = isCrypto
                    ? (cryptoCount < MAX_CRYPTO_PER_PROFILE)
                    : (currentCount < sectorCap);

                if (canAdd) {
                    profileAssets.push({
                        ...asset,
                        riskProfile: profile,
                        score: asset.scores[scoreKey],
                        action: asset.scores[scoreKey] >= BUY_THRESHOLD ? 'BUY' : 'WAIT',
                        tier,
                        thesis,
                    });
                    usedTickers.add(asset.ticker);
                    if (isCrypto) cryptoCount++;
                    else sectorCounts[key] = currentCount + 1;
                }

                if (trace) {
                    trace.push({
                        profile, tier, ticker: asset.ticker,
                        score: asset.scores[scoreKey],
                        composite: Number(structuralComposite(asset).toFixed(2)),
                        key,
                        outcome: canAdd ? 'SELECTED' : (isCrypto ? 'BLOCKED_CRYPTO_CAP' : 'BLOCKED_SECTOR_CAP'),
                    });
                }
                return canAdd;
            };

            const fillTier = (minScore, op, sectorCap, tier, thesisFn) => {
                if (profileAssets.length >= TARGET_COUNT) return;
                const candidates = allAssets
                    .filter(a => !usedTickers.has(a.ticker) && (op === 'gt' ? a.scores[scoreKey] > minScore : a.scores[scoreKey] >= minScore))
                    .sort(sortByScoreThenComposite(scoreKey));
                for (const asset of candidates) {
                    if (profileAssets.length >= TARGET_COUNT) break;
                    tryAdd(asset, tier, sectorCap, thesisFn(asset));
                }
            };

            // GOLD (Elite, score ≥ 55) → SILVER (Flex, ≥ 40) → BRONZE (Backfill, > 30)
            fillTier(55, 'gte', MAX_PER_SECTOR_STRICT, 'GOLD', (a) => `${profile}: Top Pick (Score ${a.scores[scoreKey]})`);
            fillTier(40, 'gte', MAX_PER_SECTOR_FLEX, 'SILVER', () => `${profile}: Oportunidade Secundária`);
            fillTier(30, 'gt', MAX_PER_SECTOR_FLEX, 'BRONZE', () => `Inclusão Tática: Diversificação para atingir alocação.`);

            finalPortfolio.push(...profileAssets);
        };

        runDraftCycle('DEFENSIVE', 'DEFENSIVE', 10);
        runDraftCycle('MODERATE', 'MODERATE', 10);
        runDraftCycle('BOLD', 'BOLD', 10);

        return finalPortfolio;
    },

    applyConcentrationPenalty(portfolio) {
        if (!portfolio || portfolio.length === 0) return portfolio;

        // Penalidade aplicada por perfil de risco para evitar que a escolha do DEFENSIVO
        // contamine os contadores setoriais do MODERADO e ARROJADO.
        const byProfile = {};
        portfolio.forEach(asset => {
            const p = asset.riskProfile || 'UNKNOWN';
            if (!byProfile[p]) byProfile[p] = [];
            byProfile[p].push(asset);
        });

        const applyToGroup = (assets) => {
            const sectorCounts = {};
            const managerCounts = {};
            return assets.map(asset => {
                // Mesmo balde de concentração do draft: FII por segmento, ação por macro-setor.
                const macroSector = getConcentrationKey(asset);
                const isFII = asset.type === 'FII';
                const managerProxy = isFII ? getFiiManager(asset.ticker) : 'N/A';

                let penalty = 0;

                // 1. Penalidade por Concentração Setorial
                const sCount = sectorCounts[macroSector] || 0;
                if (sCount >= 3) penalty += 15; // A partir do 4º ativo no mesmo macro-setor
                else if (sCount >= 2) penalty += 5;  // A partir do 3º ativo
                sectorCounts[macroSector] = sCount + 1;

                // 2. Penalidade por Concentração de Gestora (FIIs)
                if (isFII) {
                    const mCount = managerCounts[managerProxy] || 0;
                    if (mCount >= 2) penalty += 20; // A partir do 3º FII da mesma gestora
                    managerCounts[managerProxy] = mCount + 1;
                }

                if (penalty > 0) {
                    const newScore = Math.max(10, asset.score - penalty);
                    return {
                        ...asset,
                        score: newScore,
                        action: newScore >= BUY_THRESHOLD ? 'BUY' : 'WAIT',
                        thesis: `${asset.thesis} | [Penalidade Concentração: -${penalty}]`
                    };
                }

                return asset;
            });
        };

        // Reconstrói o portfólio na ordem original dos perfis
        const result = [];
        for (const profile of ['DEFENSIVE', 'MODERATE', 'BOLD', 'UNKNOWN']) {
            if (byProfile[profile]) result.push(...applyToGroup(byProfile[profile]));
        }
        return result;
    }
};
