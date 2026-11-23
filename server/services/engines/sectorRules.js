/**
 * Classificação de setor compartilhada pelos scorers (perfil, gate Defensivo,
 * eixos estruturais). Extraída de scoringEngine.js sem mudar regra.
 */
// Helper: resolve isPapel a partir de fiiSubType (explícito) ou setor (fallback por substring).
// Rótulos de FII de Papel na base: "Papel", "Recebíveis" (CRI/CRA). Hints específicos
// para não gerar falso-positivo com setores de tijolo (ex.: "Shoppings", "Logística").
const PAPEL_SECTOR_HINTS = ['papel', 'recebív', 'recebiv'];
export const resolvePapel = (fiiSubType, sector) => {
    if (fiiSubType) return fiiSubType === 'PAPEL';
    if (!sector) return false;
    const s = sector.toLowerCase();
    return PAPEL_SECTOR_HINTS.some(h => s.includes(h));
};

// (H) Classificação setorial centralizada — antes havia ~5 cópias divergentes de
// "é setor financeiro?" espalhadas (algumas com Holding, outras com Financials/Insurance).
// FIN_CORE é o núcleo idêntico a TODOS os sites; cada chamada declara seus extras de forma
// explícita, então a divergência legada fica visível e editável num só lugar — SEM mudar
// pontuação (cada site reproduz exatamente o conjunto de keywords que já usava).
const FIN_CORE = ['Banco', 'Segur', 'Financeiro'];
export const isFinancialSector = (sector, extra = []) => {
    if (!sector) return false;
    return [...FIN_CORE, ...extra].some(k => sector.includes(k));
};

