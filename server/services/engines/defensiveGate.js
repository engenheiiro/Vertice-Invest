/**
 * Gate de elegibilidade ao perfil DEFENSIVO, por classe de ativo (regras no
 * CLAUDE.md, "Gate de elegibilidade"). Extraído de scoringEngine.js sem mudar
 * decisão (guarda: tests/defensive_gate_characterization.spec.js).
 */
import { isCyclicalSector } from '../../config/sectorTaxonomy.js';
import { isFinancialSector, resolvePapel } from './sectorRules.js';

// (H) Setores considerados "seguros" para o gate Defensivo (BR). Mantido como lista única
// de substrings (NÃO migrado para getMacroSector: Telecom→TECNOLOGIA / Alimentos→CONSUMO
// arrastariam setores não-defensivos inteiros para "seguro", mudando a semântica).
const DEFENSIVE_SAFE_SECTORS_BR = ['Banco', 'Segur', 'Elétric', 'Eletric', 'Saneamento', 'Água', 'Telecom', 'Energia', 'Transmissão', 'Financeiro', 'Alimentos', 'Saúde', 'Gás', 'Holding', 'Bebidas'];
// Setores defensivos do Exterior (GICS, em inglês) para o gate Defensivo de STOCK_US.
const DEFENSIVE_SAFE_SECTORS_US = ['Consumer Staples', 'Utilities', 'Healthcare', 'Financials'];

// Beta AUSENTE reprova (fail-closed). O marketDataService grava `beta: 0` quando não
// há série para calcular e marca `_missing.beta` — mas o gate só olhava `beta >= 1.5`,
// então 0 passava como se fosse um beta baixíssimo e o ativo sem medição de risco
// entrava no perfil Defensivo. Beta negativo REAL continua aceito.
const hasMeasuredBeta = (m) => !m._missing?.beta && Number.isFinite(m.beta);

// ROE ausente reprova no Defensivo (fail-closed): antes a regra era pulada quando
// `_missing.roe`, e a falta de coleta virava passe livre para o perfil mais
// conservador.
const hasRoeAtLeast5 = (m) => !m._missing?.roe && Number.isFinite(m.roe) && m.roe >= 5;

// Fora dos setores seguros, a rota de entrada é renda: DY ≥ 6% com P/L POSITIVO e
// ≤ 10. `m.pl > 10` sozinho aceitava P/L 0 (ausente) e P/L negativo (prejuízo)
// como "barato", abrindo a rota DY≥6% para empresa sem lucro.
const passesBrSectorRoute = (m, sector) => DEFENSIVE_SAFE_SECTORS_BR.some(keyword => sector.includes(keyword))
    || (!(m.dy < 6.0) && m.pl > 0 && m.pl <= 10);

// Margem/payout ausentes seguem tolerados (não são o eixo do gate). Payout
// insustentável (>200%) é incompatível com perfil defensivo — dividendo vem do capital.
const passesBrBalanceSheet = (m, sector) => {
    if (!m._missing?.netMargin && m.netMargin < 3) return false;
    if (!m._missing?.payout && m.payout > 200) return false;
    return !(m.debtToEquity > 4.0 && !isFinancialSector(sector));
};

const isStockEligibleForDefensive = (asset, m) => {
    if (m.marketCap < 1000000000) return false;
    // Beta muito alto (≥1.5) indica ativo pró-cíclico incompatível com perfil defensivo.
    // O scoring já penaliza -15 pts para beta ≥1.5, mas o gate evita que ativos com
    // muitos bônus de DY/ROE compensem essa fraqueza estrutural e entrem no DEFENSIVE.
    if (!hasMeasuredBeta(m) || m.beta >= 1.5) return false;
    const sector = asset.sector || '';
    // Setor cíclico (INDUSTRIAL/COMMODITIES) NUNCA é elegível ao perfil Defensivo:
    // DY/P/L baratos numa cíclica em queda são lucro de PICO de ciclo (value-trap),
    // não segurança. Barra na origem — antes de qualquer bônus de DY/ROE (caso SHUL4).
    // Continua elegível a MODERATE/BOLD via scoreStockProfiles.
    if (isCyclicalSector(sector)) return false;
    return passesBrSectorRoute(m, sector) && hasRoeAtLeast5(m) && passesBrBalanceSheet(m, sector);
};

const isFiiEligibleForDefensive = (asset, m) => {
    if (m.marketCap < 500000000) return false;
    if (m.dy > 18.0) return false;
    if (m.vacancy > 12) return false; // Reduzido de 15 para 12 para ser mais defensivo
    // FII de Papel não tem imóveis (qtdImoveis=0): a guarda de mono-ativo só vale para tijolo.
    // Usa resolvePapel (fiiSubType explícito OU hints 'papel'/'recebív') em vez de substring crua
    // 'Papel' — senão um FII de papel rotulado "Recebíveis"/"CRI" seria vetado indevidamente.
    if (!resolvePapel(asset.fiiSubType, asset.sector) && m.qtdImoveis < 2) return false; // Mono-ativos de tijolo são vetados
    return !(m.avgLiquidity < 1000000);
};

// US stocks: exige market cap mínimo de $10B USD e setor defensivo (Consumer Staples,
// Utilities, Healthcare, Financials) — ou, fora deles, DY razoável ou P/E moderado.
// Beta e ROE seguem a mesma regra fail-closed do STOCK BR.
const isUsStockEligibleForDefensive = (asset, m) => {
    if (m.marketCap < 10_000_000_000) return false;
    if (!hasMeasuredBeta(m) || m.beta >= 1.8) return false;
    if (!hasRoeAtLeast5(m)) return false;
    const sector = asset.sector || '';
    if (DEFENSIVE_SAFE_SECTORS_US.some(s => sector.includes(s))) return true;
    return !(m.dy < 1.5 && (m.pl === 0 || m.pl > 30));
};

// Para ser defensivo em crypto, tem que ser gigante e muito líquido (Buy & Hold).
const isCryptoEligibleForDefensive = (asset, m) => {
    if (!['BTC', 'ETH'].includes(asset.ticker) && m.marketCap < 50000000000) return false;
    return !(m.avgLiquidity < 500000000);
};

const DEFENSIVE_GATE_BY_TYPE = {
    STOCK: isStockEligibleForDefensive,
    FII: isFiiEligibleForDefensive,
    STOCK_US: isUsStockEligibleForDefensive,
    CRYPTO: isCryptoEligibleForDefensive,
};

export const isEligibleForDefensive = (asset, _context) => {
    const m = asset.metrics;
    if (m.avgLiquidity < 200000) return false;
    // Classe sem gate próprio (ETF, REIT, ouro…) passa só pelo piso de liquidez, como antes.
    const gate = Object.hasOwn(DEFENSIVE_GATE_BY_TYPE, asset.type) ? DEFENSIVE_GATE_BY_TYPE[asset.type] : null;
    return gate ? gate(asset, m) : true;
};

