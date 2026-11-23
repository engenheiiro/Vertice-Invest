import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

// ---------------------------------------------------------------------------
// Construção do PDF do relatório de IR (pdf-lib). A4 retrato, fundo branco
// (documento fiscal impresso), cabeçalho escuro com a marca Vértice.
// ---------------------------------------------------------------------------

const MONTH_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const CATEGORY_PT = { ACOES: 'Ações', FII: 'FIIs', ETF: 'ETF', EXTERIOR: 'Exterior', CRIPTO: 'Cripto' };

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 42;
const RIGHT = A4.width - MARGIN;
const INK = rgb(0.09, 0.11, 0.16);      // texto principal
const MUTED = rgb(0.42, 0.45, 0.52);    // texto secundário
const NAVY = rgb(0.031, 0.047, 0.078);  // cabeçalho
const ACCENT = rgb(0.20, 0.55, 0.95);   // azul Vértice
const EMERALD = rgb(0.13, 0.66, 0.42);  // valores positivos / DARF
const LINE = rgb(0.85, 0.87, 0.90);     // divisórias
const ZEBRA = rgb(0.96, 0.97, 0.98);    // linha alternada
const LOSS = rgb(0.8, 0.2, 0.2);        // ganho negativo
const WHITE = rgb(1, 1, 1);

// pdf-lib usa StandardFonts (codificação WinAnsi/CP1252). Caracteres fora desse
// conjunto lançam exceção em drawText (ex.: "≤"), e nomes/tickers vêm de dados do
// usuário — podem conter qualquer Unicode. Sanitizamos todo texto desenhado:
// trocamos alguns símbolos por equivalentes legíveis e substituímos o resto por "?".
const CP1252_EXTRA = new Set([ // Unicode que o WinAnsi codifica além do Latin-1 (faixa 0x80–0x9F do CP1252).
    0x20AC, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160,
    0x2039, 0x0152, 0x017D, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014,
    0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x017E, 0x0178,
]);
const isWinAnsi = (cp) =>
    cp === 0x09 || cp === 0x0A || cp === 0x0D ||
    (cp >= 0x20 && cp <= 0x7E) || (cp >= 0xA0 && cp <= 0xFF) || CP1252_EXTRA.has(cp);
const PRETTY = { '≤': '<=', '≥': '>=', '→': '->', '×': 'x' };
const winAnsi = (str) => {
    let s = String(str ?? '');
    for (const [k, v] of Object.entries(PRETTY)) if (s.includes(k)) s = s.split(k).join(v);
    let out = '';
    for (const ch of s) out += isWinAnsi(ch.codePointAt(0)) ? ch : '?';
    return out;
};

const brl = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0);
const num = (v, dec = 2) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(Number(v) || 0);
const dateBR = (d) => new Date(d).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
const monthLabel = (month) => MONTH_PT[parseInt(month, 10) - 1];

/**
 * "Tela" de desenho: página corrente, cursor vertical e as primitivas de texto
 * que as seções usam. Cada seção recebe a tela e só desce o cursor.
 */
const createCanvas = (pdf, font, bold) => {
    const cv = { font, bold, page: null, y: 0, pageNum: 0 };

    cv.truncate = (str, size, maxWidth, f = font) => {
        let t = winAnsi(str);
        if (f.widthOfTextAtSize(t, size) <= maxWidth) return t;
        while (t.length > 1 && f.widthOfTextAtSize(t + '…', size) > maxWidth) t = t.slice(0, -1);
        return t + '…';
    };

    cv.newPage = () => {
        cv.page = pdf.addPage([A4.width, A4.height]);
        cv.pageNum += 1;
        cv.y = A4.height - MARGIN;
        // Rodapé
        cv.page.drawText('Vértice Invest — Documento de apoio à declaração. Não substitui orientação contábil.', {
            x: MARGIN, y: 24, size: 7, font, color: MUTED,
        });
        cv.page.drawText(String(cv.pageNum), { x: A4.width - MARGIN - 10, y: 24, size: 8, font, color: MUTED });
    };

    cv.ensure = (needed) => { if (cv.y - needed < MARGIN + 30) cv.newPage(); };

    cv.text = (str, x, size, color = INK, f = font) => {
        cv.page.drawText(winAnsi(str), { x, y: cv.y, size, font: f, color });
    };

    // Texto alinhado à direita a partir de `right`.
    cv.textRight = (str, right, size, color = INK, f = font) => {
        const s = winAnsi(str);
        const w = f.widthOfTextAtSize(s, size);
        cv.page.drawText(s, { x: right - w, y: cv.y, size, font: f, color });
    };

    cv.rule = () => {
        cv.page.drawLine({ start: { x: MARGIN, y: cv.y }, end: { x: RIGHT, y: cv.y }, thickness: 0.7, color: LINE });
    };

    // Faixa de fundo das linhas alternadas de tabela.
    cv.zebra = (on) => {
        if (on) cv.page.drawRectangle({ x: MARGIN, y: cv.y - 3, width: A4.width - MARGIN * 2, height: 13, color: ZEBRA });
    };

    cv.sectionTitle = (title, subtitle) => {
        cv.ensure(46);
        cv.y -= 8;
        cv.page.drawRectangle({ x: MARGIN, y: cv.y - 2, width: 3, height: 14, color: ACCENT });
        cv.text(title, MARGIN + 10, 12.5, INK, bold);
        cv.y -= 15;
        if (subtitle) { cv.text(subtitle, MARGIN + 10, 8.5, MUTED); cv.y -= 12; }
        cv.rule();
        cv.y -= 14;
    };

    cv.paragraph = (str, size = 8.5, color = MUTED, indent = 0) => {
        const maxWidth = A4.width - MARGIN * 2 - indent;
        for (const ln of wrapWords(winAnsi(str), (t) => font.widthOfTextAtSize(t, size) > maxWidth)) {
            cv.ensure(size + 4);
            cv.text(ln, MARGIN + indent, size, color);
            cv.y -= size + 3;
        }
    };

    return cv;
};

