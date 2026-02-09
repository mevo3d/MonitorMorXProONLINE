import dotenv from 'dotenv';
dotenv.config();

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import TelegramBot from 'node-telegram-bot-api';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fetch from 'node-fetch';
import FormData from 'form-data';
import crypto from 'crypto';
import winston from 'winston';

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
    new winston.transports.File({ filename: 'combined.log' }),
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
const TWITTER_PRO_URL = 'https://pro.x.com/i/decks/1853883906551898346';
const KEYWORDS_FILE = 'keywords.json';
const STORAGE_DIR = path.join(__dirname, 'storage');

const STORAGE_STATE_PATH = path.join(STORAGE_DIR, 'xpro-session.json');


// Configuración específica Monitor Legislativo
const LISTAS_LEGISLATIVO = [
  'https://x.com/i/lists/1938329800252232136'  // Lista Monitor Legislativo (MediosMorelos)
];

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

// Función para limpiar recursos (definida temprano para evitar errores de referencia)
async function limpiarRecursos() {
  console.log('🧹 Limpiando recursos...');

  // Limpiar intervalos
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }

  if (scrollInterval) {
    clearInterval(scrollInterval);
    scrollInterval = null;
  }

  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }

  if (sessionSaveInterval) {
    clearInterval(sessionSaveInterval);
    sessionSaveInterval = null;
  }

  // Guardar sesión antes de cerrar (si está disponible la función)
  try {
    if (context && page && typeof guardarSesionXPro === 'function') {
      console.log('💾 Guardando sesión antes de cerrar...');
      await guardarSesionXPro();
    }
  } catch (error) {
    console.error('Error guardando sesión final:', error.message);
  }

  // Cerrar navegador
  try {
    if (page) {
      await page.close();
      page = null;
    }
    if (context) {
      await context.close();
      context = null;
    }
    if (browser) {
      await browser.close();
      browser = null;
    }
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
      
      // Limpiar recursos
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

      // Esperar antes de reiniciar
      await new Promise(resolve => setTimeout(resolve, 30000));
    }
  }

  console.log('🔴 Límite de intentos alcanzado. Deteniendo monitor.');
  process.exit(1);
}

