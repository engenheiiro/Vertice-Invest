// Configuração da API
// Quando você fizer o deploy do Backend no Render, copie a URL gerada (ex: https://vertice-api.onrender.com)
// e cole abaixo na variável PROD_URL.

const PROD_URL = "https://SEU_APP_NO_RENDER.onrender.com"; 
const DEV_URL = "http://localhost:5000";

// Lógica simples: Se estivermos rodando localmente (localhost ou 127.0.0.1), use DEV_URL.
// Caso contrário, assume produção.
const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

export const API_URL = isLocalhost ? DEV_URL : PROD_URL;

console.log(`🔌 Conectando API em: ${API_URL}`);