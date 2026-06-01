
import winston from 'winston';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getRequestId } from '../utils/requestContext.js'; // (D12) correlation id

// Define caminhos absolutos para evitar confusão de diretório
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Sobe um nível de /config para /server e entra em /logs
const logDir = path.join(__dirname, '..', 'logs');

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

const consoleFormat = winston.format.printf(({ level, message, timestamp }) => {
  const time = timestamp.split(' ')[1];
  const rid = getRequestId();
  // (D12) Prefixo curto do correlation id para leitura rápida no console.
  return `[${time}]${rid ? ` [${rid.slice(0, 8)}]` : ''} ${level}: ${message}`;
});

const fileFormat = winston.format.printf(({ level, message, timestamp, stack }) => {
  const rid = getRequestId();
  // (D12) Correlation id completo nos arquivos (para grep/agregação).
  return `${timestamp} [${level.toUpperCase()}]${rid ? ` [req:${rid}]` : ''}: ${message} ${stack ? `\nSTACK: ${stack}` : ''}`;
});

const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.colorize({ all: true }),
  consoleFormat
);

const fileFormatCombined = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.uncolorize(),
  fileFormat
);

const transports = [
  new winston.transports.Console(),
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
];

const logger = winston.createLogger({
  level: level(),
  levels,
  format,
  transports,
});

// Exporta o caminho do diretório para uso em caso de pânico no index.js
export { logDir }; 
export default logger;