/** Quebra em linhas por palavra; `tooWide(linha)` decide quando quebrar. */
const wrapWords = (str, tooWide) => {
    let line = '';
    const lines = [];
    for (const w of str.split(' ')) {
        const test = line ? `${line} ${w}` : w;
        if (tooWide(test)) { lines.push(line); line = w; }
        else line = test;
    }
    if (line) lines.push(line);
    return lines;
};

// --- Cabeçalho da 1ª página ---
const drawHeader = (cv, report, user) => {
    const { page, font, bold } = cv;
    page.drawRectangle({ x: 0, y: A4.height - 96, width: A4.width, height: 96, color: NAVY });
    page.drawText('VÉRTICE', { x: MARGIN, y: A4.height - 44, size: 20, font: bold, color: WHITE });
    page.drawText('INVEST', { x: MARGIN + 92, y: A4.height - 44, size: 20, font, color: ACCENT });
    page.drawText('Relatório de Imposto de Renda', { x: MARGIN, y: A4.height - 66, size: 11, font, color: rgb(0.8, 0.84, 0.9) });
    page.drawText(`Ano-base ${report.year}`, { x: MARGIN, y: A4.height - 82, size: 10, font: bold, color: WHITE });
    // Bloco direito (contribuinte)
    const hdrName = cv.truncate(user?.name || user?.email || 'Investidor', 10, 220, bold);
    const nameW = bold.widthOfTextAtSize(hdrName, 10);
    page.drawText(hdrName, { x: RIGHT - nameW, y: A4.height - 44, size: 10, font: bold, color: WHITE });
    const genStr = winAnsi(`Emitido em ${new Date(report.generatedAt).toLocaleDateString('pt-BR')}`);
    const genW = font.widthOfTextAtSize(genStr, 8);
    page.drawText(genStr, { x: RIGHT - genW, y: A4.height - 60, size: 8, font, color: rgb(0.7, 0.75, 0.82) });
    cv.y = A4.height - 96 - 24;
};

// --- Resumo (cards) ---
const drawSummaryCards = (cv, s) => {
    const cards = [
        { label: 'DARF a pagar (ano)', value: brl(s.totalDarf), color: s.totalDarf > 0 ? EMERALD : INK },
        { label: 'Proventos isentos', value: brl(s.totalDividends), color: INK },
        { label: 'Custo posição 31/12', value: brl(s.totalPositionCostBRL), color: INK },
        { label: 'Ativos declarados', value: String(s.positionsCount), color: INK },
    ];
    const cardW = (A4.width - MARGIN * 2 - 3 * 10) / 4;
    let cx = MARGIN;
    const cardTop = cv.y;
    for (const c of cards) {
        cv.page.drawRectangle({ x: cx, y: cardTop - 44, width: cardW, height: 44, color: ZEBRA, borderColor: LINE, borderWidth: 0.7 });
        cv.page.drawText(cv.truncate(c.label, 7.5, cardW - 12), { x: cx + 8, y: cardTop - 16, size: 7.5, font: cv.font, color: MUTED });
        cv.page.drawText(cv.truncate(c.value, 12, cardW - 12, cv.bold), { x: cx + 8, y: cardTop - 34, size: 12, font: cv.bold, color: c.color });
        cx += cardW + 10;
    }
    cv.y = cardTop - 44 - 6;
};

// --- Seção: Bens e Direitos ---
const POSITION_COLS = { ticker: MARGIN + 4, qtyR: MARGIN + 300, avgR: MARGIN + 400, costR: A4.width - MARGIN - 4 };

