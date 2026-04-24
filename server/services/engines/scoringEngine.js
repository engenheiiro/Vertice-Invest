
const safeVal = (val) => {
    if (val === Infinity || val === -Infinity || isNaN(val) || val === null || val === undefined) return 0;
    return Number(val.toFixed(2));
};

// Helper: resolve isPapel a partir de fiiSubType (explícito) ou setor (fallback por substring)
const resolvePapel = (fiiSubType, sector) => {
    if (fiiSubType) return fiiSubType === 'PAPEL';
    return sector?.toLowerCase().includes('papel') || false;
};

const calculateConfidenceScore = (m) => {
    let confidence = 100;
    const audit = [];

    // Usa _missing para distinguir dado ausente de dado genuinamente ruim
    if (m._missing?.revenueGrowth) {
        confidence -= 25;
        audit.push({ factor: 'Dados de Crescimento Ausentes', points: -25, type: 'penalty', category: 'Confiança' });
    }
    if (m._missing?.roe || m._missing?.netMargin) {
        confidence -= 15;
        audit.push({ factor: 'Dados de Rentabilidade Ausentes', points: -15, type: 'penalty', category: 'Confiança' });
    }
    if (m.avgLiquidity < 1000000) {
        confidence -= 30;
        audit.push({ factor: 'Liquidez Abaixo do Ideal (<1M/dia)', points: -30, type: 'penalty', category: 'Confiança' });
    }

    // Penalidade de staleness: dados desatualizados reduzem a confiança da análise
    if (m._staleDays !== null && m._staleDays !== undefined) {
        if (m._staleDays > 180) {
            confidence -= 30;
            audit.push({ factor: `Dados Fundamentais Desatualizados (${m._staleDays} dias)`, points: -30, type: 'penalty', category: 'Confiança' });
        } else if (m._staleDays > 90) {
            confidence -= 15;
            audit.push({ factor: `Dados Fundamentais Desatualizados (${m._staleDays} dias)`, points: -15, type: 'penalty', category: 'Confiança' });
        }
    } else {
        // Data de atualização nunca registrada — penalidade leve
        confidence -= 5;
        audit.push({ factor: 'Data de Atualização dos Fundamentais Desconhecida', points: -5, type: 'penalty', category: 'Confiança' });
    }

    return { confidence, audit };
};

// --- NOVO: IDENTIFICADOR DE DIVIDEND ARISTOCRAT ---
const isDividendAristocrat = (m, type) => {
    if (type !== 'STOCK') return false;
    // Critérios Proxy: Crescimento de Receita + ROE Alto + Yield Decente + Payout Saudável
    return (m.revenueGrowth > 5 && m.roe > 12 && m.dy > 4.0 && m.netMargin > 8 && m.payout > 20 && m.payout < 90);
};

const isEligibleForDefensive = (asset, context) => {
    const m = asset.metrics;
    if (m.avgLiquidity < 200000) return false;
    if (asset.type === 'STOCK') {
        if (m.marketCap < 1000000000) return false;
        // Beta muito alto (≥1.5) indica ativo pró-cíclico incompatível com perfil defensivo.
        // O scoring já penaliza -15 pts para beta ≥1.5, mas o gate evita que ativos com
        // muitos bônus de DY/ROE compensem essa fraqueza estrutural e entrem no DEFENSIVE.
        if (m.beta >= 1.5) return false;
        const safeSectorsKeywords = ['Banco', 'Segur', 'Elétric', 'Eletric', 'Saneamento', 'Água', 'Telecom', 'Energia', 'Transmissão', 'Financeiro', 'Alimentos', 'Saúde', 'Gás', 'Holding', 'Bebidas'];
        const sector = asset.sector || '';
        const isSafeSector = safeSectorsKeywords.some(keyword => sector.includes(keyword));
        if (!isSafeSector) {
            if (m.dy < 6.0 || m.pl > 10) return false;
        }
        // Só aplica rejeição se o dado estiver presente (não ausente) — evita punir por falta de coleta
        if (!m._missing?.roe && m.roe < 5) return false;
        if (!m._missing?.netMargin && m.netMargin < 3) return false;
        // Payout insustentável (>200%) é incompatível com perfil defensivo — dividendo vem do capital.
        if (!m._missing?.payout && m.payout > 200) return false;
        const isFinancial = sector.includes('Banco') || sector.includes('Segur') || sector.includes('Financeiro');
        if (m.debtToEquity > 4.0 && !isFinancial) return false;
    } else if (asset.type === 'FII') {
        if (m.marketCap < 500000000) return false; 
        if (m.dy > 18.0) return false; 
        if (m.vacancy > 12) return false; // Reduzido de 15 para 12 para ser mais defensivo
        if (!asset.sector.includes('Papel') && m.qtdImoveis < 2) return false; // Mono-ativos são vetados do perfil Defensivo
        if (m.avgLiquidity < 1000000) return false; 
    } else if (asset.type === 'STOCK_US') {
        // US stocks: exige market cap mínimo de $10B USD e setor defensivo (Consumer Staples, Utilities, Healthcare, Financials)
        if (m.marketCap < 10_000_000_000) return false;
        if (m.beta >= 1.8) return false;
        if (!m._missing?.roe && m.roe < 5) return false;
        const usDefensiveSectors = ['Consumer Staples', 'Utilities', 'Healthcare', 'Financials'];
        const sector = asset.sector || '';
        const isSafeUSSector = usDefensiveSectors.some(s => sector.includes(s));
        if (!isSafeUSSector) {
            // Fora dos setores defensivos: exige DY razoável ou P/E moderado
            if (m.dy < 1.5 && (m.pl === 0 || m.pl > 30)) return false;
        }
    } else if (asset.type === 'CRYPTO') {
        // Para ser defensivo em crypto, tem que ser gigante e muito líquido (Buy & Hold)
        if (!['BTC', 'ETH'].includes(asset.ticker) && m.marketCap < 50000000000) return false;
        if (m.avgLiquidity < 500000000) return false;
    }
    return true;
};

const calculateIntrinsicValue = (m, type, price, context) => {
    const { MACRO } = context;
    let fairPrice = price;
    let method = "Mercado";
    let grahamPrice = 0;
    let bazinPrice = 0;
    let pegRatio = 0; 

    if (type === 'STOCK' || type === 'STOCK_US') {
        if (m.pl > 0 && m.pl < 80 && m.pvp > 0) {
            const lpa = price / m.pl;
            const vpa = price / m.pvp;
            grahamPrice = Math.sqrt(22.5 * lpa * vpa);
        }
        if (m.dy > 0) {
            const adjustedDy = Math.min(m.dy, 14) / 100; 
            const dividendPerShare = price * adjustedDy;
            bazinPrice = dividendPerShare / 0.06; 
        }
        if (m.pl > 0 && m.revenueGrowth > 0) {
            pegRatio = m.pl / m.revenueGrowth;
        }
        if (grahamPrice > 0 && bazinPrice > 0) {
            fairPrice = (grahamPrice * 0.4) + (bazinPrice * 0.6); 
            method = "Híbrido (Bazin+Graham)";
        } else if (grahamPrice > 0) {
            fairPrice = grahamPrice;
            method = "Graham";
        } else if (bazinPrice > 0) {
            fairPrice = bazinPrice;
            method = "Bazin";
        }
        if (fairPrice > price * 2.5) fairPrice = price * 2.5; 
    } else if (type === 'FII') {
        const vp = m.vpCota || price;
        // Usa fiiSubType (explícito) ou sector como fallback — corrige bug anterior onde
        // m.sector não existia em metrics e isPapel nunca era detectado
        const isPapelFII = resolvePapel(m.fiiSubType, m.sector);
        if (isPapelFII) {
            fairPrice = vp;
            method = "VP (Papel)";
        } else {
            const ntnb = MACRO.NTNB_LONG || 6.0;
            const yieldPremium = Math.max(0, m.dy - ntnb);
            fairPrice = vp * (1 + (yieldPremium / 100));
            method = "VP Ajustado";
        }
    } else if (type === 'CRYPTO') {
        fairPrice = price;
        method = "Mercado";
    }
    return { fairPrice: safeVal(fairPrice), method, grahamPrice: safeVal(grahamPrice), bazinPrice: safeVal(bazinPrice), pegRatio: safeVal(pegRatio) };
};

