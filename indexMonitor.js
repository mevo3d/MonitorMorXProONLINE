import dotenv from 'dotenv';
dotenv.config();

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import TelegramBot from 'node-telegram-bot-api';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import crypto from 'crypto';
import winston from 'winston';
import { exec } from 'child_process';
import https from 'https';
import EstadisticasMedios from './EstadisticasMedios.js';
import { createWorker } from 'tesseract.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Logger para errores
const logger = winston.createLogger({
  level: 'error',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

// Variables globales
let browser = null;
let page = null;
let context = null;
let bot = null;
let heartbeatInterval = null;
let scrollInterval = null;
let checkInterval = null;
let sessionSaveInterval = null;
let nextScrollTime = 0; // Para el temporizador visual
let ocrWorker = null; // Worker de Tesseract reutilizable
let crashCount = 0;
const MAX_CRASH_RETRIES = 100;

// Configuración
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
// URL del Deck de X Pro (Medios Morelos)
const TWITTER_PRO_URL = 'https://pro.x.com/i/decks/1853883906551898346';
const KEYWORDS_FILE = 'keywords.json';
const STORAGE_DIR = path.join(__dirname, 'storage');
const STORAGE_STATE_PATH = path.join(STORAGE_DIR, 'xpro-session.json');
const X_USERNAME = process.env.X_USERNAME;
const X_PASSWORD = process.env.X_PASSWORD;

// Sistema de recuperación ante errores
class ErrorRecoverySystem {
  constructor() {
    this.lastHeartbeat = Date.now();
    this.errors = [];
    this.maxErrors = 10;
  }

  recordError(error) {
    this.errors.push({
      timestamp: Date.now(),
      error: error.message,
      stack: error.stack
    });

    // Mantener solo los últimos errores
    if (this.errors.length > this.maxErrors) {
      this.errors.shift();
    }

    logger.error('Error registrado:', error);
  }

  shouldRestart() {
    // Si hay muchos errores recientes, reiniciar
    const recentErrors = this.errors.filter(e =>
      Date.now() - e.timestamp < 60000 // Últimos 60 segundos
    );
    return recentErrors.length >= 5;
  }

  updateHeartbeat() {
    this.lastHeartbeat = Date.now();
  }

  isAlive() {
    return Date.now() - this.lastHeartbeat < 120000; // 2 minutos
  }
}

const recoverySystem = new ErrorRecoverySystem();

// Función para limpiar recursos
async function limpiarRecursos() {
  console.log('🧹 Limpiando recursos...');

  // Limpiar intervalos
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  if (scrollInterval) clearInterval(scrollInterval);
  if (checkInterval) clearInterval(checkInterval);
  if (sessionSaveInterval) clearInterval(sessionSaveInterval);

  heartbeatInterval = null;
  scrollInterval = null;
  checkInterval = null;
  sessionSaveInterval = null;

  // Guardar sesión antes de cerrar
  try {
    if (context && page) {
      console.log('💾 Guardando sesión antes de cerrar...');
      await guardarSesionXPro();
    }
  } catch (error) {
    console.error('Error guardando sesión final:', error.message);
  }

  // Cerrar navegador
  try {
    if (page) await page.close();
    if (context) await context.close();
    if (browser) await browser.close();

    page = null;
    context = null;
    browser = null;
  } catch (error) {
    console.error('Error cerrando navegador:', error.message);
  }

  console.log('✅ Recursos limpiados');
}

// Función principal con reinicio automático
async function iniciarMonitorConRecuperacion() {
  // Inicializar Worker de OCR una sola vez
  if (!ocrWorker) {
    console.log('👁️ Inicializando motor OCR (Tesseract)...');
    try {
      ocrWorker = await createWorker('spa');
      console.log('✅ Motor OCR listo');
    } catch (e) {
      console.error('❌ Error iniciando OCR:', e.message);
    }
  }

  while (crashCount < MAX_CRASH_RETRIES) {
    try {
      console.log(`\n🚀 Iniciando monitor (intento ${crashCount + 1}/${MAX_CRASH_RETRIES})`);
      await iniciarMonitor();
    } catch (error) {
      crashCount++;
      console.error(`\n❌ Error crítico detectado (crash #${crashCount}):`, error.message);
      logger.error(`Crash #${crashCount}`, error);

      await limpiarRecursos();

      // Liberar OCR si falla todo el proceso
      if (crashCount >= MAX_CRASH_RETRIES && ocrWorker) {
        await ocrWorker.terminate();
      }

      // Notificar por Telegram
      if (bot) {
        try {
          await bot.sendMessage(TELEGRAM_CHAT_ID,
            `⚠️ Monitor Legislativo reiniciándose (${crashCount}/${MAX_CRASH_RETRIES})\n` +
            `🔍 Reiniciando sistema de monitoreo`
          );
        } catch (notifyError) {
          console.error('Error enviando notificación de reinicio:', notifyError.message);
        }
      }

      await new Promise(resolve => setTimeout(resolve, 30000));
    }
  }

  console.log('🔴 Límite de intentos alcanzado. Deteniendo monitor.');
  process.exit(1);
}

// Función principal
async function iniciarMonitor() {
  try {
    console.log('🔧 INICIANDO MONITOR LEGISLATIVO ROBUSTO...');
    console.log('⏰ Hora de inicio:', new Date().toLocaleString('es-MX'));

    // Cargar palabras clave
    const { allKeywords, categorias } = await cargarPalabrasClave();
    console.log(`📋 Cargadas ${allKeywords.length} palabras clave de ${Object.keys(categorias).length} categorías`);

    // Inicializar Telegram
    if (TELEGRAM_TOKEN && TELEGRAM_CHAT_ID) {
      bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true }); // Polling habilitado para recibir comandos
      console.log('📱 Bot de Telegram inicializado con recepción de comandos');

      // Comando /omitidos
      bot.onText(/\/omitidos/, (msg) => {
        const chatId = msg.chat.id;
        const SEEN_FILE = path.join(__dirname, 'tweets-seen.json');

        try {
          if (fs.existsSync(SEEN_FILE)) {
            let history = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8'));
            // Si es formato antiguo (strings), convertir visualmente
            const formatted = history.slice(-10).map(item => {
              if (typeof item === 'string') return `🆔 \`${item}\` (Legacy)`;

              const cleanHandle = escapeMarkdown(item.handle);
              // Limitar largo y escapar markdown del texto
              const cleanText = escapeMarkdown(item.text.substring(0, 50));

              return `🆔 \`${item.id}\`\n👤 ${cleanHandle}\n📅 ${new Date(item.seenAt).toLocaleTimeString('es-MX')}\n📝 _${cleanText}..._`;
            }).join('\n\n');

            bot.sendMessage(chatId, `🗑️ *ÚLTIMOS 10 TWEETS OMITIDOS (VISTOS)*\n\n${formatted || 'No hay historial reciente.'}`, { parse_mode: 'Markdown' });
          } else {
            bot.sendMessage(chatId, '📂 No existe el archivo de historial.');
          }
        } catch (e) {
          bot.sendMessage(chatId, `❌ Error leyendo historial: ${e.message}`);
        }
      });

      // Comando /medioshoy
      bot.onText(/\/medioshoy/, (msg) => {
        const chatId = msg.chat.id;
        const today = new Date();
        // Ajustar a zona horaria México si es necesario, o usar local si el servidor está en MX
        const dateStr = today.toISOString().split('T')[0];
        const statsFile = path.join(__dirname, 'logs', 'estadisticas-medios', `estadisticas-${dateStr}.json`);

        try {
          if (fs.existsSync(statsFile)) {
            const stats = JSON.parse(fs.readFileSync(statsFile, 'utf8'));

            // Top Medios
            const sortedMedios = Object.entries(stats.mediosPorTweet || {})
              .sort(([, a], [, b]) => b.tweets - a.tweets)
              .slice(0, 5);

            // Top Temas
            const sortedTemas = Object.entries(stats.palabrasClaveDetectadas || {})
              .sort(([, a], [, b]) => b - a)
              .slice(0, 5);

            let reply = `📊 *RESUMEN DE ACTIVIDAD HOY (${dateStr})*\n\n`;
            reply += `📱 *Total Tweets:* ${stats.totalTweets || 0}\n\n`;

            reply += `🏆 *Top 5 Medios:*\n`;
            if (sortedMedios.length === 0) reply += `_Sin actividad_\n`;
            sortedMedios.forEach((m, i) => {
              reply += `${i + 1}. *${m[0]}*: ${m[1].tweets}\n`;
            });

            reply += `\n🔥 *Top 5 Temas:*\n`;
            if (sortedTemas.length === 0) reply += `_Sin datos_\n`;
            sortedTemas.forEach((t, i) => {
              reply += `${i + 1}. *${t[0]}*: ${t[1]}\n`;
            });

            bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });

          } else {
            bot.sendMessage(chatId, `📉 No hay estadísticas registradas para hoy (${dateStr}).`);
          }
        } catch (e) {
          bot.sendMessage(chatId, `❌ Error leyendo estadísticas: ${e.message}`);
        }
      });
    }

    // Cargar historial persistente
    const tweetsEnviados = new Set();
    const SEEN_FILE = path.join(__dirname, 'tweets-seen.json');
    try {
      if (fs.existsSync(SEEN_FILE)) {
        const loaded = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8'));
        loaded.forEach(id => tweetsEnviados.add(id));
        console.log(`📂 Cargados ${tweetsEnviados.size} tweets previos del historial.`);
      }
    } catch (e) { console.error('Error cargando historial:', e.message); }

    const USER_DATA_DIR = path.join(__dirname, 'browser-data');
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });

    console.log('🚀 Iniciando navegador con contexto persistente...');

    context = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: false, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      acceptDownloads: true,

    });

    browser = context.browser();
    console.log('✅ Navegador iniciado exitosamente');

    page = await context.newPage();
    fs.mkdirSync(STORAGE_DIR, { recursive: true });

    // Manejo de sesión
    await cargarODescartarSesion();

    // Navegar a Twitter Pro
    await navegarATwitterPro();

    // Verificación de Login
    const necesitaLogin = await verificarNecesitaLogin(page);
    if (necesitaLogin) {
      console.log('🔐 Se requiere inicio de sesión...');
      if (X_USERNAME && X_PASSWORD) {
        console.log('🤖 Intentando login automático con credenciales...');
        const loginExitoso = await loginAutomatico(page);
        if (loginExitoso) {
          console.log('✅ Login automático exitoso');
          await guardarSesionXPro();
        } else {
          throw new Error('Login automático falló. Verificar credenciales.');
        }
      } else {
        console.log('⚠️ No hay credenciales en .env (X_USERNAME/X_PASSWORD). Esperando login manual...');
        const loginExitoso = await esperarInicioSesion(page);
        if (loginExitoso) await guardarSesionXPro();
      }
    } else {
      console.log('🔓 Sesión activa detectada');
      await guardarSesionXPro();
    }

    // Inicializar Carpetas y Limpieza de Lunes
    crearCarpetas();
    limpiarArchivosLunes();

    // Overlay
    await agregarOverlay(page);
    let tweetsEncontradosCount = 0;
    const startTime = Date.now();
    await actualizarOverlay(page, 0, 'Sistema iniciado', allKeywords.length, startTime);

    if (bot) {
      await bot.sendMessage(TELEGRAM_CHAT_ID,
        '✅ Monitor Legislativo iniciado correctamente\n' +
        `🔍 Monitoreando ${allKeywords.length} palabras clave\n` +
        `📂 Categorías: ${Object.keys(categorias).join(', ')}\n` +
        `📍 Manteniendo sesión en deck de X Pro`
      );
    }

    // Intervalos
    heartbeatInterval = setInterval(() => {
      recoverySystem.updateHeartbeat();
      if (!recoverySystem.isAlive()) throw new Error('Sistema no responde');
    }, 30000);

    scrollInterval = setInterval(async () => {
      try {
        await realizarAutoScroll(page);
      } catch (error) {
        console.error('Error auto-scroll:', error.message);
        recoverySystem.recordError(error);
        if (recoverySystem.shouldRestart()) throw new Error('Demasiados errores de scroll');
      }
    }, 60000); // Scroll cada 60 segundos (1 minuto)
    nextScrollTime = Date.now() + 60000;

    // Actualización de overlay con Timer
    setInterval(async () => {
      const remaining = Math.max(0, Math.ceil((nextScrollTime - Date.now()) / 1000));
      await actualizarOverlay(page, tweetsEncontradosCount, 'Monitoreo activo', allKeywords.length, startTime, remaining);
    }, 1000);

    // Flag de control de concurrencia
    let isProcessing = false;

    checkInterval = setInterval(async () => {
      if (isProcessing) return; // Evitar solapamiento
      isProcessing = true;
      try {
        const resultado = await verificarNuevosTweets(page, allKeywords, tweetsEnviados, tweetsEncontradosCount, bot);
        if (resultado > 0) tweetsEncontradosCount = resultado;
      } catch (error) {
        console.error('Error verificando tweets:', error.message);
        recoverySystem.recordError(error);
        if (recoverySystem.shouldRestart()) throw new Error('Demasiados errores verificando tweets');
      } finally {
        isProcessing = false;
      }
    }, 20000);

    // Actualización de overlay (Manejado arriba con el timer)
    // setInterval(async () => {
    //   await actualizarOverlay(page, tweetsEncontradosCount, 'Monitoreo activo', allKeywords.length, startTime);
    // }, 3000);

    sessionSaveInterval = setInterval(async () => {
      await guardarSesionXPro();
    }, 600000);

    // Mantener proceso vivo
    await new Promise(() => { });

  } catch (error) {
    console.error('❌ Error en monitor:', error.message);
    throw error;
  }
}

