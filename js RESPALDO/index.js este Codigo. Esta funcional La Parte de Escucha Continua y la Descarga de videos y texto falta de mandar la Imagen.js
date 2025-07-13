// index.js
import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import { chromium } from 'playwright';
import readline from 'readline';
import TelegramBot from 'node-telegram-bot-api';
import https from 'https';
import path from 'path';
import { exec } from 'child_process';

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Ruta para videos
const CARPETA_VIDEOS = 'A:/00_AUTOMATIZACIONES/CONGRESO MORELOS/01_Monitoreo) Medios Morelos X/media/2025';

// Cargar palabras clave desde archivo JSON
let PALABRAS_CLAVE = [];
let keywordsConfig = {};

function cargarPalabrasClave() {
  try {
    const keywordsPath = './keywords.json';
    
    if (!fs.existsSync(keywordsPath)) {
      console.log('❌ Archivo keywords.json no encontrado, creando archivo por defecto...');
      crearArchivoKeywordsDefault();
    }
    
    const data = fs.readFileSync(keywordsPath, 'utf8');
    keywordsConfig = JSON.parse(data);
    
    PALABRAS_CLAVE = keywordsConfig.palabras_clave || [];
    
    console.log(`✅ Cargadas ${PALABRAS_CLAVE.length} palabras clave desde keywords.json`);
    console.log(`📅 Última actualización: ${keywordsConfig.configuracion?.ultima_actualizacion || 'N/A'}`);
    
    return true;
  } catch (error) {
    console.error(`❌ Error cargando keywords.json: ${error.message}`);
    return false;
  }
}

function crearArchivoKeywordsDefault() {
  const defaultKeywords = {
    "palabras_clave": [
      "Daniel Martínez Terrazas", "Andrea Valentina Gordillo", "Sergio Omar Livera Chavarría",
      "Guillermina Maya Rendón", "Jazmín Juana Solano López", "Rafael Reyes Reyes",
      "Isaac Pimentel Mejía", "Congreso Morelos", "diputado", "diputada", "LVI Legislatura"
    ],
    "configuracion": {
      "version": "1.0",
      "ultima_actualizacion": new Date().toISOString().split('T')[0],
      "descripcion": "Palabras clave para monitoreo del Congreso de Morelos"
    }
  };
  
  fs.writeFileSync('./keywords.json', JSON.stringify(defaultKeywords, null, 2));
  console.log('📝 Archivo keywords.json creado con configuración por defecto');
}

function recargarPalabrasClave() {
  console.log('🔄 Recargando palabras clave...');
  const anterior = PALABRAS_CLAVE.length;
  
  if (cargarPalabrasClave()) {
    const nuevo = PALABRAS_CLAVE.length;
    console.log(`✅ Palabras clave recargadas: ${anterior} → ${nuevo}`);
    return true;
  }
  return false;
}

// Función para limpiar videos los lunes
function limpiarVideosLunes() {
  const hoy = new Date();
  const diaSemana = hoy.getDay(); // 0 = domingo, 1 = lunes
  
  if (diaSemana === 1) { // Si es lunes
    console.log('🧹 Es lunes, limpiando archivos de video...');
    
    if (fs.existsSync(CARPETA_VIDEOS)) {
      try {
        const archivos = fs.readdirSync(CARPETA_VIDEOS);
        let archivosEliminados = 0;
        
        archivos.forEach(archivo => {
          const rutaArchivo = path.join(CARPETA_VIDEOS, archivo);
          const stats = fs.statSync(rutaArchivo);
          
          // Eliminar solo archivos de video (no carpetas)
          if (stats.isFile() && (
            archivo.endsWith('.mp4') || 
            archivo.endsWith('.webm') || 
            archivo.endsWith('.mkv') || 
            archivo.endsWith('.avi')
          )) {
            fs.unlinkSync(rutaArchivo);
            archivosEliminados++;
          }
        });
        
        console.log(`✅ Limpieza completada: ${archivosEliminados} videos eliminados`);
        bot.sendMessage(TELEGRAM_CHAT_ID, `🧹 Limpieza semanal: ${archivosEliminados} videos eliminados`);
      } catch (error) {
        console.error(`❌ Error en limpieza: ${error.message}`);
      }
    } else {
      console.log('📁 Carpeta de videos no existe, creándola...');
      fs.mkdirSync(CARPETA_VIDEOS, { recursive: true });
    }
  }
}

