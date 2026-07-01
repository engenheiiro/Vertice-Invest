
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { taxReportService } from '../services/taxReportService.js';
import User from '../models/User.js';
import logger from '../config/logger.js';

// Ano-base válido: entre 2015 e o ano corrente (a declaração é sempre sobre um
// ano-calendário já encerrado ou o corrente para acompanhamento).
const parseYear = (raw) => {
    const year = parseInt(raw, 10);
    const currentYear = new Date().getFullYear();
    if (!Number.isInteger(year) || year < 2015 || year > currentYear) return null;
    return year;
};

const MONTH_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const CATEGORY_PT = { ACOES: 'Ações', FII: 'FIIs', ETF: 'ETF', EXTERIOR: 'Exterior', CRIPTO: 'Cripto' };

// GET /api/wallet/tax-report/:year — JSON estruturado.
export const getTaxReport = async (req, res, next) => {
    try {
        const year = parseYear(req.params.year);
        if (!year) return res.status(400).json({ message: 'Ano-base inválido.' });
        const report = await taxReportService.computeReport(req.user.id, year);
        res.json(report);
    } catch (error) {
        logger.error(`[Tax] Erro ao gerar relatório de IR: ${error.message}`);
        next(error);
    }
};

// GET /api/wallet/tax-report/:year/pdf — PDF para download.
export const getTaxReportPdf = async (req, res, next) => {
    try {
        const year = parseYear(req.params.year);
        if (!year) return res.status(400).json({ message: 'Ano-base inválido.' });

        const [report, user] = await Promise.all([
            taxReportService.computeReport(req.user.id, year),
            User.findById(req.user.id).select('name email').lean(),
        ]);

        const pdfBytes = await buildTaxPdf(report, user);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=vertice-ir-${year}.pdf`);
        res.send(Buffer.from(pdfBytes));
    } catch (error) {
        logger.error(`[Tax] Erro ao gerar PDF de IR: ${error.message}`);
        next(error);
    }
};

// ---------------------------------------------------------------------------
// Construção do PDF (pdf-lib). A4 retrato, fundo branco (documento fiscal
// impresso), cabeçalho escuro com a marca Vértice.
// ---------------------------------------------------------------------------

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 42;
const INK = rgb(0.09, 0.11, 0.16);      // texto principal
const MUTED = rgb(0.42, 0.45, 0.52);    // texto secundário
const NAVY = rgb(0.031, 0.047, 0.078);  // cabeçalho
const ACCENT = rgb(0.20, 0.55, 0.95);   // azul Vértice
const EMERALD = rgb(0.13, 0.66, 0.42);  // valores positivos / DARF
const LINE = rgb(0.85, 0.87, 0.90);     // divisórias
const ZEBRA = rgb(0.96, 0.97, 0.98);    // linha alternada

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

const buildTaxPdf = async (report, user) => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    const ctx = { pdf, font, bold, page: null, y: 0, pageNum: 0 };

    const truncate = (text, size, maxWidth, f = font) => {
        let t = winAnsi(text);
        if (f.widthOfTextAtSize(t, size) <= maxWidth) return t;
        while (t.length > 1 && f.widthOfTextAtSize(t + '…', size) > maxWidth) t = t.slice(0, -1);
        return t + '…';
    };

    const newPage = () => {
        ctx.page = pdf.addPage([A4.width, A4.height]);
        ctx.pageNum += 1;
        ctx.y = A4.height - MARGIN;
        // Rodapé
        ctx.page.drawText('Vértice Invest — Documento de apoio à declaração. Não substitui orientação contábil.', {
            x: MARGIN, y: 24, size: 7, font, color: MUTED,
        });
        ctx.page.drawText(String(ctx.pageNum), { x: A4.width - MARGIN - 10, y: 24, size: 8, font, color: MUTED });
    };

    const ensure = (needed) => { if (ctx.y - needed < MARGIN + 30) newPage(); };

    const text = (str, x, size, color = INK, f = font) => {
        ctx.page.drawText(winAnsi(str), { x, y: ctx.y, size, font: f, color });
    };

    // Texto alinhado à direita a partir de `right`.
    const textRight = (str, right, size, color = INK, f = font) => {
        const s = winAnsi(str);
        const w = f.widthOfTextAtSize(s, size);
        ctx.page.drawText(s, { x: right - w, y: ctx.y, size, font: f, color });
    };

    const sectionTitle = (title, subtitle) => {
        ensure(46);
        ctx.y -= 8;
        ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 2, width: 3, height: 14, color: ACCENT });
        text(title, MARGIN + 10, 12.5, INK, bold);
        ctx.y -= 15;
        if (subtitle) { text(subtitle, MARGIN + 10, 8.5, MUTED); ctx.y -= 12; }
        ctx.page.drawLine({ start: { x: MARGIN, y: ctx.y }, end: { x: A4.width - MARGIN, y: ctx.y }, thickness: 0.7, color: LINE });
        ctx.y -= 14;
    };

    const paragraph = (str, size = 8.5, color = MUTED, indent = 0) => {
        const maxWidth = A4.width - MARGIN * 2 - indent;
        const words = winAnsi(str).split(' ');
        let line = '';
        const lines = [];
        for (const w of words) {
            const test = line ? `${line} ${w}` : w;
            if (font.widthOfTextAtSize(test, size) > maxWidth) { lines.push(line); line = w; }
            else line = test;
        }
        if (line) lines.push(line);
        for (const ln of lines) {
            ensure(size + 4);
            text(ln, MARGIN + indent, size, color);
            ctx.y -= size + 3;
        }
    };

    // --- Cabeçalho da 1ª página ---
    newPage();
    ctx.page.drawRectangle({ x: 0, y: A4.height - 96, width: A4.width, height: 96, color: NAVY });
    ctx.page.drawText('VÉRTICE', { x: MARGIN, y: A4.height - 44, size: 20, font: bold, color: rgb(1, 1, 1) });
    ctx.page.drawText('INVEST', { x: MARGIN + 92, y: A4.height - 44, size: 20, font, color: ACCENT });
    ctx.page.drawText('Relatório de Imposto de Renda', { x: MARGIN, y: A4.height - 66, size: 11, font, color: rgb(0.8, 0.84, 0.9) });
    ctx.page.drawText(`Ano-base ${report.year}`, { x: MARGIN, y: A4.height - 82, size: 10, font: bold, color: rgb(1, 1, 1) });
    // Bloco direito (contribuinte)
    const rightX = A4.width - MARGIN;
    const hdrName = truncate(user?.name || user?.email || 'Investidor', 10, 220, bold);
    const nameW = bold.widthOfTextAtSize(hdrName, 10);
    ctx.page.drawText(hdrName, { x: rightX - nameW, y: A4.height - 44, size: 10, font: bold, color: rgb(1, 1, 1) });
    const genStr = winAnsi(`Emitido em ${new Date(report.generatedAt).toLocaleDateString('pt-BR')}`);
    const genW = font.widthOfTextAtSize(genStr, 8);
    ctx.page.drawText(genStr, { x: rightX - genW, y: A4.height - 60, size: 8, font, color: rgb(0.7, 0.75, 0.82) });
    ctx.y = A4.height - 96 - 24;

    // --- Resumo (cards) ---
    const s = report.summary;
    const cards = [
        { label: 'DARF a pagar (ano)', value: brl(s.totalDarf), color: s.totalDarf > 0 ? EMERALD : INK },
        { label: 'Proventos isentos', value: brl(s.totalDividends), color: INK },
        { label: 'Custo posição 31/12', value: brl(s.totalPositionCostBRL), color: INK },
        { label: 'Ativos declarados', value: String(s.positionsCount), color: INK },
    ];
    const cardW = (A4.width - MARGIN * 2 - 3 * 10) / 4;
    let cx = MARGIN;
    const cardTop = ctx.y;
    for (const c of cards) {
        ctx.page.drawRectangle({ x: cx, y: cardTop - 44, width: cardW, height: 44, color: ZEBRA, borderColor: LINE, borderWidth: 0.7 });
        ctx.page.drawText(truncate(c.label, 7.5, cardW - 12), { x: cx + 8, y: cardTop - 16, size: 7.5, font, color: MUTED });
        ctx.page.drawText(truncate(c.value, 12, cardW - 12, bold), { x: cx + 8, y: cardTop - 34, size: 12, font: bold, color: c.color });
        cx += cardW + 10;
    }
    ctx.y = cardTop - 44 - 6;

    // --- Seção: Bens e Direitos ---
    sectionTitle('Bens e Direitos — Posição em 31/12', `Declarar pelo CUSTO DE AQUISIÇÃO (preço médio), não pelo valor de mercado. Ano-base ${report.year}.`);
    if (report.positionsByGroup.length === 0) {
        paragraph('Nenhuma posição em aberto em 31/12.');
    } else {
        for (const g of report.positionsByGroup) {
            ensure(28);
            text(`Grupo ${g.grupo} — ${g.groupLabel}`, MARGIN, 9.5, ACCENT, bold);
            textRight(brl(g.totalCost), A4.width - MARGIN, 9.5, INK, bold);
            ctx.y -= 13;
            // cabeçalho da tabela
            const colTicker = MARGIN + 4;
            const colQtyR = MARGIN + 300;
            const colAvgR = MARGIN + 400;
            const colCostR = A4.width - MARGIN - 4;
            text('Ativo', colTicker, 7.5, MUTED, bold);
            textRight('Quantidade', colQtyR, 7.5, MUTED, bold);
            textRight('Preço médio', colAvgR, 7.5, MUTED, bold);
            textRight('Custo total', colCostR, 7.5, MUTED, bold);
            ctx.y -= 11;
            let zebra = false;
            for (const p of g.items) {
                ensure(14);
                if (zebra) ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 3, width: A4.width - MARGIN * 2, height: 13, color: ZEBRA });
                zebra = !zebra;
                text(truncate(`${p.ticker}${p.manualReview ? '  (conferir câmbio)' : ''}`, 8.5, 250), colTicker, 8.5, INK);
                textRight(num(p.quantity, p.quantity % 1 === 0 ? 0 : 6), colQtyR, 8.5, INK);
                textRight(brl(p.avgPrice), colAvgR, 8.5, INK);
                textRight(brl(p.totalCost), colCostR, 8.5, INK, bold);
                ctx.y -= 13;
            }
            ctx.y -= 6;
        }
        paragraph('Discriminação sugerida (exemplo): "QTD ativos de TICKER — custo médio de aquisição R$ X". Códigos grupo/código são sugestões; confirme no programa da Receita.', 7.5, MUTED);
    }

    // --- Seção: Ganhos de Renda Variável (BR) + DARF ---
    sectionTitle('Ganhos Líquidos em Renda Variável (Brasil)', 'Apuração mensal por preço médio. Ações: isenção de vendas ≤ R$20.000/mês (15%). FIIs: 20%. ETF: 15%.');
    if (report.monthly.length === 0) {
        paragraph('Nenhuma venda de renda variável brasileira no ano.');
    } else {
        // Cabeçalho
        const cMonth = MARGIN + 2;
        const cCat = MARGIN + 44;
        const cSalesR = MARGIN + 210;
        const cGainR = MARGIN + 300;
        const cBaseR = MARGIN + 390;
        const cTaxR = A4.width - MARGIN - 2;
        ensure(14);
        text('Mês', cMonth, 7.5, MUTED, bold);
        text('Categoria', cCat, 7.5, MUTED, bold);
        textRight('Vendas', cSalesR, 7.5, MUTED, bold);
        textRight('Ganho/Perda', cGainR, 7.5, MUTED, bold);
        textRight('Base trib.', cBaseR, 7.5, MUTED, bold);
        textRight('Imposto', cTaxR, 7.5, MUTED, bold);
        ctx.y -= 11;
        let zebra = false;
        for (const l of report.monthly) {
            ensure(14);
            if (zebra) ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 3, width: A4.width - MARGIN * 2, height: 13, color: ZEBRA });
            zebra = !zebra;
            const mIdx = parseInt(l.month, 10) - 1;
            text(MONTH_PT[mIdx] || l.month, cMonth, 8, INK);
            text(CATEGORY_PT[l.category] || l.category, cCat, 8, INK);
            textRight(brl(l.sales), cSalesR, 8, INK);
            textRight(brl(l.gain), cGainR, 8, l.gain < 0 ? rgb(0.8, 0.2, 0.2) : INK);
            if (l.exempt) { textRight('isento', cBaseR, 8, EMERALD); textRight('—', cTaxR, 8, MUTED); }
            else { textRight(brl(l.taxableBase), cBaseR, 8, INK); textRight(brl(l.tax), cTaxR, 8, l.tax > 0 ? INK : MUTED, l.tax > 0 ? bold : font); }
            ctx.y -= 13;
        }
        ctx.y -= 6;

        // DARFs
        ensure(20);
        text('DARFs a recolher', MARGIN, 9.5, INK, bold);
        ctx.y -= 14;
        if (report.darf.length === 0) {
            paragraph('Nenhum DARF devido (imposto acumulado abaixo de R$10 ou sem ganho tributável).');
        } else {
            for (const d of report.darf) {
                ensure(14);
                const mIdx = parseInt(d.month, 10) - 1;
                text(`Competência ${MONTH_PT[mIdx]}/${report.year}`, MARGIN + 4, 8.5, INK);
                text(`Código ${d.code}`, MARGIN + 170, 8.5, MUTED);
                text(`Vencimento ${dateBR(d.dueDate)}`, MARGIN + 250, 8.5, MUTED);
                textRight(brl(d.amount), A4.width - MARGIN - 4, 8.5, EMERALD, bold);
                ctx.y -= 13;
            }
        }
        if (report.darfCarryToNextYear > 0) {
            paragraph(`Imposto de ${brl(report.darfCarryToNextYear)} ficou abaixo de R$10,00 e deve ser somado ao DARF do próximo mês/ano.`, 7.5, MUTED);
        }
        const lc = report.lossCarryEndOfYear;
        if (lc.ACOES > 0 || lc.FII > 0 || lc.ETF > 0) {
            paragraph(`Prejuízo a compensar em anos seguintes — Ações: ${brl(lc.ACOES)} · FIIs: ${brl(lc.FII)} · ETF: ${brl(lc.ETF)}.`, 8, INK);
        }
    }

    // --- Seção: Proventos (Isentos) ---
    sectionTitle('Rendimentos Isentos e Não Tributáveis — Proventos', 'Dividendos e rendimentos de FIIs recebidos no ano. (JCP não é distinguido pela fonte — ver avisos.)');
    if (report.dividends.byTicker.length === 0) {
        paragraph('Nenhum provento recebido no ano.');
    } else {
        let zebra = false;
        for (const d of report.dividends.byTicker) {
            ensure(14);
            if (zebra) ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 3, width: A4.width - MARGIN * 2, height: 13, color: ZEBRA });
            zebra = !zebra;
            text(truncate(d.ticker, 8.5, 120, bold), MARGIN + 4, 8.5, INK, bold);
            text(truncate(d.name, 8.5, 300), MARGIN + 110, 8.5, MUTED);
            textRight(brl(d.amount), A4.width - MARGIN - 4, 8.5, INK);
            ctx.y -= 13;
        }
        ctx.y -= 2;
        ctx.page.drawLine({ start: { x: MARGIN, y: ctx.y }, end: { x: A4.width - MARGIN, y: ctx.y }, thickness: 0.7, color: LINE });
        ctx.y -= 12;
        text('Total de proventos isentos', MARGIN + 4, 9, INK, bold);
        textRight(brl(report.dividends.total), A4.width - MARGIN - 4, 9, EMERALD, bold);
        ctx.y -= 14;
    }

    // --- Seção: Conferência manual (exterior/cripto) ---
    if (report.manualReviewItems.length > 0) {
        sectionTitle('Conferência Manual — Exterior e Cripto', 'Ganho de capital NÃO calculado (regras próprias). Valores abaixo são apenas informativos.');
        for (const m of report.manualReviewItems) {
            ensure(14);
            text(CATEGORY_PT[m.category] || m.category, MARGIN + 4, 8.5, INK, bold);
            text(`Vendas no ano: ${brl(m.sales)}`, MARGIN + 120, 8.5, MUTED);
            textRight(`Resultado: ${brl(m.realizedGain)}`, A4.width - MARGIN - 4, 8.5, INK);
            ctx.y -= 13;
        }
        paragraph('Exterior: apure ganho de capital (GCAP) com isenção de R$35.000/mês para vendas no país e regras específicas para o exterior. Cripto: isenção de R$35.000/mês em vendas; acima disso, alíquotas progressivas. Consulte um contador.', 7.5, MUTED);
    }

    // --- Seção: Avisos ---
    sectionTitle('Avisos Importantes', null);
    report.disclaimers.forEach((d, i) => paragraph(`${i + 1}. ${d}`, 7.8, MUTED));

    return pdf.save();
};