const drawPositionGroup = (cv, g) => {
    const c = POSITION_COLS;
    cv.ensure(28);
    cv.text(`Grupo ${g.grupo} — ${g.groupLabel}`, MARGIN, 9.5, ACCENT, cv.bold);
    cv.textRight(brl(g.totalCost), RIGHT, 9.5, INK, cv.bold);
    cv.y -= 13;
    // cabeçalho da tabela
    cv.text('Ativo', c.ticker, 7.5, MUTED, cv.bold);
    cv.textRight('Quantidade', c.qtyR, 7.5, MUTED, cv.bold);
    cv.textRight('Preço médio', c.avgR, 7.5, MUTED, cv.bold);
    cv.textRight('Custo total', c.costR, 7.5, MUTED, cv.bold);
    cv.y -= 11;
    let zebra = false;
    for (const p of g.items) {
        cv.ensure(14);
        cv.zebra(zebra);
        zebra = !zebra;
        cv.text(cv.truncate(`${p.ticker}${p.manualReview ? '  (conferir câmbio)' : ''}`, 8.5, 250), c.ticker, 8.5, INK);
        cv.textRight(num(p.quantity, p.quantity % 1 === 0 ? 0 : 6), c.qtyR, 8.5, INK);
        cv.textRight(brl(p.avgPrice), c.avgR, 8.5, INK);
        cv.textRight(brl(p.totalCost), c.costR, 8.5, INK, cv.bold);
        cv.y -= 13;
    }
    cv.y -= 6;
};

const drawPositions = (cv, report) => {
    cv.sectionTitle(
        'Bens e Direitos — Posição em 31/12',
        `Declarar pelo CUSTO DE AQUISIÇÃO (preço médio), não pelo valor de mercado. Ano-base ${report.year}.`,
    );
    if (report.positionsByGroup.length === 0) {
        cv.paragraph('Nenhuma posição em aberto em 31/12.');
        return;
    }
    for (const g of report.positionsByGroup) drawPositionGroup(cv, g);
    cv.paragraph(
        'Discriminação sugerida (exemplo): "QTD ativos de TICKER — custo médio de aquisição R$ X". '
        + 'Códigos grupo/código são sugestões; confirme no programa da Receita.',
        7.5, MUTED,
    );
};

// --- Seção: Ganhos de Renda Variável (BR) + DARF ---
const GAIN_COLS = {
    month: MARGIN + 2, cat: MARGIN + 44, salesR: MARGIN + 210, gainR: MARGIN + 300, baseR: MARGIN + 390, taxR: A4.width - MARGIN - 2,
};

const drawMonthlyRow = (cv, l) => {
    const c = GAIN_COLS;
    cv.text(monthLabel(l.month) || l.month, c.month, 8, INK);
    cv.text(CATEGORY_PT[l.category] || l.category, c.cat, 8, INK);
    cv.textRight(brl(l.sales), c.salesR, 8, INK);
    cv.textRight(brl(l.gain), c.gainR, 8, l.gain < 0 ? LOSS : INK);
    if (l.exempt) { cv.textRight('isento', c.baseR, 8, EMERALD); cv.textRight('—', c.taxR, 8, MUTED); return; }
    cv.textRight(brl(l.taxableBase), c.baseR, 8, INK);
    const taxed = l.tax > 0;
    cv.textRight(brl(l.tax), c.taxR, 8, taxed ? INK : MUTED, taxed ? cv.bold : cv.font);
};

const drawMonthlyTable = (cv, monthly) => {
    const c = GAIN_COLS;
    cv.ensure(14);
    cv.text('Mês', c.month, 7.5, MUTED, cv.bold);
    cv.text('Categoria', c.cat, 7.5, MUTED, cv.bold);
    cv.textRight('Vendas', c.salesR, 7.5, MUTED, cv.bold);
    cv.textRight('Ganho/Perda', c.gainR, 7.5, MUTED, cv.bold);
    cv.textRight('Base trib.', c.baseR, 7.5, MUTED, cv.bold);
    cv.textRight('Imposto', c.taxR, 7.5, MUTED, cv.bold);
    cv.y -= 11;
    let zebra = false;
    for (const l of monthly) {
        cv.ensure(14);
        cv.zebra(zebra);
        zebra = !zebra;
        drawMonthlyRow(cv, l);
        cv.y -= 13;
    }
    cv.y -= 6;
};

const drawDarfs = (cv, report) => {
    cv.ensure(20);
    cv.text('DARFs a recolher', MARGIN, 9.5, INK, cv.bold);
    cv.y -= 14;
    if (report.darf.length === 0) {
        cv.paragraph('Nenhum DARF devido (imposto acumulado abaixo de R$10 ou sem ganho tributável).');
        return;
    }
    for (const d of report.darf) {
        cv.ensure(14);
        cv.text(`Competência ${monthLabel(d.month)}/${report.year}`, MARGIN + 4, 8.5, INK);
        cv.text(`Código ${d.code}`, MARGIN + 170, 8.5, MUTED);
        cv.text(`Vencimento ${dateBR(d.dueDate)}`, MARGIN + 250, 8.5, MUTED);
        cv.textRight(brl(d.amount), A4.width - MARGIN - 4, 8.5, EMERALD, cv.bold);
        cv.y -= 13;
    }
};

