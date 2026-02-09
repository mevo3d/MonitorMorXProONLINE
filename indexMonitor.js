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
  while (crashCount < MAX_CRASH_RETRIES) {
    try {
      console.log(`\n🚀 Iniciando monitor (intento ${crashCount + 1}/${MAX_CRASH_RETRIES})`);
      await iniciarMonitor();
    } catch (error) {
      crashCount++;
      console.error(`\n❌ Error crítico detectado (crash #${crashCount}):`, error.message);
      logger.error(`Crash #${crashCount}`, error);

      await limpiarRecursos();

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
      headless: false,
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      acceptDownloads: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
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
      console.log('🔐 Se requiere inicio de sesión manual (5 min timeout)');
      const loginExitoso = await esperarInicioSesion(page);
      if (loginExitoso) await guardarSesionXPro();
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
    }, 180000);

    checkInterval = setInterval(async () => {
      try {
        const resultado = await verificarNuevosTweets(page, allKeywords, tweetsEnviados, tweetsEncontradosCount, bot);
        if (resultado > 0) tweetsEncontradosCount = resultado;
      } catch (error) {
        console.error('Error verificando tweets:', error.message);
        recoverySystem.recordError(error);
        if (recoverySystem.shouldRestart()) throw new Error('Demasiados errores verificando tweets');
      }
    }, 20000);

    // Actualización de overlay
    setInterval(async () => {
      await actualizarOverlay(page, tweetsEncontradosCount, 'Monitoreo activo', allKeywords.length, startTime);
    }, 3000);

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

    return false; // Asumir sesión activa si no hay indicadores claros de login
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

