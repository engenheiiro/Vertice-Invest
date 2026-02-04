
import axios from 'axios';
import logger from '../config/logger.js';

// Lista de Fallback (Caso a API falhe)
const FALLBACK_HOLIDAYS = [
    '2024-01-01', '2024-02-12', '2024-02-13', '2024-03-29', '2024-04-21', '2024-05-01', '2024-05-30', '2024-09-07', '2024-10-12', '2024-11-02', '2024-11-15', '2024-11-20', '2024-12-25',
    '2025-01-01', '2025-03-03', '2025-03-04', '2025-04-18', '2025-04-21', '2025-05-01', '2025-06-19', '2025-09-07', '2025-10-12', '2025-11-02', '2025-11-15', '2025-11-20', '2025-12-25',
    '2026-01-01', '2026-02-16', '2026-02-17', '2026-04-03', '2026-04-21', '2026-05-01', '2026-06-04', '2026-09-07', '2026-10-12', '2026-11-02', '2026-11-15', '2026-11-20', '2026-12-25'
];

class HolidayService {
    constructor() {
        this.holidays = new Set(FALLBACK_HOLIDAYS);
        this.lastSync = null;
    }

    async sync() {
        try {
            const currentYear = new Date().getFullYear();
            const years = [currentYear, currentYear + 1];
            let count = 0;

            for (const year of years) {
                const response = await axios.get(`https://brasilapi.com.br/api/feriados/v1/${year}`, { timeout: 5000 });
                if (response.data && Array.isArray(response.data)) {
                    response.data.forEach(h => {
                        this.holidays.add(h.date);
                        count++;
                    });
                }
            }
            
            this.lastSync = new Date();
            logger.info(`📅 [HolidayService] Sincronizado com sucesso via API. ${this.holidays.size} feriados em cache.`);
        } catch (error) {
            logger.warn(`⚠️ [HolidayService] Falha ao buscar API externa: ${error.message}. Usando fallback local.`);
        }
    }

    isHoliday(dateStr) {
        // dateStr deve ser YYYY-MM-DD
        return this.holidays.has(dateStr);
    }

    getHolidays() {
        return Array.from(this.holidays).sort();
    }
}

export const holidayService = new HolidayService();
