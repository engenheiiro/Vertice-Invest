// Mapeamento de prefixo de ticker → gestora para detecção de concentração em FIIs.
// Cobre os principais gestores da B3. Tickers não listados caem de volta para os 2
// primeiros caracteres como proxy (heurística de fallback).
export const FII_MANAGER_MAP = {
    // KINEA (Itaú)
    KNCR: 'KINEA', KNRI: 'KINEA', KNIP: 'KINEA', KNCA: 'KINEA', KNHY: 'KINEA',
    // CSHG / Hedge
    HGCR: 'CSHG', HGLG: 'CSHG', HGBS: 'CSHG', HGRU: 'CSHG', HGRE: 'CSHG', HGFF: 'CSHG',
    // BTG Pactual
    BTLG: 'BTG', BTHF: 'BTG', BTCI: 'BTG', BTCR: 'BTG',
    // RBR Asset
    RBRD: 'RBR', RBRE: 'RBR', RBRF: 'RBR', RBRY: 'RBR', RBVA: 'RBR',
    // Vinci Partners
    VISC: 'VINCI', VINO: 'VINCI', VGHF: 'VINCI', VILG: 'VINCI', VIFI: 'VINCI',
    // XP Asset
    XPML: 'XP', XPIN: 'XP', XPCI: 'XP', XPIE: 'XP', XPCA: 'XP',
    // Capitânia
    CPTS: 'CAPITANIA', CPTI: 'CAPITANIA', CPFF: 'CAPITANIA',
    // TG Core
    TGAR: 'TGCORE', TGCA: 'TGCORE',
    // Riza Asset
    RZTR: 'RIZA', RZAK: 'RIZA',
    // Tordesilhas
    TRXF: 'TORDESILHAS',
    // Suno Research
    SNAG: 'SUNO', SNFF: 'SUNO',
    // Mauá Capital
    MXRF: 'MAUA',
    // Pátria Investimentos
    PATC: 'PATRIA', PATL: 'PATRIA',
    // Rio Bravo
    RBFF: 'RIOBRAVO', FLMA: 'RIOBRAVO',
    // GGR / Greenman
    GGRC: 'GGR',
    // Integral BREI
    IBFF: 'INTEGRAL',
    // Life Capital
    LIFE: 'LIFE',
    // Mogno Capital
    MCCI: 'MOGNO', MORC: 'MOGNO',
    // Devant
    DEVA: 'DEVANT', DEVR: 'DEVANT',
    // Prio (antes PetroRio)
    PRIO: 'PRIO',
};

/**
 * Retorna o código da gestora para um ticker de FII.
 * Fallback: primeiros 2 caracteres do ticker (heurística anterior).
 */
export const getFiiManager = (ticker) => {
    const prefix = ticker.replace(/\d+$/, ''); // remove sufixo numérico (ex: "KNCR" de "KNCR11")
    return FII_MANAGER_MAP[prefix] || ticker.substring(0, 2);
};