const drawCarryNotes = (cv, report) => {
    if (report.darfCarryToNextYear > 0) {
        cv.paragraph(`Imposto de ${brl(report.darfCarryToNextYear)} ficou abaixo de R$10,00 e deve ser somado ao DARF do próximo mês/ano.`, 7.5, MUTED);
    }
    const lc = report.lossCarryEndOfYear;
    if (lc.ACOES > 0 || lc.FII > 0 || lc.ETF > 0) {
        cv.paragraph(`Prejuízo a compensar em anos seguintes — Ações: ${brl(lc.ACOES)} · FIIs: ${brl(lc.FII)} · ETF: ${brl(lc.ETF)}.`, 8, INK);
    }
};

const drawGains = (cv, report) => {
    cv.sectionTitle(
        'Ganhos Líquidos em Renda Variável (Brasil)',
        'Apuração mensal por preço médio. Ações: isenção de vendas ≤ R$20.000/mês (15%). FIIs: 20%. ETF: 15%.',
    );
    if (report.monthly.length === 0) {
        cv.paragraph('Nenhuma venda de renda variável brasileira no ano.');
        return;
    }
    drawMonthlyTable(cv, report.monthly);
    drawDarfs(cv, report);
    drawCarryNotes(cv, report);
};

// --- Seção: Proventos (Isentos) ---
const drawDividends = (cv, dividends) => {
    cv.sectionTitle(
        'Rendimentos Isentos e Não Tributáveis — Proventos',
        'Dividendos e rendimentos de FIIs recebidos no ano. (JCP não é distinguido pela fonte — ver avisos.)',
    );
    if (dividends.byTicker.length === 0) {
        cv.paragraph('Nenhum provento recebido no ano.');
        return;
    }
    let zebra = false;
    for (const d of dividends.byTicker) {
        cv.ensure(14);
        cv.zebra(zebra);
        zebra = !zebra;
        cv.text(cv.truncate(d.ticker, 8.5, 120, cv.bold), MARGIN + 4, 8.5, INK, cv.bold);
        cv.text(cv.truncate(d.name, 8.5, 300), MARGIN + 110, 8.5, MUTED);
        cv.textRight(brl(d.amount), A4.width - MARGIN - 4, 8.5, INK);
        cv.y -= 13;
    }
    cv.y -= 2;
    cv.rule();
    cv.y -= 12;
    cv.text('Total de proventos isentos', MARGIN + 4, 9, INK, cv.bold);
    cv.textRight(brl(dividends.total), A4.width - MARGIN - 4, 9, EMERALD, cv.bold);
    cv.y -= 14;
};

// --- Seção: Conferência manual (exterior/cripto) ---
const drawManualReview = (cv, items) => {
    if (items.length === 0) return;
    cv.sectionTitle(
        'Conferência Manual — Exterior e Cripto',
        'Ganho de capital NÃO calculado (regras próprias). Valores abaixo são apenas informativos.',
    );
    for (const m of items) {
        cv.ensure(14);
        cv.text(CATEGORY_PT[m.category] || m.category, MARGIN + 4, 8.5, INK, cv.bold);
        cv.text(`Vendas no ano: ${brl(m.sales)}`, MARGIN + 120, 8.5, MUTED);
        cv.textRight(`Resultado: ${brl(m.realizedGain)}`, A4.width - MARGIN - 4, 8.5, INK);
        cv.y -= 13;
    }
    cv.paragraph(
        'Exterior: apure ganho de capital (GCAP) com isenção de R$35.000/mês para vendas no país e regras específicas para o exterior. '
        + 'Cripto: isenção de R$35.000/mês em vendas; acima disso, alíquotas progressivas. Consulte um contador.',
        7.5, MUTED,
    );
};

export const buildTaxPdf = async (report, user) => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const cv = createCanvas(pdf, font, bold);

    cv.newPage();
    drawHeader(cv, report, user);
    drawSummaryCards(cv, report.summary);
    drawPositions(cv, report);
    drawGains(cv, report);
    drawDividends(cv, report.dividends);
    drawManualReview(cv, report.manualReviewItems);

    // --- Seção: Avisos ---
    cv.sectionTitle('Avisos Importantes', null);
    report.disclaimers.forEach((d, i) => cv.paragraph(`${i + 1}. ${d}`, 7.8, MUTED));

    return pdf.save();
};