// Función para descargar video usando yt-dlp
async function descargarVideo(tweetUrl) {
  return new Promise((resolve) => {
    try {
      // Crear carpeta si no existe
      if (!fs.existsSync(CARPETA_VIDEOS)) {
        fs.mkdirSync(CARPETA_VIDEOS, { recursive: true });
      }
      
      const timestamp = Date.now();
      const nombreArchivo = `video_${timestamp}_%(title)s.%(ext)s`;
      
      // Verificar si la URL ya está completa o necesita el dominio
      let urlCompleta;
      if (tweetUrl.startsWith('http')) {
        // Ya es una URL completa
        urlCompleta = tweetUrl;
      } else {
        // Es una ruta relativa, agregar dominio
        urlCompleta = `https://x.com${tweetUrl}`;
      }
      
      console.log(`🎬 Descargando video de: ${urlCompleta}`);
      
      // Comando yt-dlp optimizado
      const comando = `yt-dlp --no-check-certificate --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" -P "${CARPETA_VIDEOS}" -o "${nombreArchivo}" -f "best[ext=mp4]/best" "${urlCompleta}"`;
      
      console.log(`🔧 Ejecutando: yt-dlp para ${urlCompleta}`);
      
      exec(comando, { 
        timeout: 120000, // 2 minutos timeout
        maxBuffer: 1024 * 1024 * 10 // 10MB buffer
      }, (error, stdout, stderr) => {
        if (stdout) console.log(`📝 yt-dlp output: ${stdout}`);
        if (stderr) console.log(`⚠️ yt-dlp stderr: ${stderr}`);
        
        if (error) {
          console.error(`❌ Error descargando video: ${error.message}`);
          resolve(null);
          return;
        }
        
        // Buscar archivo descargado
        try {
          const archivos = fs.readdirSync(CARPETA_VIDEOS);
          const archivoDescargado = archivos.find(archivo => 
            archivo.startsWith(`video_${timestamp}`) && 
            (archivo.endsWith('.mp4') || archivo.endsWith('.webm') || archivo.endsWith('.mkv'))
          );
          
          if (archivoDescargado) {
            const rutaCompleta = path.join(CARPETA_VIDEOS, archivoDescargado);
            console.log(`✅ Video descargado: ${archivoDescargado}`);
            resolve(rutaCompleta);
          } else {
            console.log(`❌ No se encontró archivo descargado con timestamp ${timestamp}`);
            resolve(null);
          }
        } catch (err) {
          console.error(`❌ Error buscando archivo descargado: ${err.message}`);
          resolve(null);
        }
      });
    } catch (error) {
      console.error(`❌ Error preparando descarga: ${error.message}`);
      resolve(null);
    }
  });
}

// Función para extraer texto limpio del tweet
function extraerTextoTweet(textoCompleto) {
  // Dividir por líneas y limpiar
  const lineas = textoCompleto.split('\n');
  
  // Filtrar líneas que no son contenido del tweet
  const lineasFiltradas = lineas.filter(linea => {
    const lineaLimpia = linea.trim();
    
    // Filtrar líneas vacías
    if (!lineaLimpia) return false;
    
    // Filtrar metadatos típicos de Twitter
    if (lineaLimpia.includes('Retweet')) return false;
    if (lineaLimpia.includes('Like')) return false;
    if (lineaLimpia.includes('Reply')) return false;
    if (lineaLimpia.includes('Share')) return false;
    if (lineaLimpia.match(/^\d+[mkMK]?$/)) return false; // números como 1.2k, 500, etc.
    if (lineaLimpia.includes('Show this thread')) return false;
    if (lineaLimpia.includes('Translate')) return false;
    if (lineaLimpia.match(/^\d{1,2}:\d{2}\s*(AM|PM)?$/i)) return false; // horas
    if (lineaLimpia.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i)) return false; // fechas
    
    return true;
  });
  
  // Unir las líneas filtradas
  let textoLimpio = lineasFiltradas.join('\n').trim();
  
  // Eliminar múltiples saltos de línea consecutivos
  textoLimpio = textoLimpio.replace(/\n\n+/g, '\n\n');
  
  return textoLimpio;
}

const LISTA_URL = 'https://pro.x.com/i/decks/1853883906551898346';
const USER_DATA_DIR = './sesion-x';
const bot = new TelegramBot(TELEGRAM_TOKEN);
const resumenDiario = { total: 0, enviados: 0, menciones: {} };
const historialTweets = new Set();

