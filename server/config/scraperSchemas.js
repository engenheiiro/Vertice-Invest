/**
 * Layouts VERSIONADOS dos raspadores frágeis (Fundamentus).
 *
 * O scraping depende da ORDEM das colunas das tabelas HTML do Fundamentus. Se o
 * site reordenar/inserir/remover uma coluna, os índices abaixo passam a apontar
 * para a coluna errada e os dados saem zerados ou trocados SEM lançar erro —
 * uma falha silenciosa difícil de notar.
 *
 * Por isso cada layout é isolado e versionado aqui:
 *   - version: bump manual sempre que o site mudar e o mapa for reajustado.
 *   - source: URL raspada (documentação).
 *   - table: seletor cheerio da tabela de resultados.
 *   - columns: nome semântico → índice da coluna (<td>). O serviço usa SEMPRE
 *     esses nomes, nunca números mágicos.
 *   - dataSignature: nome da coluna → tipo de invariante esperado NA LINHA DE
 *     DADOS (não no cabeçalho). validateFundamentusLayout() confere a 1ª linha de
 *     `tbody td` — a MESMA fonte usada na extração — e avisa quando os índices não
 *     batem mais com o conteúdo. Validar pelo corpo (e não pelo <thead>) evita o
 *     falso positivo de cabeçalhos que divergem do corpo em uma coluna.
 *
 * Quando o validador acusar divergência: conferir a tabela no site, corrigir os
 * índices em `columns`/`dataSignature` e incrementar `version`.
 */

export const FUNDAMENTUS_STOCKS_LAYOUT = {
    version: 1,
    source: 'https://www.fundamentus.com.br/resultado.php',
    table: 'table#resultado',
    columns: {
        ticker: 0,
        price: 1,
        pl: 2,
        pvp: 3,
        psr: 4,
        dy: 5,
        pAtivo: 6,
        pCapGiro: 7,
        pEbit: 8,
        pAtivCircLiq: 9,
        evEbit: 10,
        evEbitda: 11,
        mrgEbit: 12,
        netMargin: 13,
        currentRatio: 14,
        roic: 15,
        roe: 16,
        liq2m: 17,
        patrimLiq: 18,
        divBrutaPatrim: 19,
        cresRec5a: 20,
    },
    // Invariantes na linha de dados: âncoras espalhadas (início, preço, métricas
    // intermediárias e finais) detectam shift/insert/remoção de coluna no corpo.
    dataSignature: {
        ticker: 'stockTicker',
        price: 'positiveNumber',
        pl: 'number',
        roe: 'number',
        patrimLiq: 'number', // pode ser 0 legitimamente (empresa em prejuízo/PL negativo)
    },
};

export const FUNDAMENTUS_FIIS_LAYOUT = {
    version: 1,
    source: 'https://www.fundamentus.com.br/fii_resultado.php',
    table: 'table#tabelaResultado',
    columns: {
        ticker: 0,
        segment: 1,
        price: 2,
        ffoYield: 3,
        dy: 4,
        pvp: 5,
        marketCap: 6,
        liquidity: 7,
        qtdImoveis: 8,
        priceM2: 9,
        rentM2: 10,
        capRate: 11,
        vacancy: 12,
    },
    dataSignature: {
        ticker: 'fiiTicker',
        price: 'positiveNumber',
        dy: 'number',
        pvp: 'number',
    },
};