const calculateProfileScores = (asset, valuationData, context) => {
    const { MACRO } = context;
    const m = asset.metrics;
    const type = asset.type;
    const { fairPrice, pegRatio } = valuationData;
    
    const upside = asset.price > 0 ? (fairPrice / asset.price) - 1 : 0;
    const NTNB = MACRO.NTNB_LONG || 6.30;
    
    let defScore = 0, modScore = 0, boldScore = 0;
    const audit = { DEFENSIVE: [], MODERATE: [], BOLD: [], CONFIDENCE: [] };
    const { confidence, audit: confAudit } = calculateConfidenceScore(m);
    audit.CONFIDENCE = confAudit;

    if (type === 'STOCK' || type === 'STOCK_US') {
        // Setor financeiro pode apresentar crescimento de receita artificialmente alto por
        // base-year ou reestruturações. Aplica teto de 30% para evitar PEG/Hyper Growth indevidos.
        const isFinancialSector = asset.sector?.includes('Banco') || asset.sector?.includes('Segur') || asset.sector?.includes('Financeiro') || asset.sector?.includes('Holding') || asset.sector?.includes('Financials') || asset.sector?.includes('Financial');
        const effectiveRevenueGrowth = (isFinancialSector && m.revenueGrowth > 30) ? 0 : m.revenueGrowth;

        // ── DEFENSIVO ────────────────────────────────────────────────────────────
        // Base reduzida 60→40: bônus progressivos diferenciam ações medianas de elite.
        // Mesmo raciocínio aplicado aos FIIs na rodada anterior.
        const isDefensiveEligible = isEligibleForDefensive(asset, context);
        if (isDefensiveEligible) {
            defScore = 40;
            audit.DEFENSIVE.push({ factor: 'Score Base (Setor Defensivo)', points: 40, type: 'base' });

            // Market cap tiers
            if (m.marketCap > 10000000000) { defScore += 10; audit.DEFENSIVE.push({ factor: 'Large Cap (>10B)', points: 10, type: 'bonus' }); }
            else if (m.marketCap > 2000000000) { defScore += 4; audit.DEFENSIVE.push({ factor: 'Mid Cap (>2B)', points: 4, type: 'bonus' }); }

            // DY tiers: escala proporcional ao prêmio real entregue
            if (m.dy >= 10.0) { defScore += 22; audit.DEFENSIVE.push({ factor: 'Dividend Yield Excepcional (≥10%)', points: 22, type: 'bonus' }); }
            else if (m.dy >= 8.0) { defScore += 16; audit.DEFENSIVE.push({ factor: 'Dividend Yield Alto (≥8%)', points: 16, type: 'bonus' }); }
            else if (m.dy >= 6.0) { defScore += 10; audit.DEFENSIVE.push({ factor: 'Dividend Yield > 6%', points: 10, type: 'bonus' }); }
            else if (m.dy >= 4.0) { defScore += 5; audit.DEFENSIVE.push({ factor: 'Dividend Yield Moderado (≥4%)', points: 5, type: 'bonus' }); }

            // ROE tiers
            if (m.roe >= 20) { defScore += 15; audit.DEFENSIVE.push({ factor: 'ROE Excelente (≥20%)', points: 15, type: 'bonus' }); }
            else if (m.roe >= 15) { defScore += 10; audit.DEFENSIVE.push({ factor: 'ROE Robusto (≥15%)', points: 10, type: 'bonus' }); }
            else if (m.roe >= 12) { defScore += 5; audit.DEFENSIVE.push({ factor: 'ROE Saudável (≥12%)', points: 5, type: 'bonus' }); }

            // Upside tiers
            if (upside >= 0.30) { defScore += 15; audit.DEFENSIVE.push({ factor: 'Upside Forte (>30%)', points: 15, type: 'bonus' }); }
            else if (upside >= 0.20) { defScore += 10; audit.DEFENSIVE.push({ factor: 'Upside Moderado (>20%)', points: 10, type: 'bonus' }); }
            else if (upside >= 0.15) { defScore += 5; audit.DEFENSIVE.push({ factor: 'Upside Positivo (>15%)', points: 5, type: 'bonus' }); }
            else if (upside >= 0.10) { defScore += 3; audit.DEFENSIVE.push({ factor: 'Upside Leve (>10%)', points: 3, type: 'bonus' }); }

            // P/VP penalties: novo tier intermediário
            if (m.pvp > 3.0) { defScore -= 10; audit.DEFENSIVE.push({ factor: 'P/VP Muito Esticado (>3.0)', points: -10, type: 'penalty' }); }
            else if (m.pvp > 2.0) { defScore -= 5; audit.DEFENSIVE.push({ factor: 'P/VP Elevado (>2.0)', points: -5, type: 'penalty' }); }

            // Beta tiers: bônus para ultra-defensivos, penalidade mais severa para voláteis
            if (m.beta < 0.70) { defScore += 5; audit.DEFENSIVE.push({ factor: 'Beta Defensivo (<0.7)', points: 5, type: 'bonus' }); }
            else if (m.beta >= 1.5) { defScore -= 15; audit.DEFENSIVE.push({ factor: 'Beta Muito Alto (≥1.5)', points: -15, type: 'penalty' }); }
            else if (m.beta > 1.2) { defScore -= 8; audit.DEFENSIVE.push({ factor: 'Beta Alto (>1.2)', points: -8, type: 'penalty' }); }

            // Volatilidade anual: ativo defensivo não deve oscilar 30%+ ao ano
            const stockVol = m.volatility || 20;
            if (stockVol > 40) { defScore -= 20; audit.DEFENSIVE.push({ factor: 'Volatilidade Muito Alta (>40%)', points: -20, type: 'penalty' }); }
            else if (stockVol > 30) { defScore -= 10; audit.DEFENSIVE.push({ factor: 'Volatilidade Elevada (>30%)', points: -10, type: 'penalty' }); }

            // Payout acima de 100%: DY inflado por distribuição além do lucro — risco real de corte
            if (!m._missing?.payout && m.payout > 150) { defScore -= 30; audit.DEFENSIVE.push({ factor: `Payout Insustentável (${m.payout.toFixed(1)}%)`, points: -30, type: 'penalty' }); }
            else if (!m._missing?.payout && m.payout > 100) { defScore -= 20; audit.DEFENSIVE.push({ factor: `Payout Acima do Lucro (${m.payout.toFixed(1)}%)`, points: -20, type: 'penalty' }); }
            else if (!m._missing?.payout && m.payout >= 30 && m.payout <= 85) { defScore += 5; audit.DEFENSIVE.push({ factor: `Payout Saudável (${m.payout.toFixed(1)}%)`, points: 5, type: 'bonus' }); }

            // Alavancagem: empresa com dívida crítica não é defensiva, mesmo com bons dividendos.
            // Reutiliza o mesmo cálculo derivado usado no structural Risk score.
            const isFinancialSectorForLev = asset.sector?.includes('Banco') || asset.sector?.includes('Segur') || asset.sector?.includes('Financeiro') || asset.sector?.includes('Financials') || asset.sector?.includes('Financial');
            if (!isFinancialSectorForLev) {
                const ev = (m.marketCap || 0) + (m.netDebt || 0);
                if (m.evEbitda > 0 && ev > 0) {
                    const ebitda = ev / m.evEbitda;
                    const dlEbitda = m.netDebt / ebitda;
                    if (dlEbitda > 3.5) {
                        defScore -= 15;
                        audit.DEFENSIVE.push({ factor: `Alavancagem Crítica (DL/EBITDA: ${dlEbitda.toFixed(1)}x)`, points: -15, type: 'penalty' });
                    } else if (dlEbitda > 2.5) {
                        defScore -= 8;
                        audit.DEFENSIVE.push({ factor: `Alavancagem Elevada (DL/EBITDA: ${dlEbitda.toFixed(1)}x)`, points: -8, type: 'penalty' });
                    }
                }
            }
        } else {
            defScore = 30;
            audit.DEFENSIVE.push({ factor: 'Ineligível para Carteira Defensiva', points: 30, type: 'base' });
        }

        // ── MODERADO ──────────────────────────────────────────────────────────────
        // Base reduzida 60→40. Bônus progressivos em crescimento, ROE e upside.
        if (m.marketCap > 2000000000) {
            modScore = 40;
            audit.MODERATE.push({ factor: 'Score Base (Mid/Large Cap)', points: 40, type: 'base' });

            // Revenue growth tiers
            if (effectiveRevenueGrowth > 30) { modScore += 22; audit.MODERATE.push({ factor: 'Crescimento Receita Excepcional (>30%)', points: 22, type: 'bonus' }); }
            else if (effectiveRevenueGrowth > 20) { modScore += 16; audit.MODERATE.push({ factor: 'Crescimento Receita Alto (>20%)', points: 16, type: 'bonus' }); }
            else if (effectiveRevenueGrowth > 10) { modScore += 10; audit.MODERATE.push({ factor: 'Crescimento Receita > 10%', points: 10, type: 'bonus' }); }
            else if (effectiveRevenueGrowth > 5) { modScore += 4; audit.MODERATE.push({ factor: 'Crescimento Receita Moderado (>5%)', points: 4, type: 'bonus' }); }

            // ROE tiers
            if (m.roe > 20) { modScore += 15; audit.MODERATE.push({ factor: 'ROE Excelente (>20%)', points: 15, type: 'bonus' }); }
            else if (m.roe > 15) { modScore += 10; audit.MODERATE.push({ factor: 'ROE Robusto (>15%)', points: 10, type: 'bonus' }); }
            else if (m.roe > 12) { modScore += 7; audit.MODERATE.push({ factor: 'ROE Saudável (>12%)', points: 7, type: 'bonus' }); }
            else if (m.roe > 10) { modScore += 3; audit.MODERATE.push({ factor: 'ROE Positivo (>10%)', points: 3, type: 'bonus' }); }

            // Upside tiers
            if (upside > 0.40) { modScore += 20; audit.MODERATE.push({ factor: 'Upside Agressivo (>40%)', points: 20, type: 'bonus' }); }
            else if (upside > 0.30) { modScore += 15; audit.MODERATE.push({ factor: 'Upside Alto (>30%)', points: 15, type: 'bonus' }); }
            else if (upside > 0.20) { modScore += 10; audit.MODERATE.push({ factor: 'Upside > 20%', points: 10, type: 'bonus' }); }
            else if (upside > 0.10) { modScore += 5; audit.MODERATE.push({ factor: 'Upside Positivo (>10%)', points: 5, type: 'bonus' }); }

            // Bancos e holdings: margem contábil incomparável — não penalizar
            const hasAnomalousMargin = m.netMargin > 100 || (isFinancialSector && m.netMargin === 0);
            if (!hasAnomalousMargin && !m._missing?.netMargin && m.netMargin < 5) {
                modScore -= 15;
                audit.MODERATE.push({ factor: 'Margem Líquida Baixa (<5%)', points: -15, type: 'penalty' });
            }

            // ROE < Selic com buffer de 0.5% para evitar penalizar casos borderline
            const selic = MACRO.SELIC || 14.75;
            if (!isFinancialSector && !m._missing?.roe && m.roe > 0 && m.roe < (selic - 0.5)) {
                const roePenalty = m.roe < selic / 2 ? 20 : 10;
                modScore -= roePenalty;
                audit.MODERATE.push({ factor: `ROE Abaixo da Selic (${m.roe.toFixed(1)}% < ${selic.toFixed(1)}%)`, points: -roePenalty, type: 'penalty' });
            }

            // Payout acima de 100%: distribuição além do lucro é risco de sustentabilidade
            if (!m._missing?.payout && m.payout > 100) {
                modScore -= 10;
                audit.MODERATE.push({ factor: `Payout Insustentável (${m.payout.toFixed(1)}%)`, points: -10, type: 'penalty' });
            }
        } else {
            modScore = 25;
            audit.MODERATE.push({ factor: 'Score Base (Small Cap)', points: 25, type: 'base' });
        }

        // ── ARROJADO ──────────────────────────────────────────────────────────────
        // Base reduzida 50→35. Bônus tiered em PEG, crescimento e upside.
        // Sem PEG gate em >15% — gate reduzido para >10% para capturar mais oportunidades.
        boldScore = 35;
        audit.BOLD.push({ factor: 'Base Arrojada', points: 35, type: 'base' });
        const effectivePegForBold = effectiveRevenueGrowth > 0 ? m.pl / effectiveRevenueGrowth : 0;

        // PEG tiers: gate em >10% de crescimento efetivo
        if (effectiveRevenueGrowth > 10) {
            if (effectivePegForBold > 0 && effectivePegForBold < 0.5) { boldScore += 30; audit.BOLD.push({ factor: 'PEG Excepcional (<0.5)', points: 30, type: 'bonus' }); }
            else if (effectivePegForBold < 1.0) { boldScore += 22; audit.BOLD.push({ factor: 'PEG Excelente (<1.0)', points: 22, type: 'bonus' }); }
            else if (effectivePegForBold < 1.5) { boldScore += 12; audit.BOLD.push({ factor: 'PEG Saudável (<1.5)', points: 12, type: 'bonus' }); }
            else if (effectivePegForBold < 2.0) { boldScore += 5; audit.BOLD.push({ factor: 'PEG Razoável (<2.0)', points: 5, type: 'bonus' }); }
        }

        // Revenue growth tiers (acumulativo ao PEG)
        if (effectiveRevenueGrowth > 40) { boldScore += 25; audit.BOLD.push({ factor: 'Hyper Growth Extremo (>40%)', points: 25, type: 'bonus' }); }
        else if (effectiveRevenueGrowth > 25) { boldScore += 15; audit.BOLD.push({ factor: 'Hyper Growth (>25%)', points: 15, type: 'bonus' }); }
        else if (effectiveRevenueGrowth > 15) { boldScore += 8; audit.BOLD.push({ factor: 'Crescimento Sólido (>15%)', points: 8, type: 'bonus' }); }

        // Upside tiers
        if (upside > 0.80) { boldScore += 30; audit.BOLD.push({ factor: 'Upside Extremo (>80%)', points: 30, type: 'bonus' }); }
        else if (upside > 0.50) { boldScore += 20; audit.BOLD.push({ factor: 'Upside Agressivo (>50%)', points: 20, type: 'bonus' }); }
        else if (upside > 0.30) { boldScore += 10; audit.BOLD.push({ factor: 'Upside Relevante (>30%)', points: 10, type: 'bonus' }); }
        else if (upside > 0.20) { boldScore += 5; audit.BOLD.push({ factor: 'Upside Moderado (>20%)', points: 5, type: 'bonus' }); }

        // Volatility penalties: novo tier intermediário
        if ((m.volatility || 30) > 60) { boldScore -= 20; audit.BOLD.push({ factor: 'Volatilidade Extrema (>60%)', points: -20, type: 'penalty' }); }
        else if ((m.volatility || 30) > 45) { boldScore -= 10; audit.BOLD.push({ factor: 'Volatilidade Alta (>45%)', points: -10, type: 'penalty' }); }

        // ── PENALIDADE DE SOBREVALORIZAÇÃO (comum a todos os perfis) ──────────────
        const hasMeaningfulFairPrice = valuationData.grahamPrice > 0 || valuationData.bazinPrice > 0;
        if (hasMeaningfulFairPrice && upside < -0.10) {
            const pct = (Math.abs(upside) * 100).toFixed(0);
            let boldModPenalty, defPenalty;
            if (upside < -0.25) {
                boldModPenalty = 40;
                defPenalty = 20;
            } else {
                boldModPenalty = 25;
                defPenalty = 10;
            }
            boldScore -= boldModPenalty;
            modScore -= boldModPenalty;
            defScore -= defPenalty;
            audit.BOLD.push({ factor: `Sobrevalorizado (preço ${pct}% acima do Preço Justo)`, points: -boldModPenalty, type: 'penalty' });
            audit.MODERATE.push({ factor: `Sobrevalorizado (preço ${pct}% acima do Preço Justo)`, points: -boldModPenalty, type: 'penalty' });
            audit.DEFENSIVE.push({ factor: `Sobrevalorizado (preço ${pct}% acima do Preço Justo)`, points: -defPenalty, type: 'penalty' });
        }

    } else if (type === 'FII') {
        const isTier1 = asset.dbFlags?.isTier1 || false;
        const isPapel = resolvePapel(asset.fiiSubType, asset.sector);
        const yieldSpread = m.dy - NTNB;

        // ── DEFENSIVO ────────────────────────────────────────────────────────
        // Base reduzida de 65→40: bônus progressivos evitam que FIIs medianos
        // atinjam 100 trivialmente só por cumprir 3 critérios binários.
        if (isEligibleForDefensive(asset, context)) {
            defScore = 40;
            audit.DEFENSIVE.push({ factor: 'Score Base (FII Defensivo)', points: 40, type: 'base' });

            // Yield spread vs NTN-B: escala proporcional ao prêmio real entregue
            if (yieldSpread >= 5.0) {
                defScore += 22; audit.DEFENSIVE.push({ factor: `Yield Excepcional (NTN-B +${yieldSpread.toFixed(1)}%)`, points: 22, type: 'bonus' });
            } else if (yieldSpread >= 3.0) {
                defScore += 18; audit.DEFENSIVE.push({ factor: `Yield Alto (NTN-B +${yieldSpread.toFixed(1)}%)`, points: 18, type: 'bonus' });
            } else if (yieldSpread >= 1.5) {
                defScore += 12; audit.DEFENSIVE.push({ factor: 'Yield > NTN-B + 1.5%', points: 12, type: 'bonus' });
            } else if (yieldSpread >= 0.5) {
                defScore += 5; audit.DEFENSIVE.push({ factor: `Yield Moderado (NTN-B +${yieldSpread.toFixed(1)}%)`, points: 5, type: 'bonus' });
            } else if (yieldSpread < 0) {
                defScore -= 10; audit.DEFENSIVE.push({ factor: `Spread Negativo vs NTN-B (${yieldSpread.toFixed(1)}%)`, points: -10, type: 'penalty' });
            }

            // P/VP: bonifica zona próxima ao valor patrimonial; penaliza ágio excessivo
            if (isPapel) {
                if (m.pvp >= 0.95 && m.pvp <= 1.05) { defScore += 15; audit.DEFENSIVE.push({ factor: 'P/VP Equilibrado (Papel)', points: 15, type: 'bonus' }); }
                else if (m.pvp >= 0.88 && m.pvp < 0.95) { defScore += 10; audit.DEFENSIVE.push({ factor: 'P/VP com Deságio Leve (Papel)', points: 10, type: 'bonus' }); }
                else if (m.pvp > 1.05 && m.pvp <= 1.10) { defScore += 5; audit.DEFENSIVE.push({ factor: 'P/VP com Ágio Leve (Papel)', points: 5, type: 'bonus' }); }
                else if (m.pvp > 1.10) { defScore -= 5; audit.DEFENSIVE.push({ factor: 'P/VP com Ágio Elevado (Papel)', points: -5, type: 'penalty' }); }
            } else {
                if (m.pvp >= 0.90 && m.pvp <= 1.05) { defScore += 15; audit.DEFENSIVE.push({ factor: 'P/VP Saudável (Tijolo)', points: 15, type: 'bonus' }); }
                else if (m.pvp >= 0.82 && m.pvp < 0.90) { defScore += 10; audit.DEFENSIVE.push({ factor: 'P/VP com Deságio (Tijolo)', points: 10, type: 'bonus' }); }
                else if (m.pvp > 1.05 && m.pvp <= 1.12) { defScore += 5; audit.DEFENSIVE.push({ factor: 'P/VP com Ágio Moderado (Tijolo)', points: 5, type: 'bonus' }); }
                else if (m.pvp > 1.12) { defScore -= 5; audit.DEFENSIVE.push({ factor: 'P/VP com Ágio Elevado (Tijolo)', points: -5, type: 'penalty' }); }
            }

            // Beta: tiered — diferencia FIIs ultra-estáveis de apenas estáveis
            if (m.beta < 0.40) { defScore += 12; audit.DEFENSIVE.push({ factor: 'Beta Ultra Defensivo (<0.4)', points: 12, type: 'bonus' }); }
            else if (m.beta < 0.70) { defScore += 7; audit.DEFENSIVE.push({ factor: 'Beta Defensivo (<0.7)', points: 7, type: 'bonus' }); }
            else if (m.beta > 0.90) { defScore -= 15; audit.DEFENSIVE.push({ factor: 'Beta Elevado (>0.9)', points: -15, type: 'penalty' }); }

            if (isTier1) { defScore += 8; audit.DEFENSIVE.push({ factor: 'Fundo Tier 1 (Elite)', points: 8, type: 'bonus' }); }

            // Liquidez como proxy de segurança patrimonial
            if (m.avgLiquidity > 5000000) { defScore += 6; audit.DEFENSIVE.push({ factor: 'Liquidez Alta (>5M)', points: 6, type: 'bonus' }); }
            else if (m.avgLiquidity > 2000000) { defScore += 3; audit.DEFENSIVE.push({ factor: 'Liquidez Boa (>2M)', points: 3, type: 'bonus' }); }

            // Diversificação de imóveis (Tijolo) — reduz risco concentração
            if (!isPapel) {
                if (m.qtdImoveis > 20) { defScore += 6; audit.DEFENSIVE.push({ factor: 'Alta Diversificação (>20 imóveis)', points: 6, type: 'bonus' }); }
                else if (m.qtdImoveis > 10) { defScore += 3; audit.DEFENSIVE.push({ factor: 'Boa Diversificação (>10 imóveis)', points: 3, type: 'bonus' }); }
            }
        } else {
            defScore = 25;
            audit.DEFENSIVE.push({ factor: 'Ineligível para Carteira Defensiva FII', points: 25, type: 'base' });
        }

        // ── MODERADO ─────────────────────────────────────────────────────────
        modScore = 45;
        audit.MODERATE.push({ factor: 'Score Base (Perfil Moderado FII)', points: 45, type: 'base' });

        if (yieldSpread >= 5.0) {
            modScore += 25; audit.MODERATE.push({ factor: `Yield Excepcional (NTN-B +${yieldSpread.toFixed(1)}%)`, points: 25, type: 'bonus' });
        } else if (yieldSpread >= 3.0) {
            modScore += 18; audit.MODERATE.push({ factor: `Yield Alto (NTN-B +${yieldSpread.toFixed(1)}%)`, points: 18, type: 'bonus' });
        } else if (yieldSpread >= 1.5) {
            modScore += 10; audit.MODERATE.push({ factor: 'Yield > NTN-B + 1.5%', points: 10, type: 'bonus' });
        } else if (yieldSpread >= 0) {
            modScore += 4; audit.MODERATE.push({ factor: `Yield Positivo (NTN-B +${yieldSpread.toFixed(1)}%)`, points: 4, type: 'bonus' });
        } else {
            modScore -= 10; audit.MODERATE.push({ factor: `Spread Negativo vs NTN-B (${yieldSpread.toFixed(1)}%)`, points: -10, type: 'penalty' });
        }

        if (isPapel) {
            if (m.pvp < 0.90) { modScore += 12; audit.MODERATE.push({ factor: 'Deságio Expressivo em Papel (>10%)', points: 12, type: 'bonus' }); }
            else if (m.pvp < 0.95) { modScore += 7; audit.MODERATE.push({ factor: 'Deságio em Papel (5–10%)', points: 7, type: 'bonus' }); }
            else if (m.pvp < 1.00) { modScore += 3; audit.MODERATE.push({ factor: 'Deságio Leve em Papel', points: 3, type: 'bonus' }); }
        } else {
            if (m.capRate > (NTNB + 3)) { modScore += 10; audit.MODERATE.push({ factor: 'Cap Rate Excelente (>NTN-B + 3%)', points: 10, type: 'bonus' }); }
            else if (m.capRate > (NTNB + 1)) { modScore += 6; audit.MODERATE.push({ factor: 'Cap Rate > NTN-B + 1%', points: 6, type: 'bonus' }); }
            else if (m.capRate > NTNB) { modScore += 3; audit.MODERATE.push({ factor: 'Cap Rate > NTN-B', points: 3, type: 'bonus' }); }

            if (m.pvp < 0.80) { modScore += 12; audit.MODERATE.push({ factor: 'Deságio Expressivo em Tijolo (>20%)', points: 12, type: 'bonus' }); }
            else if (m.pvp < 0.90) { modScore += 7; audit.MODERATE.push({ factor: 'Deságio em Tijolo (10–20%)', points: 7, type: 'bonus' }); }
            else if (m.pvp < 0.95) { modScore += 3; audit.MODERATE.push({ factor: 'Deságio Leve em Tijolo', points: 3, type: 'bonus' }); }
        }

        if (m.avgLiquidity > 5000000) { modScore += 5; audit.MODERATE.push({ factor: 'Liquidez Alta (>5M)', points: 5, type: 'bonus' }); }
        else if (m.avgLiquidity > 2000000) { modScore += 3; audit.MODERATE.push({ factor: 'Liquidez Boa (>2M)', points: 3, type: 'bonus' }); }

        // Penalidade por vacância: relevante para moderados que ainda aceitam algum risco
        if (!isPapel) {
            if (m.vacancy > 15) { modScore -= 8; audit.MODERATE.push({ factor: `Vacância Alta (${m.vacancy.toFixed(1)}%)`, points: -8, type: 'penalty' }); }
            else if (m.vacancy > 10) { modScore -= 4; audit.MODERATE.push({ factor: `Vacância Moderada (${m.vacancy.toFixed(1)}%)`, points: -4, type: 'penalty' }); }
        }

        // ── ARROJADO ──────────────────────────────────────────────────────────
        boldScore = 35;
        audit.BOLD.push({ factor: 'Base Arrojada FII', points: 35, type: 'base' });

        if (yieldSpread >= 7.0) {
            boldScore += 35; audit.BOLD.push({ factor: `Yield Extremo (NTN-B +${yieldSpread.toFixed(1)}%)`, points: 35, type: 'bonus' });
        } else if (yieldSpread >= 5.0) {
            boldScore += 25; audit.BOLD.push({ factor: 'Yield Agressivo (>NTN-B + 5%)', points: 25, type: 'bonus' });
        } else if (yieldSpread >= 3.0) {
            boldScore += 15; audit.BOLD.push({ factor: `Yield Arrojado (NTN-B +${yieldSpread.toFixed(1)}%)`, points: 15, type: 'bonus' });
        } else if (yieldSpread >= 1.0) {
            boldScore += 7; audit.BOLD.push({ factor: `Yield Moderado (NTN-B +${yieldSpread.toFixed(1)}%)`, points: 7, type: 'bonus' });
        }

        if (isPapel) {
            if (m.pvp < 0.85) { boldScore += 25; audit.BOLD.push({ factor: 'Deságio Acentuado em Papel (>15%)', points: 25, type: 'bonus' }); }
            else if (m.pvp < 0.92) { boldScore += 15; audit.BOLD.push({ factor: 'Deságio Expressivo em Papel (8–15%)', points: 15, type: 'bonus' }); }
            else if (m.pvp < 0.97) { boldScore += 8; audit.BOLD.push({ factor: 'Deságio em Papel (3–8%)', points: 8, type: 'bonus' }); }
        } else {
            if (m.pvp < 0.75) { boldScore += 25; audit.BOLD.push({ factor: 'Deságio Extremo em Tijolo (>25%)', points: 25, type: 'bonus' }); }
            else if (m.pvp < 0.82) { boldScore += 18; audit.BOLD.push({ factor: 'Deságio Acentuado em Tijolo (18–25%)', points: 18, type: 'bonus' }); }
            else if (m.pvp < 0.90) { boldScore += 10; audit.BOLD.push({ factor: 'Deságio em Tijolo (10–18%)', points: 10, type: 'bonus' }); }
        }

        // Cap rate agressivo: imóveis com alta rentabilidade operacional
        if (!isPapel) {
            if (m.capRate > (NTNB + 5)) { boldScore += 10; audit.BOLD.push({ factor: 'Cap Rate Excepcional (>NTN-B + 5%)', points: 10, type: 'bonus' }); }
            else if (m.capRate > (NTNB + 3)) { boldScore += 5; audit.BOLD.push({ factor: 'Cap Rate Alto (>NTN-B + 3%)', points: 5, type: 'bonus' }); }
        }

    } else if (type === 'CRYPTO') {
        const isBlueChip = ['BTC', 'ETH'].includes(asset.ticker);
        const isTop10 = m.marketCap > 20000000000;
        const isMidCap = m.marketCap > 2000000000 && m.marketCap <= 20000000000;

        if (isBlueChip) {
            defScore = 90; audit.DEFENSIVE.push({ factor: 'Crypto Blue Chip', points: 90, type: 'base' });
        } else if (isTop10) {
            modScore = 90; audit.MODERATE.push({ factor: 'Crypto Large Cap', points: 90, type: 'base' });
        } else if (isMidCap) {
            boldScore = 90; audit.BOLD.push({ factor: 'Crypto Mid Cap', points: 90, type: 'base' });
        } else {
            boldScore = 95; audit.BOLD.push({ factor: 'Crypto Small Cap (Assimetria)', points: 95, type: 'base' });
        }
        
        if (m.avgLiquidity < 50000000) {
            defScore -= 30; modScore -= 20; boldScore -= 10;
            audit.BOLD.push({ factor: 'Baixa Liquidez Crypto', points: -10, type: 'penalty' });
        } else if (m.avgLiquidity > 1000000000) {
            defScore += 10; modScore += 10;
            audit.MODERATE.push({ factor: 'Alta Liquidez Institucional', points: 10, type: 'bonus' });
        }
    }

    // Aplica penalidades de confiança diretamente nos scores de perfil (apenas STOCK/STOCK_US)
    // para que o audit log "Dados e Confiança" reflita deduções reais (não cosmético).
    // FIIs: revenueGrowth e roe/netMargin são estruturalmente ausentes → não aplicar a penalidade.
    // CRYPTO: usa suas próprias penalidades de liquidez dentro do bloco acima.
    if ((type === 'STOCK' || type === 'STOCK_US') && confidence < 100) {
        const confPenalty = 100 - confidence;
        defScore -= confPenalty;
        modScore -= confPenalty;
        boldScore -= confPenalty;
    }

    // Dividend Aristocrat bonus aplicado ANTES do clamp de confiança (maxScoreAllowed).
    // Aplicar depois do clamp violaria o teto de 70 para ativos com dados incompletos,
    // podendo gerar sinal BUY indevido em ativos que deveriam ficar em WAIT.
    const isAristocrat = isDividendAristocrat(m, type);
    if (isAristocrat) {
        defScore += 10;
        modScore += 5;
        audit.DEFENSIVE.push({ factor: 'Dividend Aristocrat Bonus', points: 10, type: 'bonus' });
        audit.MODERATE.push({ factor: 'Dividend Aristocrat Bonus', points: 5, type: 'bonus' });
    }

    // Cap graduado: salto binário 59→70/60→100 substituído por escada para evitar que
    // um dado a menos reduza o teto de 100 para 70 abruptamente.
    const maxScoreAllowed = type === 'CRYPTO' ? 100
        : confidence >= 80 ? 100
        : confidence >= 60 ? 85
        : 70;
    const finalScores = {
        DEFENSIVE: Math.min(maxScoreAllowed, Math.max(10, defScore)),
        MODERATE: Math.min(maxScoreAllowed, Math.max(10, modScore)),
        BOLD: Math.min(maxScoreAllowed, Math.max(10, boldScore))
    };

    return { scores: finalScores, audit, isAristocrat };
};