// Comandos de Telegram para gestionar palabras clave
bot.onText(/\/keywords/, async (msg) => {
  const mensaje = `📝 *Configuración de Palabras Clave*\n\n` +
                 `📊 Total de palabras: ${PALABRAS_CLAVE.length}\n` +
                 `📅 Última actualización: ${keywordsConfig.configuracion?.ultima_actualizacion || 'N/A'}\n` +
                 `📄 Versión: ${keywordsConfig.configuracion?.version || 'N/A'}\n\n` +
                 `Para modificar las palabras clave:\n` +
                 `1. Edita el archivo keywords.json\n` +
                 `2. Usa /reload para recargar`;
  
  await bot.sendMessage(msg.chat.id, mensaje, { parse_mode: 'Markdown' });
});

bot.onText(/\/reload/, async (msg) => {
  await bot.sendMessage(msg.chat.id, '🔄 Recargando palabras clave...');
  
  if (recargarPalabrasClave()) {
    const mensaje = `✅ *Palabras clave recargadas*\n\n` +
                   `📊 Total de palabras: ${PALABRAS_CLAVE.length}\n` +
                   `📅 Última actualización: ${keywordsConfig.configuracion?.ultima_actualizacion || 'N/A'}`;
    
    await bot.sendMessage(msg.chat.id, mensaje, { parse_mode: 'Markdown' });
  } else {
    await bot.sendMessage(msg.chat.id, '❌ Error recargando palabras clave. Revisa el archivo keywords.json');
  }
});

bot.onText(/\/add (.+)/, async (msg, match) => {
  const nuevaPalabra = match[1].trim();
  
  if (!PALABRAS_CLAVE.includes(nuevaPalabra)) {
    PALABRAS_CLAVE.push(nuevaPalabra);
    
    // Actualizar archivo JSON
    keywordsConfig.palabras_clave = PALABRAS_CLAVE;
    keywordsConfig.configuracion.ultima_actualizacion = new Date().toISOString().split('T')[0];
    
    fs.writeFileSync('./keywords.json', JSON.stringify(keywordsConfig, null, 2));
    
    await bot.sendMessage(msg.chat.id, `✅ Palabra clave agregada: "${nuevaPalabra}"\nTotal: ${PALABRAS_CLAVE.length} palabras`);
    console.log(`➕ Palabra clave agregada via Telegram: ${nuevaPalabra}`);
  } else {
    await bot.sendMessage(msg.chat.id, `⚠️ La palabra "${nuevaPalabra}" ya existe en la lista`);
  }
});

bot.onText(/\/remove (.+)/, async (msg, match) => {
  const palabraRemover = match[1].trim();
  const index = PALABRAS_CLAVE.findIndex(p => p.toLowerCase() === palabraRemover.toLowerCase());
  
  if (index !== -1) {
    PALABRAS_CLAVE.splice(index, 1);
    
    // Actualizar archivo JSON
    keywordsConfig.palabras_clave = PALABRAS_CLAVE;
    keywordsConfig.configuracion.ultima_actualizacion = new Date().toISOString().split('T')[0];
    
    fs.writeFileSync('./keywords.json', JSON.stringify(keywordsConfig, null, 2));
    
    await bot.sendMessage(msg.chat.id, `✅ Palabra clave removida: "${palabraRemover}"\nTotal: ${PALABRAS_CLAVE.length} palabras`);
    console.log(`➖ Palabra clave removida via Telegram: ${palabraRemover}`);
  } else {
    await bot.sendMessage(msg.chat.id, `⚠️ La palabra "${palabraRemover}" no se encontró en la lista`);
  }
});

async function agregarOverlay(page) {
  await page.evaluate(() => {
    const div = document.createElement('div');
    div.id = 'overlay-monitor';
    div.style.position = 'fixed';
    div.style.top = '10px';
    div.style.left = '10px';
    div.style.background = 'rgba(0,0,0,0.7)';
    div.style.color = 'white';
    div.style.padding = '8px';
    div.style.zIndex = 9999;
    div.style.fontFamily = 'monospace';
    div.innerText = '⏳ Esperando...';
    document.body.appendChild(div);
  });
}