// Funciones auxiliares
async function cargarODescartarSesion() {
  if (fs.existsSync(STORAGE_STATE_PATH)) {
    try {
      const sessionData = JSON.parse(fs.readFileSync(STORAGE_STATE_PATH, 'utf8'));
      if (sessionData.cookies && sessionData.cookies.length > 0) {
        // En persistent context no siempre es necesario cargar manualmente si se usa el mismo user_data_dir,
        // pero guardar/restaurar el json ayuda como backup.
        console.log('📂 Sesión backup encontrada');
      }
    } catch (e) {
      console.error('Error leyendo sesión, eliminando...', e);
      fs.unlinkSync(STORAGE_STATE_PATH);
    }
  }
}

async function navegarATwitterPro() {
  let navegacionExitosa = false;
  let intentos = 0;
  while (!navegacionExitosa && intentos < 3) {
    intentos++;
    try {
      console.log(`🌐 Navegando a X Pro (Intento ${intentos})...`);
      await page.goto(TWITTER_PRO_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(3000);
      const url = page.url();
      if (url.includes('x.com') || url.includes('twitter.com')) {
        navegacionExitosa = true;
      }
    } catch (e) {
      console.error('Error navegación:', e.message);
      await page.waitForTimeout(5000);
    }
  }
  if (!navegacionExitosa) throw new Error('No se pudo navegar a X Pro');
}

async function verificarNecesitaLogin(page) {
  try {
    await page.waitForTimeout(2000);
    const currentUrl = page.url();
    if (currentUrl.includes('/login')) return true;
    const indicators = await Promise.all([
      page.$('[data-testid="loginButton"]'),
      page.$('input[type="email"]')
    ]);
    if (indicators.some(i => i)) return true;

    const sessionIndicators = await Promise.all([
      page.$('[data-testid="SideNav_AccountSwitcher_Button"]'),
      page.$('[data-testid="primaryColumn"]')
    ]);
    if (sessionIndicators.some(i => i)) return false;

    // Si veo el botón de Log in, definitivamente necesito login
    const landingLogin = await page.$('text="Log in"');
    if (landingLogin) return true;

    return true; // Por seguridad, si no veo indicadores de sesión, asumo que necesito login
  } catch { return true; }
}

async function esperarInicioSesion(page) {
  const maxEspera = 300000;
  const start = Date.now();
  while (Date.now() - start < maxEspera) {
    if (!(await verificarNecesitaLogin(page))) return true;
    process.stdout.write(`\r⏱️ Esperando login... ${Math.ceil((maxEspera - (Date.now() - start)) / 1000)}s`);
    await page.waitForTimeout(2000);
  }
  return false;
}

async function loginAutomatico(page) {
  try {
    // Paso 1: Navegar al login de X
    console.log('  📝 Navegando a página de login...');
    await page.goto('https://x.com/i/flow/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Paso 2: Ingresar username
    console.log('  👤 Ingresando usuario...');
    let usernameInput = await page.$('input[autocomplete="username"]');
    if (!usernameInput) usernameInput = await page.$('input[name="text"]');
    if (!usernameInput) usernameInput = await page.$('input[type="text"]');
    if (!usernameInput) {
      console.error('  ❌ No se encontró el campo de usuario');
      await page.screenshot({ path: path.join(__dirname, 'debug_no_username_field.png') });
      return false;
    }
    await usernameInput.click();
    await page.waitForTimeout(300);
    await usernameInput.fill(X_USERNAME);
    await page.waitForTimeout(500);
    console.log('  ✅ Usuario ingresado');

    // Paso 3: Click en "Siguiente"
    const nextButton = await page.$('button:has-text("Next"), button:has-text("Siguiente")');
    if (nextButton) {
      await nextButton.click();
    } else {
      // Fallback: enter key
      await usernameInput.press('Enter');
    }
    await page.waitForTimeout(3000);
    console.log('  ✅ Clic en Siguiente');
    await page.screenshot({ path: path.join(__dirname, 'debug_after_next.png') });

    // Paso 3.5: Manejar posible verificación de identidad ("Enter your phone number or username")
    const verificationInput = await page.$('input[data-testid="ocfEnterTextTextInput"]');
    if (verificationInput) {
      console.log('  🔒 Verificación adicional detectada, ingresando usuario...');
      await verificationInput.fill(X_USERNAME);
      await page.waitForTimeout(500);
      const verifyNextBtns = await page.$$('button[data-testid="ocfEnterTextNextButton"]');
      if (verifyNextBtns.length > 0) await verifyNextBtns[0].click();
      await page.waitForTimeout(2000);
    }

    // Paso 4: Ingresar contraseña
    console.log('  🔑 Ingresando contraseña...');
    const passwordInput = await page.waitForSelector('input[type="password"]', { timeout: 15000 });
    await passwordInput.fill(X_PASSWORD);
    await page.waitForTimeout(500);

    // Paso 5: Click en "Log in"
    const loginButton = await page.$('button[data-testid="LoginForm_Login_Button"]');
    if (loginButton) {
      await loginButton.click();
    } else {
      // Fallback: buscar botón por texto
      const allButtons = await page.$$('button[role="button"]');
      for (const btn of allButtons) {
        const text = await btn.innerText().catch(() => '');
        if (text.includes('Log in') || text.includes('Iniciar sesión')) {
          await btn.click();
          break;
        }
      }
    }
    console.log('  ⏳ Esperando redirección post-login...');
    await page.waitForTimeout(5000);

    // Paso 6: Navegar al deck de X Pro
    await page.goto(TWITTER_PRO_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(5000);

    // Paso 7: Verificar éxito
    const loggedIn = !(await verificarNecesitaLogin(page));
    if (loggedIn) {
      console.log('  🎉 Login completado exitosamente');
      return true;
    } else {
      console.error('  ❌ Login pareció completarse pero la sesión no está activa');
      await page.screenshot({ path: path.join(__dirname, 'debug_login_failed.png') });
      return false;
    }
  } catch (error) {
    console.error('  ❌ Error durante login automático:', error.message);
    await page.screenshot({ path: path.join(__dirname, 'debug_login_error.png') }).catch(() => { });
    return false;
  }
}

async function guardarSesionXPro() {
  if (!context) return false;
  try {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
    await context.storageState({ path: STORAGE_STATE_PATH });
    return true;
  } catch (e) {
    console.error('Error guardando sesión:', e.message);
    return false;
  }
}

async function agregarOverlay(page) {
  await page.evaluate(() => {
    const div = document.createElement('div');
    div.id = 'overlay-monitor';
    Object.assign(div.style, {
      position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
      background: 'rgba(0,0,0,0.9)', color: 'white', padding: '15px 20px',
      borderRadius: '10px', fontSize: '12px', fontFamily: 'monospace', zIndex: '999999',
      minWidth: '400px', border: '2px solid rgba(0,255,0,0.3)', backdropFilter: 'blur(5px)'
    });
    div.innerText = '🤖 Monitor X Pro - Iniciando...';
    document.body.appendChild(div);
  });
}

async function actualizarOverlay(page, encontrados, status, kwCount, startTime, nextScroll) {
  try {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const min = Math.floor(uptime / 60);
    const sec = uptime % 60;
    await page.evaluate(({ e, m, s, st, k, ns }) => {
      const d = document.getElementById('overlay-monitor');
      if (d) {
        d.innerText = `🤖 Monitor X Pro\n⏰ Uptime: ${m}:${s.toString().padStart(2, '0')}\n` +
          `🔍 Keywords: ${k}\n📨 Enviados: ${e}\n✅ Status: ${st}\n` +
          `📜 Próximo Scroll: ${ns}s`;

        // Alerta visual si falta poco para scroll
        if (ns <= 5) d.style.color = '#ffeba7';
        else d.style.color = 'white';
      }
    }, { e: encontrados, m: min, s: sec, st: status, k: kwCount, ns: nextScroll || 0 });
  } catch { }
}

async function cargarPalabrasClave() {
  try {
    const data = await fs.promises.readFile(KEYWORDS_FILE, 'utf8');
    const config = JSON.parse(data);
    let allKeywords = [];

    // Prioridad: Usar las categorías si existen
    if (config.categorias) {
      Object.values(config.categorias).forEach(lista => {
        if (Array.isArray(lista)) allKeywords.push(...lista);
      });
    }
    // Fallback: Usar lista plana si no hay categorías o está vacía
    if (allKeywords.length === 0 && config.palabras_clave) {
      allKeywords = config.palabras_clave;
    }

    // Eliminar duplicados
    allKeywords = [...new Set(allKeywords)].filter(Boolean);

    return { allKeywords, categorias: config.categorias || {} };
  } catch (error) {
    console.error('⚠️ Error cargando keywords, usando defaults');
    return {
      allKeywords: ['Congreso', 'Morelos'],
      categorias: { default: ['Congreso', 'Morelos'] }
    };
  }
}

async function realizarAutoScroll(page) {
  console.log('🔄 Ejecutando auto-scroll en TODAS las columnas...');

  // 1. Scroll vertical en cada columna visible
  const columnas = await page.$$('[data-testid="column"]');
  for (const col of columnas) {
    try {
      // Scroll hacia abajo
      await col.evaluate(el => el.scrollTop += 500);

      // Si está muy abajo, volver un poco arriba para "despertar"
      // await col.evaluate(el => { if(el.scrollTop > 5000) el.scrollTop = 0; }); // Opcional si se quiere resetear
    } catch (e) { }
    await page.waitForTimeout(200);
  }

  // 2. Scroll Horizontal del contenedor principal para "ver" columnas ocultas
  try {
    // Intentar mover el foco a la derecha para obligar carga de columnas laterales
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(100);
    await page.keyboard.press('ArrowRight');
  } catch (e) { }

  // Resetear timer
  nextScrollTime = Date.now() + 60000;
}

// Configuración de rutas (Legacy Port)
const CARPETA_BASE = path.join(__dirname, 'media');
const CARPETA_VIDEOS = path.join(CARPETA_BASE, 'video');
const CARPETA_IMAGENES = path.join(CARPETA_BASE, 'img');
const CARPETA_RESPALDO = path.join(__dirname, 'media_backup'); // Respaldo secundario local

const CARPETA_VIDEOS_RESPALDO = path.join(CARPETA_RESPALDO, 'video');
const CARPETA_IMAGENES_RESPALDO = path.join(CARPETA_RESPALDO, 'img');
let videosFallidos = [];

// Función para verificar disponibilidad de ruta
function verificarRutaDisponible(ruta) {
  try {
    // Si la ruta no existe, intentamos crearla para verificar permisos
    if (!fs.existsSync(ruta)) return false;
    fs.accessSync(ruta, fs.constants.W_OK);
    return true;
  } catch (error) {
    return false;
  }
}

// Función para obtener la carpeta de destino con fallback
function obtenerCarpetaDestino(tipo) {
  const rutaPrincipal = tipo === 'video' ? CARPETA_VIDEOS : CARPETA_IMAGENES;
  const rutaRespaldo = tipo === 'video' ? CARPETA_VIDEOS_RESPALDO : CARPETA_IMAGENES_RESPALDO;

  if (verificarRutaDisponible(path.join(CARPETA_BASE))) {
    // Crear subcarpeta si no existe
    if (!fs.existsSync(rutaPrincipal)) fs.mkdirSync(rutaPrincipal, { recursive: true });
    return { carpeta: rutaPrincipal, esRespaldo: false };
  } else {
    console.log(`⚠️ Ruta principal no disponible para ${tipo}. Usando respaldo...`);
    // Asegurar que exista respaldo
    if (!fs.existsSync(rutaRespaldo)) fs.mkdirSync(rutaRespaldo, { recursive: true });
    return { carpeta: rutaRespaldo, esRespaldo: true };
  }
}

// Función para crear todas las carpetas necesarias
function crearCarpetas() {
  const carpetasRespaldo = [CARPETA_RESPALDO, CARPETA_VIDEOS_RESPALDO, CARPETA_IMAGENES_RESPALDO];

  // Intentar crear carpetas principales
  try {
    if (!fs.existsSync(CARPETA_BASE)) fs.mkdirSync(CARPETA_BASE, { recursive: true });
    if (!fs.existsSync(CARPETA_VIDEOS)) fs.mkdirSync(CARPETA_VIDEOS, { recursive: true });
    if (!fs.existsSync(CARPETA_IMAGENES)) fs.mkdirSync(CARPETA_IMAGENES, { recursive: true });
  } catch (e) { console.error('Error creando carpetas principales:', e.message); }

  // Siempre crear carpetas de respaldo
  carpetasRespaldo.forEach(carpeta => {
    if (!fs.existsSync(carpeta)) fs.mkdirSync(carpeta, { recursive: true });
  });
}

// Función para limpiar archivos los lunes (ARCHIVADO)
function limpiarArchivosLunes() {
  const hoy = new Date();
  const diaSemana = hoy.getDay(); // 0 = domingo, 1 = lunes

  if (diaSemana === 1) { // Si es lunes
    console.log('🧹 Es lunes, archivando contenido de la semana anterior...');

    // Crear carpeta de archivo
    const archiveDir = path.join(CARPETA_BASE, 'archive', `${hoy.getFullYear()}-W${getWeekNumber(hoy)}`);
    if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });

    let archivosMovidos = 0;

    // Función auxiliar de archivado
    const archivar = (origen, destino) => {
      if (fs.existsSync(origen)) {
        try {
          const files = fs.readdirSync(origen);
          files.forEach(file => {
            // Mover solo archivos multimedia
            if (file.match(/\.(mp4|webm|mkv|jpg|jpeg|png|gif)$/)) {
              const srcPath = path.join(origen, file);
              const destPath = path.join(destino, file);
              // Rename corre "mover" en el mismo fs
              try {
                fs.renameSync(srcPath, destPath);
                archivosMovidos++;
              } catch (err) {
                // Si falla rename (ej. distitos discos), intentar copy+unlink
                fs.copyFileSync(srcPath, destPath);
                fs.unlinkSync(srcPath);
                archivosMovidos++;
              }
            }
          });
        } catch (e) { console.error(`Error archivando ${origen}:`, e.message); }
      }
    };

    // Archivar carpetas
    archivar(CARPETA_VIDEOS, archiveDir);
    archivar(CARPETA_IMAGENES, archiveDir);

    // También respaldos por si acaso
    archivar(CARPETA_VIDEOS_RESPALDO, archiveDir);
    archivar(CARPETA_IMAGENES_RESPALDO, archiveDir);

    // Limpiar historial pero guardando copia
    const SEEN_FILE = path.join(__dirname, 'tweets-seen.json');
    if (fs.existsSync(SEEN_FILE)) {
      try {
        const backupSeen = path.join(archiveDir, 'tweets-seen-week.json');
        fs.copyFileSync(SEEN_FILE, backupSeen);
        fs.unlinkSync(SEEN_FILE);
        console.log('🧹 Historial reiniciado (copia guardada en archivo).');
      } catch (e) { console.error('Error archivando historial:', e.message); }
    }

    if (archivosMovidos > 0) {
      console.log(`✅ Archivado semanal completado: ${archivosMovidos} archivos movidos a ${archiveDir}`);
      if (bot) bot.sendMessage(TELEGRAM_CHAT_ID, `📦 Archivado semanal: ${archivosMovidos} items movidos a\n${archiveDir}`);
    }

    // Limpiar estadísticas antiguas (EstadisticasMedios)
    const reportsManager = new ReportsManager();
    reportsManager.stats.limpiarEstadisticasAntiguas();
  }
}

function getWeekNumber(d) {
  d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  var weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return weekNo;
}

// Normalización de texto para búsqueda flexible
function normalizeText(text) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

async function descargarVideo(tweetUrl, tweetId, esReintento = false) {
  return new Promise((resolve) => {
    try {
      const nombreArchivo = `video_${tweetId}.%(ext)s`;
      let urlCompleta;
      if (tweetUrl.startsWith('http')) {
        urlCompleta = tweetUrl;
      } else {
        urlCompleta = `https://x.com${tweetUrl}`;
      }

      console.log(`🎬 ${esReintento ? 'Reintentando' : 'Descargando'} video [${tweetId}]`);

      const { carpeta } = obtenerCarpetaDestino('video');

      // Comando yt-dlp EXACTO al legacy
      const comando = `yt-dlp --no-check-certificate --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" --encoding utf-8 -P "${carpeta}" -o "${nombreArchivo}" --format-sort "res:2160,fps,br,asr" -f "best[height<=2160]/best" --no-post-overwrites "${urlCompleta}"`;

      exec(comando, {
        timeout: 120000, // 2 minutos
        maxBuffer: 1024 * 1024 * 10,
        encoding: 'utf8'
      }, (error, stdout, stderr) => {
        if (error) {
          console.error(`❌ Error descargando video [${tweetId}]: ${error.message}`);
          if (!esReintento) {
            videosFallidos.push({ id: tweetId, url: urlCompleta, timestamp: new Date().toISOString(), error: error.message });
          }
          resolve(null);
          return;
        }

        try {
          const archivos = fs.readdirSync(carpeta);
          const archivoDescargado = archivos.find(archivo => archivo.startsWith(`video_${tweetId}`) && archivo.match(/\.(mp4|webm|mkv)$/));

          if (archivoDescargado) {
            const rutaCompleta = path.join(carpeta, archivoDescargado);
            resolve(rutaCompleta);
          } else {
            resolve(null);
          }
        } catch (err) {
          resolve(null);
        }
      });
    } catch (error) {
      resolve(null);
    }
  });
}

async function descargarImagen(url, tweetId, index) {
  return new Promise((resolve, reject) => {
    try {
      const extension = path.extname(url.split('?')[0]) || '.jpg';
      const nombreArchivo = `img_${tweetId}_${index}${extension}`;

      const { carpeta } = obtenerCarpetaDestino('imagen');
      const rutaCompleta = path.join(carpeta, nombreArchivo);

      let urlMaximaCalidad = url;
      if (url.includes('pbs.twimg.com') || url.includes('twimg.com')) {
        urlMaximaCalidad = url.split('?')[0] + '?format=jpg&name=orig';
      }

      const archivo = fs.createWriteStream(rutaCompleta);
      const timeout = setTimeout(() => {
        archivo.destroy();
        fs.unlink(rutaCompleta, () => { }); // Borrar parcial
        resolve(null);
      }, 30000);

      https.get(urlMaximaCalidad, (response) => {
        if (response.statusCode !== 200) {
          clearTimeout(timeout);
          fs.unlink(rutaCompleta, () => { });
          resolve(null);
          return;
        }
        response.pipe(archivo);
        archivo.on('finish', () => {
          clearTimeout(timeout);
          archivo.close(() => resolve(rutaCompleta));
        });
      }).on('error', () => {
        clearTimeout(timeout);
        fs.unlink(rutaCompleta, () => { });
        resolve(null);
      });
    } catch (error) {
      resolve(null);
    }
  });
}

async function descargarImagenSimple(url, dest) {
  return new Promise((resolve) => {
    https.get(url, (res) => {
      if (res.statusCode === 200) {
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => { file.close(resolve); });
      } else resolve();
    }).on('error', () => resolve());
  });
}

