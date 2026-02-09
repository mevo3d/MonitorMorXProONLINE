// src/utils/logger.js - Sistema de logging avanzado con Winston
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Obtener variables de entorno
const logLevel = process.env.LOG_LEVEL || 'info';
const logsPath = process.env.LOGS_PATH || path.join(__dirname, '../../logs');

// Formato personalizado para logs
const customFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Formato para consola (más legible)
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...metadata }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(metadata).length > 0) {
      msg += ` ${JSON.stringify(metadata)}`;
    }
    return msg;
  })
);

// Transporte: Archivo rotativo para errores
const errorTransport = new DailyRotateFile({
  filename: path.join(logsPath, 'error-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  level: 'error',
  maxSize: process.env.LOG_MAX_SIZE || '20m',
  maxFiles: process.env.LOG_MAX_FILES || '14d',
  format: customFormat
});

// Transporte: Archivo rotativo para todos los logs
const combinedTransport = new DailyRotateFile({
  filename: path.join(logsPath, 'combined-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: process.env.LOG_MAX_SIZE || '20m',
  maxFiles: process.env.LOG_MAX_FILES || '14d',
  format: customFormat
});

// Transporte: Archivo rotativo para tweets procesados
const tweetsTransport = new DailyRotateFile({
  filename: path.join(logsPath, 'tweets-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: process.env.LOG_MAX_SIZE || '20m',
  maxFiles: process.env.LOG_MAX_FILES || '30d',
  format: customFormat
});

// Transporte: Archivo rotativo para duplicados
const duplicatesTransport = new DailyRotateFile({
  filename: path.join(logsPath, 'duplicates-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: process.env.LOG_MAX_SIZE || '20m',
  maxFiles: process.env.LOG_MAX_FILES || '30d',
  format: customFormat
});

// Crear logger principal
const logger = winston.createLogger({
  level: logLevel,
  format: customFormat,
  transports: [
    errorTransport,
    combinedTransport
  ],
  exitOnError: false
});

// Agregar transporte de consola en desarrollo
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: consoleFormat
  }));
}

// Logger especializado para tweets
const tweetLogger = winston.createLogger({
  level: 'info',
  format: customFormat,
  transports: [tweetsTransport],
  exitOnError: false
});

// Logger especializado para duplicados
const duplicateLogger = winston.createLogger({
  level: 'info',
  format: customFormat,
  transports: [duplicatesTransport],
  exitOnError: false
});

export { logger, tweetLogger, duplicateLogger };
export default logger;
