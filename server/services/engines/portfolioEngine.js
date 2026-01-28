
export const portfolioEngine = {
    /**
     * Executa o Draft Competitivo para montar a carteira ideal.
     * Seleciona os melhores ativos para cada perfil de risco.
     */
    performCompetitiveDraft(allAssets) {
        const finalPortfolio = [];
        const usedTickers = new Set();

        const draft = (profile, scoreKey, count) => {
            // --- TRAVA DE SEGURANÇA SETORIAL (HARD CAP) ---
            // Atualizado: Limita cada setor a no MÁXIMO 20% das vagas disponíveis.
            // Ex: Em um Top 10, no máximo 2 ativos do mesmo setor.
            const MAX_PER_SECTOR_PROFILE = Math.ceil(count * 0.20); 
            const sectorCounts = {};
            
            // Filtra candidatos elegíveis (Score > 50) e ordena por maior nota
            let candidates = allAssets
                .filter(a => a.scores[scoreKey] > 50) 
                .sort((a, b) => b.scores[scoreKey] - a.scores[scoreKey]);

            let selectedCount = 0;
            
            for (const asset of candidates) {
                if (selectedCount >= count) break; // Já preencheu a quantidade necessária
                if (usedTickers.has(asset.ticker)) continue; // Evita duplicatas na lista final

                const sector = asset.sector || 'Outros';
                const currentSectorCount = sectorCounts[sector] || 0;

                // Verifica se o setor já estourou a cota de 20%
                if (currentSectorCount < MAX_PER_SECTOR_PROFILE) {
                    finalPortfolio.push({
                        ...asset,
                        riskProfile: profile,
                        score: asset.scores[profile],
                        action: asset.scores[profile] >= 65 ? 'BUY' : 'WAIT',
                        // A tese curta é gerada aqui baseada no perfil
                        thesis: `${profile}: Score ${asset.scores[profile]} - ${asset.bullThesis[0] || 'Fundamentos Sólidos'}`
                    });
                    
                    usedTickers.add(asset.ticker);
                    sectorCounts[sector] = currentSectorCount + 1;
                    selectedCount++;
                }
            }
        };

        // Distribuição para garantir diversidade no Draft
        draft('DEFENSIVE', 'DEFENSIVE', 30); 
        draft('MODERATE', 'MODERATE', 10);   
        draft('BOLD', 'BOLD', 10);           

        return finalPortfolio;
    },

    /**
     * Aplica penalidades adicionais se houver concentração excessiva global (Backup Safety)
     */
    applyConcentrationPenalty(portfolio) {
        const profiles = ['DEFENSIVE', 'MODERATE', 'BOLD'];
        
        profiles.forEach(profile => {
            const profileAssets = portfolio.filter(p => p.riskProfile === profile);
            
            const sectorCounts = {};
            
            profileAssets.forEach(asset => {
                const sector = asset.sector || 'Outros';
                sectorCounts[sector] = (sectorCounts[sector] || 0) + 1;
                
                // Se exceder 2 ativos do mesmo setor no mesmo perfil, penaliza score para forçar rebaixamento na ordenação visual
                if (sectorCounts[sector] > 2) {
                    const excess = sectorCounts[sector] - 2;
                    const penalty = excess * 10; 
                    asset.score = Math.max(20, asset.score - penalty);
                }
            });
        });
        
        return portfolio.sort((a, b) => b.score - a.score);
    }
};
