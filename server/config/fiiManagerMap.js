// Mapeamento de prefixo de ticker → gestora para detecção de concentração em FIIs.
// Cobre os principais gestores da B3. Tickers não listados caem de volta para os 2
// primeiros caracteres como proxy (heurística de fallback).
export const FII_MANAGER_MAP = {
    // KINEA (Itaú)
    KNCR: 'KINEA', KNRI: 'KINEA', KNIP: 'KINEA', KNCA: 'KINEA', KNHY: 'KINEA',
    KNSC: 'KINEA', KNHF: 'KINEA', KNUQ: 'KINEA',
    // CSHG / Hedge
    HGCR: 'CSHG', HGLG: 'CSHG', HGBS: 'CSHG', HGRU: 'CSHG', HGRE: 'CSHG', HGFF: 'CSHG',
    // BTG Pactual
    BTLG: 'BTG', BTHF: 'BTG', BTCI: 'BTG', BTCR: 'BTG', BRCR: 'BTG',
    // RBR Asset (RBRP/RBRR/RBRL trazem "RBR" no próprio nome do fundo na base)
    RBRD: 'RBR', RBRE: 'RBR', RBRF: 'RBR', RBRY: 'RBR', RBVA: 'RBR',
    RBRP: 'RBR', RBRR: 'RBR', RBRL: 'RBR',
    // Vinci Partners
    VISC: 'VINCI', VINO: 'VINCI', VGHF: 'VINCI', VILG: 'VINCI', VIFI: 'VINCI',
    // XP Asset
    XPML: 'XP', XPIN: 'XP', XPCI: 'XP', XPIE: 'XP', XPCA: 'XP',
    // Capitânia (todos com "Capitania" no nome do fundo na base)
    CPTS: 'CAPITANIA', CPTI: 'CAPITANIA', CPFF: 'CAPITANIA',
    CPSH: 'CAPITANIA', CPLG: 'CAPITANIA', CPUR: 'CAPITANIA',
    CPOF: 'CAPITANIA', CPTR: 'CAPITANIA',
    // TG Core
    TGAR: 'TGCORE', TGCA: 'TGCORE',
    // Riza Asset
    RZTR: 'RIZA', RZAK: 'RIZA',
    // Tordesilhas
    TRXF: 'TORDESILHAS',
    // Suno Research
    SNAG: 'SUNO', SNFF: 'SUNO',
    // Mauá Capital ("Maua Capital Recebiveis" é o nome do MCCI11 na base)
    MXRF: 'MAUA', MCCI: 'MAUA',
    // Pátria Investimentos (MALL11 = "Patria Malls" na base)
    PATC: 'PATRIA', PATL: 'PATRIA', PMLL: 'PATRIA', MALL: 'PATRIA',
    // Safra (família "JS")
    JSRE: 'SAFRA', JSAF: 'SAFRA', JSCR: 'SAFRA',
    // HSI (Hemisfério Sul Investimentos)
    HSLG: 'HSI', HSRE: 'HSI', HSML: 'HSI', HSAF: 'HSI',
    // VBI Real Estate
    LVBI: 'VBI', PVBI: 'VBI', VBIP: 'VBI',
    // Guardian Gestora
    GARE: 'GUARDIAN',
    // Rio Bravo
    RBFF: 'RIOBRAVO', FLMA: 'RIOBRAVO',
    // GGR / Greenman
    GGRC: 'GGR',
    // Integral BREI
    IBFF: 'INTEGRAL',
    // Life Capital
    LIFE: 'LIFE',
    // Mogno Capital (MCCI11 saiu daqui: o fundo é "Maua Capital Recebiveis")
    MORC: 'MOGNO',
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
