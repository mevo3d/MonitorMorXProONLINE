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

// Rutas específicas para diferentes tipos de archivos
const CARPETA_BASE = 'A:/00_AUTOMATIZACIONES/CONGRESO MORELOS/01_Monitoreo) Medios Morelos X/media/2025';
const CARPETA_VIDEOS = path.join(CARPETA_BASE, 'video');
const CARPETA_IMAGENES = path.join(CARPETA_BASE, 'img');
const CARPETA_LOGS = path.join(CARPETA_BASE, 'logs');
const RUTA_LOG_URLS = path.join(CARPETA_LOGS, 'urls_procesadas.txt');

// Sistema de IDs únicos
let contadorSecuencial = 1;
const idsGenerados = new Set(); // Para evitar duplicados
let videosFallidos = []; // Para videos que fallan al descargar

// Cargar palabras clave desde archivo JSON
let PALABRAS_CLAVE = [];
let keywordsConfig = {};

// Función para generar ID único de 6 caracteres alfanuméricos
function generarIDUnico() {
  const caracteres = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id;
  
  do {
    // Combinar timestamp + contador secuencial + aleatorio
    const timestamp = Date.now().toString(36).slice(-3); // Últimos 3 caracteres del timestamp en base 36
    const secuencial = contadorSecuencial.toString(36).toUpperCase().padStart(2, '0'); // 2 caracteres del contador
    const aleatorio = caracteres[Math.floor(Math.random() * caracteres.length)]; // 1 carácter aleatorio
    
    id = timestamp + secuencial + aleatorio;
    contadorSecuencial++;
    
    // Si el contador llega a 1296 (36^2), reiniciar
    if (contadorSecuencial > 1296) {
      contadorSecuencial = 1;
    }
    
  } while (idsGenerados.has(id)); // Asegurar que no se repita
  
  idsGenerados.add(id);
  
  // Limpiar set cada 10000 IDs para evitar memoria excesiva
  if (idsGenerados.size > 10000) {
    idsGenerados.clear();
  }
  
  return id;
}

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

// Función para crear todas las carpetas necesarias
function crearCarpetas() {
  const carpetas = [CARPETA_BASE, CARPETA_VIDEOS, CARPETA_IMAGENES, CARPETA_LOGS];
  
  carpetas.forEach(carpeta => {
    if (!fs.existsSync(carpeta)) {
      fs.mkdirSync(carpeta, { recursive: true });
      console.log(`📁 Carpeta creada: ${carpeta}`);
    }
  });
}