async function actualizarOverlay(page, segundosRestantes, tweetsEncontrados) {
  await page.evaluate(({ segundos, encontrados }) => {
    const div = document.getElementById('overlay-monitor');
    if (div) {
      div.innerText = `🔁 Refrescando en: ${segundos}s\n✅ Últimos encontrados: ${encontrados}`;
    }
  }, { segundos: segundosRestantes, encontrados: tweetsEncontrados });
}

async function descargarImagen(url) {
  return new Promise((resolve, reject) => {
    const filename = path.basename(url);
    const filepath = path.join('./', filename);
    const file = fs.createWriteStream(filepath);
    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => file.close(() => resolve(filepath)));
    }).on('error', reject);
  });
}

async function monitorearListaX() {
  console.log('🌐 Iniciando navegador...');

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, { headless: false });
  const page = await context.newPage();
  await page.goto(LISTA_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(10000);

  if (page.url().includes('login')) {
    await bot.sendMessage(TELEGRAM_CHAT_ID, '❌ No estás logueado en X. Por favor inicia sesión manualmente.');
    console.log('❌ No logueado. Esperando login manual.');
    await page.waitForURL('https://x.com/', { timeout: 0 });
    console.log('🔐 Login completado. Continuando...');
  } else {
    console.log('✅ Ya estás logueado.');
  }

  console.log('📄 Monitoreando X Pro en múltiples columnas visibles...');
  await agregarOverlay(page);

  const inicioHora = Date.now() - (60 * 60 * 1000);
  console.log('🤖 Monitoreo activo. Presiona ENTER para detener...');

  let segundos = 30;
  let tweetsEncontrados = 0;

  const intervaloVisual = setInterval(() => {
    segundos -= 1;
    if (segundos < 0) segundos = 30;
    actualizarOverlay(page, segundos, tweetsEncontrados);
  }, 1000);

  const intervaloBusqueda = setInterval(async () => {
    try {
      segundos = 30;
      const now = Date.now();
      const tweets = await page.$$('article');

      for (const tweetElement of tweets) {
        const innerText = await tweetElement.innerText();
        const timestampAttr = await tweetElement.$('time');
        if (!timestampAttr) continue;

        const timeISO = await timestampAttr.getAttribute('datetime');
        const timeMs = new Date(timeISO).getTime();
        if (timeMs < inicioHora || timeMs > now) continue;

        const link = await tweetElement.$('a[href*="/status/"]');
        if (!link) continue;

        const url = await link.getAttribute('href');
        if (historialTweets.has(url)) continue;
        historialTweets.add(url);

        // Debug: verificar qué URL se está extrayendo
        console.log(`🔍 URL extraída: "${url}"`);

        // Usar las palabras clave cargadas desde el archivo JSON
        const contieneClave = PALABRAS_CLAVE.some(p => innerText.includes(p));
        if (!contieneClave) continue;

        resumenDiario.total++;
        resumenDiario.enviados++;

        // Extraer texto limpio del tweet
        const textoTweet = extraerTextoTweet(innerText);
        
        // Contar menciones usando las palabras del archivo
        PALABRAS_CLAVE.forEach(palabra => {
          if (innerText.includes(palabra)) {
            resumenDiario.menciones[palabra] = (resumenDiario.menciones[palabra] || 0) + 1;
          }
        });

        const media = await tweetElement.$('img');
        const video = await tweetElement.$('video');
        
        // Generar URL completa del tweet para mostrar
        let tweetUrlCompleta;
        if (url.startsWith('http')) {
          tweetUrlCompleta = url;
        } else {
          tweetUrlCompleta = `https://x.com${url}`;
        }

        // Procesar videos PRIMERO
        if (video) {
          console.log('🎬 Video detectado en tweet');
          
          try {
            const rutaVideo = await descargarVideo(url);
            
            if (rutaVideo && fs.existsSync(rutaVideo)) {
              // Enviar texto del tweet + video
              await bot.sendVideo(TELEGRAM_CHAT_ID, rutaVideo, { 
                caption: `${textoTweet}\n\n🔗 ${tweetUrlCompleta}` 
              });
              
              console.log(`✅ Video enviado: ${path.basename(rutaVideo)}`);
              tweetsEncontrados++;
              
              // Opcional: eliminar video después de enviar para ahorrar espacio inmediatamente
              // setTimeout(() => {
              //   if (fs.existsSync(rutaVideo)) {
              //     fs.unlinkSync(rutaVideo);
              //     console.log(`🗑️ Video eliminado: ${path.basename(rutaVideo)}`);
              //   }
              // }, 5000);
              
            } else {
              // Si falla la descarga, enviar mensaje con nota
              await bot.sendMessage(TELEGRAM_CHAT_ID, 
                `${textoTweet}\n\n🔗 ${tweetUrlCompleta}\n\n⚠️ Video no se pudo descargar`
              );
              tweetsEncontrados++;
            }
          } catch (error) {
            console.error(`❌ Error procesando video: ${error.message}`);
            await bot.sendMessage(TELEGRAM_CHAT_ID, 
              `${textoTweet}\n\n🔗 ${tweetUrlCompleta}\n\n❌ Error descargando video`
            );
            tweetsEncontrados++;
          }
          
          continue; // Ir al siguiente tweet
        }

        // Procesar imágenes
        if (media) {
          const src = await media.getAttribute('src');
          if (src && !src.includes('profile_images')) {
            try {
              const pathImagen = await descargarImagen(src);
              await bot.sendPhoto(TELEGRAM_CHAT_ID, pathImagen, { 
                caption: `${textoTweet}\n\n🔗 ${tweetUrlCompleta}` 
              });
              fs.unlinkSync(pathImagen);
              tweetsEncontrados++;
            } catch (error) {
              console.error(`❌ Error descargando imagen: ${error.message}`);
              await bot.sendMessage(TELEGRAM_CHAT_ID, `${textoTweet}\n\n🔗 ${tweetUrlCompleta}`);
              tweetsEncontrados++;
            }
            continue;
          }
        }

        // Tweet solo de texto
        await bot.sendMessage(TELEGRAM_CHAT_ID, `${textoTweet}\n\n🔗 ${tweetUrlCompleta}`);
        tweetsEncontrados++;
        console.log(`✅ Enviado: ${textoTweet.substring(0, 80)}...`);
      }
    } catch (err) {
      console.error('❌ Error durante el monitoreo:', err.message);
    }
  }, 30000);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('', async () => {
    clearInterval(intervaloVisual);
    clearInterval(intervaloBusqueda);

    const resumen = Object.entries(resumenDiario.menciones)
      .sort(([, a], [, b]) => b - a)
      .map(([k, v]) => `- ${k}: ${v}`)
      .join('\n');

    const resumenTexto = `🧾 Resumen Diario:\n- Menciones totales: ${resumenDiario.total}\n- Tweets enviados: ${resumenDiario.enviados}\n- Más mencionados:\n${resumen}`;

    await bot.sendMessage(TELEGRAM_CHAT_ID, resumenTexto);
    await bot.sendMessage(TELEGRAM_CHAT_ID, '🛑 Monitoreo detenido manualmente.');
    console.log('🛑 Monitoreo detenido manualmente. Cerrando navegador...');
    await context.close();
    rl.close();
  });
}