async function iniciarMonitor() {
  try {
    console.log('🔧 INICIANDO MONITOR LEGISLATIVO ROBUSTO...');
    console.log('⏰ Hora de inicio:', new Date().toLocaleString('es-MX'));

    // Cargar configuración
    console.log('📋 Cargando palabras clave...');
    const keywords = await cargarPalabrasClave();

  // Inicializar Telegram
  if (TELEGRAM_TOKEN && TELEGRAM_CHAT_ID) {
    bot = new TelegramBot(TELEGRAM_TOKEN);
    console.log('📱 Bot de Telegram inicializado');
  }

  // Configurar sistema de monitoreo
  const tweetsEnviados = new Set();

  // Crear directorio de datos persistente para mantener la sesión (COMO EN INDEX.JS)
  const USER_DATA_DIR = path.join(__dirname, 'browser-data');
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });

  console.log('🗂️ Usando contexto persistente para mantener sesión entre ejecuciones...');

  console.log('🚀 Iniciando navegador con contexto persistente...');

  // Inicializar navegador con contexto persistente (MANTIENE SESIÓN ENTRE EJECUCIONES)
  context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    acceptDownloads: true,
    permissions: ['clipboard-read', 'clipboard-write'],
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu'
    ]
  });

  // El browser es parte del contexto persistente
  browser = context.browser();

  console.log('✅ Navegador iniciado exitosamente');

  page = await context.newPage();

  // Crear directorio de almacenamiento si no existe
  fs.mkdirSync(STORAGE_DIR, { recursive: true });

  // Cargar sesión guardada si existe
  let sesionCargada = false;
  if (fs.existsSync(STORAGE_STATE_PATH)) {
    try {
      // Verificar el archivo antes de cargar
      const stats = fs.statSync(STORAGE_STATE_PATH);
      console.log(`📄 Encontrado archivo de sesión (${stats.size} bytes)`);

      // Leer y validar contenido
      const sessionData = JSON.parse(fs.readFileSync(STORAGE_STATE_PATH, 'utf8'));
      if (sessionData.cookies && sessionData.cookies.length > 0) {
        console.log(`🍪 Archivo contiene ${sessionData.cookies.length} cookies, cargando...`);

        // Cargar el estado de la sesión
        await context.storageState({ path: STORAGE_STATE_PATH });
        console.log('📂 Sesión de X Pro cargada exitosamente');
        sesionCargada = true;
      } else {
        console.warn('⚠️ Archivo de sesión no contiene cookies válidas, iniciando sesión nueva...');
        // Eliminar archivo corrupto
        fs.unlinkSync(STORAGE_STATE_PATH);
      }
    } catch (error) {
      console.error('Error cargando sesión:', error.message);
      console.log('⚠️ Iniciando con sesión nueva...');
      // Eliminar archivo corrupto si existe
      if (fs.existsSync(STORAGE_STATE_PATH)) {
        try {
          fs.unlinkSync(STORAGE_STATE_PATH);
          console.log('🗑️ Archivo de sesión corrupto eliminado');
        } catch (deleteError) {
          console.error('Error eliminando archivo corrupto:', deleteError.message);
        }
      }
    }
  } else {
    console.log('📝 No hay archivo de sesión previo, iniciando sesión nueva...');
  }

  // Navegar a X Pro con retry y manejo de redirecciones
  let navegacionExitosa = false;
  let intentosNavegacion = 0;
  const maxIntentosNavegacion = 3;

  while (!navegacionExitosa && intentosNavegacion < maxIntentosNavegacion) {
    try {
      intentosNavegacion++;
      console.log(`🌐 Intento ${intentosNavegacion}/${maxIntentosNavegacion} navegando al deck de X Pro...`);

      await page.goto(TWITTER_PRO_URL, {
        waitUntil: 'domcontentloaded',
        timeout: 45000
      });

      // Esperar un poco y verificar la URL actual
      await page.waitForTimeout(3000);
      const currentUrl = page.url();

      console.log(`📍 URL actual: ${currentUrl}`);

      // Si fuimos redirigidos a X normal, intentar ir a X Pro nuevamente
      if (currentUrl.includes('x.com') && !currentUrl.includes('pro.x.com')) {
        console.log('🔄 Redirigido a X normal, intentando acceder a X Pro...');
        await page.goto(TWITTER_PRO_URL, {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });
        await page.waitForTimeout(2000);
      }

      // Verificar URL final
      const finalUrl = page.url();
      console.log(`📍 URL final: ${finalUrl}`);

      // Verificar si estamos en una página de X (no importa si es pro o no)
      if (finalUrl.includes('x.com') || finalUrl.includes('twitter.com')) {
        console.log('✅ Navegación al deck de X Pro exitosa');
        navegacionExitosa = true;
      } else {
        throw new Error('No se pudo llegar a ninguna página de X');
      }
    } catch (error) {
      console.error(`⚠️ Error en navegación (intento ${intentosNavegacion}):`, error.message);

      if (intentosNavegacion < maxIntentosNavegacion) {
        console.log('🔄 Reintentando en 5 segundos...');
        await page.waitForTimeout(5000);
      } else {
        throw new Error(`No se pudo navegar al deck de X Pro después de ${maxIntentosNavegacion} intentos`);
      }
    }
  }

  // Esperar adicional para que cargue completamente
  await page.waitForTimeout(5000);

  // Verificar si necesita inicio de sesión
  console.log('🔍 Verificando estado de sesión...');
  const necesitaLogin = await verificarNecesitaLogin(page);

  if (necesitaLogin) {
    console.log('🔐 Se requiere inicio de sesión manual');
    console.log('⏳ Por favor, inicia sesión en la ventana del navegador...');
    console.log('💡 Tienes 5 minutos para iniciar sesión');

    // Esperar a que el usuario inicie sesión
    const loginExitoso = await esperarInicioSesion(page);

    if (loginExitoso) {
      // Guardar sesión después del login exitoso
      const guardadoExitoso = await guardarSesionXPro();
      if (guardadoExitoso) {
        console.log('✅ Sesión guardada correctamente - La próxima vez no necesitarás iniciar sesión');
      } else {
        console.warn('⚠️ No se pudo guardar la sesión, tendrás que iniciar sesión nuevamente');
      }
    } else {
      console.log('❌ No se detectó inicio de sesión, continuando sin sesión persistente');
    }
  } else {
    console.log('🔓 Sesión activa detectada - No se requiere inicio de sesión');

    // Guardar sesión actual para mantenerla actualizada
    const guardadoExitoso = await guardarSesionXPro();
    if (guardadoExitoso) {
      console.log('💾 Sesión actualizada guardada');
    } else {
      console.warn('⚠️ No se pudo actualizar el archivo de sesión');
    }
  }

  // Agregar overlay visual para monitoreo en tiempo real
  await agregarOverlay(page);

  // Variable global para contar tweets encontrados
  let tweetsEncontradosCount = 0;
  const startTime = Date.now();

  // Actualizar overlay inicial con información completa
  await actualizarOverlay(page, 0, 'Sistema iniciado - Monitoreo activo', keywords.length, startTime);

  // Notificar inicio exitoso
  if (bot) {
    try {
      await bot.sendMessage(TELEGRAM_CHAT_ID,
        '✅ Monitor Legislativo iniciado correctamente\n' +
        `🔍 Monitoreando ${keywords.length} palabras clave\n` +
        `📍 Manteniendo sesión en deck de X Pro\n` +
        `🎬 Overlay visual activado`
      );
    } catch (notifyError) {
      console.error('Error enviando confirmación de arranque:', notifyError.message);
    }
  }

  // Mantenerse en el deck de X Pro para monitoreo
  console.log('📍 Manteniendo monitor en deck de X Pro');
  console.log('📋 Deck configurado:', TWITTER_PRO_URL);

  // Guardar sesión después de configuración exitosa
  await guardarSesionXPro();

  // Heartbeat para mantener vivo
  heartbeatInterval = setInterval(() => {
    try {
      recoverySystem.updateHeartbeat();
      const uptime = Math.floor((Date.now() - (recoverySystem.lastHeartbeat - process.uptime() * 1000)) / 60000);
      console.log(`💓 Heartbeat - Uptime: ${uptime} min`);

      // Verificar salud del sistema
      if (!recoverySystem.isAlive()) {
        throw new Error('Sistema no responde');
      }
    } catch (error) {
      console.error('Error en heartbeat:', error.message);
      throw error;
    }
  }, 30000); // Cada 30 segundos

  // Auto-scroll periódico
  scrollInterval = setInterval(async () => {
    try {
      await realizarAutoScroll(page);
    } catch (error) {
      console.error('Error en auto-scroll:', error.message);
      recoverySystem.recordError(error);

      if (recoverySystem.shouldRestart()) {
        throw new Error('Demasiados errores de scroll');
      }
    }
  }, 180000); // Cada 3 minutos

  // Verificación de tweets
  checkInterval = setInterval(async () => {
    try {
      const horaVerificacion = new Date().toLocaleTimeString('es-MX');
      console.log(`⏰ [${horaVerificacion}] Iniciando verificación de tweets...`);
      const resultado = await verificarNuevosTweets(page, keywords, tweetsEnviados, tweetsEncontradosCount, startTime, bot);
      if (resultado > 0) {
        tweetsEncontradosCount = resultado;
      }
      console.log(`✅ [${horaVerificacion}] Verificación completada`);
    } catch (error) {
      console.error('Error verificando tweets:', error.message);
      recoverySystem.recordError(error);

      if (recoverySystem.shouldRestart()) {
        throw new Error('Demasiados errores verificando tweets');
      }
    }
  }, 20000); // Cada 20 segundos - más rápido

  // Actualizar overlay periódicamente con información dinámica
  setInterval(async () => {
    try {
      const uptime = Math.floor((Date.now() - startTime) / 1000);
      const minutos = Math.floor(uptime / 60);
      const segundos = uptime % 60;

      // Mensaje dinámico según el tiempo
      let mensajeEstado = 'Monitoreo activo';
      if (segundos % 10 < 5) {
        mensajeEstado = `Escaneando tweets...`;
      } else {
        mensajeEstado = `Analizando contenido (${keywords.length} palabras clave)`;
      }

      await actualizarOverlay(page, tweetsEncontradosCount, mensajeEstado, keywords.length, startTime);
    } catch (error) {
      // Silencioso para no saturar logs
    }
  }, 3000); // Cada 3 segundos para más dinamismo

  // Guardado periódico de sesión (cada 10 minutos)
  const sessionSaveInterval = setInterval(async () => {
    try {
      await guardarSesionXPro();
      console.log('💾 Sesión guardada automáticamente');
    } catch (error) {
      console.error('Error guardando sesión automática:', error.message);
    }
  }, 600000); // Cada 10 minutos

  // Mantener el proceso vivo
  console.log('🤖 Monitor activo. Presiona Ctrl+C para detener...');

  // Manejo de señales
  process.on('SIGINT', async () => {
    console.log('\n🛑 Deteniendo monitor...');
    await limpiarRecursos();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n🛑 Terminando monitor...');
    await limpiarRecursos();
    process.exit(0);
  });

  // Mantener el proceso ejecutándose
  await new Promise(() => {}); // Espera infinita
} catch (error) {
  console.error('❌ Error en monitor:', error.message);
  throw error; // Re-lanzar para que sea manejado por el sistema de recuperación
}