// Función para registrar URLs procesadas en log con ID
function registrarURLEnLog(url, tipo, palabrasClave, autor = 'Desconocido', tweetId) {
  const timestamp = new Date().toLocaleString('es-MX', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  
  const entrada = `[${timestamp}] [${tweetId}] ${tipo} - ${autor} - ${palabrasClave.join(', ')} - ${url}\n`;
  
  try {
    fs.appendFileSync(RUTA_LOG_URLS, entrada);
  } catch (error) {
    console.error(`❌ Error escribiendo log [${tweetId}]: ${error.message}`);
  }
}

// Función para limpiar archivos los lunes
function limpiarArchivosLunes() {
  const hoy = new Date();
  const diaSemana = hoy.getDay(); // 0 = domingo, 1 = lunes
  
  if (diaSemana === 1) { // Si es lunes
    console.log('🧹 Es lunes, limpiando archivos...');
    
    let archivosEliminados = 0;
    
    // Limpiar videos
    if (fs.existsSync(CARPETA_VIDEOS)) {
      try {
        const archivosVideo = fs.readdirSync(CARPETA_VIDEOS);
        archivosVideo.forEach(archivo => {
          const rutaArchivo = path.join(CARPETA_VIDEOS, archivo);
          const stats = fs.statSync(rutaArchivo);
          
          if (stats.isFile() && (archivo.endsWith('.mp4') || archivo.endsWith('.webm') || archivo.endsWith('.mkv'))) {
            fs.unlinkSync(rutaArchivo);
            archivosEliminados++;
          }
        });
      } catch (error) {
        console.error(`❌ Error limpiando videos: ${error.message}`);
      }
    }
    
    // Limpiar imágenes
    if (fs.existsSync(CARPETA_IMAGENES)) {
      try {
        const archivosImg = fs.readdirSync(CARPETA_IMAGENES);
        archivosImg.forEach(archivo => {
          const rutaArchivo = path.join(CARPETA_IMAGENES, archivo);
          const stats = fs.statSync(rutaArchivo);
          
          if (stats.isFile() && (archivo.endsWith('.jpg') || archivo.endsWith('.jpeg') || archivo.endsWith('.png') || archivo.endsWith('.gif'))) {
            fs.unlinkSync(rutaArchivo);
            archivosEliminados++;
          }
        });
      } catch (error) {
        console.error(`❌ Error limpiando imágenes: ${error.message}`);
      }
    }
    
    console.log(`✅ Limpieza completada: ${archivosEliminados} archivos eliminados`);
    bot.sendMessage(TELEGRAM_CHAT_ID, `🧹 Limpieza semanal: ${archivosEliminados} archivos eliminados`);
  }
}

// Función mejorada para descargar video con ID único
async function descargarVideo(tweetUrl, tweetId, esReintento = false) {
  return new Promise((resolve) => {
    try {
      // Nombre de archivo con ID del tweet
      const nombreArchivo = `video_${tweetId}.%(ext)s`;
      
      // Verificar si la URL ya está completa o necesita el dominio
      let urlCompleta;
      if (tweetUrl.startsWith('http')) {
        urlCompleta = tweetUrl;
      } else {
        urlCompleta = `https://x.com${tweetUrl}`;
      }
      
      console.log(`🎬 ${esReintento ? 'Reintentando' : 'Descargando'} video [${tweetId}]: ${urlCompleta}`);
      
      // Comando yt-dlp optimizado con nombre basado en ID
      const comando = `yt-dlp --no-check-certificate --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" --encoding utf-8 -P "${CARPETA_VIDEOS}" -o "${nombreArchivo}" -f "best[ext=mp4]/best" "${urlCompleta}"`;
      
      console.log(`🔧 Ejecutando: yt-dlp para video [${tweetId}]`);
      
      exec(comando, { 
        timeout: 120000, // 2 minutos timeout
        maxBuffer: 1024 * 1024 * 10, // 10MB buffer
        encoding: 'utf8'
      }, (error, stdout, stderr) => {
        if (stdout) console.log(`📝 yt-dlp output [${tweetId}]: ${stdout}`);
        if (stderr) console.log(`⚠️ yt-dlp stderr [${tweetId}]: ${stderr}`);
        
        if (error) {
          console.error(`❌ Error descargando video [${tweetId}]: ${error.message}`);
          
          // Guardar para reintento si no es ya un reintento
          if (!esReintento) {
            videosFallidos.push({
              id: tweetId,
              url: urlCompleta,
              timestamp: new Date().toISOString(),
              error: error.message
            });
            console.log(`💾 Video [${tweetId}] guardado para reintento. Total fallidos: ${videosFallidos.length}`);
          }
          
          resolve(null);
          return;
        }
        
        // Buscar archivo descargado
        try {
          const archivos = fs.readdirSync(CARPETA_VIDEOS);
          const archivoDescargado = archivos.find(archivo => 
            archivo.startsWith(`video_${tweetId}`) && 
            (archivo.endsWith('.mp4') || archivo.endsWith('.webm') || archivo.endsWith('.mkv'))
          );
          
          if (archivoDescargado) {
            const rutaCompleta = path.join(CARPETA_VIDEOS, archivoDescargado);
            console.log(`✅ Video descargado [${tweetId}]: ${archivoDescargado}`);
            resolve(rutaCompleta);
          } else {
            console.log(`❌ No se encontró archivo descargado [${tweetId}]`);
            
            // Guardar para reintento si no es ya un reintento
            if (!esReintento) {
              videosFallidos.push({
                id: tweetId,
                url: urlCompleta,
                timestamp: new Date().toISOString(),
                error: 'Archivo no encontrado después de descarga'
              });
            }
            
            resolve(null);
          }
        } catch (err) {
          console.error(`❌ Error buscando archivo descargado [${tweetId}]: ${err.message}`);
          resolve(null);
        }
      });
    } catch (error) {
      console.error(`❌ Error preparando descarga [${tweetId}]: ${error.message}`);
      resolve(null);
    }
  });
}

// Función mejorada para descargar imagen con ID único
async function descargarImagen(url, tweetId) {
  return new Promise((resolve, reject) => {
    try {
      // Extraer extensión de la URL o usar jpg por defecto
      const extension = path.extname(url.split('?')[0]) || '.jpg';
      const nombreArchivo = `img_${tweetId}${extension}`;
      const rutaCompleta = path.join(CARPETA_IMAGENES, nombreArchivo);
      
      console.log(`🖼️ Descargando imagen [${tweetId}]: ${nombreArchivo}`);
      
      const archivo = fs.createWriteStream(rutaCompleta);
      
      const timeout = setTimeout(() => {
        archivo.destroy();
        reject(new Error(`Timeout descargando imagen [${tweetId}]`));
      }, 30000);
      
      https.get(url, (response) => {
        if (response.statusCode !== 200) {
          clearTimeout(timeout);
          reject(new Error(`HTTP ${response.statusCode} para imagen [${tweetId}]`));
          return;
        }
        
        response.pipe(archivo);
        archivo.on('finish', () => {
          clearTimeout(timeout);
          archivo.close(() => {
            console.log(`✅ Imagen descargada [${tweetId}]: ${nombreArchivo}`);
            resolve(rutaCompleta);
          });
        });
      }).on('error', (error) => {
        clearTimeout(timeout);
        reject(new Error(`Error descargando imagen [${tweetId}]: ${error.message}`));
      });
    } catch (error) {
      reject(new Error(`Error preparando descarga imagen [${tweetId}]: ${error.message}`));
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

// Función para extraer autor del tweet
async function extraerAutor(tweetElement) {
  try {
    // Buscar diferentes posibles selectores para el autor
    const posiblesSelectores = [
      '[data-testid="User-Name"]',
      '[data-testid="User-Names"]', 
      'a[role="link"][href*="/"]',
      '[dir="ltr"] span'
    ];
    
    for (const selector of posiblesSelectores) {
      const autorElement = await tweetElement.$(selector);
      if (autorElement) {
        const texto = await autorElement.innerText();
        if (texto && !texto.includes('@') && texto.length < 50) {
          return texto.split('\n')[0].trim(); // Tomar solo la primera línea
        }
      }
    }
    
    return 'Usuario desconocido';
  } catch (error) {
    return 'Usuario desconocido';
  }
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

// Comando para reintentar descargas de videos fallidos
bot.onText(/\/DVideo/, async (msg) => {
  if (videosFallidos.length === 0) {
    await bot.sendMessage(msg.chat.id, '✅ No hay videos fallidos para reintentar');
    return;
  }
  
  await bot.sendMessage(msg.chat.id, `🔄 Reintentando descarga de ${videosFallidos.length} videos...`);
  
  let exitosos = 0;
  let fallidos = 0;
  
  for (const videoFallido of videosFallidos) {
    try {
      console.log(`🔄 Reintentando [${videoFallido.id}]: ${videoFallido.url}`);
      const rutaVideo = await descargarVideo(videoFallido.url, videoFallido.id, true);
      
      if (rutaVideo && fs.existsSync(rutaVideo)) {
        // Enviar video exitoso
        await bot.sendVideo(TELEGRAM_CHAT_ID, rutaVideo, { 
          caption: `🔄 Video descargado en reintento\n📅 Fallo original: ${new Date(videoFallido.timestamp).toLocaleString('es-MX')}\n\n🆔 ${videoFallido.id}` 
        });
        exitosos++;
      } else {
        fallidos++;
      }
      
      // Pausa entre reintentos para no saturar
      await new Promise(resolve => setTimeout(resolve, 3000));
      
    } catch (error) {
      console.error(`❌ Error en reintento [${videoFallido.id}]: ${error.message}`);
      fallidos++;
    }
  }
  
  // Limpiar lista de fallidos
  videosFallidos = [];
  
  const mensaje = `📊 *Resultado de reintentos:*\n\n` +
                 `✅ Exitosos: ${exitosos}\n` +
                 `❌ Fallidos: ${fallidos}\n\n` +
                 `Lista de pendientes limpiada`;
  
  await bot.sendMessage(msg.chat.id, mensaje, { parse_mode: 'Markdown' });
});

// Comando para ver videos fallidos con IDs
bot.onText(/\/VFallidos/, async (msg) => {
  if (videosFallidos.length === 0) {
    await bot.sendMessage(msg.chat.id, '✅ No hay videos fallidos');
    return;
  }
  
  let mensaje = `📋 *Videos Fallidos (${videosFallidos.length}):*\n\n`;
  
  videosFallidos.forEach((video, index) => {
    const fecha = new Date(video.timestamp).toLocaleString('es-MX');
    const urlCorta = video.url.length > 45 ? video.url.substring(0, 45) + '...' : video.url;
    mensaje += `${index + 1}. 🆔 ${video.id}\n📱 ${urlCorta}\n📅 ${fecha}\n❌ ${video.error.substring(0, 80)}\n\n`;
  });
  
  mensaje += `Usa /DVideo para reintentar todos`;
  
  await bot.sendMessage(msg.chat.id, mensaje, { parse_mode: 'Markdown' });
});

// Comando para limpiar lista de videos fallidos
bot.onText(/\/LimpiarFallidos/, async (msg) => {
  const cantidad = videosFallidos.length;
  videosFallidos = [];
  await bot.sendMessage(msg.chat.id, `🧹 Lista de videos fallidos limpiada (${cantidad} videos eliminados)`);
});

// Comando de ayuda
bot.onText(/\/help/, async (msg) => {
  const mensaje = `📝 *Comandos Disponibles:*\n\n` +
                 `*📋 Palabras Clave:*\n` +
                 `• /keywords - Ver configuración\n` +
                 `• /reload - Recargar keywords.json\n` +
                 `• /add <palabra> - Agregar palabra\n` +
                 `• /remove <palabra> - Quitar palabra\n\n` +
                 `*🎥 Videos:*\n` +
                 `• /DVideo - Reintentar videos fallidos\n` +
                 `• /VFallidos - Ver lista de fallidos\n` +
                 `• /LimpiarFallidos - Limpiar lista\n\n` +
                 `*ℹ️ General:*\n` +
                 `• /help - Mostrar esta ayuda`;
  
  await bot.sendMessage(msg.chat.id, mensaje, { parse_mode: 'Markdown' });
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

        // Usar las palabras clave cargadas desde el archivo JSON
        const palabrasEncontradas = PALABRAS_CLAVE.filter(p => innerText.includes(p));
        if (palabrasEncontradas.length === 0) continue;

        // GENERAR ID ÚNICO AL INICIO DEL PROCESAMIENTO
        const tweetId = generarIDUnico();
        
        console.log(`🔍 Procesando tweet [${tweetId}]`);

        resumenDiario.total++;
        resumenDiario.enviados++;

        // Extraer texto limpio del tweet y autor
        const textoTweet = extraerTextoTweet(innerText);
        const autor = await extraerAutor(tweetElement);
        
        // Generar URL completa del tweet
        let tweetUrlCompleta;
        if (url.startsWith('http')) {
          tweetUrlCompleta = url;
        } else {
          tweetUrlCompleta = `https://x.com${url}`;
        }
        
        // Contar menciones usando las palabras del archivo
        PALABRAS_CLAVE.forEach(palabra => {
          if (innerText.includes(palabra)) {
            resumenDiario.menciones[palabra] = (resumenDiario.menciones[palabra] || 0) + 1;
          }
        });

        const media = await tweetElement.$('img');
        const video = await tweetElement.$('video');

        // Procesar videos PRIMERO
        if (video) {
          console.log(`🎬 Video detectado en tweet [${tweetId}]`);
          
          // Registrar en log CON ID
          registrarURLEnLog(tweetUrlCompleta, 'VIDEO', palabrasEncontradas, autor, tweetId);
          
          try {
            const rutaVideo = await descargarVideo(url, tweetId);
            
            if (rutaVideo && fs.existsSync(rutaVideo)) {
              // Enviar solo texto + video (SIN enlace) CON ID
              await bot.sendVideo(TELEGRAM_CHAT_ID, rutaVideo, { 
                caption: `${textoTweet}\n\n🆔 ${tweetId}` 
              });
              
              console.log(`✅ Video enviado [${tweetId}]: ${path.basename(rutaVideo)}`);
              tweetsEncontrados++;
              
            } else {
              // Si falla la descarga, enviar mensaje con nota
              await bot.sendMessage(TELEGRAM_CHAT_ID, 
                `${textoTweet}\n\n⚠️ Video no se pudo descargar\n🆔 ${tweetId}`
              );
              tweetsEncontrados++;
            }
          } catch (error) {
            console.error(`❌ Error procesando video [${tweetId}]: ${error.message}`);
            await bot.sendMessage(TELEGRAM_CHAT_ID, 
              `${textoTweet}\n\n❌ Error descargando video\n🆔 ${tweetId}`
            );
            tweetsEncontrados++;
          }
          
          continue; // Ir al siguiente tweet
        }

        // Procesar imágenes
        if (media) {
          const src = await media.getAttribute('src');
          if (src && !src.includes('profile_images')) {
            console.log(`🖼️ Imagen detectada en tweet [${tweetId}]`);
            
            // Registrar en log CON ID
            registrarURLEnLog(tweetUrlCompleta, 'IMAGEN', palabrasEncontradas, autor, tweetId);
            
            try {
              const rutaImagen = await descargarImagen(src, tweetId);
              
              if (rutaImagen && fs.existsSync(rutaImagen)) {
                // Enviar solo texto + imagen (SIN enlace) CON ID
                await bot.sendPhoto(TELEGRAM_CHAT_ID, rutaImagen, { 
                  caption: `${textoTweet}\n\n🆔 ${tweetId}` 
                });
                
                console.log(`✅ Imagen enviada [${tweetId}]: ${path.basename(rutaImagen)}`);
                tweetsEncontrados++;
              } else {
                // Si falla la descarga, enviar solo texto con enlace
                await bot.sendMessage(TELEGRAM_CHAT_ID, `${textoTweet}\n\n🔗 ${tweetUrlCompleta}\n🆔 ${tweetId}`);
                tweetsEncontrados++;
              }
            } catch (error) {
              console.error(`❌ Error descargando imagen [${tweetId}]: ${error.message}`);
              await bot.sendMessage(TELEGRAM_CHAT_ID, `${textoTweet}\n\n🔗 ${tweetUrlCompleta}\n🆔 ${tweetId}`);
              tweetsEncontrados++;
            }
            continue;
          }
        }

        // Tweet solo de texto CON ID
        console.log(`📝 Tweet de texto detectado [${tweetId}]`);
        
        // Registrar en log CON ID
        registrarURLEnLog(tweetUrlCompleta, 'TEXTO', palabrasEncontradas, autor, tweetId);
        
        await bot.sendMessage(TELEGRAM_CHAT_ID, `${textoTweet}\n\n🔗 ${tweetUrlCompleta}\n🆔 ${tweetId}`);
        tweetsEncontrados++;
        console.log(`✅ Enviado [${tweetId}]: ${textoTweet.substring(0, 80)}...`);
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

// Inicializar
console.log('🚀 Monitor de X Pro Deck iniciado');

// Crear carpetas necesarias
crearCarpetas();

// Limpiar archivos si es lunes
limpiarArchivosLunes();

if (!cargarPalabrasClave()) {
  console.error('❌ Error crítico: No se pudieron cargar las palabras clave');
  process.exit(1);
}

console.log(`🔑 Palabras clave cargadas: ${PALABRAS_CLAVE.length}`);
console.log(`📁 Carpeta videos: ${CARPETA_VIDEOS}`);
console.log(`📁 Carpeta imágenes: ${CARPETA_IMAGENES}`);
console.log(`📁 Carpeta logs: ${CARPETA_LOGS}`);

// Enviar notificación de inicio
bot.sendMessage(TELEGRAM_CHAT_ID, 
  `🚀 *Monitor X Pro Deck Iniciado*\n\n` +
  `🔑 Palabras clave: ${PALABRAS_CLAVE.length} términos\n` +
  `📁 Videos: ${CARPETA_VIDEOS}\n` +
  `📁 Imágenes: ${CARPETA_IMAGENES}\n` +
  `📁 Logs: ${CARPETA_LOGS}\n` +
  `📅 Última actualización: ${keywordsConfig.configuracion?.ultima_actualizacion || 'N/A'}\n` +
  `🕐 Inicio: ${new Date().toLocaleString('es-MX')}\n\n` +
  `Comandos disponibles:\n` +
  `• /keywords - Ver configuración de palabras\n` +
  `• /reload - Recargar keywords.json\n` +
  `• /add <palabra> - Agregar palabra clave\n` +
  `• /remove <palabra> - Quitar palabra clave\n` +
  `• /DVideo - Reintentar videos fallidos\n` +
  `• /VFallidos - Ver videos fallidos\n` +
  `• /LimpiarFallidos - Limpiar lista fallidos\n` +
  `• /help - Ver todos los comandos\n\n` +
  `📹 Videos y 🖼️ imágenes se descargan con ID único\n` +
  `🧹 Limpieza automática los lunes`,
  { parse_mode: 'Markdown' }
).catch(console.error);

monitorearListaX();
// Codigo funcionando perfectamente salvo las imagenes esta mas completo con IDs de Videos y guardado y envio a logs.