// Función para escapar caracteres de Markdown (V1)
function escapeMarkdown(text) {
  return text.replace(/([_*[`])/g, '\\$1');
}

async function verificarNuevosTweets(page, keywords, tweetsEnviados, count, bot) {
  try {
    console.log('🔍 Verificando nuevos tweets...');
    const tweets = await page.$$('[data-testid="tweet"]');
    console.log(`✨ Encontrados ${tweets.length} elementos de tweet en el DOM`);

    if (tweets.length === 0) {
      console.log("📸 No se encontraron tweets, tomando foto de depuración...");
      await page.screenshot({ path: '/root/MonitorMorXPro/debug_no_tweets.png', fullPage: true });
    }
    const candidates = [];

    // 1. Extracción Masiva
    for (const tweet of tweets) {
      try {
        // Datos básicos
        let authorHandle = "";
        let stableText = "";
        let authorName = "Desconocido";
        let tweetUrl = null;
        let tweetTime = "N/A";
        let timeAgo = "";

        // Extracción segura
        const userEl = await tweet.$('[data-testid="User-Name"]');
        if (userEl) {
          const userText = await userEl.innerText();
          const parts = userText.split('\n');
          if (parts.length >= 1) authorName = parts[0];
          if (parts.length >= 2) authorHandle = parts[1];
        }

        const contentEl = await tweet.$('[data-testid="tweetText"]');
        if (contentEl) stableText = await contentEl.innerText();

        // Si no hay texto, intentar OCR si no se ha hecho, pero por rendimiento
        // en esta fase solo filtramos por texto visible. El OCR se hará bajo demanda si pasa filtro.
        if (!stableText) continue;

        // Limpieza de texto para comparación
        const cleanText = stableText.trim();

        // ID Único (Handle + Texto)
        const uniqueString = `${authorHandle}|${cleanText}`;
        const tweetId = crypto.createHash('md5').update(uniqueString).digest('hex').substring(0, 8);

        // Si ya fue enviado, saltar
        if (tweetsEnviados.has(tweetId)) continue;

        // Verificar historial persistente
        const SEEN_FILE = path.join(__dirname, 'tweets-seen.json');
        if (fs.existsSync(SEEN_FILE)) {
          const history = JSON.parse(fs.readFileSync(SEEN_FILE));
          const exists = history.some(item =>
            (typeof item === 'string' && item === tweetId) ||
            (typeof item === 'object' && item.id === tweetId)
          );
          if (exists) {
            tweetsEnviados.add(tweetId);
            continue;
          }
        }

        // Extraer estadísticas para ranking (Views/Likes)
        let metricScore = 0;
        try {
          const groups = await tweet.getAttribute('aria-label'); // A veces contiene stats
          // Fallback: tratar de sacar números de los botones de acción
          // Por simplicidad, usaremos el orden de aparición como proxy de relevancia si no hay data
          // Pero si el usuario usa "Latest", el primero es el más nuevo. 
          // Si usa "Top", el primero es el más relevante.
        } catch (e) { }

        // URL
        const timeEl = await tweet.$('time');
        if (timeEl) {
          const isoTime = await timeEl.getAttribute('datetime');
          const d = new Date(isoTime);
          tweetTime = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
          const now = new Date();
          const diffMs = now - d;
          const diffSecs = Math.floor(diffMs / 1000);
          const diffMins = Math.floor(diffMs / 60000);
          const diffHrs = Math.floor(diffMs / 3600000);
          const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

          if (diffDays > 0) timeAgo = ` *${diffDays}d*`;
          else if (diffHrs > 0) timeAgo = ` *${diffHrs}h*`;
          else if (diffMins > 0) timeAgo = ` *${diffMins}m*`;
          else timeAgo = ` *${diffSecs}s*`;

          const parent = await timeEl.evaluateHandle(el => el.closest('a'));
          const href = await parent.getAttribute('href');
          tweetUrl = href ? (href.startsWith('http') ? href : `https://x.com${href}`) : null;
        }

        candidates.push({
          id: tweetId,
          element: tweet,
          handle: authorHandle,
          name: authorName,
          text: stableText,
          cleanText: normalizeText(stableText).substring(0, 50), // Firma corta para agrupamiento
          url: tweetUrl,
          time: tweetTime,
          timeAgo: timeAgo,
          originalText: cleanText // Para envío
        });

      } catch (e) { }
    }

    // 2. Agrupamiento por Contenido (Firma de texto)
    const groups = {};
    for (const c of candidates) {
      if (!groups[c.cleanText]) groups[c.cleanText] = [];
      groups[c.cleanText].push(c);
    }

    // 3. Procesamiento por Grupo
    for (const key in groups) {
      const group = groups[key];
      // Seleccionar el "Principal" (El que tenga URL válida o el primero)
      const mainTweet = group.find(t => t.url) || group[0];
      const others = group.filter(t => t !== mainTweet);

      // Verificar palabra clave en el Grupo (usando texto del main)
      // Check OCR on Main Tweet ONLY if text match fails
      let matchesKeyword = false;
      let ocrText = "";

      const fullTextMain = normalizeText(mainTweet.text);
      let foundKeyword = keywords.find(k => fullTextMain.includes(normalizeText(k)));

      // Si no encuentra por texto, intentar OCR en el Main Tweet
      if (!foundKeyword && ocrWorker) {
        try {
          const images = await mainTweet.element.$$('img[src*="pbs.twimg.com/media"]');
          if (images.length > 0) {
            const src = await images[0].getAttribute('src');
            if (src) {
              const tempPath = path.join(__dirname, `ocr_temp_${mainTweet.id}.jpg`);
              await descargarImagenSimple(src, tempPath);
              if (fs.existsSync(tempPath)) {
                const { data: { text } } = await ocrWorker.recognize(tempPath);
                ocrText = text || "";
                fs.unlinkSync(tempPath);
              }
            }
          }
        } catch (e) { }
        const fullTextWithOcr = normalizeText(mainTweet.text + " " + ocrText);
        foundKeyword = keywords.find(k => fullTextWithOcr.includes(normalizeText(k)));
      }

      if (foundKeyword) {
        console.log(`📢 Encontrado Grupo de Tweets: ${group.length} coincidencias. Enviando Principal: ${mainTweet.id}`);

        // Marcar TODOS como enviados para evitar duplicados futuros
        group.forEach(t => tweetsEnviados.add(t.id));
        count += group.length;

        // Registrar Stats
        try {
          const reportsManager = new ReportsManager();
          reportsManager.stats.registrarTweet({
            texto: mainTweet.text,
            handle: mainTweet.handle, // Pasar handle para métricas oficiales
            palabrasClaveEncontradas: [foundKeyword] // Simplificado
          });

          // --- LÓGICA DE DESCUBRIMIENTO INTELIGENTE ---
          const TRUSTED_SEEDS = ['@MorelosCongreso', '@GobiernoMorelos', '@TSJMorelos'];
          if (TRUSTED_SEEDS.some(s => s.toLowerCase() === mainTweet.handle.toLowerCase())) {
            // Buscar menciones a potenciales nuevos actores
            const mentions = mainTweet.originalText.match(/@[\w_]+/g) || [];
            const keywordsToTrigger = ['diputado', 'diputada', 'legislador', 'secretario', 'secretaria', 'magistrado', 'juez', 'fiscal'];

            for (const mention of mentions) {
              const cleanMention = mention.substring(1); // sin @ for search if needed, but we store variants
              // Si NO está ya en nuestras keywords (buscamos si alguna keyword incluye el handle)
              const alreadyTracked = keywords.some(k => k.toLowerCase().includes(mention.toLowerCase()));

              if (!alreadyTracked) {
                // Verificar contexto (si el tweet dice "Diputado @Tal")
                const lowerText = mainTweet.originalText.toLowerCase();
                const contextMatch = keywordsToTrigger.some(trigger => {
                  // Simple check: trigger word appears before mention or strictly related
                  return lowerText.includes(trigger);
                });

                if (contextMatch) {
                  console.log(`🌟 DESCUBRIMIENTO: Detectado posible oficial ${mention} vía ${mainTweet.handle}`);

                  // Agregar a keywords.json
                  try {
                    const kPath = path.join(__dirname, 'keywords.json');
                    const kData = JSON.parse(fs.readFileSync(kPath));

                    // Agregar a legislativo por defecto si viene de congreso, o gobierno, o generic 'descubiertos'
                    if (!kData.categorias.descubiertos) kData.categorias.descubiertos = [];
                    if (!kData.categorias.descubiertos.includes(mention)) {
                      kData.categorias.descubiertos.push(mention);
                      fs.writeFileSync(kPath, JSON.stringify(kData, null, 2));

                      // Notificar
                      if (bot) bot.sendMessage(TELEGRAM_CHAT_ID, `🆕 *NUEVA CUENTA DETECTADA*\n\nEl sistema agregó automáticamente a *${mention}* a la lista de monitoreo.\n\n📍 Fuente: ${mainTweet.handle}\nTweet: "${mainTweet.text.substring(0, 50)}..."`, { parse_mode: 'Markdown' });

                      // Recargar keywords en memoria (parcial, idealmente requires restart but we push to runtime array)
                      keywords.push(mention);
                    }
                  } catch (e) { console.error('Error auto-adding keyword:', e); }
                }
              }
            }
          }
          // ---------------------------------------------
        } catch (e) { }

        // Persistencia (Batch)
        const SEEN_FILE = path.join(__dirname, 'tweets-seen.json');
        let currentHistory = [];
        if (fs.existsSync(SEEN_FILE)) currentHistory = JSON.parse(fs.readFileSync(SEEN_FILE));

        group.forEach(t => {
          currentHistory.push({
            id: t.id,
            handle: t.handle,
            text: t.text.substring(0, 50),
            seenAt: new Date().toISOString()
          });
        });
        if (currentHistory.length > 500) currentHistory = currentHistory.slice(-500);
        fs.writeFileSync(SEEN_FILE, JSON.stringify(currentHistory, null, 2));


        // Descargar Medios (Solo del Main)
        const mediaPaths = [];
        // ... (Lógica de descarga de videos/imágenes igual que antes, usando mainTweet.element)
        // Videos
        if (mainTweet.url) {
          const hasVideo = await mainTweet.element.$('[data-testid="videoPlayer"], [data-testid="playButton"]');
          if (hasVideo) {
            const videoPath = await descargarVideo(mainTweet.url, mainTweet.id);
            if (videoPath) mediaPaths.push({ type: 'video', media: videoPath });
          }
        }
        // Imágenes
        const imgs = await mainTweet.element.$$('img[src*="pbs.twimg.com/media"]');
        for (let i = 0; i < imgs.length; i++) {
          const src = await imgs[i].getAttribute('src');
          if (src) {
            const hq = src.replace('format=jpg&name=small', 'format=jpg&name=large');
            const p = await descargarImagen(hq, mainTweet.id, i);
            if (p) mediaPaths.push({ type: 'photo', media: p });
          }
        }

        // Enviar Telegram
        if (bot) {
          const cleanName = escapeMarkdown(mainTweet.name);
          const cleanHandle = escapeMarkdown(mainTweet.handle);
          const cleanTextMsg = escapeMarkdown(mainTweet.originalText);

          let caption = `*${cleanName}* _${cleanHandle}_\n• ${mainTweet.time}${mainTweet.timeAgo}\n\n${cleanTextMsg}\n\n🆔 \`${mainTweet.id}\`\n🔗 Ver Tweet: ${mainTweet.url || ''}`;

          // Append Duplicates info
          if (others.length > 0) {
            const otherHandles = others.map(o => o.handle).filter(h => h !== mainTweet.handle);
            // Unique handles
            const uniqueOthers = [...new Set(otherHandles)];
            if (uniqueOthers.length > 0) {
              caption += `\n\n👀 *También visto en:* ${uniqueOthers.map(h => escapeMarkdown(h)).join(', ')}`;
            }
          }

          // Envio de medios (Copiado de lógica anterior)
          if (mediaPaths.length > 0) {
            if (mediaPaths.some(m => m.type === 'video')) {
              for (const m of mediaPaths) {
                if (m.type === 'video') await bot.sendVideo(TELEGRAM_CHAT_ID, m.media, { caption, parse_mode: 'Markdown' }).catch(e => console.error(e));
                else await bot.sendPhoto(TELEGRAM_CHAT_ID, m.media).catch(e => console.error(e));
              }
            } else {
              const mediaGroup = mediaPaths.map(m => ({ type: 'photo', media: m.media, caption: m === mediaPaths[0] ? caption : '', parse_mode: 'Markdown' }));
              if (mediaGroup.length === 1) await bot.sendPhoto(TELEGRAM_CHAT_ID, mediaGroup[0].media, { caption, parse_mode: 'Markdown' });
              else await bot.sendMediaGroup(TELEGRAM_CHAT_ID, mediaGroup);
            }
          } else {
            await bot.sendMessage(TELEGRAM_CHAT_ID, caption, { parse_mode: 'Markdown', disable_web_page_preview: true });
          }
        }
      }
    }

    return count;
  } catch (e) {
    console.error('Error verificación batch:', e.message);
    throw e;
  }
}