// Función para verificar si necesita inicio de sesión
async function verificarNecesitaLogin(page) {
  try {
    // Esperar un momento a que la página se estabilice
    await page.waitForTimeout(2000);

    // Verificar si la URL actual es de login
    const currentUrl = page.url();
    if (currentUrl.includes('/login') || currentUrl.includes('/i/flow/login')) {
      console.log('🔐 URL de login detectada');
      return true;
    }

    // Verificar si hay elementos de login prominentes
    const loginButton = await page.$('[data-testid="loginButton"]');
    const loginLink = await page.$('a[href="/login"]');
    const emailInput = await page.$('input[type="email"]');
    const passwordInput = await page.$('input[type="password"]');

    // Verificar indicadores de sesión activa
    const composeButton = await page.$('[data-testid="DraftButton"]');
    const profileButton = await page.$('[data-testid="SideNav_AccountSwitcher_Button"]');
    const homeTimeline = await page.$('[data-testid="primaryColumn"]');
    const navigationRail = await page.$('nav[aria-label*="Primary"]');

    // Contar indicadores de login
    const loginIndicators = [loginButton, loginLink, emailInput, passwordInput].filter(Boolean).length;
    const sessionIndicators = [composeButton, profileButton, homeTimeline, navigationRail].filter(Boolean).length;

    console.log(`🔍 Indicadores de login: ${loginIndicators}, Indicadores de sesión: ${sessionIndicators}`);

    // Si hay varios indicadores de sesión, probablemente ya estamos logged in
    if (sessionIndicators >= 2) {
      console.log('🔓 Sesión activa detectada por indicadores positivos');
      return false;
    }

    // Si hay elementos de login y pocos indicadores de sesión, necesita login
    if (loginIndicators > 0 && sessionIndicators === 0) {
      console.log('🔐 Login requerido - se detectaron elementos de login');
      return true;
    }

    // Verificación adicional: buscar texto específico de la página
    const pageText = await page.textContent('body').catch(() => '');
    if (pageText.includes('Sign in to X') || pageText.includes('Log in to Twitter') || pageText.includes('Enter your phone number')) {
      console.log('🔐 Login requerido - texto de login detectado');
      return true;
    }

    // Por defecto, asumir que no necesita login si no hay señales claras
    console.log('🤖 No se detectaron señales claras de login, asumiendo sesión activa');
    return false;

  } catch (error) {
    console.error('Error verificando necesidad de login:', error.message);
    console.log('⚠️ Ante error, asumiendo que necesita login por seguridad');
    return true; // Por defecto, asumir que necesita login
  }
}

