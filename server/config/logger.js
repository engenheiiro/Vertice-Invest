
import winston from 'winston';

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
  info: 'cyan', // Mudado para Cyan para destacar informações gerais
  http: 'magenta',
  debug: 'white',
};

winston.addColors(colors);

// Formato customizado para melhor legibilidade no console
const consoleFormat = winston.format.printf(({ level, message, timestamp }) => {
  // Remove caracteres ISO do timestamp para ficar mais limpo (HH:mm:ss)
  const time = timestamp.split(' ')[1];
  return `[${time}] ${level}: ${message}`;
});

const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  consoleFormat
);

const transports = [
  new winston.transports.Console(),
];

const logger = winston.createLogger({
  level: level(),
  levels,
  format,
  transports,
});

export default logger;