// Sistema de Reportes Semanales
class ReportsManager {
  constructor() {
    this.baseDir = path.join(__dirname, 'logs', 'estadisticas-medios');
    this.stats = new EstadisticasMedios();
  }

  // Recolectar estadísticas de toda la semana
  collectWeeklyStats() {
    const weeklyStats = {
      totalTweets: 0,
      medios: {},
      topTemas: {},
      interaccionesOficiales: {}
    };

    try {
      if (!fs.existsSync(this.baseDir)) return weeklyStats;

      // Obtener archivos de los últimos 7 días
      const files = fs.readdirSync(this.baseDir).filter(f => f.endsWith('.json'));
      const today = new Date();

      files.forEach(file => {
        // Verificar si el archivo es de esta semana (últimos 7 días)
        // Formato: estadisticas-YYYY-MM-DD.json
        const datePart = file.replace('estadisticas-', '').replace('.json', '');
        const fileDate = new Date(datePart);

        // Diferencia en días
        const diffTime = Math.abs(today - fileDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays <= 7) {
          try {
            const content = JSON.parse(fs.readFileSync(path.join(this.baseDir, file), 'utf8'));

            // Sumar Total
            weeklyStats.totalTweets += (content.totalTweets || 0);

            // Sumar por Medio
            if (content.mediosPorTweet) {
              Object.entries(content.mediosPorTweet).forEach(([medio, data]) => {
                if (!weeklyStats.medios[medio]) weeklyStats.medios[medio] = 0;
                weeklyStats.medios[medio] += data.tweets;
              });
            }

            // Sumar Temas (Palabras Clave)
            if (content.palabrasClaveDetectadas) {
              Object.entries(content.palabrasClaveDetectadas).forEach(([tema, count]) => {
                if (!weeklyStats.topTemas[tema]) weeklyStats.topTemas[tema] = 0;
                weeklyStats.topTemas[tema] += count;
              });
            }

            // Sumar Interacciones Oficiales
            if (content.interaccionesOficiales) {
              Object.entries(content.interaccionesOficiales).forEach(([fuente, destinos]) => {
                if (!weeklyStats.interaccionesOficiales[fuente]) weeklyStats.interaccionesOficiales[fuente] = {};
                Object.entries(destinos).forEach(([destino, count]) => {
                  if (!weeklyStats.interaccionesOficiales[fuente][destino]) weeklyStats.interaccionesOficiales[fuente][destino] = 0;
                  weeklyStats.interaccionesOficiales[fuente][destino] += count;
                });
              });
            }

          } catch (e) { console.error(`Error leyendo stats ${file}:`, e.message); }
        }
      });
    } catch (e) { console.error('Error recolectando stats semanales:', e.message); }

    return weeklyStats;
  }

