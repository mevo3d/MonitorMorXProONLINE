#!/usr/bin/env node
// services/x-monitor.js - Monitor X Morelos - Servicio X (Twitter)
import dotenv from 'dotenv';
dotenv.config();

import { chromium } from 'playwright';
import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

class XMonitor {
  constructor() {
    this.browser = null;
    this.page = null;
    this.telegram = new TelegramBot(TELEGRAM_TOKEN);
    this.tweetsEnviados = new Set();
    this.palabrasClave = this.cargarPalabrasClave();
    this.retryCount = 0;
    this.maxRetries = 3;
    this.isRunning = false;

    // Sistema de IDs únicos
    this.contadorSecuencial = 1;
    this.idsGenerados = new Set();

    console.log('🐦 X Monitor inicializado');
  }

  cargarPalabrasClave() {
    try {
      const data = fs.readFileSync('keywords.json', 'utf8');
      const config = JSON.parse(data);
      return config.palabras || [];
    } catch (error) {
      console.error('❌ Error cargando keywords.json:', error.message);
      return [];
    }
  }

  async iniciarBrowser() {
    try {
      console.log('🌐 Iniciando navegador para X...');

      this.browser = await chromium.launch({
        headless: false,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu'
        ]
      });

      const context = await this.browser.newContext({
        viewport: { width: 1280, height: 720 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      });

      this.page = await context.newPage();

      // Cargar cookies si existen
      if (fs.existsSync('cookies.json')) {
        const cookies = JSON.parse(fs.readFileSync('cookies.json', 'utf8'));
        await context.addCookies(cookies);
      }

      console.log('✅ Navegador iniciado correctamente');
      return true;

    } catch (error) {
      console.error('❌ Error iniciando navegador:', error.message);
      return false;
    }
  }

  generarIDUnico() {
    const caracteres = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let id;

    do {
      const timestamp = Date.now().toString(36).slice(-3);
      const contador = (this.contadorSecuencial++).toString().padStart(3, '0');
      const random = Array.from({length: 2}, () =>
        caracteres[Math.floor(Math.random() * caracteres.length)]
      ).join('');

      id = timestamp + contador + random;
    } while (this.idsGenerados.has(id));

    this.idsGenerados.add(id);
    return id;
  }

  async verificarLogin() {
    try {
      console.log('🔍 Verificando estado de login en X...');

      await this.page.goto('https://x.com/home', {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });

      // Esperar un momento para que cargue
      await this.page.waitForTimeout(3000);

      // Verificar si estamos logueados (buscar elementos de la timeline)
      const timelineElement = await this.page.$('[data-testid="primaryColumn"]');

      if (timelineElement) {
        console.log('✅ Sesión de X activa');
        return true;
      } else {
        console.log('❌ No hay sesión activa en X');
        return false;
      }

    } catch (error) {
      console.error('❌ Error verificando login:', error.message);
      return false;
    }
  }

  async monitorizarTimeline() {
    try {
      console.log('📡 Iniciando monitorización de timeline...');

      await this.page.goto('https://x.com/MediosMorelos', {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });

      console.log('📱 Timeline de Medios Morelos cargada');

      let lastHeight = 0;
      let scrollCount = 0;
      const maxScrolls = 50;

      while (this.isRunning && scrollCount < maxScrolls) {
        try {
          // Buscar nuevos tweets
          const tweets = await this.page.$$('[data-testid="tweet"]');

          for (let tweet of tweets) {
            try {
              const tweetText = await tweet.textContent() || '';
              const idUnico = this.generarIDUnico();

              // Verificar si contiene palabras clave
              const contieneKeyword = this.palabrasClave.some(keyword =>
                tweetText.toLowerCase().includes(keyword.toLowerCase())
              );

              if (contieneKeyword && !this.tweetsEnviados.has(tweetText)) {
                console.log(`🔍 Tweet encontrado con keyword: ${tweetText.substring(0, 100)}...`);

                await this.procesarTweet(tweet, tweetText, idUnico);
                this.tweetsEnviados.add(tweetText);
              }

            } catch (tweetError) {
              // Ignorar errores individuales de tweets
            }
          }

          // Scroll hacia abajo para cargar más tweets
          const currentHeight = await this.page.evaluate('document.body.scrollHeight');

          if (currentHeight === lastHeight) {
            break; // No hay más contenido
          }

          await this.page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
          await this.page.waitForTimeout(2000);

          lastHeight = currentHeight;
          scrollCount++;

        } catch (scrollError) {
          console.error('⚠️ Error en scroll:', scrollError.message);
          break;
        }
      }

      console.log(`✅ Monitorización completada. ${scrollCount} scrolls realizados`);

    } catch (error) {
      console.error('❌ Error en monitorización:', error.message);
      throw error;
    }
  }

