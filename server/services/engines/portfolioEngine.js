
import { getMacroSector } from '../../config/sectorTaxonomy.js';

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
                .sort((a, b) => b.scores[scoreKey] - a.scores[scoreKey]);

            const sectorCounts = {};
            const MAX_PER_SECTOR_STRICT = profile === 'DEFENSIVE' ? 4 : 2; 

            for (const asset of candidates) {
                if (profileAssets.length >= TARGET_COUNT) break;
                
                const sector = getMacroSector(asset.sector);
                const isCrypto = asset.type === 'CRYPTO';
                const currentCount = sectorCounts[sector] || 0;
                
                if (isCrypto || currentCount < MAX_PER_SECTOR_STRICT) {
                    profileAssets.push({
                        ...asset,
                        riskProfile: profile,
                        score: asset.scores[scoreKey],
                        action: asset.scores[scoreKey] >= 65 ? 'BUY' : 'WAIT',
                        tier: 'GOLD', // Novo
                        thesis: `${profile}: Top Pick (Score ${asset.scores[scoreKey]})`
                    });
                    usedTickers.add(asset.ticker);
                    sectorCounts[sector] = currentCount + 1;
                }
            }

            // --- TIER SILVER (Flex) ---
            if (profileAssets.length < TARGET_COUNT) {
                candidates = allAssets
                    .filter(a => !usedTickers.has(a.ticker) && a.scores[scoreKey] >= 40)
                    .sort((a, b) => b.scores[scoreKey] - a.scores[scoreKey]);

                const MAX_PER_SECTOR_FLEX = 5; 

                for (const asset of candidates) {
                    if (profileAssets.length >= TARGET_COUNT) break;
                    
                    const sector = getMacroSector(asset.sector);
                    const isCrypto = asset.type === 'CRYPTO';
                    const currentCount = sectorCounts[sector] || 0;
                    
                    if (isCrypto || currentCount < MAX_PER_SECTOR_FLEX) {
                        profileAssets.push({
                            ...asset,
                            riskProfile: profile,
                            score: asset.scores[scoreKey],
                            action: 'WAIT',
                            tier: 'SILVER', // Novo
                            thesis: `${profile}: Oportunidade Secundária`
                        });
                        usedTickers.add(asset.ticker);
                        sectorCounts[sector] = currentCount + 1;
                    }
                }
            }

            // --- TIER BRONZE (Backfill) ---
            if (profileAssets.length < TARGET_COUNT) {
                candidates = allAssets
                    .filter(a => !usedTickers.has(a.ticker) && a.scores['MODERATE'] > 30) 
                    .sort((a, b) => b.scores['MODERATE'] - a.scores['MODERATE']);

                for (const asset of candidates) {
                    if (profileAssets.length >= TARGET_COUNT) break;
                    
                    profileAssets.push({
                        ...asset,
                        riskProfile: profile, 
                        score: asset.scores['MODERATE'], 
                        action: 'WAIT',
                        tier: 'BRONZE', // Novo
                        thesis: `Inclusão Tática: Diversificação para atingir alocação.`
                    });
                    usedTickers.add(asset.ticker);
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

        // Agrupadores para detectar concentração
        const sectorCounts = {};
        const managerCounts = {}; // Para FIIs (extraído do nome ou ticker se possível, ou apenas ticker base)

        return portfolio.map(asset => {
            const macroSector = getMacroSector(asset.sector);
            const isFII = asset.type === 'FII';
            
            // Lógica de Gestora para FIIs (Simplificada: Primeiras 2 letras do ticker como proxy se não houver metadado)
            // Idealmente teríamos o campo 'manager' no banco.
            const managerProxy = isFII ? asset.ticker.substring(0, 2) : 'N/A';

            let penalty = 0;

            // 1. Penalidade por Concentração Setorial
            const sCount = sectorCounts[macroSector] || 0;
            if (sCount >= 3) penalty += 15; // A partir do 4º ativo no mesmo macro-setor
            else if (sCount >= 2) penalty += 5;  // A partir do 3º ativo
            sectorCounts[macroSector] = sCount + 1;

            // 2. Penalidade por Concentração de Gestora (FIIs)
            if (isFII) {
                const mCount = managerCounts[managerProxy] || 0;
                if (mCount >= 2) penalty += 20; // A partir do 3º FII da mesma "família" (proxy)
                managerCounts[managerProxy] = mCount + 1;
            }

            if (penalty > 0) {
                return {
                    ...asset,
                    score: Math.max(10, asset.score - penalty),
                    thesis: `${asset.thesis} | [Penalidade Concentração: -${penalty}]`
                };
            }

            return asset;
        });
    }
};