// Inicializar cargando palabras clave
console.log('🚀 Monitor de X Pro Deck iniciado');

// Limpiar videos si es lunes
limpiarVideosLunes();

if (!cargarPalabrasClave()) {
  console.error('❌ Error crítico: No se pudieron cargar las palabras clave');
  process.exit(1);
}

console.log(`🔑 Palabras clave cargadas: ${PALABRAS_CLAVE.length}`);
console.log(`📁 Carpeta de videos: ${CARPETA_VIDEOS}`);

// Enviar notificación de inicio con información de keywords
bot.sendMessage(TELEGRAM_CHAT_ID, 
  `🚀 *Monitor X Pro Deck Iniciado*\n\n` +
  `🔑 Palabras clave: ${PALABRAS_CLAVE.length} términos\n` +
  `📁 Carpeta videos: ${CARPETA_VIDEOS}\n` +
  `📅 Última actualización: ${keywordsConfig.configuracion?.ultima_actualizacion || 'N/A'}\n` +
  `🕐 Inicio: ${new Date().toLocaleString('es-MX')}\n\n` +
  `Comandos disponibles:\n` +
  `• /keywords - Ver configuración de palabras\n` +
  `• /reload - Recargar keywords.json\n` +
  `• /add <palabra> - Agregar palabra clave\n` +
  `• /remove <palabra> - Quitar palabra clave\n\n` +
  `📹 Videos se descargan automáticamente\n` +
  `🧹 Limpieza automática los lunes`,
  { parse_mode: 'Markdown' }
).catch(console.error);

monitorearListaX();

// este Codigo. Esta funcional La Parte de Escucha Continua y la Descarga de videos y texto falta de mandar la Imagen.