const calculateStructuralScores = (asset, context) => {
    const m = asset.metrics;
    const type = asset.type;
    const ticker = asset.ticker;
    const isPapel = resolvePapel(asset.fiiSubType, asset.sector);
    const audit = { QUALITY: [], VALUATION: [], RISK: [] };
    let quality = 0; audit.QUALITY.push({ factor: 'Base de Qualidade', points: 0, type: 'base' });
    let valuation = 0; audit.VALUATION.push({ factor: 'Base de Valuation', points: 0, type: 'base' });
    let risk = 0;

    if (type === 'STOCK' || type === 'STOCK_US') {
        // --- QUALITY SCORE ---
        let qScore = 0;
        if (m.roe > 15) { qScore += 25; audit.QUALITY.push({ factor: 'ROE Elevado (>15%)', points: 25, type: 'bonus' }); }
        else if (m.roe > 10) { qScore += 15; audit.QUALITY.push({ factor: 'ROE Saudável (>10%)', points: 15, type: 'bonus' }); }
        else { audit.QUALITY.push({ factor: 'ROE Modesto / Baixo', points: 0, type: 'base' }); }
        
        // Holdings (>100%) e bancos (0%) têm margens contabilmente incomparáveis com empresas industriais.
        // Tratar como dado ausente evita bônus indevido para ITSA4 (200%) e penalidade falsa para BBDC4 (0%).
        const isFinancialForQuality = asset.sector?.includes('Banco') || asset.sector?.includes('Segur') || asset.sector?.includes('Financeiro') || asset.sector?.includes('Holding');
        const netMarginForScoring = (m.netMargin > 100 || (isFinancialForQuality && m.netMargin === 0)) ? null : m.netMargin;
        if (netMarginForScoring !== null) {
            if (netMarginForScoring > 10) { qScore += 25; audit.QUALITY.push({ factor: 'Margem Líquida Robusta (>10%)', points: 25, type: 'bonus' }); }
            else if (netMarginForScoring > 5) { qScore += 15; audit.QUALITY.push({ factor: 'Margem Líquida Regular (>5%)', points: 15, type: 'bonus' }); }
            else { audit.QUALITY.push({ factor: 'Margem Líquida Estreita', points: 0, type: 'base' }); }
        } else {
            audit.QUALITY.push({ factor: 'Margem N/A (Setor Financeiro/Holding)', points: 0, type: 'base' });
        }

        if (m.debtToEquity < 1.0) { qScore += 25; audit.QUALITY.push({ factor: 'Estrutura Capital Excelente (D/P < 1.0)', points: 25, type: 'bonus' }); }
        else if (m.debtToEquity < 2.0) { qScore += 15; audit.QUALITY.push({ factor: 'Alavancagem Controlada (D/P < 2.0)', points: 15, type: 'bonus' }); }
        else { audit.QUALITY.push({ factor: 'Alavancagem Elevada', points: -10, type: 'penalty' }); qScore -= 10; }

        if (m.revenueGrowth > 10) { qScore += 25; audit.QUALITY.push({ factor: 'Crescimento de Receita Sólido (>10%)', points: 25, type: 'bonus' }); }
        else if (m.revenueGrowth > 5) { qScore += 10; audit.QUALITY.push({ factor: 'Crescimento de Receita Moderado', points: 10, type: 'bonus' }); }

        // --- NOVO: SUSTENTABILIDADE DE DIVIDENDOS (PAYOUT) ---
        const payout = m.payout || 0;
        if (payout > 100) {
            qScore -= 30;
            audit.QUALITY.push({ factor: `Payout Insustentável (${payout.toFixed(1)}%)`, points: -30, type: 'penalty' });
        } else if (payout > 40 && payout < 85) {
            qScore += 15;
            audit.QUALITY.push({ factor: `Payout Saudável (${payout.toFixed(1)}%)`, points: 15, type: 'bonus' });
        } else if (payout > 0 && payout < 20) {
            qScore -= 5;
            audit.QUALITY.push({ factor: `Payout Muito Baixo (${payout.toFixed(1)}%)`, points: -5, type: 'penalty' });
        }

        quality = Math.min(100, Math.max(0, qScore));

        // --- VALUATION SCORE ---
        let vScore = 0;
        if (m.pl > 0 && m.pl < 10) { vScore += 30; audit.VALUATION.push({ factor: 'P/L Barato (<10)', points: 30, type: 'bonus' }); }
        else if (m.pl > 0 && m.pl < 15) { vScore += 15; audit.VALUATION.push({ factor: 'P/L Justo (<15)', points: 15, type: 'bonus' }); }

        if (m.pvp > 0 && m.pvp < 1.5) { vScore += 30; audit.VALUATION.push({ factor: 'P/VP Barato (<1.5)', points: 30, type: 'bonus' }); }
        else if (m.pvp > 0 && m.pvp < 2.5) { vScore += 15; audit.VALUATION.push({ factor: 'P/VP Justo (<2.5)', points: 15, type: 'bonus' }); }

        if (m.evEbitda > 0 && m.evEbitda < 8) { vScore += 20; audit.VALUATION.push({ factor: 'EV/EBITDA Atrativo (<8)', points: 20, type: 'bonus' }); }
        if (m.dy > 6) { vScore += 20; audit.VALUATION.push({ factor: 'Dividend Yield > 6%', points: 20, type: 'bonus' }); }

        valuation = Math.min(100, Math.max(0, vScore));

        // --- NOVO: SPREAD VS TESOURO (VALUATION PROFISSIONAL) ---
        const ntnb = context.MACRO?.NTNB_LONG || 6.30;
        if (m.pl > 0) {
            const earningsYield = (1 / m.pl) * 100;
            const spread = earningsYield - ntnb;
            
            if (spread > 4) {
                valuation = Math.min(100, valuation + 20);
                audit.VALUATION.push({ factor: `Spread vs Tesouro Excelente (${spread.toFixed(1)}%)`, points: 20, type: 'bonus' });
            } else if (spread > 0) {
                valuation = Math.min(100, valuation + 10);
                audit.VALUATION.push({ factor: `Spread vs Tesouro Positivo (${spread.toFixed(1)}%)`, points: 10, type: 'bonus' });
            } else {
                valuation = Math.max(0, valuation - 20);
                audit.VALUATION.push({ factor: `Spread Negativo vs Tesouro (${spread.toFixed(1)}%)`, points: -20, type: 'penalty' });
            }
        }

        // --- RISK SCORE (Higher is Safer) ---
        let rScore = 50; audit.RISK.push({ factor: 'Base de Risco', points: 50, type: 'base' });
        if (m.marketCap > 10000000000) { rScore += 20; audit.RISK.push({ factor: 'Large Cap (Segurança)', points: 20, type: 'bonus' }); }
        else if (m.marketCap < 500000000) { rScore -= 20; audit.RISK.push({ factor: 'Micro Cap (Risco)', points: -20, type: 'penalty' }); }

        if (m.avgLiquidity > 5000000) { rScore += 10; audit.RISK.push({ factor: 'Liquidez Alta (>5M)', points: 10, type: 'bonus' }); }
        else if (m.avgLiquidity < 100000) { rScore -= 20; audit.RISK.push({ factor: 'Liquidez Crítica (<100k)', points: -20, type: 'penalty' }); }

        // --- REFINAMENTO: Penalidade por dívida alta (DL/EBITDA) ---
        const isFinancial = asset.sector?.includes('Banco') || asset.sector?.includes('Segur') || asset.sector?.includes('Financeiro');
        if (!isFinancial) {
            // Cálculo de EBITDA Derivado: EV = MarketCap + NetDebt. EV/EBITDA = EV / EBITDA => EBITDA = EV / (EV/EBITDA)
            const ev = (m.marketCap || 0) + (m.netDebt || 0);
            if (m.evEbitda > 0 && ev > 0) {
                const ebitda = ev / m.evEbitda;
                const dlEbitda = m.netDebt / ebitda;
                
                if (dlEbitda > 3.5) {
                    rScore -= 40;
                    audit.RISK.push({ factor: `Alavancagem Crítica (DL/EBITDA: ${dlEbitda.toFixed(1)}x)`, points: -40, type: 'penalty' });
                } else if (dlEbitda > 2.5) {
                    rScore -= 15;
                    audit.RISK.push({ factor: `Alavancagem Elevada (DL/EBITDA: ${dlEbitda.toFixed(1)}x)`, points: -15, type: 'penalty' });
                } else if (dlEbitda < 1.0 && dlEbitda > -1) {
                    rScore += 10;
                    audit.RISK.push({ factor: 'Caixa Robusto / Baixa Alavancagem', points: 10, type: 'bonus' });
                }
            } else if (m.debtToEquity > 3.0) {
                rScore -= 40;
                audit.RISK.push({ factor: 'Dívida/Patrimônio Explosiva (>3.0)', points: -40, type: 'penalty' });
            } else if (m.debtToEquity > 1.5) {
                rScore -= 15;
                audit.RISK.push({ factor: 'Dívida/Patrimônio Elevada (>1.5)', points: -15, type: 'penalty' });
            }
        }

        risk = Math.min(100, Math.max(0, rScore));

    } else if (type === 'FII') {
        const ntnb = context.MACRO?.NTNB_LONG || 6.30;
        const spread = m.dy - ntnb;

        // --- QUALITY FII ---
        let qScore = 40; audit.QUALITY.push({ factor: 'Base Qualidade FII', points: 40, type: 'base' });
        if (!isPapel) {
            // Penalidade de Vacância Linear: -3 pontos para cada 1% acima de 10%
            if (m.vacancy > 10) {
                const penalty = (m.vacancy - 10) * 3;
                qScore -= penalty;
                audit.QUALITY.push({ factor: `Vacância Elevada (${m.vacancy.toFixed(1)}%)`, points: -penalty, type: 'penalty' });
            } else if (m.vacancy < 5) {
                qScore += 20;
                audit.QUALITY.push({ factor: 'Vacância Baixa (<5%)', points: 20, type: 'bonus' });
            }
            
            if (m.qtdImoveis > 10) { qScore += 20; audit.QUALITY.push({ factor: 'Multi-propriedade (>10 imóveis)', points: 20, type: 'bonus' }); }
            else if (m.qtdImoveis > 5) { qScore += 10; audit.QUALITY.push({ factor: 'Boa diversificação (>5 imóveis)', points: 10, type: 'bonus' }); }
            else if (m.qtdImoveis === 1) { qScore -= 30; audit.QUALITY.push({ factor: 'Risco Mono-Ativo', points: -30, type: 'penalty' }); }
        } else {
            // Papel: Foco em Liquidez e Histórico (Proxy por Liquidez aqui)
            if (m.avgLiquidity > 5000000) { qScore += 30; audit.QUALITY.push({ factor: 'Liquidez Alta (Papel)', points: 30, type: 'bonus' }); }
            else if (m.avgLiquidity > 1000000) { qScore += 15; audit.QUALITY.push({ factor: 'Liquidez Saudável (Papel)', points: 15, type: 'bonus' }); }
        }
        
        // Bônus por Yield Real (Spread sobre inflação/NTNB)
        if (spread > 2) { qScore += 20; audit.QUALITY.push({ factor: 'Yield Real > 2%', points: 20, type: 'bonus' }); }
        
        quality = Math.min(100, Math.max(0, qScore));

        // --- VALUATION FII (Baseado em Spread vs NTN-B) ---
        let vScore = 0;
        
        // Lógica de Spread: O investidor exige prêmio sobre o Tesouro IPCA+
        // Prêmio ideal: > 2% para Tijolo, > 3% para Papel (Risco de Crédito)
        const requiredSpread = isPapel ? 3.0 : 2.0;
        
        if (spread >= requiredSpread + 2) { vScore += 90; audit.VALUATION.push({ factor: 'Spread Excelente (>4-5%)', points: 90, type: 'bonus' }); }
        else if (spread >= requiredSpread) { vScore += 70; audit.VALUATION.push({ factor: 'Spread Saudável', points: 70, type: 'bonus' }); }
        else if (spread >= 0) { vScore += 40; audit.VALUATION.push({ factor: 'Spread Positivo', points: 40, type: 'bonus' }); }
        else { audit.VALUATION.push({ factor: `Spread Negativo vs Tesouro (${spread.toFixed(1)}%)`, points: 0, type: 'penalty' }); }

        // Ajuste por P/VP
        if (m.pvp < 0.90) { vScore += 10; audit.VALUATION.push({ factor: 'Deságio P/VP (<0.90)', points: 10, type: 'bonus' }); }
        else if (m.pvp > 1.10) { vScore -= 20; audit.VALUATION.push({ factor: 'Ágio Excessivo (>1.10)', points: -20, type: 'penalty' }); }

        valuation = Math.min(100, Math.max(0, vScore));

        // --- RISK FII ---
        let rScore = 50; audit.RISK.push({ factor: 'Base Risco FII', points: 50, type: 'base' });
        // Tiers granulares para criar variância real: antes quase todos travavam em 70 (base+liq>2M)
        if (m.avgLiquidity > 10000000) { rScore += 30; audit.RISK.push({ factor: 'Liquidez Institucional (>10M)', points: 30, type: 'bonus' }); }
        else if (m.avgLiquidity > 5000000) { rScore += 25; audit.RISK.push({ factor: 'Liquidez Alta (>5M)', points: 25, type: 'bonus' }); }
        else if (m.avgLiquidity > 2000000) { rScore += 20; audit.RISK.push({ factor: 'Liquidez Boa (>2M)', points: 20, type: 'bonus' }); }
        else if (m.avgLiquidity > 1000000) { rScore += 10; audit.RISK.push({ factor: 'Liquidez Mínima (>1M)', points: 10, type: 'bonus' }); }
        
        if (!isPapel) {
            if (m.vacancy > 20) { rScore -= 40; audit.RISK.push({ factor: 'Vacância Crítica (>20%)', points: -40, type: 'penalty' }); }
            if (m.qtdImoveis === 1) {
                rScore -= 50; audit.RISK.push({ factor: 'Risco Binário (Mono-Ativo)', points: -50, type: 'penalty' });
            } else if (m.qtdImoveis < 3) {
                rScore -= 20; audit.RISK.push({ factor: 'Baixa Diversificação', points: -20, type: 'penalty' });
            }
        } else {
            if (m.pvp > 1.15) { rScore -= 40; audit.RISK.push({ factor: 'Ágio em Papel (Risco Amortização)', points: -40, type: 'penalty' }); }
        }
        risk = Math.min(100, Math.max(0, rScore));

    } else if (type === 'CRYPTO') {
        // Quality: Baseado em dominância, liquidez e tendência de longo prazo (SMA200)
        let qScore = 40;
        if (['BTC', 'ETH'].includes(ticker)) qScore += 40;
        else if (m.marketCap > 20000000000) qScore += 20;
        else if (m.marketCap > 5000000000) qScore += 10;
        
        if (m.avgLiquidity > 1000000000) qScore += 10;
        
        // Tendência de longo prazo como proxy de qualidade/adoção
        if (m.sma200 && asset.price > m.sma200) qScore += 10;
        
        quality = Math.min(100, Math.max(0, qScore));

        // Valuation: Difícil em crypto. Usaremos desvio da SMA200 e EMA50 como proxy de "desconto" ou "esticado"
        let vScore = 50;
        if (['BTC', 'ETH'].includes(ticker)) vScore += 10; // Prêmio de segurança
        
        if (m.sma200 && asset.price > 0) {
            const deviationFromSMA = (asset.price - m.sma200) / m.sma200;
            if (deviationFromSMA < -0.20) vScore += 30; // Muito descontado em relação à média histórica
            else if (deviationFromSMA < 0) vScore += 15; // Levemente descontado
            else if (deviationFromSMA > 0.50) vScore -= 20; // Muito esticado (sobrecomprado)
            else if (deviationFromSMA > 0.20) vScore -= 10; // Esticado
        }
        valuation = Math.min(100, Math.max(0, vScore));

        // Risk: Inversamente proporcional à volatilidade, beta, tamanho e VMC
        let rScore = 50;
        if (m.marketCap > 50000000000) rScore += 20; 
        else if (m.marketCap < 1000000000) rScore -= 30; 
        
        const vmc = m.marketCap > 0 ? (m.avgLiquidity / m.marketCap) : 0;
        if (vmc > 0.02 && vmc < 0.15) rScore += 15; // VMC Saudável
        else if (vmc > 0.5) rScore -= 20; // Especulação
        else if (vmc < 0.005) rScore -= 30; // Sem liquidez

        if (m.avgLiquidity > 1000000000) rScore += 10;
        else if (m.avgLiquidity < 50000000) rScore -= 20;
        
        // Penaliza alta volatilidade
        if (m.volatility) {
            if (m.volatility > 100) rScore -= 30; // Volatilidade extrema anualizada
            else if (m.volatility > 70) rScore -= 15;
            else if (m.volatility < 40) rScore += 15; // Baixa volatilidade para crypto
        }
        
        risk = Math.min(100, Math.max(0, rScore));
    }

    return { quality, valuation, risk, audit };
};

