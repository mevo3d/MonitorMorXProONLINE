// src/services/x-monitor.js - Monitor de X con Playwright Headless para Servidor
import dotenv from 'dotenv';
dotenv.config();

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import deduplicator from '../utils/deduplicator.js';
import { logger, tweetLogger } from '../utils/logger.js';
import axios from 'axios';

class XMonitorService {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.isRunning = false;
    this.retryCount = 0;
    this.maxRetries = parseInt(process.env.MAX_RETRIES) || 3;

    // Configuración
    this.targetAccount = process.env.X_TARGET_ACCOUNT || 'MediosMorelos';
    this.intervalMinutes = parseInt(process.env.MONITOR_INTERVAL_MINUTES) || 5;
    this.scrollsPerCycle = parseInt(process.env.SCROLL_TWEETS_PER_CYCLE) || 20;
    this.headless = process.env.HEADLESS !== 'false'; // Siempre true en servidor

    // Palabras clave
    this.keywords = this.loadKeywords();

    // Contadores
    this.stats = {
      tweetsProcessed: 0,
      tweetsMatched: 0,
      tweetsDownloaded: 0,
      duplicatesFound: 0,
      errors: 0
    };

    logger.info('🐦 X Monitor Service inicializado', {
      targetAccount: this.targetAccount,
      interval: this.intervalMinutes,
      headless: this.headless
    });
  }

  /**
   * Carga palabras clave desde archivo JSON
   */
  loadKeywords() {
    try {
      const keywordsPath = path.join(process.cwd(), 'keywords.json');
      const data = fs.readFileSync(keywordsPath, 'utf8');
      const config = JSON.parse(data);
      const keywords = config.palabras_clave || [];
      logger.info(`✅ ${keywords.length} palabras clave cargadas`);
      return keywords;
    } catch (error) {
      logger.error('❌ Error cargando keywords.json:', error.message);
      return [];
    }
  }

  /**
   * Recarga palabras clave
   */
  reloadKeywords() {
    this.keywords = this.loadKeywords();
    logger.info(`🔄 Keywords recargadas: ${this.keywords.length}`);
  }

  /**
   * Inicializa navegador en modo headless
   */
  async initBrowser() {
    try {
      logger.info('🌐 Iniciando navegador Chromium headless...');

      this.browser = await chromium.launch({
        headless: this.headless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--window-size=1920,1080'
        ]
      });

      this.context = await this.browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      });

      // Cargar cookies si existen
      const cookiesPath = path.join(process.cwd(), 'config', 'cookies.json');
      if (fs.existsSync(cookiesPath)) {
        const cookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf8'));
        await this.context.addCookies(cookies);
        logger.info('✅ Cookies cargadas');
      }

      this.page = await this.context.newPage();

      // Set timeout defaults
      this.page.setDefaultTimeout(parseInt(process.env.NAVIGATION_TIMEOUT_MS) || 60000);
      this.page.setDefaultNavigationTimeout(parseInt(process.env.NAVIGATION_TIMEOUT_MS) || 60000);

      logger.info('✅ Navegador iniciado correctamente');
      return true;

    } catch (error) {
      logger.error('❌ Error iniciando navegador:', error);
      throw error;
    }
  }

  /**
   * Verifica si hay sesión activa en X
   */
  async verifySession() {
    try {
      logger.info('🔍 Verificando sesión de X...');

      await this.page.goto('https://x.com/home', {
        waitUntil: 'networkidle',
        timeout: 30000
      });

      await this.page.waitForTimeout(3000);

      // Verificar si estamos logueados buscando elementos de la timeline
      const timelineElement = await this.page.$('[data-testid="primaryColumn"]');

      if (timelineElement) {
        logger.info('✅ Sesión de X activa');
        return true;
      }

      // Si no hay timeline, verificar si estamos en página de login
      const isLoginPage = await this.page.$('input[autocomplete="username"]');

      if (isLoginPage) {
        logger.warn('⚠️ No hay sesión activa, se requiere login manual');
        // En servidor, lanzar error porque no se puede hacer login interactivo
        throw new Error('Sesión de X expirada. Se requiere re-autenticación manual.');
      }

      return false;

    } catch (error) {
      logger.error('❌ Error verificando sesión:', error.message);
      throw error;
    }
  }

  /**
   * Verifica si el tweet coincide con alguna palabra clave
   * @param {string} text - Texto del tweet
   * @returns {boolean} True si hay coincidencia
   */
  matchKeywords(text) {
    if (!text) return false;

    const textLower = text.toLowerCase();

    for (const keyword of this.keywords) {
      if (textLower.includes(keyword.toLowerCase())) {
        return keyword; // Retornar la palabra que coincidió
      }
    }

    return null;
  }

  /**
   * Descarga media (imagen/video) desde URL
   * @param {string} url - URL del media
   * @param {string} tweetId - ID del tweet
   * @param {string} type - 'img' o 'video'
   * @returns {string|null} Ruta local del archivo descargado
   */
  async downloadMedia(url, tweetId, type = 'img') {
    try {
      const date = new Date();
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');

      const basePath = process.env.MEDIA_BASE_PATH || './media';
      const mediaPath = path.join(basePath, String(year), type);

      // Crear directorio si no existe
      if (!fs.existsSync(mediaPath)) {
        fs.mkdirSync(mediaPath, { recursive: true });
      }

      // Generar nombre de archivo único
      const ext = type === 'video' ? '.mp4' : '.jpg';
      const filename = `${tweetId}_${Date.now()}${ext}`;
      const filePath = path.join(mediaPath, filename);

      // Descargar usando axios
      const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream',
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
        }
      });

      // Guardar archivo
      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
          logger.info(`📥 Media descargado: ${filename}`);
          this.stats.tweetsDownloaded++;
          resolve(filePath);
        });
        writer.on('error', reject);
      });

    } catch (error) {
      logger.error(`❌ Error descargando media (${type}):`, error.message);
      return null;
    }
  }

  /**
   * Procesa un tweet individual
   * @param {Object} tweetElement - Elemento del tweet
   */
  async processTweet(tweetElement) {
    try {
      // Extraer datos del tweet
      const text = await tweetElement.evaluate(el => {
        const textEl = el.querySelector('[data-testid="tweetText"]');
        return textEl ? textEl.innerText : '';
      });

      const author = await tweetElement.evaluate(el => {
        const authorEl = el.querySelector('[data-testid="User-Name"]');
        return authorEl ? authorEl.innerText : '';
      });

      const timeEl = await tweetElement.$('time');
      const timestamp = timeEl ? await timeEl.getAttribute('datetime') : new Date().toISOString();

      // Extraer URLs de media
      const mediaUrls = await tweetElement.evaluate(el => {
        const images = Array.from(el.querySelectorAll('[data-testid="tweetPhoto"] img'));
        const videos = Array.from(el.querySelectorAll('video'));

        return [
          ...images.map(img => img.src),
          ...videos.map(video => video.src || video.poster)
        ].filter(Boolean);
      });

      // Crear objeto de tweet
      const tweet = {
        id: `tweet_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        text,
        author,
        timestamp,
        mediaUrls,
        url: null // Se puede extraer el link del tweet
      };

      // Verificar duplicados
      const dedupResult = deduplicator.processTweet(tweet);

      if (dedupResult.isDuplicate) {
        this.stats.duplicatesFound++;
        return null;
      }

      // Verificar keywords
      const matchedKeyword = this.matchKeywords(text);

      if (!matchedKeyword) {
        this.stats.tweetsProcessed++;
        return null;
      }

      // ¡COINCIDENCIA! Procesar tweet
      this.stats.tweetsMatched++;
      logger.info(`🎯 COINCIDENCIA: "${matchedKeyword}"`, {
        author: author.split('\n')[0],
        text: text.substring(0, 100)
      });

      // Descargar media si existe
      const downloadedFiles = [];
      for (const [index, mediaUrl] of mediaUrls.entries()) {
        const type = mediaUrl.includes('video') || mediaUrl.includes('mp4') ? 'video' : 'img';
        const filePath = await this.downloadMedia(mediaUrl, tweet.id, type);
        if (filePath) {
          downloadedFiles.push(filePath);
        }
      }

      // Log en archivo especial de tweets
      tweetLogger.info('Tweet procesado', {
        id: tweet.id,
        author,
        text,
        keyword: matchedKeyword,
        mediaCount: downloadedFiles.length,
        timestamp
      });

      // Retornar tweet procesado para notificación
      return {
        ...tweet,
        matchedKeyword,
        downloadedFiles,
        hash: dedupResult.hash
      };

    } catch (error) {
      logger.error('❌ Error procesando tweet:', error.message);
      this.stats.errors++;
      return null;
    }
  }

  /**
   * Ciclo principal de monitoreo
   */
  async monitorCycle() {
    try {
      logger.info('📡 Iniciando ciclo de monitoreo...');

      // Ir al timeline del objetivo
      const targetUrl = `https://x.com/${this.targetAccount}`;
      await this.page.goto(targetUrl, {
        waitUntil: 'networkidle',
        timeout: 30000
      });

      logger.info(`📱 Timeline cargada: @${this.targetAccount}`);

      // Scroll y procesar tweets
      let scrollCount = 0;
      const matchedTweets = [];

      while (scrollCount < this.scrollsPerCycle && this.isRunning) {
        try {
          // Buscar tweets en la página actual
          const tweets = await this.page.$$('[data-testid="tweet"]');

          if (tweets.length === 0) {
            await this.page.waitForTimeout(2000);
            continue;
          }

          // Procesar tweets nuevos
          for (const tweet of tweets) {
            if (!this.isRunning) break;

            const processed = await this.processTweet(tweet);
            if (processed) {
              matchedTweets.push(processed);
            }
          }

          // Scroll hacia abajo
          await this.page.evaluate(() => {
            window.scrollBy(0, window.innerHeight);
          });

          await this.page.waitForTimeout(2000); // Esperar carga de nuevos tweets
          scrollCount++;

          logger.debug(`Scroll ${scrollCount}/${this.scrollsPerCycle}, tweets procesados: ${this.stats.tweetsProcessed}`);

        } catch (error) {
          logger.error('❌ Error en scroll:', error.message);
          break;
        }
      }

      logger.info(`✅ Ciclo completado: ${matchedTweets.length} coincidencias encontradas`);
      return matchedTweets;

    } catch (error) {
      logger.error('❌ Error en ciclo de monitoreo:', error);
      throw error;
    }
  }

  /**
   * Inicia el servicio de monitoreo
   */
  async start() {
    try {
      this.isRunning = true;

      // Iniciar navegador
      await this.initBrowser();

      // Verificar sesión
      const hasSession = await this.verifySession();
      if (!hasSession) {
        throw new Error('No hay sesión activa en X');
      }

      // Iniciar ciclos de monitoreo
      logger.info(`🚀 Iniciando monitoreo cada ${this.intervalMinutes} minutos...`);

      while (this.isRunning) {
        try {
          const matchedTweets = await this.monitorCycle();

          // Enviar notificaciones con los tweets coincidentes
          for (const tweet of matchedTweets) {
            // Aquí se puede emitir evento o llamar al notifier
            logger.info('📤 Tweet para notificar:', tweet.id);
          }

          // Esperar para el siguiente ciclo
          if (this.isRunning) {
            logger.info(`⏰ Esperando ${this.intervalMinutes} minutos para siguiente ciclo...`);
            await new Promise(resolve => setTimeout(resolve, this.intervalMinutes * 60 * 1000));
          }

        } catch (error) {
          logger.error('❌ Error en ciclo:', error);

          if (this.retryCount < this.maxRetries) {
            this.retryCount++;
            logger.warn(`🔄 Reintentando (${this.retryCount}/${this.maxRetries}) en 30 segundos...`);
            await new Promise(resolve => setTimeout(resolve, 30000));
          } else {
            logger.error('❌ Máximo de reintentos alcanzado, deteniendo servicio');
            throw error;
          }
        }
      }

    } catch (error) {
      logger.error('❌ Error fatal en X Monitor:', error);
      throw error;
    }
  }

  /**
   * Detiene el servicio
   */
  async stop() {
    logger.info('🛑 Deteniendo X Monitor Service...');
    this.isRunning = false;

    if (this.browser) {
      await this.browser.close();
      logger.info('✅ Navegador cerrado');
    }

    logger.info('📊 Estadísticas finales:', this.stats);
  }

  /**
   * Obtiene estadísticas del servicio
   */
  getStats() {
    return {
      ...this.stats,
      uptime: process.uptime(),
      deduplicator: deduplicator.getStats()
    };
  }
}

// Exportar instancia única
const xMonitor = new XMonitorService();

// Manejo de shutdown graceful
process.on('SIGINT', async () => {
  logger.info('⚠️ SIGINT recibido, deteniendo X Monitor...');
  await xMonitor.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('⚠️ SIGTERM recibido, deteniendo X Monitor...');
  await xMonitor.stop();
  process.exit(0);
});

export default xMonitor;