// Normaliza um rótulo de célula para comparação/exibição (sem acento, minúsculo).
const normalizeHeader = (txt) =>
    (txt || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();

// Converte texto numérico BR ("1.234,56", "12,3%", "-") em número.
// '-'/vazio → 0 (dado ausente legítimo); texto não-numérico → NaN.
const parseBrNumber = (str) => {
    const t = String(str ?? '').trim();
    if (t === '' || t === '-') return 0;
    const clean = t.replace(/\./g, '').replace(',', '.').replace('%', '').trim();
    const n = parseFloat(clean);
    return isNaN(n) ? NaN : n;
};

// Testes de invariante por célula da linha de dados.
const CELL_TESTS = {
    // Ação B3: 4 letras + 1-2 dígitos (PETR4, MGLU3, TASA4B → cobre TASA4/4B sem o sufixo).
    stockTicker: (t) => /^[A-Z]{4}\d{1,2}/.test(String(t).trim().toUpperCase()),
    // FII B3: 4 letras + "11" (HGLG11, TGAR11).
    fiiTicker: (t) => /^[A-Z]{4}11/.test(String(t).trim().toUpperCase()),
    // Numérico (ou vazio/'-' = dado ausente legítimo).
    number: (t) => !Number.isNaN(parseBrNumber(t)),
    // Numérico estritamente positivo (preço, patrimônio — nunca 0/ausente numa linha válida).
    positiveNumber: (t) => { const n = parseBrNumber(t); return Number.isFinite(n) && n > 0; },
};

/**
 * Confere se os índices de `columns` ainda batem com a estrutura real da tabela,
 * validando a PRIMEIRA LINHA DE DADOS (`tbody td`) — a mesma fonte usada pela
 * extração. NÃO interrompe o scraping: devolve as divergências para o serviço
 * logar um alerta claro de que o raspador pode estar desatualizado.
 *
 * Validar pelo corpo (e não pelo <thead>) é proposital: o cabeçalho do Fundamentus
 * pode divergir do corpo em uma coluna, o que gerava falso positivo enquanto os
 * dados extraídos seguiam corretos.
 *
 * @param {import('cheerio').CheerioAPI} $ - documento carregado pelo cheerio.
 * @param {object} layout - um dos *_LAYOUT acima.
 * @returns {{ ok: boolean, version: number, mismatches: string[] }}
 */
export const validateFundamentusLayout = ($, layout) => {
    // Linhas de dados do corpo. Fallback: <tr> com <td> fora de <tbody>.
    let dataRows = $(`${layout.table} tbody tr`).toArray().filter(tr => $(tr).find('td').length > 0);
    if (dataRows.length === 0) {
        dataRows = $(`${layout.table} tr`).toArray().filter(tr => $(tr).find('td').length > 0);
    }

    // Sem linha de dados legível: tabela ausente/bloqueada — quem chama trata o vazio.
    if (dataRows.length === 0) {
        return { ok: false, version: layout.version, mismatches: ['linha de dados não encontrada'] };
    }

    const maxIdx = Math.max(...Object.values(layout.columns));

    // Confere uma linha contra largura + invariantes de coluna. Retorna lista de divergências.
    const checkRow = (tr) => {
        const tds = $(tr).find('td');
        const mismatches = [];
        if (tds.length < maxIdx + 1) {
            mismatches.push(`linha com ${tds.length} colunas; esperava ≥ ${maxIdx + 1}`);
        }
        for (const [colName, testName] of Object.entries(layout.dataSignature)) {
            const idx = layout.columns[colName];
            const raw = $(tds[idx]).text();
            const test = CELL_TESTS[testName];
            if (!test || !test(raw)) {
                mismatches.push(`col ${idx} (${colName}): "${normalizeHeader(raw)}" não passou em ${testName}`);
            }
        }
        return mismatches;
    };

    // Valida até as 5 primeiras linhas: BASTA UMA passar. Linhas isoladas com
    // valores-limite (ex.: patrimônio 0, preço suspenso) não devem falsar o layout;
    // um shift REAL de coluna quebra TODAS as linhas. Em caso de falha total,
    // reporta as divergências da 1ª linha (mais informativas).
    let firstMismatches = null;
    for (const tr of dataRows.slice(0, 5)) {
        const m = checkRow(tr);
        if (m.length === 0) return { ok: true, version: layout.version, mismatches: [] };
        if (firstMismatches === null) firstMismatches = m;
    }
    return { ok: false, version: layout.version, mismatches: firstMismatches };
};
