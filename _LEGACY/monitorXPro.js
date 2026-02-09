// index.js
import dotenv from 'dotenv';
dotenv.config();

import { chromium } from 'playwright';
import readline from 'readline';
import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import winston from 'winston';

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TWITTER_LIST_URL = 'https://x.com/i/lists/1938329800252232136'; // Lista #MediosMorelos

// Cargar palabras clave desde archivo JSON
let PALABRAS_CLAVE = [];
try {
  const keywordsConfig = JSON.parse(fs.readFileSync('keywords.json', 'utf8'));
  PALABRAS_CLAVE = keywordsConfig.palabras_clave || [];
  console.log(`✅ Cargadas ${PALABRAS_CLAVE.length} palabras clave desde keywords.json`);
} catch (error) {
  console.error('❌ Error cargando keywords.json:', error.message);
  PALABRAS_CLAVE = [
    'Isaac Pimentel', 'Congreso Morelos', 'diputado', 'LVI Legislatura',
    'Andrea Gordillo', 'Jazmín Solano', 'Sergio Livera', 'Guillermina Maya',
    'Eleonor Martínez', 'Luis Pedrero', 'Tania Valentina', 'Ruth Rodríguez'
  ];
  console.log(`🔄 Usando lista fallback con ${PALABRAS_CLAVE.length} palabras clave`);
}

const bot = new TelegramBot(TELEGRAM_TOKEN);

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

// Variables globales para manejo de errores
let crashCount = 0;
const MAX_CRASH_RETRIES = 100;
let browser = null;
let page = null;
let context = null;
let intervalId = null;

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

// Función de limpieza de recursos
async function limpiarRecursos() {
  console.log('🧹 Limpiando recursos...');

  // Guardar estado de la sesión antes de cerrar
  try {
    if (context && page) {
      console.log('💾 Guardando estado de sesión...');
      await context.storageState({ path: 'storage/xpro-session.json' });
      console.log('✅ Estado de sesión guardado.');
    }
  } catch (error) {
    console.error('Error guardando sesión:', error.message);
  }

  // Limpiar intervalos
  if (intervalId) clearInterval(intervalId);

  // Cerrar navegador
  try {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  } catch (error) {
    console.error('Error cerrando navegador:', error.message);
  }

  // Resetear variables
  browser = null;
  page = null;
  context = null;
  intervalId = null;
}

// Función principal con reinicio automático
async function iniciarMonitorConRecuperacion() {
  while (crashCount < MAX_CRASH_RETRIES) {
    try {
      console.log(`\n🚀 Iniciando monitor (intento ${crashCount + 1}/${MAX_CRASH_RETRIES})`);
      await monitorearXPro();
    } catch (error) {
      crashCount++;
      console.error(`\n❌ Error crítico detectado (crash #${crashCount}):`, error.message);
      logger.error(`Crash #${crashCount}`, error);
      
      // Limpiar recursos
      await limpiarRecursos();
      
      // Notificar por Telegram
      try {
        await bot.sendMessage(TELEGRAM_CHAT_ID, 
          `⚠️ Monitor reiniciándose automáticamente\n` +
          `Crash #${crashCount}\n` +
          `Error: ${error.message}\n` +
          `Reiniciando en 30 segundos...`
        );
      } catch (e) {
        console.error('Error enviando notificación:', e.message);
      }
      
      // Esperar antes de reiniciar
      console.log('⏳ Esperando 30 segundos antes de reiniciar...');
      await new Promise(resolve => setTimeout(resolve, 30000));
    }
  }
  
  console.error('❌ Se alcanzó el límite máximo de reinicios. El sistema se detendrá.');
  process.exit(1);
}