// Función para esperar el inicio de sesión
async function esperarInicioSesion(page) {
  const maxEspera = 300000; // 5 minutos
  const startTime = Date.now();

  while (Date.now() - startTime < maxEspera) {
    try {
      const necesitaLogin = await verificarNecesitaLogin(page);
      if (!necesitaLogin) {
        console.log('✅ Inicio de sesión detectado');
        return true;
      }

      // Mostrar tiempo restante
      const tiempoRestante = Math.ceil((maxEspera - (Date.now() - startTime)) / 1000);
      process.stdout.write(`\r⏱️ Esperando inicio de sesión... ${tiempoRestante}s restantes`);

      await page.waitForTimeout(2000);
    } catch (error) {
      console.error('Error verificando estado de login:', error.message);
      await page.waitForTimeout(5000);
    }
  }

  console.log('\n⏰ Tiempo de espera agotado');
  return false;
}

async function guardarSesionXPro() {
  try {
    // Verificar que context y page existan
    if (!context) {
      console.warn('⚠️ No hay contexto para guardar sesión');
      return false;
    }

    // Crear directorio si no existe
    fs.mkdirSync(STORAGE_DIR, { recursive: true });

    // Esperar un momento a que todo se estabilice
    await page.waitForTimeout(1000);

    // Guardar estado completo de la sesión
    await context.storageState({ path: STORAGE_STATE_PATH });

    // Verificar que el archivo se creó correctamente
    if (fs.existsSync(STORAGE_STATE_PATH)) {
      const stats = fs.statSync(STORAGE_STATE_PATH);
      console.log(`✔ Sesión de X Pro guardada (${stats.size} bytes)`);

      // Leer y validar el contenido del archivo
      try {
        const sessionData = JSON.parse(fs.readFileSync(STORAGE_STATE_PATH, 'utf8'));
        if (sessionData.cookies && sessionData.cookies.length > 0) {
          console.log(`🍪 Sesión contiene ${sessionData.cookies.length} cookies`);
          return true;
        } else {
          console.warn('⚠️ Archivo de sesión no contiene cookies');
          return false;
        }
      } catch (readError) {
        console.error('Error leyendo archivo de sesión:', readError.message);
        return false;
      }
    } else {
      console.error('❌ No se pudo crear el archivo de sesión');
      return false;
    }
  } catch (error) {
    console.error('Error guardando sesión de X Pro:', error.message);
    return false;
  }
}



