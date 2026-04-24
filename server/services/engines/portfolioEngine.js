
import { getMacroSector } from '../../config/sectorTaxonomy.js';
import { getFiiManager } from '../../config/fiiManagerMap.js';

// Threshold Global para Recomendação de Compra
const BUY_THRESHOLD = 70;

// Máximo de ativos CRYPTO por perfil: sem este limite, o bypass de setor de crypto
// permite que todos os slots BOLD sejam preenchidos por cripto.
const MAX_CRYPTO_PER_PROFILE = 3;

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
    performCompetitiveDraft(allAssets) {
        const finalPortfolio = [];
        const usedTickers = new Set();

        const runDraftCycle = (profile, scoreKey, count) => {
            const TARGET_COUNT = count;
            const profileAssets = [];

            // --- TIER GOLD (Elite) ---
            let candidates = allAssets
                .filter(a => !usedTickers.has(a.ticker) && a.scores[scoreKey] >= 55)
                .sort(sortByScoreThenComposite(scoreKey));

            const sectorCounts = {};
            // Cap global: máximo 3 ativos por macro-setor por perfil (30% de 10 slots).
            // DEFENSIVO usa o mesmo limite que os demais — sem exceção por perfil.
            const MAX_PER_SECTOR_STRICT = profile === 'DEFENSIVE' ? 3 : 2;
            const MAX_PER_SECTOR_FLEX = 3;
            let cryptoCount = 0;

            for (const asset of candidates) {
                if (profileAssets.length >= TARGET_COUNT) break;

                const sector = getMacroSector(asset.sector);
                const isCrypto = asset.type === 'CRYPTO';
                const currentCount = sectorCounts[sector] || 0;

                const canAdd = isCrypto ? (cryptoCount < MAX_CRYPTO_PER_PROFILE) : (currentCount < MAX_PER_SECTOR_STRICT);
                if (canAdd) {
                    profileAssets.push({
                        ...asset,
                        riskProfile: profile,
                        score: asset.scores[scoreKey],
                        action: asset.scores[scoreKey] >= BUY_THRESHOLD ? 'BUY' : 'WAIT',
                        tier: 'GOLD',
                        thesis: `${profile}: Top Pick (Score ${asset.scores[scoreKey]})`
                    });
                    usedTickers.add(asset.ticker);
                    if (isCrypto) cryptoCount++;
                    else sectorCounts[sector] = currentCount + 1;
                }
            }

            // --- TIER SILVER (Flex) ---
            if (profileAssets.length < TARGET_COUNT) {
                candidates = allAssets
                    .filter(a => !usedTickers.has(a.ticker) && a.scores[scoreKey] >= 40)
                    .sort(sortByScoreThenComposite(scoreKey));

                for (const asset of candidates) {
                    if (profileAssets.length >= TARGET_COUNT) break;

                    const sector = getMacroSector(asset.sector);
                    const isCrypto = asset.type === 'CRYPTO';
                    const currentCount = sectorCounts[sector] || 0;

                    const canAdd = isCrypto ? (cryptoCount < MAX_CRYPTO_PER_PROFILE) : (currentCount < MAX_PER_SECTOR_FLEX);
                    if (canAdd) {
                        profileAssets.push({
                            ...asset,
                            riskProfile: profile,
                            score: asset.scores[scoreKey],
                            action: asset.scores[scoreKey] >= BUY_THRESHOLD ? 'BUY' : 'WAIT',
                            tier: 'SILVER',
                            thesis: `${profile}: Oportunidade Secundária`
                        });
                        usedTickers.add(asset.ticker);
                        if (isCrypto) cryptoCount++;
                        else sectorCounts[sector] = currentCount + 1;
                    }
                }
            }

            // --- TIER BRONZE (Backfill) ---
            if (profileAssets.length < TARGET_COUNT) {
                candidates = allAssets
                    .filter(a => !usedTickers.has(a.ticker) && a.scores[scoreKey] > 30)
                    .sort(sortByScoreThenComposite(scoreKey));

                for (const asset of candidates) {
                    if (profileAssets.length >= TARGET_COUNT) break;

                    const sector = getMacroSector(asset.sector);
                    const isCrypto = asset.type === 'CRYPTO';
                    const currentCount = sectorCounts[sector] || 0;

                    const canAdd = isCrypto ? (cryptoCount < MAX_CRYPTO_PER_PROFILE) : (currentCount < MAX_PER_SECTOR_FLEX);
                    if (canAdd) {
                        profileAssets.push({
                            ...asset,
                            riskProfile: profile,
                            score: asset.scores[scoreKey],
                            action: asset.scores[scoreKey] >= BUY_THRESHOLD ? 'BUY' : 'WAIT',
                            tier: 'BRONZE',
                            thesis: `Inclusão Tática: Diversificação para atingir alocação.`
                        });
                        usedTickers.add(asset.ticker);
                        if (isCrypto) cryptoCount++;
                        else sectorCounts[sector] = currentCount + 1;
                    }
                }
            }

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
                const macroSector = getMacroSector(asset.sector);
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
