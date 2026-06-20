
import { holidayService } from '../services/holidayService.js';

// Inicializa o serviço na primeira importação
holidayService.sync();

/**
 * (6.10) Utilitário ÚNICO de datas. Antes a base misturava
 * `x.toISOString().split('T')[0]`, `setHours(0,0,0,0)` e parsing ad-hoc espalhados
 * por vários serviços. Centralize aqui.
 *
 * Convenção de timezone do projeto:
 *  - CHAVE DE DIA (`toDateKey`): derivada de toISOString → base UTC. Use para
 *    comparar/agrupar por dia, indexar mapas (dividendos, séries, snapshots).
 *    Comparações entre chaves geradas por esta função são sempre consistentes.
 *  - MEIA-NOITE LOCAL (`startOfDay`): 00:00 no fuso do processo. Use para
 *    cursores de iteração e janelas "desde o início do dia".
 */

// Converte uma data (Date|string|number) em chave ISO `YYYY-MM-DD` (base UTC).
// Retorna null para entrada vazia/ inválida (em vez de lançar).
export const toDateKey = (date) => {
    if (!date) return null;
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().split('T')[0];
};

// Normaliza para a meia-noite LOCAL (00:00:00.000), devolvendo um NOVO Date.
export const startOfDay = (date) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
};

// Interpreta uma chave `YYYY-MM-DD` como meia-noite UTC desse dia (Date estável,
// sem deslize de fuso). Útil para reconstruir um Date a partir de uma chave.
export const dateKeyToUtcDate = (date) => {
    const key = toDateKey(date);
    return key ? new Date(`${key}T00:00:00.000Z`) : null;
};

export const isBusinessDay = (date) => {
    const day = date.getDay();
    if (day === 0 || day === 6) return false; // Sábado ou Domingo
    
    const isoDate = date.toISOString().split('T')[0];
    if (holidayService.isHoliday(isoDate)) return false; // Feriado

    return true;
};

export const countBusinessDays = (startDate, endDate) => {
    let count = 0;
    const curDate = new Date(startDate);
    const end = new Date(endDate);
    
    // Normaliza horas para evitar problemas de fuso
    curDate.setHours(0,0,0,0);
    end.setHours(0,0,0,0);

    // Se datas forem iguais, 0 dias
    if (curDate.getTime() >= end.getTime()) return 0;

    while (curDate < end) {
        curDate.setDate(curDate.getDate() + 1);
        if (isBusinessDay(curDate)) {
            count++;
        }
    }
    return count;
};

export const addBusinessDays = (date, days) => {
    const result = new Date(date);
    let added = 0;
    while (added < days) {
        result.setDate(result.getDate() + 1);
        if (isBusinessDay(result)) {
            added++;
        }
    }
    return result;
};
