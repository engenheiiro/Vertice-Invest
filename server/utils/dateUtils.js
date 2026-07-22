
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

// Interpreta o valor de um <input type="date"> como DIA-CALENDÁRIO, e não como
// meia-noite UTC. `new Date('2026-07-21')` vira 20/07 às 21h em Brasília; ancorar
// ao meio-dia UTC mantém o dia selecionado tanto em UTC quanto nos fusos do Brasil.
// Entradas Date/ISO completas preservam o instante informado.
export const parseCalendarDate = (value) => {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : new Date(value);
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
        if (match) {
            const year = Number(match[1]);
            const month = Number(match[2]);
            const day = Number(match[3]);
            const parsed = new Date(Date.UTC(year, month - 1, day, 12));
            const valid = parsed.getUTCFullYear() === year
                && parsed.getUTCMonth() === month - 1
                && parsed.getUTCDate() === day;
            return valid ? parsed : null;
        }
    }

    if (value === null || value === undefined || value === '') return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

// Dia útil ancorado em UTC. As datas do projeto são "dias puros" à meia-noite UTC
// (dateKeyToUtcDate, brazilDateOnly, brazilToday, calcDate). Usar getDay()/setHours
// (LOCAL) fazia o resultado depender do fuso do PROCESSO: num servidor UTC (prod)
// funcionava, mas num dev em BRT (UTC-3) a meia-noite UTC vira 21h do dia anterior
// → o dia da semana e a contagem retrocediam 1 dia (ex.: renda fixa "rendia" no
// sábado no dev). getUTCDay()/setUTCHours mantêm dev e prod idênticos.
// (Em processo UTC, getDay()===getUTCDay() e setHours(0..)===setUTCHours(0..), então
//  este ajuste é NO-OP em produção — só torna o dev determinístico.)
export const isBusinessDay = (date) => {
    const day = date.getUTCDay();
    if (day === 0 || day === 6) return false; // Sábado ou Domingo

    const isoDate = date.toISOString().split('T')[0];
    if (holidayService.isHoliday(isoDate)) return false; // Feriado

    return true;
};

export const countBusinessDays = (startDate, endDate) => {
    let count = 0;
    const curDate = new Date(startDate);
    const end = new Date(endDate);

    // Normaliza para meia-noite UTC (independe do fuso do processo).
    curDate.setUTCHours(0, 0, 0, 0);
    end.setUTCHours(0, 0, 0, 0);

    // Se datas forem iguais, 0 dias
    if (curDate.getTime() >= end.getTime()) return 0;

    while (curDate < end) {
        curDate.setUTCDate(curDate.getUTCDate() + 1);
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
        result.setUTCDate(result.getUTCDate() + 1);
        if (isBusinessDay(result)) {
            added++;
        }
    }
    return result;
};