async function monitorearXPro() {
  try {
    // Configurar navegador con opciones robustas
    browser = await chromium.launch({ 
      headless: false,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ],
      timeout: 60000
    });
    
    context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      storageState: 'storage/xpro-session.json'
    });
    
    // Manejo de errores de página
    context.on('page', async (newPage) => {
      newPage.on('pageerror', error => {
        console.error('Error en página:', error.message);
        recoverySystem.recordError(error);
      });
      
      newPage.on('crash', async () => {
        console.error('❌ La página se ha bloqueado');
        throw new Error('Page crashed');
      });
    });
    
    page = await context.newPage();
    
    // Configurar timeouts
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(60000);

    console.log('🌐 Iniciando navegador...');
    await page.goto('https://pro.x.com', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    await page.waitForTimeout(10000); // Esperar para que cargue sesión

    if (page.url().includes('login')) {
      await bot.sendMessage(TELEGRAM_CHAT_ID, '❌ No estás logueado en X Pro. Por favor haz login manualmente.');
      console.log('❌ No logueado. Esperando login manual.');
      await page.waitForURL('https://pro.x.com/**', { timeout: 300000 }); // 5 minutos para login
    } else {
      console.log('✅ Ya estás logueado.');
    }

    await page.goto(TWITTER_LIST_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    console.log('📄 Entrando a la lista de medios...');
    await page.waitForTimeout(10000);

    const tweetsYaEnviados = new Set();
    
    // Heartbeat para mantener vivo
    const heartbeatInterval = setInterval(() => {
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
        clearInterval(heartbeatInterval);
        clearInterval(intervalId);
        throw error;
      }
    }, 30000); // Cada 30 segundos

    // Función para manejar el scroll automático y actualización del feed
    async function autoScrollAndUpdate() {
      try {
        // Buscar y hacer click en botones de "Mostrar más tweets"
        const showMoreSelectors = [
        '[role="button"]:has-text("Show")',
        '[aria-label*="more"]',
        'div:has-text("Press to see more Tweets")',
        'div:has-text("Presionar para que aparezcan")',
        '[data-testid="cellInnerDiv"] button'
        ];
        
        for (const selector of showMoreSelectors) {
        try {
          const buttons = await page.$$(selector);
          for (const button of buttons) {
            const isVisible = await button.isVisible();
            if (isVisible) {
              const buttonText = await button.textContent();
              if (buttonText && (
                buttonText.includes('Show') || 
                buttonText.includes('more') || 
                buttonText.includes('Press') ||
                buttonText.includes('Presionar') ||
                buttonText.includes('Ver más') ||
                buttonText.includes('Mostrar')
              )) {
                console.log(`🔄 Actualizando feed: "${buttonText}"`);
                await button.click();
                await page.waitForTimeout(2000);
              }
            }
          }
        } catch (e) {
          // Ignorar errores de elementos que ya no existen
        }
      }

        // Verificar posición del scroll
        const scrollInfo = await page.evaluate(() => {
        const scrollHeight = document.body.scrollHeight;
        const scrollPosition = window.pageYOffset;
        const windowHeight = window.innerHeight;
        const scrollPercentage = (scrollPosition / (scrollHeight - windowHeight)) * 100;
        
        return {
          position: scrollPosition,
          height: scrollHeight,
          percentage: scrollPercentage
        };
      });

        // Si estamos cerca del medio o del final, hacer scroll
        if (scrollInfo.percentage > 40) {
        // Scroll suave hacia abajo
        await page.evaluate(() => {
          window.scrollBy({ 
            top: 600, 
            behavior: 'smooth' 
          });
        });
        }
        
        return scrollInfo;
      } catch (error) {
        console.error('Error en auto-scroll:', error.message);
        recoverySystem.recordError(error);
        return null;
      }
    }



    console.log('🤖 Monitoreo activo. Presiona ENTER para detener...');

    
    let lastScrollPosition = 0;
    let scrollStuckCount = 0;
    let tweetsProcessed = 0;

    intervalId = setInterval(async () => {
    try {
      // Ejecutar auto-scroll primero
      const scrollInfo = await autoScrollAndUpdate();
      
      if (scrollInfo) {
        // Detectar si el scroll está atascado
        if (scrollInfo.position === lastScrollPosition) {
          scrollStuckCount++;
          
          if (scrollStuckCount >= 3) {
            console.log('⚠️ Feed detenido, forzando actualización...');
            
            // Refresh suave del feed
            await page.evaluate(() => {
              window.scrollTo({ top: 0, behavior: 'smooth' });
            });
            await page.waitForTimeout(1500);
            
            await page.evaluate(() => {
              window.scrollTo({ top: window.pageYOffset + 1000, behavior: 'smooth' });
            });
            
            scrollStuckCount = 0;
          }
        } else {
          scrollStuckCount = 0;
          if (tweetsProcessed % 10 === 0) {
            console.log(`📊 Posición: ${Math.round(scrollInfo.percentage)}% - Tweets procesados: ${tweetsProcessed}`);
          }
        }
        
        lastScrollPosition = scrollInfo.position;
      }

      // Obtener y procesar tweets
      const tweets = await page.$$eval('article', articles =>
        articles.map(article => {
          const textContent = article.innerText;
          const linkElement = article.querySelector('a[href*="/status/"]');
          const tweetLink = linkElement ? linkElement.href : null;
          return { text: textContent, link: tweetLink };
        })
      );

      for (const tweet of tweets) {
        if (PALABRAS_CLAVE.some(palabra => tweet.text.toLowerCase().includes(palabra.toLowerCase()))) {
          const tweetId = tweet.link || tweet.text;
          if (!tweetsYaEnviados.has(tweetId)) {
            tweetsYaEnviados.add(tweetId);
            tweetsProcessed++;
            
            const palabraEncontrada = PALABRAS_CLAVE.find(palabra => 
              tweet.text.toLowerCase().includes(palabra.toLowerCase())
            );
            
            let mensaje = `📢 Mención: "${palabraEncontrada}"\n\n${tweet.text.substring(0, 400)}...`;
            if (tweet.link) mensaje += `\n\n🔗 ${tweet.link}`;
            
            await bot.sendMessage(TELEGRAM_CHAT_ID, mensaje);
            console.log(`✅ Tweet #${tweetsProcessed}: ${tweet.text.substring(0, 60)}...`);
          }
        }
      }
      
      // Limpiar memoria periódicamente
      if (tweetsYaEnviados.size > 1000) {
        const arrayTweets = Array.from(tweetsYaEnviados);
        tweetsYaEnviados.clear();
        arrayTweets.slice(-500).forEach(id => tweetsYaEnviados.add(id));
        console.log('🧹 Memoria optimizada');
      }
      
      } catch (error) {
        console.error('Error en monitoreo:', error.message);
        recoverySystem.recordError(error);
        
        // Si hay demasiados errores, reiniciar
        if (recoverySystem.shouldRestart()) {
          clearInterval(intervalId);
          clearInterval(heartbeatInterval);
          throw new Error('Demasiados errores detectados');
        }
      }
    }, 30 * 1000); // Ejecutar cada 30 segundos

    // Crear interfaz para detener
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('', async () => {
      clearInterval(intervalId);
      clearInterval(heartbeatInterval);
      await bot.sendMessage(TELEGRAM_CHAT_ID, '🛑 Monitoreo detenido manualmente.');
      console.log('🛑 Monitoreo detenido manualmente. Cerrando navegador...');
      await limpiarRecursos();
      rl.close();
      process.exit(0);
    });
    
    // Manejo de señales del sistema
    const handleShutdown = async (signal) => {
      console.log(`\n🛑 Recibida señal ${signal}. Guardando sesión y deteniendo monitor...`);

      // Detener intervalos
      if (intervalId) clearInterval(intervalId);
      if (heartbeatInterval) clearInterval(heartbeatInterval);

      // Notificar a Telegram si es posible
      try {
        await bot.sendMessage(TELEGRAM_CHAT_ID, `🛑 Monitor detenido (${signal}). Guardando sesión...`);
      } catch (e) {
        console.log('No se pudo notificar a Telegram');
      }

      // Guardar sesión de forma explícita
      try {
        if (context && page) {
          console.log('💾 Guardando estado de sesión antes de salir...');
          await context.storageState({ path: 'storage/xpro-session.json' });
          console.log('✅ Sesión guardada exitosamente.');
        }
      } catch (error) {
        console.error('❌ Error guardando sesión:', error.message);
      }

      // Limpiar recursos
      await limpiarRecursos();

      console.log('👋 Programa finalizado correctamente.');
      process.exit(0);
    };

    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));

    // También manejar el cierre inesperado
    process.on('uncaughtException', async (error) => {
      console.error('❌ Error no capturado:', error);
      await handleShutdown('UNCAUGHT_EXCEPTION');
    });
    
  } catch (error) {
    console.error('❌ Error en monitor:', error.message);
    throw error; // Re-lanzar para que sea manejado por el sistema de recuperación
  }
}

// Iniciar con sistema de recuperación automática
iniciarMonitorConRecuperacion().catch(error => {
  console.error('Error fatal:', error);
  process.exit(1);
});
