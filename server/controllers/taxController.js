import { buildTaxPdf } from '../services/taxPdfBuilder.js';
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

