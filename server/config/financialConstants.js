
// Fonte Única da Verdade para Taxas Históricas
// Usado para cálculos de CDI/Selic em períodos fechados onde a API do BC não é consultada ou como fallback.

export const HISTORICAL_CDI_RATES = {
    2015: 14.25,
    2016: 14.00,
    2017: 9.95,
    2018: 6.50,
    2019: 5.96,
    2020: 2.77,
    2021: 4.40, // Ajustado para precisão (algumas fontes citam 4.42, mantendo padrão conservador)
    2022: 12.38,
    2023: 13.03,
    2024: 10.80 
};