const generateDynamicTheses = (m, type, ticker, context, valuationData, currentPrice, sector, fiiSubType) => {
    const { MACRO } = context;
    const bull = [];
    const bear = [];
    if (m.dy > MACRO.SELIC) bull.push(`Yield (${m.dy.toFixed(1)}%) supera a Selic.`);
    if (m.pvp < 0.85 && m.pvp > 0) bull.push(`Desconto patrimonial (P/VP ${m.pvp.toFixed(2)}).`);
    if (!m._missing?.roe && m.roe > 18) bull.push(`Rentabilidade alta (ROE ${m.roe.toFixed(1)}%).`);

    if (type === 'FII') {
        const ntnb = context.MACRO?.NTNB_LONG || 6.30;
        const spread = m.dy - ntnb;
        const isPapel = resolvePapel(fiiSubType, sector);
        
        if (spread > 2.5) bull.push(`Alto prêmio de risco: Spread de ${spread.toFixed(1)}% sobre NTN-B.`);
        else if (spread < 0.5) bear.push(`Prêmio de risco pífio (${spread.toFixed(1)}%) sobre o Tesouro.`);

        if (m.vacancy > 12) bear.push(`Vacância elevada (${m.vacancy.toFixed(1)}%): Risco de fluxo de caixa.`);
        else if (m.vacancy < 3 && !isPapel) bull.push("Ocupação quase plena (Vacância < 3%).");

        if (m.qtdImoveis === 1) bear.push("Risco Mono-Ativo: Dependência total de um único imóvel.");
        if (m.beta < 0.7) bull.push(`Baixa volatilidade (Beta ${m.beta.toFixed(2)}): Perfil defensivo.`);
        else if (m.beta > 1.1) bear.push(`Volatilidade alta para o setor (Beta ${m.beta.toFixed(2)}).`);

        if (isPapel && m.pvp > 1.05) bear.push("Ágio em FII de Papel: Risco de amortização negativa.");
    }

    if (m.debtToEquity > 4 && type === 'STOCK') bear.push("Alavancagem alta.");
    if (m.avgLiquidity < 500000 && type !== 'CRYPTO') bear.push("Baixa liquidez.");
    
    if (type === 'CRYPTO') {
        if (['BTC', 'ETH'].includes(ticker)) bull.push("Blue Chip do mercado cripto (Reserva de Valor / Infraestrutura).");
        if (m.marketCap > 20000000000) bull.push("Alta capitalização de mercado (Large Cap), maior resiliência.");
        else if (m.marketCap < 2000000000) bull.push("Baixa capitalização (Small Cap), alta assimetria de retorno.");
        
        if (m.avgLiquidity > 1000000000) bull.push("Altíssima liquidez, facilitando entrada/saída institucional.");
        else if (m.avgLiquidity < 50000000) bear.push("Baixa liquidez, risco de slippage e manipulação.");

        const vmc = m.marketCap > 0 ? (m.avgLiquidity / m.marketCap) : 0;
        if (vmc > 0.02 && vmc < 0.15) bull.push(`Volume/MarketCap saudável (${(vmc*100).toFixed(1)}%), indicando adoção orgânica.`);
        else if (vmc > 0.5) bear.push(`Volume/MarketCap excessivo (${(vmc*100).toFixed(1)}%), possível especulação ou wash trading.`);
        else if (vmc < 0.005) bear.push(`Volume/MarketCap muito baixo (${(vmc*100).toFixed(1)}%), indicando desinteresse do mercado.`);

        if (m.marketCap < 100000000) bear.push("Micro Cap (< $100M): Risco extremo de volatilidade e falha do projeto.");
        
        if (m.sma200) {
            if (currentPrice > m.sma200) bull.push("Tendência de alta de longo prazo (Preço > SMA200).");
            else bear.push("Tendência de baixa de longo prazo (Preço < SMA200).");
        }
        
        if (m.volatility) {
            if (m.volatility > 100) bear.push(`Volatilidade extrema (${m.volatility.toFixed(1)}% a.a.).`);
            else if (m.volatility < 50) bull.push(`Volatilidade controlada para o setor (${m.volatility.toFixed(1)}% a.a.).`);
        }
    }
    
    return { bull, bear };
};

