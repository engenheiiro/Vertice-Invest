
import { authService } from './auth';

export const marketService = {
    /**
     * Busca o preço histórico de um ativo em uma data específica.
     */
    async getHistoricalPrice(ticker: string, date: string, type: string) {
        // Normaliza parâmetros
        const params = new URLSearchParams({
            ticker,
            date,
            type
        });

        const response = await authService.api(`/api/market/price?${params.toString()}`);
        
        if (!response.ok) {
            // Se der 404 ou erro, não lança exceção para não travar a UI, apenas retorna null
            return null;
        }
        
        return await response.json();
    },

    /**
     * Busca a cotação atual (Live/Cache) do sistema.
     * Usado quando a data da transação é "Hoje".
     */
    async getCurrentQuote(ticker: string) {
        const response = await authService.api(`/api/market/quote?ticker=${ticker}`);
        if (!response.ok) return null;
        return await response.json();
    },

    /**
     * Inspeciona se um ativo tem cache de histórico e retorna metadados.
     */
    async getAssetCacheStatus(ticker: string) {
        const response = await authService.api(`/api/market/status/${ticker}`);
        if (!response.ok) throw new Error("Erro ao consultar status do cache");
        return await response.json();
    }
};