  async procesarTweet(tweet, texto, idUnico) {
    try {
      // Extraer multimedia si existe
      const media = await this.extraerMedia(tweet, idUnico);

      // Enviar a Telegram
      const mensaje = `🐦 **X MORELOS** (${idUnico})\n\n${texto.substring(0, 500)}${texto.length > 500 ? '...' : ''}`;

      if (media.length > 0) {
        for (let mediaFile of media) {
          await this.telegram.sendMediaGroup(TELEGRAM_CHAT_ID, [{
            type: 'photo',
            media: mediaFile
          }]);
        }
      }

      await this.telegram.sendMessage(TELEGRAM_CHAT_ID, mensaje, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      });

      console.log(`✅ Tweet enviado a Telegram: ${idUnico}`);

    } catch (error) {
      console.error('❌ Error procesando tweet:', error.message);
    }
  }

  async extraerMedia(tweet, idUnico) {
    const mediaFiles = [];

    try {
      // Buscar imágenes
      const images = await tweet.$$('[data-testid="tweetPhoto"]');

      for (let i = 0; i < images.length; i++) {
        try {
          const img = await images[i].$('img');
          if (img) {
            const src = await img.getAttribute('src');
            if (src && !src.includes('placeholder')) {
              const filename = `x-${idUnico}-${i + 1}.jpg`;
              const filepath = path.join('media/img', filename);

              // Descargar imagen
              const response = await fetch(src);
              const buffer = await response.arrayBuffer();
              fs.writeFileSync(filepath, Buffer.from(buffer));

              mediaFiles.push(filepath);
            }
          }
        } catch (imgError) {
          console.error('⚠️ Error extrayendo imagen:', imgError.message);
        }
      }

    } catch (error) {
      console.error('⚠️ Error extrayendo media:', error.message);
    }

    return mediaFiles;
  }

  async iniciar() {
    console.log('🚀 Iniciando X Monitor...');
    this.isRunning = true;

    // Crear directorios necesarios
    if (!fs.existsSync('media/img')) {
      fs.mkdirSync('media/img', { recursive: true });
    }

    while (this.isRunning && this.retryCount < this.maxRetries) {
      try {
        // Iniciar navegador
        if (!await this.iniciarBrowser()) {
          throw new Error('No se pudo iniciar el navegador');
        }

        // Verificar login
        if (!await this.verificarLogin()) {
          throw new Error('No hay sesión activa en X');
        }

        // Guardar cookies
        try {
          const cookies = await this.page.context().cookies();
          fs.writeFileSync('cookies.json', JSON.stringify(cookies, null, 2));
        } catch (cookieError) {
          console.error('⚠️ Error guardando cookies:', cookieError.message);
        }

        // Iniciar monitorización
        await this.monitorizarTimeline();

        // Esperar antes del siguiente ciclo
        console.log('⏳ Esperando 60 segundos antes del siguiente ciclo...');
        await new Promise(resolve => setTimeout(resolve, 60000));

      } catch (error) {
        this.retryCount++;
        console.error(`❌ Error ciclo ${this.retryCount}/${this.maxRetries}:`, error.message);

        if (this.retryCount < this.maxRetries) {
          console.log('🔄 Reintentando en 30 segundos...');
          await new Promise(resolve => setTimeout(resolve, 30000));
        } else {
          console.error('❌ Máximo de reintentos alcanzado');
          await this.telegram.sendMessage(
            TELEGRAM_CHAT_ID,
            '❌ Error crítico: X Monitor no pudo reestablecer conexión después de varios intentos'
          );
        }
      }
    }
  }

  async detener() {
    console.log('🛑 Deteniendo X Monitor...');
    this.isRunning = false;

    if (this.browser) {
      await this.browser.close();
    }

    console.log('✅ X Monitor detenido');
  }
}

// Iniciar el servicio
const xMonitor = new XMonitor();

// Manejar señales de cierre
process.on('SIGINT', async () => {
  await xMonitor.detener();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await xMonitor.detener();
  process.exit(0);
});

// Iniciar monitoreo
xMonitor.iniciar().catch(error => {
  console.error('❌ Error fatal en X Monitor:', error);
  process.exit(1);
});