const STABLECOINS = ['USDT', 'USDC', 'DAI', 'FDUSD', 'TUSD', 'USDD', 'USDE'];

export const scoringEngine = {
    processAsset(asset, context) {
        // --- LOG DE DESCARTE (CRITÉRIOS DE CORTE) ---
        if (asset.type === 'CRYPTO' && STABLECOINS.includes(asset.ticker)) {
            return { _discarded: true, reason: "Stablecoin", details: "Ativos pareados não geram ganho de capital" };
        }
        if (asset.price <= 0.01 && asset.type !== 'CRYPTO') return { _discarded: true, reason: "Preço de Centavos", details: `< 0.01` };
        // FIIs precisam de liquidez maior que ações para execução real sem slippage.
        const liquidityFloor = asset.type === 'FII' ? 500000 : 200000;
        if (asset.metrics.avgLiquidity < liquidityFloor && asset.type !== 'CRYPTO') return { _discarded: true, reason: "Liquidez Insuficiente", details: `${asset.metrics.avgLiquidity} (Mínimo: ${asset.type === 'FII' ? '500k' : '200k'})` };
        if (asset.dbFlags && asset.dbFlags.isBlacklisted) return { _discarded: true, reason: "Blacklist Manual", details: "Banido pelo Admin" }; 

        const valuationData = calculateIntrinsicValue(asset.metrics, asset.type, asset.price, context);
        const profileResult = calculateProfileScores(asset, valuationData, context);
        const structuralResult = calculateStructuralScores(asset, context);
        const thesisData = generateDynamicTheses(asset.metrics, asset.type, asset.ticker, context, valuationData, asset.price, asset.sector, asset.fiiSubType);
        const aristocrat = profileResult.isAristocrat;

        if (aristocrat) {
            thesisData.bull.unshift("Dividend Aristocrat: Crescimento consistente e dividendos saudáveis.");
        }

        // Consolidação do Audit Log Completo
        const auditLog = [
            ...profileResult.audit.CONFIDENCE.map(a => ({ ...a, category: 'Dados e Confiança' })),
            ...profileResult.audit.DEFENSIVE.map(a => ({ ...a, category: 'Perfil Defensivo' })),
            ...profileResult.audit.MODERATE.map(a => ({ ...a, category: 'Perfil Moderado' })),
            ...profileResult.audit.BOLD.map(a => ({ ...a, category: 'Perfil Arrojado' })),
            ...structuralResult.audit.QUALITY.map(a => ({ ...a, category: 'Qualidade' })),
            ...structuralResult.audit.VALUATION.map(a => ({ ...a, category: 'Valuation' })),
            ...structuralResult.audit.RISK.map(a => ({ ...a, category: 'Risco' }))
        ];

        return {
            ticker: asset.ticker,
            name: asset.name,
            sector: asset.sector,
            type: asset.type,
            currentPrice: asset.price,
            targetPrice: valuationData.fairPrice,
            metrics: { 
                ...asset.metrics, 
                structural: { quality: structuralResult.quality, valuation: structuralResult.valuation, risk: structuralResult.risk }, 
                ...valuationData 
            }, 
            scores: profileResult.scores, 
            auditLog: auditLog, // O NOVO CAMPO PARA O FRONT
            riskProfile: '', 
            score: 0, 
            action: 'WAIT',
            thesis: '',
            bullThesis: thesisData.bull, 
            bearThesis: thesisData.bear,
            isDividendAristocrat: aristocrat
        };
    }
};
