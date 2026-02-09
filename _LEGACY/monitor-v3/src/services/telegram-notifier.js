// src/services/telegram-notifier.js - Servicio de Notificaciones por Telegram
import dotenv from 'dotenv';
dotenv.config();

import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

class TelegramNotifierService {
  constructor() {
    this.token = process.env.TELEGRAM_TOKEN;
    this.chatId = process.env.TELEGRAM_CHAT_ID;
    this.bot = new TelegramBot(this.token, { polling: false }); // No polling, solo enviar
    this.isRunning = false;

    // Contadores
    this.stats = {
      mensajesEnviados: 0,
      errores: 0,
      ultimaNotificacion: null
    };

    logger.info('📱 Telegram Notifier Service inicializado');
  }

  /**
   * Inicia el servicio (escucha comandos)
   */
  async start() {
    try {
      this.isRunning = true;

      // Enviar mensaje de inicio
      await this.enviarMensajeInicio();

      logger.info('✅ Telegram Notifier iniciado');

    } catch (error) {
      logger.error('❌ Error iniciando Telegram Notifier:', error);
      throw error;
    }
  }

  /**
   * Envía mensaje de inicio del sistema
   */
  async enviarMensajeInicio() {
    const mensaje = `
🚀 *Monitor Legislativo Morelos v3.0*

Sistema iniciado correctamente

✅ Servicios activos:
• X (Twitter) Monitor
• Telegram Notifier

⚙️ Configuración:
• Cuenta objetivo: @${process.env.X_TARGET_ACCOUNT || 'MediosMorelos'}
• Intervalo: ${process.env.MONITOR_INTERVAL_MINUTES || 5} minutos
• Palabras clave: ${this.contarKeywords()}

_Uso: /help para ver comandos disponibles_
    `.trim();

    await this.sendMessage(mensaje, 'Markdown');
  }

  /**
   * Cuenta palabras clave
   */
  contarKeywords() {
    try {
      const keywordsPath = path.join(process.cwd(), 'keywords.json');
      const data = JSON.parse(fs.readFileSync(keywordsPath, 'utf8'));
      return data.palabras_clave?.length || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Carga palabras clave desde archivo
   */
  getKeywords() {
    try {
      const keywordsPath = path.join(process.cwd(), 'keywords.json');
      const data = JSON.parse(fs.readFileSync(keywordsPath, 'utf8'));
      return data.palabras_clave || [];
    } catch (error) {
      logger.error('❌ Error cargando keywords:', error.message);
      return [];
    }
  }

  /**
   * Envía notificación de tweet coincidente
   * @param {Object} tweet - Tweet procesado
   */
  async notifyTweet(tweet) {
    try {
      const { author, text, matchedKeyword, downloadedFiles, timestamp } = tweet;

      let mensaje = `
🐦 *COINCIDENCIA EN X*

🔑 *Keyword:* ${matchedKeyword}

👤 *Autor:* ${author.split('\n')[0]}

📝 *Texto:*
${text.length > 300 ? text.substring(0, 300) + '...' : text}

🕐 ${new Date(timestamp).toLocaleString('es-MX')}
      `.trim();

      // Enviar mensaje de texto
      await this.sendMessage(mensaje, 'Markdown');

      // Enviar imágenes si existen
      for (const filePath of downloadedFiles) {
        if (filePath && fs.existsSync(filePath)) {
          await this.sendPhoto(filePath);
          await new Promise(resolve => setTimeout(resolve, 1000)); // Evitar flood
        }
      }

      this.stats.mensajesEnviados++;
      this.stats.ultimaNotificacion = new Date().toISOString();

      logger.info(`📤 Notificación enviada: ${tweet.id}`);

    } catch (error) {
      logger.error('❌ Error enviando notificación:', error.message);
      this.stats.errores++;
    }
  }

  /**
   * Envía mensaje de texto simple
   * @param {string} text - Texto del mensaje
   * @param {string} parseMode - 'Markdown' o 'HTML'
   */
  async sendMessage(text, parseMode = 'Markdown') {
    try {
      await this.bot.sendMessage(this.chatId, text, { parse_mode: parseMode });
      this.stats.mensajesEnviados++;
    } catch (error) {
      logger.error('❌ Error enviando mensaje:', error.message);
      this.stats.errores++;
      throw error;
    }
  }

  /**
   * Envía foto
   * @param {string} filePath - Ruta de la imagen
   * @param {string} caption - Pie de foto (opcional)
   */
  async sendPhoto(filePath, caption = '') {
    try {
      await this.bot.sendPhoto(this.chatId, filePath, { caption });
      this.stats.mensajesEnviados++;
    } catch (error) {
      logger.error('❌ Error enviando foto:', error.message);
      this.stats.errores++;
    }
  }

  /**
   * Envía reporte de estado
   */
  async sendStatus(xMonitorStats, deduplicatorStats) {
    const uptime = Math.floor(process.uptime());
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);

    const mensaje = `
📊 *ESTADO DEL SISTEMA*

⏱ *Uptime:* ${hours}h ${minutes}m

🐦 *X Monitor Stats:*
• Tweets procesados: ${xMonitorStats.tweetsProcessed}
• Coincidencias: ${xMonitorStats.tweetsMatched}
• Media descargado: ${xMonitorStats.tweetsDownloaded}
• Duplicados: ${xMonitorStats.duplicatesFound}
• Errores: ${xMonitorStats.errors}

🔍 *Deduplicador:*
• Hashes en caché: ${deduplicatorStats.totalHashes}
• Uso: ${deduplicatorStats.usagePercentage}%

📱 *Telegram Stats:*
• Mensajes enviados: ${this.stats.mensajesEnviados}
• Errores: ${this.stats.errores}
• Última notificación: ${this.stats.ultimaNotificacion ? new Date(this.stats.ultimaNotificacion).toLocaleString('es-MX') : 'N/A'}

_Última actualización: ${new Date().toLocaleString('es-MX')}_
    `.trim();

    await this.sendMessage(mensaje, 'Markdown');
  }

  /**
   * Envía lista de palabras clave
   */
  async sendKeywords() {
    const keywords = this.getKeywords();

    let mensaje = `🔑 *PALABRAS CLAVE* (${keywords.length})\n\n`;

    // Agrupar de 20 en 20 para evitar mensajes muy largos
    const chunks = [];
    for (let i = 0; i < keywords.length; i += 20) {
      const chunk = keywords.slice(i, i + 20).map((k, idx) => `${i + idx + 1}. ${k}`).join('\n');
      chunks.push(chunk);
    }

    // Enviar primer chunk con encabezado
    await this.sendMessage(mensaje + chunks[0], 'Markdown');

    // Enviar resto de chunks
    for (let i = 1; i < chunks.length; i++) {
      await this.sendMessage(chunks[i], 'Markdown');
    }

    logger.info(`📤 Lista de keywords enviada (${keywords.length} palabras)`);
  }

  /**
   * Detiene el servicio
   */
  async stop() {
    logger.info('🛑 Deteniendo Telegram Notifier...');
    this.isRunning = false;

    // Enviar mensaje de apagado
    await this.sendMessage('⚠️ Sistema detenido', 'Markdown');

    logger.info('✅ Telegram Notifier detenido');
  }

  /**
   * Obtiene estadísticas
   */
  getStats() {
    return this.stats;
  }
}

// Exportar instancia única
const telegramNotifier = new TelegramNotifierService();

export default telegramNotifier;