// Función para agregar overlay visual (COMO EN INDEX.JS)
async function agregarOverlay(page) {
  await page.evaluate(() => {
    const div = document.createElement('div');
    div.id = 'overlay-monitor';
    div.style.position = 'fixed';
    div.style.bottom = '20px';
    div.style.left = '50%';
    div.style.transform = 'translateX(-50%)';
    div.style.background = 'rgba(0,0,0,0.9)';
    div.style.color = 'white';
    div.style.padding = '15px 20px';
    div.style.borderRadius = '10px';
    div.style.fontSize = '12px';
    div.style.fontFamily = 'monospace';
    div.style.zIndex = '999999';
    div.style.minWidth = '400px';
    div.style.border = '2px solid rgba(0,255,0,0.3)';
    div.style.boxShadow = '0 0 20px rgba(0,255,0,0.2)';
    div.style.backdropFilter = 'blur(5px)';
    div.innerText = '🤖 Monitor X Pro Robusto - Iniciando...';
    document.body.appendChild(div);
  });
}

// Función para actualizar overlay con información en tiempo real (COMO EN INDEX.JS)
async function actualizarOverlay(page, tweetsEncontrados = 0, ultimoStatus = '', keywordsCount = 0, startTimeParam) {
  const uptime = Math.floor((Date.now() - startTimeParam) / 1000);
  const minutos = Math.floor(uptime / 60);
  const segundos = uptime % 60;

  await page.evaluate(({ encontrados, uptimeMin, uptimeSeg, status, palabrasCount }) => {
    const div = document.getElementById('overlay-monitor');
    if (div) {
      const tiempo = new Date().toLocaleTimeString('es-MX');

      let contenido = `🤖 Monitor X Pro Robusto\n`;
      contenido += `⏰ Uptime: ${uptimeMin}:${uptimeSeg.toString().padStart(2, '0')}\n`;
      contenido += `🔍 Palabras clave: ${palabrasCount}\n`;
      contenido += `📨 Tweets enviados: ${encontrados}\n`;
      contenido += `📅 Hora actual: ${tiempo}\n`;
      contenido += `──────────────────────────────\n`;
      contenido += `📍 Deck: Medios Legislativos Morelos\n`;
      contenido += `🔄 Verificación: Activa cada 20s\n`;

      if (status) {
        contenido += `──────────────────────────────\n`;
        contenido += `✅ Última actividad: ${status}`;
      }

      contenido += `\n💚 Sistema operativo correctamente`;

      div.style.border = '2px solid rgba(0,255,0,0.8)';
      div.style.boxShadow = '0 0 30px rgba(0,255,0,0.6)';
      div.style.background = 'rgba(0,20,0,0.95)';
      div.style.backdropFilter = 'blur(10px)';
      div.innerText = contenido;
    }
  }, {
    encontrados: tweetsEncontrados,
    uptimeMin: minutos,
    uptimeSeg: segundos,
    status: ultimoStatus,
    palabrasCount: keywordsCount
  });
}