  async sendWeeklyReport(bot) {
    if (!bot) return;

    console.log('📊 Generando reporte semanal...');
    const stats = this.collectWeeklyStats();

    if (stats.totalTweets === 0) {
      await bot.sendMessage(TELEGRAM_CHAT_ID, '📊 *Reporte Semanal*\n\nNo hubo actividad registrada esta semana.');
      return;
    }

    // Top Medios
    const topMedios = Object.entries(stats.medios)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10);

    // Top Temas
    const topTemas = Object.entries(stats.topTemas)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10);

    let msg = `📊 *REPORTE SEMANAL DE MEDIOS*\n`;
    msg += `🗓️ Semana del ${new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toLocaleDateString('es-MX')} al ${new Date().toLocaleDateString('es-MX')}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    msg += `📱 *Total Tweets Procesados:* ${stats.totalTweets}\n\n`;

    msg += `🏆 *Top 10 Medios Más Activos:*\n`;
    topMedios.forEach((m, i) => {
      const medal = i === 0 ? '🥇' : (i === 1 ? '🥈' : (i === 2 ? '🥉' : '▪️'));
      msg += `${medal} *${m[0]}*: ${m[1]} tweets\n`;
    });

    msg += `\n🔥 *Temas Principales (Keywords):*\n`;
    topTemas.forEach((t, i) => {
      msg += `${i + 1}. *${t[0]}*: ${t[1]} menciones\n`;
    });

    // Reporte de Interacciones Oficiales (@MorelosCongreso etc)
    if (Object.keys(stats.interaccionesOficiales).length > 0) {
      msg += `\n🏛️ *ACTIVIDAD OFICIAL (Menciones)*\n`;
      Object.entries(stats.interaccionesOficiales).forEach(([origen, destinos]) => {
        // Filtrar solo si el origen es de interés (aunque ya filtramos al registrar)
        msg += `\n📌 *${origen}:*\n`;
        // Top 5 mencionados por esta cuenta
        Object.entries(destinos)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 5)
          .forEach(([dest, count]) => {
            msg += `   • ${dest}: ${count} veces\n`;
          });
      });
    }

    msg += `\n🤖 _Monitor Legislativo Morelos_`;

    await bot.sendMessage(TELEGRAM_CHAT_ID, msg, { parse_mode: 'Markdown' });
    console.log('✅ Reporte semanal enviado.');
  }
}

// Inicializar Gestor de Reportes
const reportsManager = new ReportsManager();

// Scheduler para reporte semanal (Viernes 10:00 PM)
const scheduleReport = () => {
  setInterval(async () => {
    const now = new Date();
    // 5 = Viernes, 22 = 10PM
    if (now.getDay() === 5 && now.getHours() === 22 && now.getMinutes() === 0) {
      await reportsManager.sendWeeklyReport(bot);
      // Evitar múltiples envíos en el mismo minuto
      await new Promise(r => setTimeout(r, 65000));
    }
  }, 40000); // Checar cada 40s
};

scheduleReport();

// Iniciar
iniciarMonitorConRecuperacion();