async function actualizarOverlay(page, encontrados, status, kwCount, startTime) {
  try {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const min = Math.floor(uptime / 60);
    const sec = uptime % 60;
    await page.evaluate(({ e, m, s, st, k }) => {
      const d = document.getElementById('overlay-monitor');
      if (d) {
        d.innerText = `🤖 Monitor X Pro\n⏰ Uptime: ${m}:${s.toString().padStart(2, '0')}\n` +
          `🔍 Keywords: ${k}\n📨 Enviados: ${e}\n✅ Status: ${st}`;
      }
    }, { e: encontrados, m: min, s: sec, st: status, k: kwCount });
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
  const columnas = await page.$$('[data-testid="column"]');
  for (const col of columnas) {
    await col.evaluate(el => el.scrollTop += 500).catch();
    await page.waitForTimeout(200);
  }
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

// Función para limpiar archivos los lunes
function limpiarArchivosLunes() {
  const hoy = new Date();
  const diaSemana = hoy.getDay(); // 0 = domingo, 1 = lunes

  if (diaSemana === 1) { // Si es lunes
    console.log('🧹 Es lunes, limpiando archivos...');
    let archivosEliminados = 0;

    // Limpiar videos (Principal y Respaldo)
    [CARPETA_VIDEOS, CARPETA_VIDEOS_RESPALDO].forEach(dir => {
      if (fs.existsSync(dir)) {
        try {
          const archivos = fs.readdirSync(dir);
          archivos.forEach(archivo => {
            if (archivo.match(/\.(mp4|webm|mkv)$/)) {
              fs.unlinkSync(path.join(dir, archivo));
              archivosEliminados++;
            }
          });
        } catch (e) { console.error(`Error limpiando videos en ${dir}:`, e.message); }
      }
    });

    // Limpiar imágenes (Principal y Respaldo)
    [CARPETA_IMAGENES, CARPETA_IMAGENES_RESPALDO].forEach(dir => {
      if (fs.existsSync(dir)) {
        try {
          const archivos = fs.readdirSync(dir);
          archivos.forEach(archivo => {
            if (archivo.match(/\.(jpg|jpeg|png|gif)$/)) {
              fs.unlinkSync(path.join(dir, archivo));
              archivosEliminados++;
            }
          });
        } catch (e) { console.error(`Error limpiando imagenes en ${dir}:`, e.message); }
      }
    });



    // Limpiar historial persistente
    const SEEN_FILE = path.join(__dirname, 'tweets-seen.json');
    if (fs.existsSync(SEEN_FILE)) {
      try {
        fs.unlinkSync(SEEN_FILE);
        console.log('🧹 Historial de tweets vistos (semana anterior) eliminado.');
      } catch (e) { console.error('Error borrando historial:', e.message); }
    }

    if (archivosEliminados > 0) {
      console.log(`✅ Limpieza completada: ${archivosEliminados} archivos eliminados`);
      if (bot) bot.sendMessage(TELEGRAM_CHAT_ID, `🧹 Limpieza semanal: ${archivosEliminados} archivos eliminados`);
    }

    // Limpiar estadísticas antiguas (EstadisticasMedios)
    const reportsManager = new ReportsManager();
    reportsManager.stats.limpiarEstadisticasAntiguas();
  }
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

// Función para escapar caracteres de Markdown (V1)
function escapeMarkdown(text) {
  return text.replace(/([_*[`])/g, '\\$1');
}

async function verificarNuevosTweets(page, keywords, tweetsEnviados, count, bot) {
  try {
    const tweets = await page.$$('[data-testid="tweet"]');
    for (const tweet of tweets) {
      // Intentar extraer datos ESTABLES primero
      let authorHandle = "";
      let stableText = "";

      try {
        const userEl = await tweet.$('[data-testid="User-Name"]');
        if (userEl) {
          const userText = await userEl.innerText();
          const parts = userText.split('\n');
          if (parts.length >= 2) authorHandle = parts[1];
        }

        const contentEl = await tweet.$('[data-testid="tweetText"]');
        if (contentEl) {
          stableText = await contentEl.innerText();
        }
      } catch (e) { }

      // Si no pudimos extraer lo mínimo, saltamos
      if (!stableText) continue;

      // Generar ID estable basado solo en Handle + Texto (Ignorando hora relativa)
      const uniqueString = `${authorHandle}|${stableText.trim()}`;
      const tweetId = crypto.createHash('md5').update(uniqueString).digest('hex').substring(0, 8);

      // Verificación en memoria
      if (tweetsEnviados.has(tweetId)) continue;

      // Verificación en archivo (Soporte para formato antiguo string[] y nuevo object[])
      const SEEN_FILE = path.join(__dirname, 'tweets-seen.json');
      let currentHistory = [];
      try {
        if (fs.existsSync(SEEN_FILE)) {
          currentHistory = JSON.parse(fs.readFileSync(SEEN_FILE));
          // Verificar si existe el ID en el historial (compatible con ambos formatos)
          const exists = currentHistory.some(item =>
            (typeof item === 'string' && item === tweetId) ||
            (typeof item === 'object' && item.id === tweetId)
          );

          if (exists) {
            tweetsEnviados.add(tweetId);
            continue;
          }
        }
      } catch (e) { }

      // Verificar palabras clave en el texto estable
      if (keywords.some(k => stableText.toLowerCase().includes(k.toLowerCase()))) {
        tweetsEnviados.add(tweetId);
        count++;
        console.log(`📢 Nuevo Tweet Detectado! [${tweetId}]`);

        // Registrar en estadísticas
        try {
          const reportsManager = new ReportsManager();
          reportsManager.stats.registrarTweet({
            texto: stableText,
            palabrasClaveEncontradas: keywords.filter(k => stableText.toLowerCase().includes(k.toLowerCase()))
          });
        } catch (e) { console.error('Error registrando estadística:', e.message); }

        // Persistir ID Nuevo con metadatos para debugging
        try {
          // Convertir historial antiguo a objetos si es necesario
          if (currentHistory.length > 0 && typeof currentHistory[0] === 'string') {
            currentHistory = currentHistory.map(id => ({ id, handle: 'migrated', text: 'migrated', seenAt: new Date().toISOString() }));
          }

          currentHistory.push({
            id: tweetId,
            handle: authorHandle,
            text: stableText.substring(0, 280), // Guardar contexto completo
            seenAt: new Date().toISOString()
          });

          // Mantener solo los últimos 500 para no inflar el archivo eternamente
          if (currentHistory.length > 500) currentHistory = currentHistory.slice(-500);

          fs.writeFileSync(SEEN_FILE, JSON.stringify(currentHistory, null, 2));
        } catch (e) { console.error('Error guardando ID persistente:', e.message); }

        // Extraer URL del tweet de forma segura
        let tweetUrl = null;
        try {
          const timeEl = await tweet.$('time');
          if (timeEl) {
            const parent = await timeEl.evaluateHandle(el => el.closest('a'));
            const href = await parent.getAttribute('href');
            if (href) {
              // Evitar doble dominio si href ya es absoluto
              if (href.startsWith('http')) {
                tweetUrl = href;
              } else {
                tweetUrl = `https://x.com${href}`;
              }
            }
          }
        } catch (e) { }

        // Medios
        const mediaPaths = [];

        // 1. Videos (yt-dlp si hay URL)
        if (tweetUrl) {
          // Verificar si parece tener video
          const hasVideo = await tweet.$('[data-testid="videoPlayer"], [data-testid="playButton"]');
          if (hasVideo) {
            console.log(`🎬 Descargando video para ${tweetId}...`);
            const videoPath = await descargarVideo(tweetUrl, tweetId);
            if (videoPath) mediaPaths.push({ type: 'video', media: videoPath });
          }
        }

        // 2. Imágenes
        const imgs = await tweet.$$('img[src*="pbs.twimg.com/media"]');
        for (let i = 0; i < imgs.length; i++) {
          const src = await imgs[i].getAttribute('src');
          if (src) {
            const highQualitySrc = src.replace('format=jpg&name=small', 'format=jpg&name=large');
            const imgPath = await descargarImagen(highQualitySrc, tweetId, i);
            if (imgPath) mediaPaths.push({ type: 'photo', media: imgPath });
          }
        }

        // Extraer info detallada (Autor, Hora, Diferencia, Texto Limpio)
        let authorName = "Desconocido";
        // authorHandle ya lo tenemos
        let tweetTime = "N/A";
        let timeAgo = "";
        let cleanText = escapeMarkdown(stableText.trim());

        try {
          const userEl = await tweet.$('[data-testid="User-Name"]');
          if (userEl) {
            const userText = await userEl.innerText();
            const parts = userText.split('\n');
            if (parts.length >= 2) {
              authorName = parts[0];
              // parts[1] es el handle
            }
          }

          // 2. Extraer Tiempo y Calcular Diferencia
          const timeEl = await tweet.$('time');
          if (timeEl) {
            const isoTime = await timeEl.getAttribute('datetime'); // ISO format
            if (isoTime) {
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
            }
          }

          // 3. Texto ya extraído en stableText
          // Intentar expandir tweet si hay botón "Show more" (aunque ya leímos, si había show more tal vez leímos incompleto, reintentar)
          /* NOTA: Para no complicar el hash, usamos el texto inicial para el ID. 
             Pero para el ENVÍO, podemos intentar expandir y releer para tener el full text. */

          try {
            const showMoreBtn = await tweet.$('text=/Show more|Mostrar más/i');
            if (showMoreBtn) {
              await showMoreBtn.click({ timeout: 1000 }).catch(() => { });
              await page.waitForTimeout(500);
              // Releer texto completo para el mensaje
              const contentEl = await tweet.$('[data-testid="tweetText"]');
              if (contentEl) {
                const rawBody = await contentEl.innerText();
                cleanText = escapeMarkdown(rawBody.trim());
              }
            }
          } catch (e) { }

        } catch (e) {
          console.error('Error extrayendo detalles:', e.message);
        }

        // Enviar a Telegram con formato mejorado
        if (bot) {
          const cleanName = escapeMarkdown(authorName);
          const cleanHandle = escapeMarkdown(authorHandle);

          const caption = `*${cleanName}* _${cleanHandle}_\n• ${tweetTime}${timeAgo}\n\n${cleanText}\n\n🆔 \`${tweetId}\`\n🔗 Ver Tweet: ${tweetUrl || ''}`;

          if (mediaPaths.length > 0) {
            // Enviar como grupo o individual
            if (mediaPaths.some(m => m.type === 'video')) {
              // Video: Caption va en el video si es único
              for (const m of mediaPaths) {
                if (m.type === 'video') {
                  await bot.sendVideo(TELEGRAM_CHAT_ID, m.media, { caption: caption, parse_mode: 'Markdown' }).catch(e => console.error(e.message));
                } else {
                  await bot.sendPhoto(TELEGRAM_CHAT_ID, m.media).catch(e => console.error(e.message));
                }
              }
            } else {
              // Solo fotos (MediaGroup)
              const mediaGroup = mediaPaths.map(m => ({
                type: 'photo',
                media: m.media,
                // Solo poner caption en la primera imagen
                caption: m === mediaPaths[0] ? caption : '',
                parse_mode: 'Markdown'
              }));

              try {
                if (mediaGroup.length === 1) {
                  await bot.sendPhoto(TELEGRAM_CHAT_ID, mediaGroup[0].media, { caption: caption, parse_mode: 'Markdown' });
                } else {
                  await bot.sendMediaGroup(TELEGRAM_CHAT_ID, mediaGroup);
                }
              } catch (e) {
                // Fallback
                console.error("Error enviando grupo, enviando texto e imágenes separado");
                await bot.sendMessage(TELEGRAM_CHAT_ID, caption, { parse_mode: 'Markdown', disable_web_page_preview: true });
                for (const m of mediaPaths) {
                  await bot.sendPhoto(TELEGRAM_CHAT_ID, m.media);
                }
              }
            }
          } else {
            // Solo texto
            await bot.sendMessage(TELEGRAM_CHAT_ID, caption, { parse_mode: 'Markdown', disable_web_page_preview: true }).catch(e => console.error('Error enviando telegram texto:', e.message));
          }
        }
      }
    }
    return count;
  } catch (e) {
    console.error('Error verificación:', e.message);
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
      topTemas: {}
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