// Función para cargar palabras clave
async function cargarPalabrasClave() {
  try {
    const data = await fs.promises.readFile(KEYWORDS_FILE, 'utf8');
    const config = JSON.parse(data);
    const keywords = config.palabras_clave || [];
    console.log(`✅ Cargadas ${keywords.length} palabras clave desde keywords.json`);
    console.log(`🔍 Palabras clave: ${keywords.slice(0, 5).join(', ')}${keywords.length > 5 ? '...' : ''}`);
    return keywords;
  } catch (error) {
    console.error('Error cargando keywords:', error.message);
    const fallback = [
      'Isaac Pimentel', 'Congreso Morelos', 'diputado', 'LVI Legislatura',
      'Andrea Gordillo', 'Jazmín Solano', 'Sergio Livera'
    ];
    console.log(`⚠️ Usando palabras clave fallback: ${fallback.length} términos`);
    return fallback;
  }
}

// Función de auto-scroll
async function realizarAutoScroll(page) {
  const hora = new Date().toLocaleTimeString('es-MX');
  console.log(`🔄 [${hora}] Auto-scroll: Iniciando...`);
  
  try {
    // Buscar todas las columnas
    const columnas = await page.$$('[data-testid="column"]');
    
    if (columnas.length === 0) {
      console.log('⚠️ No se encontraron columnas');
      return;
    }
    
    console.log(`  📋 Encontradas ${columnas.length} columnas`);
    
    // Scroll en cada columna
    for (let i = 0; i < columnas.length; i++) {
      try {
        await columnas[i].evaluate(el => {
          el.scrollTop += 500;
        });
        console.log(`    ✅ Columna ${i + 1}: Scroll aplicado`);
        await page.waitForTimeout(500);
      } catch (e) {
        console.log(`    ⚠️ Columna ${i + 1}: Error en scroll`);
      }
    }
    
    console.log(`  🏁 Auto-scroll completado @ ${hora}`);
  } catch (error) {
    console.error('Error en auto-scroll:', error.message);
    throw error;
  }
}

