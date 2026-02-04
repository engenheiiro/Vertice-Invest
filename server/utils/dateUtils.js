
import { holidayService } from '../services/holidayService.js';

// Inicializa o serviço na primeira importação
holidayService.sync();

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
