// Configuração da API

// Graças ao Proxy configurado no vite.config.ts e ao Express servindo estáticos:
// Não precisamos mais verificar se é localhost.
// Usamos caminhos relativos ("") e o ambiente resolve o resto automaticamente.

export const API_URL = ""; 

// Exemplo:
// fetch(`${API_URL}/api/login`) vira:
// Local: http://localhost:5173/api/login -> Proxy -> http://localhost:5000/api/login
// Prod: https://seu-site.com/api/login -> Backend direto