// Función para verificar tweets
async function verificarNuevosTweets(page, keywords, tweetsEnviados, tweetsEncontradosCount = 0, startTime = 0, bot = null) {
  try {
    // Buscar tweets en todas las columnas
    const tweets = await page.$$('[data-testid="tweet"]');

    console.log(`🔍 Verificando ${tweets.length} tweets encontrados con ${keywords.length} palabras clave`);

    for (const tweet of tweets) {
      try {
        // Obtener texto del tweet
        const texto = await tweet.textContent();
        if (!texto) continue;
        
        // Generar ID único
        const tweetId = crypto.createHash('md5').update(texto).digest('hex').substring(0, 6);
        
        // Verificar si ya fue enviado
        if (tweetsEnviados.has(tweetId)) continue;
        
        // Verificar palabras clave
        const coincide = keywords.some(keyword =>
          texto.toLowerCase().includes(keyword.toLowerCase())
        );

        // Log para depuración (mostrar primeros 100 caracteres del texto)
        if (texto.length > 0) {
          const palabrasCoincidentes = keywords.filter(keyword =>
            texto.toLowerCase().includes(keyword.toLowerCase())
          );

          if (palabrasCoincidentes.length > 0) {
            console.log(`🎯 COINCIDENCIA: ${palabrasCoincidentes.join(', ')}`);
            console.log(`📄 Texto: "${texto.substring(0, 100)}..."`);
          }
        }

        if (coincide) {
          console.log(`🔍 Tweet [${tweetId}] detectado con palabra clave`);

          // Incrementar contador y actualizar overlay
          tweetsEncontradosCount++;
          await actualizarOverlay(page, tweetsEncontradosCount, `Tweet detectado: ${tweetId}`, keywords.length, startTime);

          // Enviar a Telegram (pasar bot como parámetro)
          await enviarATelegram(texto, tweetId, bot);

          // Marcar como enviado inmediatamente para evitar duplicados
          tweetsEnviados.add(tweetId);
          
          // Limpiar Set si es muy grande
          if (tweetsEnviados.size > 10000) {
            const arrayTweets = Array.from(tweetsEnviados);
            arrayTweets.splice(0, 5000); // Eliminar los primeros 5000
            tweetsEnviados.clear();
            arrayTweets.forEach(id => tweetsEnviados.add(id));
          }
        }
      } catch (error) {
        console.error('Error procesando tweet:', error.message);
      }
    }

    // Log de resumen
    console.log(`📊 Resumen de verificación: ${tweets.length} tweets procesados, ${tweetsEnviados.size} únicos registrados`);

    // Retornar el contador actualizado
    return tweetsEncontradosCount;

  } catch (error) {
    console.error('Error verificando tweets:', error.message);
    throw error;
  }
}

// Función para enviar a Telegram
async function enviarATelegram(texto, tweetId, bot) {
  if (!bot) {
    return;
  }

  try {
    const mensaje = `📰 Tweet detectado [${tweetId}]\n\n${texto.substring(0, 500)}`;
    await bot.sendMessage(TELEGRAM_CHAT_ID, mensaje);
    console.log(`✅ Tweet [${tweetId}] enviado a Telegram`);
  } catch (error) {
    console.error('Error enviando a Telegram:', error.message);
  }
}

}

// Iniciar el sistema con recuperación
iniciarMonitorConRecuperacion().catch(error => {
  console.error('Error fatal:', error);
  process.exit(1);
});