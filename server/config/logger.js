
import winston from 'winston';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { getRequestId } from '../utils/requestContext.js'; // (D12) correlation id

// Define caminhos absolutos para evitar confusão de diretório
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Sob teste (Vitest), os transports de arquivo apontam para um diretório ISOLADO
// por worker no tmp — não para server/logs. Sem isto: (1) rodar a suíte poluía os
// logs de PRODUÇÃO reais e (2) workers paralelos disputavam o mesmo combined.json.log
// (lock no Windows), causando um flake raro no logger_structured. O basename dos
// arquivos é preservado, então o transport JSON continua sendo "combined.json.log".
const isTest = !!(process.env.VITEST || process.env.NODE_ENV === 'test');
const logDir = isTest
  ? path.join(os.tmpdir(), 'vertice-test-logs', String(process.env.VITEST_WORKER_ID || process.env.VITEST_POOL_ID || process.pid))
  : path.join(__dirname, '..', 'logs');

// Garante que a pasta de logs existe
if (!fs.existsSync(logDir)) {
  try {
    fs.mkdirSync(logDir, { recursive: true });
    console.log(`📁 Pasta de logs criada em: ${logDir}`);
  } catch (err) {
    console.error("❌ ERRO FATAL: Não foi possível criar pasta de logs.", err);
  }
}

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

const level = () => {
  const env = process.env.NODE_ENV || 'development';
  return env === 'development' ? 'debug' : 'info';
};

const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'cyan',
  http: 'magenta',
  debug: 'white',
};

winston.addColors(colors);

// (6.6) Logs estruturados.
// Os call sites podem passar metadados como 2º argumento:
//   logger.info('Scraping concluído', { source: 'fundamentus', count: 350 })
// Esses campos viram colunas pesquisáveis no transport JSON (combined.json.log)
// e aparecem de forma legível (key=value) no console e nos logs de texto.

// Campos estruturais do winston/logger que NÃO são metadados de negócio.
const RESERVED = new Set(['level', 'message', 'timestamp', 'stack', 'requestId']);

// Extrai os metadados (2º arg) e os formata como " | key=value" para os logs de
// texto. Objetos aninhados são serializados em JSON compacto.
const formatMeta = (info) => {
  const keys = Object.keys(info).filter((k) => !RESERVED.has(k));
  if (keys.length === 0) return '';
  const pairs = keys.map((k) => {
    const v = info[k];
    return `${k}=${v !== null && typeof v === 'object' ? JSON.stringify(v) : v}`;
  });
  return ` | ${pairs.join(' ')}`;
};

// (D12 + 6.6) Promove o correlation id a CAMPO estruturado (info.requestId),
// não apenas a um prefixo de texto — assim ele é filtrável no JSON.
const injectRequestId = winston.format((info) => {
  const rid = getRequestId();
  if (rid) info.requestId = rid;
  return info;
});

// Campos comuns a todos os transports (id de request, timestamp, stack de erro).
const baseFields = winston.format.combine(
  injectRequestId(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
);

const consoleFormat = winston.format.printf((info) => {
  const time = (info.timestamp || '').split(' ')[1] || info.timestamp;
  // (D12) Prefixo curto do correlation id para leitura rápida no console.
  const rid = info.requestId ? ` [${info.requestId.slice(0, 8)}]` : '';
  return `[${time}]${rid} ${info.level}: ${info.message}${formatMeta(info)}`;
});

const fileFormat = winston.format.printf((info) => {
  // (D12) Correlation id completo nos arquivos (para grep/agregação).
  const rid = info.requestId ? ` [req:${info.requestId}]` : '';
  return `${info.timestamp} [${info.level.toUpperCase()}]${rid}: ${info.message}${formatMeta(info)}${info.stack ? `\nSTACK: ${info.stack}` : ''}`;
});

// Console — legível e colorido.
const consoleCombined = winston.format.combine(
  baseFields,
  winston.format.colorize({ all: true }),
  consoleFormat
);

// Arquivos de texto — legíveis, sem cor.
const fileFormatCombined = winston.format.combine(
  baseFields,
  winston.format.uncolorize(),
  fileFormat
);

// (6.6) Arquivo ESTRUTURADO em JSON — uma linha por evento, pronta para busca e
// agregação (jq, Loki, Datadog, etc.). requestId e os metadados do 2º arg viram
// campos de primeira classe.
const jsonCombined = winston.format.combine(
  baseFields,
  winston.format.json()
);

const transports = [
  new winston.transports.Console({ format: consoleCombined }),
  new winston.transports.File({
    filename: path.join(logDir, 'error.log'),
    level: 'error',
    format: fileFormatCombined,
    maxsize: 5242880,
    maxFiles: 5,
  }),
  new winston.transports.File({
    filename: path.join(logDir, 'combined.log'),
    format: fileFormatCombined,
    maxsize: 5242880,
    maxFiles: 5,
  }),
  new winston.transports.File({
    filename: path.join(logDir, 'combined.json.log'),
    format: jsonCombined,
    maxsize: 5242880,
    maxFiles: 5,
  }),
];

const logger = winston.createLogger({
  level: level(),
  levels,
  transports,
});

// Exporta o caminho do diretório para uso em caso de pânico no index.js
export { logDir };
export default logger;
