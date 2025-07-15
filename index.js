// index.js
import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import { chromium } from 'playwright';
import readline from 'readline';
import TelegramBot from 'node-telegram-bot-api';
import WhatsAppBot from './WhatsAppMejorado.js';
import DetectorDuplicados from './DetectorDuplicados.js';
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

// Función para registrar URLs procesadas en log con ID y columna
function registrarURLEnLog(url, tipo, palabrasClave, autor = 'Desconocido', tweetId, columna = 0) {
  const timestamp = new Date().toLocaleString('es-MX', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  
  const entrada = `[${timestamp}] [${tweetId}] [COL${columna}] ${tipo} - ${autor} - ${palabrasClave.join(', ')} - ${url}\n`;
  
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
const comando = `yt-dlp --no-check-certificate --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" --encoding utf-8 -P "${CARPETA_VIDEOS}" -o "${nombreArchivo}" --format-sort "res:2160,fps,br,asr" -f "best[height<=2160]/best" --no-post-overwrites "${urlCompleta}"`;

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

      // Obtener URL de máxima calidad para imágenes de Twitter
      let urlMaximaCalidad = url;
      if (url.includes('pbs.twimg.com') || url.includes('twimg.com')) {
      urlMaximaCalidad = url.split('?')[0] + '?format=jpg&name=orig';
  
      console.log(`🔗 URL máxima calidad: ${urlMaximaCalidad}`);
}

const archivo = fs.createWriteStream(rutaCompleta);
      
      const timeout = setTimeout(() => {
        archivo.destroy();
        reject(new Error(`Timeout descargando imagen [${tweetId}]`));
      }, 30000);
      
      https.get(urlMaximaCalidad, (response) => {
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
    if (lineaLimpia.includes('Mostrar más')) return false; // Filtrar "Mostrar más"
    if (lineaLimpia.includes('Show more')) return false; // Filtrar "Show more"
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

const XPRO_BASE_URL = 'https://pro.x.com';
const USER_DATA_DIR = path.resolve('./sesion-x');
const bot = new TelegramBot(TELEGRAM_TOKEN);
const whatsapp = new WhatsAppBot();
const detectorDuplicados = new DetectorDuplicados();
const resumenDiario = { 
  total: 0, 
  enviados: 0, 
  menciones: {}
};





const historialTweets = new Set();
const tweetsEnviados = new Map(); // Para evitar duplicados con más información

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



// Comando para ver un hash específico
bot.onText(/\/hash (.+)/, async (msg, match) => {
  const hashBuscado = match[1].trim();
  
  // Buscar en el registro
  if (registroContenido.tweets[hashBuscado]) {
    const contenido = registroContenido.tweets[hashBuscado];
    const mensaje = `🔍 *CONTENIDO DEL HASH: ${hashBuscado}*\n\n` +
                   `👤 Autor: ${contenido.autor}\n` +
                   `📅 Fecha: ${new Date(contenido.timestamp).toLocaleString('es-MX')}\n` +
                   `📝 Vista previa: "${contenido.texto_preview}"\n` +
                   `🖼️ Tiene media: ${contenido.tiene_media ? 'Sí' : 'No'}\n\n` +
                   `🔁 *Duplicados de este contenido:*\n`;
    
    // Buscar cuántas veces se ha duplicado
    const duplicados = resumenDiario.duplicadosDetalles.filter(d => d.hash === hashBuscado);
    if (duplicados.length > 0) {
      duplicados.forEach((dup, index) => {
        mensaje += `${index + 1}. ${dup.autor_actual} (${dup.hora_actual})\n`;
      });
    } else {
      mensaje += 'No se han detectado duplicados aún.';
    }
    
    await bot.sendMessage(msg.chat.id, mensaje, { parse_mode: 'Markdown' });
  } else {
    await bot.sendMessage(msg.chat.id, `❌ Hash "${hashBuscado}" no encontrado`);
  }
});

// Comando para ver detalles completos de duplicados
bot.onText(/\/detalle_duplicados/, async (msg) => {
  if (resumenDiario.duplicados === 0) {
    await bot.sendMessage(msg.chat.id, '✅ No se han detectado duplicados hoy');
    return;
  }

  let mensaje = `🔁 *DETALLES COMPLETOS DE DUPLICADOS*\n\n`;
  
  // Mostrar hasta 10 detecciones con texto completo
  const ultimosDetalles = resumenDiario.duplicadosDetalles.slice(-10);
  ultimosDetalles.forEach((dup, index) => {
    mensaje += `*${index + 1}.* Hash: \`${dup.hash}\`\n` +
              `📝 Contenido: "${dup.texto_preview}"\n` +
              `👤 Original: ${dup.autor_original} (${dup.hora_original})\n` +
              `🔄 Duplicado: ${dup.autor_actual} (${dup.hora_actual})\n` +
              `🖼️ Media: ${dup.tiene_media ? 'Sí' : 'No'}\n\n`;
  });

  await bot.sendMessage(msg.chat.id, mensaje, { parse_mode: 'Markdown' });
});

// Comando para exportar log de duplicados
bot.onText(/\/export_duplicados/, async (msg) => {
  try {
    const logData = {
      fecha: new Date().toLocaleDateString('es-MX'),
      total_duplicados: resumenDiario.duplicados,
      contenidos_unicos: [...new Set(resumenDiario.duplicadosDetalles.map(d => d.hash))].length,
      detalles_completos: resumenDiario.duplicadosDetalles,
      hashes_reportados: Array.from(duplicadosReportados),
      registro_completo: registroContenido
    };
    
    const logPath = path.join(CARPETA_LOGS, `duplicados_${new Date().toISOString().split('T')[0]}.json`);
    fs.writeFileSync(logPath, JSON.stringify(logData, null, 2));
    
    await bot.sendMessage(msg.chat.id, `📄 Log exportado: ${logPath}\n\n📊 Resumen:\n- Total duplicados: ${resumenDiario.duplicados}\n- Contenidos únicos: ${logData.contenidos_unicos}\n- Hashes en memoria: ${duplicadosReportados.size}`);
  } catch (error) {
    await bot.sendMessage(msg.chat.id, `❌ Error exportando: ${error.message}`);
  }
});

// Comando para ver duplicados del día
bot.onText(/\/duplicados/, async (msg) => {
  if (resumenDiario.duplicados === 0) {
    await bot.sendMessage(msg.chat.id, '✅ No se han detectado duplicados hoy');
    return;
  }

  // Agrupar duplicados por hash para mostrar resumen más limpio
  const duplicadosUnicos = new Map();
  resumenDiario.duplicadosDetalles.forEach(dup => {
    if (!duplicadosUnicos.has(dup.hash)) {
      duplicadosUnicos.set(dup.hash, {
        ...dup,
        count: 1
      });
    } else {
      duplicadosUnicos.get(dup.hash).count++;
    }
  });

  let mensaje = `🔁 *DUPLICADOS DEL DÍA*\n\n` +
               `📊 Total detecciones: ${resumenDiario.duplicados}\n` +
               `🔗 Contenidos únicos duplicados: ${duplicadosUnicos.size}\n\n`;

  if (duplicadosUnicos.size > 0) {
    mensaje += `📋 *Resumen por contenido:*\n`;
    Array.from(duplicadosUnicos.values()).slice(0, 5).forEach((dup, index) => {
      mensaje += `\n${index + 1}. *${dup.count}x detectado*\n` +
                `   Hash: \`${dup.hash}\`\n` +
                `   Original: ${dup.autor_original} (${dup.hora_original})\n` +
                `   ${dup.tiene_media ? '🖼️ Con media' : '📝 Solo texto'}\n`;
    });
    
    if (duplicadosUnicos.size > 5) {
      mensaje += `\n... y ${duplicadosUnicos.size - 5} contenidos más`;
    }
  }

  await bot.sendMessage(msg.chat.id, mensaje, { parse_mode: 'Markdown' });
});

// Comando para ver estado de WhatsApp con monitoreo mejorado
bot.onText(/\/whatsapp/, async (msg) => {
  const estado = whatsapp.getEstado();
  const mensaje = `📱 *Estado WhatsApp Mejorado:*\n\n` +
                 `🔗 Conectado: ${estado.conectado ? '✅' : '❌'}\n` +
                 `💬 Chat configurado: ${estado.chatConfigured ? '✅' : '❌'}\n` +
                 `🔄 Reconexiones: ${estado.reconnectAttempts}/10\n` +
                 `📊 Total reconexiones: ${estado.totalReconnects || 0}\n` +
                 `📨 Mensajes enviados: ${estado.totalMessagessSent || 0}\n` +
                 `⏱️ Uptime: ${estado.uptime || 'N/A'}\n` +
                 `🕐 Última actividad: ${estado.lastActivity || 'N/A'}\n\n` +
                 `${!estado.chatConfigured ? '⚠️ Configura WHATSAPP_CHAT_ID en .env\n' : ''}` +
                 `${!estado.conectado ? '🔄 Auto-reconexión mejorada habilitada (hasta 10 intentos)\n' : ''}` +
                 `✨ Sistema de mantenimiento activo: Heartbeat + Verificación de conexión\n` +
                 `💾 Backup automático de sesión habilitado\n` +
                 `📱 Notificaciones a Telegram por desconexiones`;
  
  await bot.sendMessage(msg.chat.id, mensaje, { parse_mode: 'Markdown' });
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
                 `*🔍 Duplicados:*\n` +
                 `• /omitidos - Ver omisiones de hoy\n` +
                 `• /omitidos_detalle - Lista detallada\n` +
                 `• /estadisticas_duplicados - Métricas\n` +
                 `• /tweets_enviados - Ver tweets enviados\n` +
                 `• /revisar_omitidos - Revisión manual\n\n` +
                 `*📱 WhatsApp:*\n` +
                 `• /whatsapp - Ver estado detallado\n\n` +
                 `*ℹ️ General:*\n` +
                 `• /help - Mostrar esta ayuda`;
  
  await bot.sendMessage(msg.chat.id, mensaje, { parse_mode: 'Markdown' });
});

// Comandos para sistema de duplicados
bot.onText(/\/omitidos/, async (msg) => {
  try {
    const reporte = await detectorDuplicados.obtenerOmisionesHoy();
    await bot.sendMessage(msg.chat.id, reporte, { parse_mode: 'Markdown' });
  } catch (error) {
    await bot.sendMessage(msg.chat.id, `❌ Error obteniendo omisiones: ${error.message}`);
  }
});

bot.onText(/\/omitidos_detalle/, async (msg) => {
  try {
    const reporte = await detectorDuplicados.obtenerOmisionesHoy();
    await bot.sendMessage(msg.chat.id, reporte, { parse_mode: 'Markdown' });
  } catch (error) {
    await bot.sendMessage(msg.chat.id, `❌ Error obteniendo detalles: ${error.message}`);
  }
});

bot.onText(/\/estadisticas_duplicados/, async (msg) => {
  try {
    const estadisticas = detectorDuplicados.obtenerEstadisticas();
    await bot.sendMessage(msg.chat.id, estadisticas, { parse_mode: 'Markdown' });
  } catch (error) {
    await bot.sendMessage(msg.chat.id, `❌ Error obteniendo estadísticas: ${error.message}`);
  }
});

bot.onText(/\/revisar_omitidos/, async (msg) => {
  try {
    const mensaje = `🔍 **Funciones de Revisión**\n\n` +
                   `• /omitidos - Omisiones de hoy\n` +
                   `• /estadisticas_duplicados - Métricas del sistema\n\n` +
                   `📊 Use estos comandos para revisar el funcionamiento del detector de duplicados.\n` +
                   `Los archivos detallados se guardan en: ./logs/omisiones/`;
    
    await bot.sendMessage(msg.chat.id, mensaje, { parse_mode: 'Markdown' });
  } catch (error) {
    await bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
  }
});

bot.onText(/\/tweets_enviados/, async (msg) => {
  try {
    const lista = detectorDuplicados.obtenerTweetsEnviados();
    await bot.sendMessage(msg.chat.id, lista, { parse_mode: 'Markdown' });
  } catch (error) {
    await bot.sendMessage(msg.chat.id, `❌ Error obteniendo tweets enviados: ${error.message}`);
  }
});

// Funciones para envío dual (Telegram + WhatsApp)
async function enviarMensajeDual(mensaje) {
  const promesas = [];
  
  // Enviar a Telegram
  promesas.push(
    bot.sendMessage(TELEGRAM_CHAT_ID, mensaje).catch(error => {
      console.error('❌ Error enviando a Telegram:', error.message);
    })
  );
  
  // Enviar a WhatsApp si está conectado
  if (whatsapp.getEstado().conectado) {
    promesas.push(
      whatsapp.enviarMensaje(mensaje).catch(error => {
        console.error('❌ Error enviando a WhatsApp:', error.message);
      })
    );
  }
  
  await Promise.allSettled(promesas);
}

async function enviarImagenDual(rutaImagen, caption) {
  const promesas = [];
  
  // Enviar a Telegram
  promesas.push(
    bot.sendPhoto(TELEGRAM_CHAT_ID, rutaImagen, { caption }).catch(error => {
      console.error('❌ Error enviando imagen a Telegram:', error.message);
    })
  );
  
  // Enviar a WhatsApp si está conectado
  if (whatsapp.getEstado().conectado) {
    promesas.push(
      whatsapp.enviarImagen(rutaImagen, caption).catch(error => {
        console.error('❌ Error enviando imagen a WhatsApp:', error.message);
      })
    );
  }
  
  await Promise.allSettled(promesas);
}

async function enviarVideoDual(rutaVideo, caption) {
  const promesas = [];
  
  // Enviar a Telegram
  promesas.push(
    bot.sendVideo(TELEGRAM_CHAT_ID, rutaVideo, { caption }).catch(error => {
      console.error('❌ Error enviando video a Telegram:', error.message);
    })
  );
  
  // Enviar a WhatsApp si está conectado
  if (whatsapp.getEstado().conectado) {
    promesas.push(
      whatsapp.enviarVideo(rutaVideo, caption).catch(error => {
        console.error('❌ Error enviando video a WhatsApp:', error.message);
      })
    );
  }
  
  await Promise.allSettled(promesas);
}

// Función para expandir tweets que tienen "Mostrar más"
async function expandirTweetCompleto(tweetElement) {
  try {
    // Método 1: Buscar por texto específico (más confiable)
    const textoCompleto = await tweetElement.innerText();
    if (textoCompleto.includes('Mostrar más') || textoCompleto.includes('Show more')) {
      
      // Buscar diferentes selectores comunes para el botón
      const selectores = [
        '[data-testid="tweet-text-show-more-link"]',
        'span[role="button"]',
        'button',
        'a[role="button"]',
        'span[dir="ltr"]'
      ];
      
      for (const selector of selectores) {
        try {
          const elementos = await tweetElement.$$(selector);
          for (const elemento of elementos) {
            const textoElemento = await elemento.innerText();
            if (textoElemento && (textoElemento.includes('Mostrar más') || textoElemento.includes('Show more'))) {
              // Expansión silenciosa - no mostrar logs repetitivos
              
              // Hacer scroll al elemento si es necesario
              await elemento.scrollIntoViewIfNeeded();
              
              // Hacer clic y esperar
              await elemento.click();
              await new Promise(resolve => setTimeout(resolve, 800));
              
              return;
            }
          }
        } catch (error) {
          // Continuar con el siguiente selector
          continue;
        }
      }
    }
  } catch (error) {
    // Si falla la expansión, continuar con el texto que tenemos
    // No mostrar error para mantener logs limpios
  }
}

async function agregarOverlay(page) {
  await page.evaluate(() => {
    const div = document.createElement('div');
    div.id = 'overlay-monitor';
    div.style.position = 'fixed';
    div.style.bottom = '20px';
    div.style.left = '50%';
    div.style.transform = 'translateX(-50%)';
    div.style.background = 'rgba(0,0,0,0.8)';
    div.style.color = '#00ff00';
    div.style.padding = '12px 20px';
    div.style.zIndex = 9999;
    div.style.fontFamily = 'Consolas, monospace';
    div.style.fontSize = '13px';
    div.style.borderRadius = '8px';
    div.style.border = '2px solid #00ff00';
    div.style.boxShadow = '0 4px 8px rgba(0,0,0,0.5)';
    div.style.textAlign = 'center';
    div.style.minWidth = '300px';
    div.innerText = '🤖 Monitor X Pro - Iniciando...';
    document.body.appendChild(div);
  });
}

async function actualizarOverlay(page, segundosRestantes, tweetsEncontrados, columnasMonitoreadas = 0, nombresColumnas = []) {
  await page.evaluate(({ segundos, encontrados, columnas, nombres }) => {
    const div = document.getElementById('overlay-monitor');
    if (div) {
      const tiempo = new Date().toLocaleTimeString('es-MX');
      let contenido = `🤖 Monitor X Pro ACTIVO\n`;
      contenido += `⏰ ${tiempo}\n`;
      contenido += `🔄 Próxima revisión: ${segundos}s\n`;
      contenido += `📊 Columnas: ${columnas}\n`;
      contenido += `📨 Tweets enviados: ${encontrados}\n`;
      
      if (nombres && nombres.length > 0) {
        contenido += `\n📋 Monitoreando:\n`;
        nombres.slice(0, 6).forEach((nombre, i) => {
          contenido += `  ${i + 1}. ${nombre}\n`;
        });
        if (nombres.length > 6) {
          contenido += `  ... y ${nombres.length - 6} más`;
        }
      }
      
      div.innerText = contenido;
    }
  }, { 
    segundos: segundosRestantes, 
    encontrados: tweetsEncontrados, 
    columnas: columnasMonitoreadas,
    nombres: nombresColumnas
  });
}

// Función MEJORADA para extraer nombres de columnas REALES
async function obtenerNombresColumnas(columnas, mostrarLogs = false) {
  const nombres = [];
  
  if (mostrarLogs) {
    console.log(`🔍 Analizando ${columnas.length} elementos detectados...`);
  }
  
  for (let i = 0; i < columnas.length; i++) {
    try {
      if (mostrarLogs && i < 5) { // Solo mostrar primeros 5 para no saturar
        console.log(`📋 Analizando columna ${i + 1}/${columnas.length}...`);
      }
      
      // Selectores OPTIMIZADOS basados en debugging real
      const selectores = [
        // Selectores que funcionaron en el debugging
        'h1[role="heading"]',                   // Los headers reales encontrados
        'h2[role="heading"]',
        'h3[role="heading"]',
        '[data-testid="column-title-wrapper"]', // Específico encontrado
        
        // Selectores específicos de X Pro 
        '[data-testid="deckHeader"] h2',
        '[data-testid="deckHeader"] span',
        '[data-testid="deckHeader"]',
        
        // Headers generales que funcionaron
        'header h1, header h2, header h3',
        '[role="heading"]',
        'h1, h2, h3',                          // Simplificado - funcionó
        
        // Búsqueda directa por texto conocido (funcionó en debugging)
        'text="Isaac Pimentel"',
        'text="#MediosMorelos"', 
        'text="congreso morelos"',
        'text="Congreso Morelos"',
        'text="Medio Morelos"',
        
        // Case-insensitive (funcionó)
        'text=/isaac pimentel/i',
        'text=/medios morelos/i',
        'text=/congreso morelos/i',
        
        // Fallbacks
        'div[dir="ltr"]:first-child',
        'span:first-child'
      ];
      
      let nombreEncontrado = null;
      
      for (const selector of selectores) {
        try {
          let elemento = null;
          
          // Manejar selectores de texto especiales usando page.locator
          if (selector.startsWith('text=')) {
            try {
              // Buscar el texto dentro de la columna específica
              const textoCompleto = await columnas[i].innerText();
              const selectorTexto = selector.replace('text=', '').replace(/"/g, '').replace(/\//g, '').replace(/i$/, '');
              
              if (textoCompleto.toLowerCase().includes(selectorTexto.toLowerCase())) {
                nombreEncontrado = selectorTexto;
                console.log(`   ✅ Encontrado con búsqueda texto "${selector}": "${nombreEncontrado}"`);
                break;
              }
            } catch (error) {
              // Continuar con el siguiente
            }
          } else {
            // Selector CSS normal
            elemento = await columnas[i].$(selector);
            if (elemento) {
              const texto = await elemento.innerText();
              
              if (mostrarLogs && i < 5) {
                console.log(`   🔍 Selector "${selector}" -> "${texto?.substring(0, 50)}"`);
              }
              
              // Validar que el texto sea un nombre de columna válido
              if (texto && 
                  texto.trim().length > 0 && 
                  texto.trim().length < 100 &&
                  !texto.includes('Buscar') &&
                  !texto.includes('Search') &&
                  !texto.includes('Tweet') &&
                  !texto.includes('Tuit') &&
                  !texto.match(/^\d+[hms]?$/) && // Filtrar tiempos como "19h", "5m"
                  !texto.match(/^\d+$/) && // Filtrar números puros
                  !texto.includes('cronología') &&
                  !texto.includes('Timeline') &&
                  !texto.includes('Mostrar') &&
                  !texto.includes('Show') &&
                  !texto.includes('Ver más') &&
                  !texto.includes('Ver todo')) {
                
                nombreEncontrado = texto.trim();
                if (mostrarLogs && i < 5) {
                  console.log(`   ✅ Nombre válido encontrado: "${nombreEncontrado}"`);
                }
                break;
              } else if (texto && mostrarLogs && i < 5) {
                console.log(`   ❌ Texto descartado: "${texto.substring(0, 30)}" (no cumple criterios)`);
              }
            }
          }
        } catch (error) {
          if (mostrarLogs && i < 5) {
            console.log(`   ⚠️ Error con selector "${selector}": ${error.message}`);
          }
        }
      }
      
      // Si no encontramos nombre, intentar obtener todo el texto de la columna y buscar patrones
      if (!nombreEncontrado) {
        try {
          const textoCompleto = await columnas[i].innerText();
          const lineas = textoCompleto.split('\n').map(l => l.trim()).filter(l => l.length > 0);
          
          // Buscar en las primeras líneas nombres conocidos
          const nombresConocidos = [
            'Isaac Pimentel', 'Congreso Morelos', '#MediosMorelos', 'Medio Morelos',
            'Daniel Martínez Terrazas', 'Andrea Valentina Gordillo', 'Sergio Omar Livera',
            'Guillermina Maya', 'Jazmín Solano', 'Rafael Reyes', 'Nayla Carolina Ruiz'
          ];
          
          for (const lineaTexto of lineas.slice(0, 5)) { // Solo primeras 5 líneas
            for (const nombreConocido of nombresConocidos) {
              if (lineaTexto.toLowerCase().includes(nombreConocido.toLowerCase())) {
                nombreEncontrado = nombreConocido;
                if (mostrarLogs && i < 5) {
                  console.log(`   🎯 Encontrado por patrón: "${nombreEncontrado}" en "${lineaTexto}"`);
                }
                break;
              }
            }
            if (nombreEncontrado) break;
          }
          
          // Si aún no encontramos, usar la primera línea que parezca un título
          if (!nombreEncontrado && lineas.length > 0) {
            const primeraLinea = lineas[0];
            if (primeraLinea.length > 3 && primeraLinea.length < 50 && 
                !primeraLinea.match(/^\d+$/) && 
                !primeraLinea.includes('Activo') &&
                !primeraLinea.includes('Online')) {
              nombreEncontrado = primeraLinea;
              if (mostrarLogs && i < 5) {
                console.log(`   📝 Usando primera línea como nombre: "${nombreEncontrado}"`);
              }
            }
          }
          
        } catch (error) {
          if (mostrarLogs && i < 5) {
            console.log(`   ❌ Error obteniendo texto completo: ${error.message}`);
          }
        }
      }
      
      if (nombreEncontrado) {
        nombres.push(nombreEncontrado);
        if (mostrarLogs && i < 5) {
          console.log(`✅ Columna ${i + 1}: "${nombreEncontrado}"`);
        }
      } else {
        if (mostrarLogs && i < 5) {
          console.log(`❌ Columna ${i + 1}: No se pudo determinar el nombre`);
        }
        nombres.push(`Columna ${i + 1}`); // Fallback
      }
      
    } catch (error) {
      if (mostrarLogs && i < 5) {
        console.log(`❌ Error analizando columna ${i + 1}: ${error.message}`);
      }
      nombres.push(`Columna ${i + 1}`); // Fallback
    }
  }
  
  return nombres;
}

async function monitorearListaX() {
  console.log('🌐 Iniciando navegador...');

  let context = null;
  let page = null;
  
  try {
    // Opciones mejoradas para estabilidad y background
    const browserOptions = {
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        // OPTIMIZACIÓN PARA BACKGROUND - permite minimizar sin perder funcionalidad
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-background-media-suspend',
        '--disable-hang-monitor',
        '--enable-aggressive-domstorage-flushing',
        '--disable-features=CalculateNativeWinOcclusion',
        '--disable-field-trial-config',
        '--disable-ipc-flooding-protection',
        // VENTANA COMPACTA - se puede minimizar fácilmente
        '--window-size=900,700',
        '--window-position=100,100'
      ],
      timeout: 60000, // 60 segundos timeout
      slowMo: 50 // Más rápido pero estable
    };

    console.log('🔧 Configurando contexto del navegador...');
    context = await chromium.launchPersistentContext(USER_DATA_DIR, browserOptions);
    
    console.log('📄 Creando nueva página...');
    page = await context.newPage();
    
    // Configurar timeouts más largos
    page.setDefaultNavigationTimeout(60000);
    page.setDefaultTimeout(30000);
    
    console.log('🌐 Navegando a X Pro...');
    await page.goto(XPRO_BASE_URL, { 
      waitUntil: 'domcontentloaded',
      timeout: 60000 
    });
    
    console.log('⏳ Esperando carga inicial...');
    await page.waitForTimeout(5000);
    
  } catch (error) {
    console.error('❌ Error iniciando navegador:', error.message);
    
    // Intentar cerrar recursos si existen
    if (page) {
      try { await page.close(); } catch (e) { }
    }
    if (context) {
      try { await context.close(); } catch (e) { }
    }
    
    // Reenviar notificación de error
    await enviarMensajeDual('❌ Error iniciando navegador. Verifica que no haya otras instancias de Chrome abiertas.');
    
    throw error;
  }

  if (page.url().includes('login')) {
    await enviarMensajeDual('❌ No estás logueado en X. Por favor inicia sesión manualmente.');
    console.log('❌ No logueado. Esperando login manual.');
    await page.waitForURL('https://x.com/', { timeout: 0 });
    console.log('🔐 Login completado. Continuando...');
  } else {
    console.log('✅ Ya estás logueado.');
  }

  console.log('📄 Iniciando monitoreo de DECKS en X Pro...');
  await agregarOverlay(page);

  const inicioHora = Date.now() - (60 * 60 * 1000);
  console.log('🤖 Monitoreo activo. Presiona ENTER para detener...');

  let segundos = 30;
  let tweetsEncontrados = 0;
  let columnasMonitoreadas = 0;
  let nombresColumnas = [];
  let primeraDeteccion = true; // Para controlar logs iniciales

  const intervaloVisual = setInterval(() => {
    segundos -= 1;
    if (segundos < 0) segundos = 30;
    actualizarOverlay(page, segundos, tweetsEncontrados, columnasMonitoreadas, nombresColumnas);
  }, 1000);

  const intervaloBusqueda = setInterval(async () => {
    try {
      segundos = 30;
      const now = Date.now();
      
      // LÓGICA CORREGIDA: Detectar títulos Y contenedores de tweets
      let columnas = [];
      let nombresDecksDetectados = [];
      
      try {
        // PASO 1: Detectar títulos de DECKS reales
        const titulosDecks = await page.$$('[data-testid="column-title-wrapper"]');
        
        if (primeraDeteccion) {
          console.log(`📋 DECKS reales detectados: ${titulosDecks.length}`);
        }
        
        // PASO 2: Obtener nombres de los títulos
        for (let i = 0; i < titulosDecks.length; i++) {
          try {
            const titulo = await titulosDecks[i].innerText();
            nombresDecksDetectados.push(titulo);
            
            if (primeraDeteccion) {
              console.log(`   ${i + 1}. ✅ "${titulo}"`);
            }
          } catch (error) {
            if (primeraDeteccion) {
              console.log(`   ❌ Error leyendo título ${i + 1}: ${error.message}`);
            }
          }
        }
        
        // PASO 3: Obtener contenedores de tweets (donde están los tweets reales)
        columnas = await page.$$('[data-testid="multi-column-layout-column-content"]');
        
        if (primeraDeteccion) {
          console.log(`📊 Contenedores de tweets detectados: ${columnas.length}`);
          console.log(`🎯 Monitoreando: ${nombresDecksDetectados.join(', ')}`);
        }
        
      } catch (error) {
        if (primeraDeteccion) {
          console.log(`❌ Error en detección: ${error.message}`);
        }
        
        // FALLBACK: Buscar directamente los contenedores
        columnas = await page.$$('[data-testid="multi-column-layout-column-content"]');
        
        if (primeraDeteccion) {
          console.log(`📋 Fallback: ${columnas.length} contenedores encontrados`);
        }
      }
      
      // Si no encontramos columnas, intentar detectar por contenido
      if (columnas.length === 0 && primeraDeteccion) {
        console.log('🔍 No se encontraron columnas con selectores estándar, buscando por contenido...');
        try {
          // Buscar elementos que contengan nombres conocidos de columnas
          const nombresColumnas = ['Isaac Pimentel', '#MediosMorelos', 'Congreso Morelos', 'Medio Morelos'];
          for (const nombre of nombresColumnas) {
            const elementosConTexto = await page.$$(`text=/${nombre}/i`);
            // Si encontramos elementos con ese texto, asumimos que hay columnas
            if (elementosConTexto.length > 0) {
              // Buscar contenedores de tweets como fallback
              const contenedores = await page.$$('[data-testid="multi-column-layout-column-content"]');
              if (contenedores.length > 0) {
                columnas = contenedores;
                break;
              }
            }
          }
          
          if (columnas.length > 0) {
            console.log(`📋 Encontradas ${columnas.length} columnas por contenido`);
          }
        } catch (error) {
          console.log(`❌ Error buscando columnas por contenido: ${error.message}`);
        }
      }
      
      // Actualizar variables solo si detectamos algo nuevo
      if (primeraDeteccion || nombresDecksDetectados.length !== columnasMonitoreadas) {
        nombresColumnas = nombresDecksDetectados; // Usar nombres reales detectados
        columnasMonitoreadas = nombresDecksDetectados.length;
        primeraDeteccion = false; // Ya no es la primera detección
      }
      
      // Buscar tweets en TODAS las columnas detectadas con información de columna
      const tweets = [];
      for (let i = 0; i < columnas.length; i++) {
        try {
          const tweetsEnColumna = await columnas[i].$$('article');
          // Agregar información de columna a cada tweet
          for (const tweet of tweetsEnColumna) {
            tweet._columnaIndex = i + 1;
            tweets.push(tweet);
          }
        } catch (error) {
          // Silencioso - no mostrar errores de columna
        }
      }

      for (const tweetElement of tweets) {
        // Expandir tweet si tiene "Mostrar más" antes de extraer texto
        await expandirTweetCompleto(tweetElement);
        
        const innerText = await tweetElement.innerText();
        const timestampAttr = await tweetElement.$('time');
        if (!timestampAttr) continue;

        const timeISO = await timestampAttr.getAttribute('datetime');
        const timeMs = new Date(timeISO).getTime();
        if (timeMs < inicioHora || timeMs > now) continue;

        const link = await tweetElement.$('a[href*="/status/"]');
        if (!link) continue;

        const url = await link.getAttribute('href');
        
        // Usar las palabras clave cargadas desde el archivo JSON
        const palabrasEncontradas = PALABRAS_CLAVE.filter(p => innerText.includes(p));
        if (palabrasEncontradas.length === 0) continue;

        // Extraer texto limpio del tweet
        const textoTweet = extraerTextoTweet(innerText);
        
        // Extraer autor primero para verificar duplicados
        const autor = await extraerAutor(tweetElement);
        
        // Verificar si hay media
        const media = await tweetElement.$('img');
        const video = await tweetElement.$('video');
        
        // VERIFICACIÓN DE DUPLICADOS - Nuevo sistema inteligente
        let mediaUrl = '';
        if (media) {
          try {
            mediaUrl = await media.getAttribute('src') || '';
          } catch (e) {
            mediaUrl = '';
          }
        } else if (video) {
          mediaUrl = 'video_detected';
        }
        
        const tweetParaVerificar = {
          texto: textoTweet,
          usuario: autor,
          url: url.startsWith('http') ? url : `https://x.com${url}`,
          mediaUrl: mediaUrl
        };
        
        const resultadoDuplicado = await detectorDuplicados.verificarDuplicado(tweetParaVerificar);
        
        if (resultadoDuplicado.esDuplicado) {
          // Tweet omitido por duplicado - continuar con el siguiente
          continue;
        }
        
        // Agregar al historial tradicional también
        historialTweets.add(url);

        // GENERAR ID ÚNICO AL INICIO DEL PROCESAMIENTO
        const tweetId = generarIDUnico();
        const columnaIndex = tweetElement._columnaIndex || 0;
        const nombreColumna = nombresColumnas[columnaIndex - 1] || `DECK ${columnaIndex}`;
        
        console.log(`🔍 Tweet [${tweetId}] - ${nombreColumna}`);

        resumenDiario.total++;
        resumenDiario.enviados++;

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

        // Procesar videos PRIMERO
        if (video) {
          console.log(`🎬 Video detectado en tweet [${tweetId}]`);
          
          // Registrar en log CON ID y columna
          registrarURLEnLog(tweetUrlCompleta, 'VIDEO', palabrasEncontradas, autor, tweetId, nombreColumna);
          
          try {
            const rutaVideo = await descargarVideo(url, tweetId);
            
            if (rutaVideo && fs.existsSync(rutaVideo)) {
              // Enviar solo texto + video (SIN enlace) CON ID a ambos canales
              await enviarVideoDual(rutaVideo, `${textoTweet}\n\n📊 ${nombreColumna}\n🆔 ${tweetId}`);
              
              // REGISTRAR TWEET ENVIADO EXITOSAMENTE
              detectorDuplicados.registrarTweetEnviado(tweetParaVerificar, tweetId, nombreColumna, 'video');
              
              console.log(`✅ Video enviado [${tweetId}] - ${nombreColumna}`);
              tweetsEncontrados++;
              
            } else {
              // Si falla la descarga, enviar mensaje con nota a ambos canales
              await enviarMensajeDual(
                `${textoTweet}\n\n⚠️ Video no se pudo descargar\n📊 ${nombreColumna}\n🆔 ${tweetId}`
              );
              
              // REGISTRAR TWEET ENVIADO EXITOSAMENTE (aunque sin video)
              detectorDuplicados.registrarTweetEnviado(tweetParaVerificar, tweetId, nombreColumna, 'video_fallido');
              
              tweetsEncontrados++;
            }
          } catch (error) {
            console.error(`❌ Error procesando video [${tweetId}]: ${error.message}`);
            await enviarMensajeDual(
              `${textoTweet}\n\n❌ Error descargando video\n📊 ${nombreColumna}\n🆔 ${tweetId}`
            );
            
            // REGISTRAR TWEET ENVIADO EXITOSAMENTE (aunque con error)
            detectorDuplicados.registrarTweetEnviado(tweetParaVerificar, tweetId, nombreColumna, 'video_error');
            
            tweetsEncontrados++;
          }
          
          continue; // Ir al siguiente tweet
        }

        // Buscar imágenes con múltiples selectores - SOLUCIÓN 2
        let imagenEncontrada = null;
        let srcImagen = null;
        
        console.log(`🔍 [${tweetId}] Buscando imágenes con múltiples selectores...`);
        
        // Intentar múltiples selectores para encontrar imágenes de contenido
        const selectoresImagen = [
          'img[src*="media"]',           // Imágenes con "media" en URL
          'img[src*="pbs.twimg.com"]',   // Imágenes de Twitter
          'img[alt]:not([alt=""])',      // Imágenes con alt text (contenido)
          '[data-testid="tweetPhoto"] img', // Selector específico de fotos de tweet
          'div[data-testid="card.layoutLarge.media"] img', // Cards con imagen
          '[data-testid="tweet"] img',   // Imágenes dentro de tweets
          'article img',                 // Imágenes dentro de artículos
          'img'                          // Fallback: cualquier imagen
        ];
        
        for (let i = 0; i < selectoresImagen.length; i++) {
          const selector = selectoresImagen[i];
          console.log(`🔍 [${tweetId}] Probando selector ${i + 1}/${selectoresImagen.length}: "${selector}"`);
          
          try {
            imagenEncontrada = await tweetElement.$(selector);
            if (imagenEncontrada) {
              srcImagen = await imagenEncontrada.getAttribute('src');
              console.log(`✅ [${tweetId}] Imagen encontrada con selector "${selector}": ${srcImagen}`);
              
              // Verificar si es imagen de contenido válida
              if (srcImagen && 
                  !srcImagen.includes('profile_images') && 
                  !srcImagen.includes('profile_banners') &&
                  !srcImagen.includes('emoji') &&
                  !srcImagen.includes('icon') &&
                  !srcImagen.includes('avatar') &&
                  (srcImagen.includes('media') || 
                   srcImagen.includes('pbs.twimg.com') || 
                   srcImagen.includes('twimg.com') ||
                   srcImagen.includes('cdn.') ||
                   srcImagen.length > 100)) { // URLs de imagen suelen ser largas
                
                console.log(`🎯 [${tweetId}] Imagen válida confirmada: ${srcImagen}`);
                break; // Encontramos una imagen válida
              } else {
                console.log(`❌ [${tweetId}] Imagen descartada (perfil/emoji/icono): ${srcImagen}`);
                imagenEncontrada = null; // Reset para seguir buscando
                srcImagen = null;
              }
            } else {
              console.log(`❌ [${tweetId}] No se encontró imagen con selector: "${selector}"`);
            }
          } catch (error) {
            console.log(`❌ [${tweetId}] Error con selector "${selector}": ${error.message}`);
          }
        }
        
        // Procesar imagen si se encontró una válida
        if (imagenEncontrada && srcImagen) {
          console.log(`🖼️ [${tweetId}] Procesando imagen de contenido: ${srcImagen}`);
          
          // Registrar en log CON ID y columna
          registrarURLEnLog(tweetUrlCompleta, 'IMAGEN', palabrasEncontradas, autor, tweetId, nombreColumna);
          
          try {
            console.log(`📥 [${tweetId}] Iniciando descarga de imagen...`);
            const rutaImagen = await descargarImagen(srcImagen, tweetId);
            
            if (rutaImagen && fs.existsSync(rutaImagen)) {
              // ✅ ÉXITO: Enviar texto + imagen (SIN enlace) CON ID a ambos canales
              await enviarImagenDual(rutaImagen, `${textoTweet}\n\n📊 ${nombreColumna}\n🆔 ${tweetId}`);
              
              // REGISTRAR TWEET ENVIADO EXITOSAMENTE
              detectorDuplicados.registrarTweetEnviado(tweetParaVerificar, tweetId, nombreColumna, 'imagen');
              
              console.log(`✅ [${tweetId}] Imagen enviada - ${nombreColumna}`);
              tweetsEncontrados++;
            } else {
              // ❌ FALLÓ LA DESCARGA: Enviar texto + enlace + ID a ambos canales
              console.log(`❌ [${tweetId}] Descarga falló, enviando con enlace para consultar imagen`);
              await enviarMensajeDual(
                `${textoTweet}\n\n🔗 ${tweetUrlCompleta}\n⚠️ Imagen no se pudo descargar - consultar en enlace\n📊 ${nombreColumna}\n🆔 ${tweetId}`
              );
              
              // REGISTRAR TWEET ENVIADO EXITOSAMENTE (aunque sin imagen)
              detectorDuplicados.registrarTweetEnviado(tweetParaVerificar, tweetId, nombreColumna, 'imagen_fallida');
              
              tweetsEncontrados++;
            }
          } catch (error) {
            // ❌ ERROR EN DESCARGA: Enviar texto + enlace + ID a ambos canales
            console.error(`❌ [${tweetId}] Error en proceso de descarga: ${error.message}`);
            await enviarMensajeDual(
              `${textoTweet}\n\n🔗 ${tweetUrlCompleta}\n❌ Error procesando imagen - consultar en enlace\n📊 ${nombreColumna}\n🆔 ${tweetId}`
            );
            
            // REGISTRAR TWEET ENVIADO EXITOSAMENTE (aunque con error)
            detectorDuplicados.registrarTweetEnviado(tweetParaVerificar, tweetId, nombreColumna, 'imagen_error');
            
            tweetsEncontrados++;
          }
          
          continue; // Ir al siguiente tweet DESPUÉS de procesar la imagen
        } else {
          console.log(`📝 [${tweetId}] No se encontró imagen de contenido válida, procesando como texto`);
        }

        // Tweet solo de texto CON ID
        console.log(`📝 Tweet de texto [${tweetId}] - ${nombreColumna}`);
        
        // Registrar en log CON ID y columna
        registrarURLEnLog(tweetUrlCompleta, 'TEXTO', palabrasEncontradas, autor, tweetId, nombreColumna);
        
        await enviarMensajeDual(`${textoTweet}\n\n🔗 ${tweetUrlCompleta}\n📊 ${nombreColumna}\n🆔 ${tweetId}`);
        
        // REGISTRAR TWEET ENVIADO EXITOSAMENTE
        detectorDuplicados.registrarTweetEnviado(tweetParaVerificar, tweetId, nombreColumna, 'texto');
        
        tweetsEncontrados++;
        console.log(`✅ Enviado [${tweetId}] - ${nombreColumna}`);
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

    await enviarMensajeDual(resumenTexto);
    await enviarMensajeDual('🛑 Monitoreo detenido manualmente.');
    console.log('🛑 Monitoreo detenido manualmente. Cerrando navegador...');
    
    // Cerrar WhatsApp si está conectado
    if (whatsapp.getEstado().conectado) {
      try {
        await whatsapp.cerrar();
      } catch (error) {
        console.log('⚠️ Error cerrando WhatsApp:', error.message);
      }
    }
    
    // Cerrar navegador de forma segura
    try {
      if (page) {
        await page.close();
      }
      if (context) {
        await context.close();
      }
    } catch (error) {
      console.log('⚠️ Error cerrando navegador:', error.message);
    }
    
    rl.close();
    
    // Terminar el proceso completamente para volver al prompt
    process.exit(0);
  });
}

// Inicializar
console.log('🚀 Monitor de X Pro Deck DUAL iniciado (Telegram + WhatsApp)');

// Crear carpetas necesarias
crearCarpetas();

// Limpiar archivos si es lunes
limpiarArchivosLunes();

// Limpiar archivos de duplicados si es lunes
detectorDuplicados.limpiezaSemanal();

if (!cargarPalabrasClave()) {
  console.error('❌ Error crítico: No se pudieron cargar las palabras clave');
  process.exit(1);
}

console.log(`🔑 Palabras clave cargadas: ${PALABRAS_CLAVE.length}`);
console.log(`📁 Carpeta videos: ${CARPETA_VIDEOS}`);
console.log(`📁 Carpeta imágenes: ${CARPETA_IMAGENES}`);
console.log(`📁 Carpeta logs: ${CARPETA_LOGS}`);



// Inicializar WhatsApp
console.log('📱 Inicializando WhatsApp...');
whatsapp.inicializar().then(success => {
  if (success) {
    console.log('✅ WhatsApp inicializado correctamente');
  } else {
    console.log('⚠️ WhatsApp no se pudo inicializar - solo se usará Telegram');
  }
}).catch(error => {
  console.error('❌ Error inicializando WhatsApp:', error.message);
  console.log('⚠️ Continuando solo con Telegram');
});

// Enviar notificación de inicio (esperar un poco para que WhatsApp esté listo)
setTimeout(() => {
  const mensaje = `🚀 *Monitor X Pro DUAL INICIADO*\n\n` +
    `📱 Telegram: ✅ Conectado\n` +
    `📱 WhatsApp: ${whatsapp.getEstado().conectado ? '✅ Conectado' : '⏳ Conectando...'}\n\n` +
    `🔑 Palabras clave: ${PALABRAS_CLAVE.length} términos\n` +
    `📊 Modo: TODAS las columnas visibles\n` +
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
    `• /whatsapp - Ver estado WhatsApp\n` +
    `• /help - Ver todos los comandos\n\n` +
    `📹 Videos y 🖼️ imágenes se descargan con ID único\n` +
    `🧹 Limpieza automática los lunes\n` +
    `🔄 Monitoreo automático de múltiples columnas\n` +
    `📲 Envío DUAL: Telegram + WhatsApp`;

  bot.sendMessage(TELEGRAM_CHAT_ID, mensaje, { parse_mode: 'Markdown' }).catch(console.error);
}, 3000);

// Función para enviar estadísticas finales del día
async function enviarEstadisticasFinales() {
  const fecha = new Date().toLocaleDateString('es-MX');
  const hora = new Date().toLocaleTimeString('es-MX');
  
  // Preparar detalles de duplicados de forma más limpia
  let seccionDuplicados = '';
  if (resumenDiario.duplicados > 0) {
    // Contar contenidos únicos duplicados
    const duplicadosUnicos = new Map();
    resumenDiario.duplicadosDetalles.forEach(dup => {
      if (!duplicadosUnicos.has(dup.hash)) {
        duplicadosUnicos.set(dup.hash, { ...dup, count: 1 });
      } else {
        duplicadosUnicos.get(dup.hash).count++;
      }
    });

    seccionDuplicados = `\n\n🔁 *CONTENIDO DUPLICADO:*\n` +
                       `📊 Total detecciones: ${resumenDiario.duplicados}\n` +
                       `🔗 Contenidos únicos: ${duplicadosUnicos.size}\n`;
    
    // Mostrar los 3 más repetidos
    const topDuplicados = Array.from(duplicadosUnicos.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    if (topDuplicados.length > 0) {
      seccionDuplicados += `\n📋 *Más repetidos:*\n`;
      topDuplicados.forEach((dup, index) => {
        seccionDuplicados += `${index + 1}. ${dup.count}x - ${dup.autor_original} (${dup.hora_original})\n`;
      });
    }
  }

  const mensaje = `📊 *REPORTE FINAL DEL DÍA*\n\n` +
                 `📅 Fecha: ${fecha}\n` +
                 `🕐 Hora cierre: ${hora}\n\n` +
                 `📈 *ESTADÍSTICAS:*\n` +
                 `📨 Tweets analizados: ${resumenDiario.total}\n` +
                 `✅ Tweets enviados: ${resumenDiario.enviados}\n` +
                 `🔁 Duplicados evitados: ${resumenDiario.duplicados}\n` +
                 `🎬 Videos fallidos: ${videosFallidos.length}\n\n` +
                 `🔑 *TOP PALABRAS MENCIONADAS:*\n` +
                 Object.entries(resumenDiario.menciones)
                   .sort(([,a], [,b]) => b - a)
                   .slice(0, 5)
                   .map(([palabra, count]) => `• ${palabra}: ${count} veces`)
                   .join('\n') +
                 seccionDuplicados +
                 `\n\n🛑 *SISTEMA CERRANDO AUTOMÁTICAMENTE*\n` +
                 `⏰ Próximo inicio programado: 00:00 hrs\n` +
                 `🔄 Reinicio automático habilitado`;

  try {
    await bot.sendMessage(TELEGRAM_CHAT_ID, mensaje, { parse_mode: 'Markdown' });
    console.log('📊 Estadísticas finales enviadas');
  } catch (error) {
    console.error('❌ Error enviando estadísticas finales:', error.message);
  }
}

// Función para programar el cierre automático diario
function programarCierreAutomatico() {
  const ahora = new Date();
  const cierreHoy = new Date();
  cierreHoy.setHours(23, 59, 0, 0); // 11:59 PM
  
  // Si ya pasó la hora de cierre hoy, programar para mañana
  if (ahora >= cierreHoy) {
    cierreHoy.setDate(cierreHoy.getDate() + 1);
  }
  
  const tiempoHastaCierre = cierreHoy.getTime() - ahora.getTime();
  
  console.log(`⏰ Cierre automático programado para: ${cierreHoy.toLocaleString('es-MX')}`);
  console.log(`⏱️ Tiempo restante: ${Math.round(tiempoHastaCierre / (1000 * 60 * 60))} horas`);
  
  setTimeout(async () => {
    console.log('🛑 Iniciando cierre automático diario...');
    
    // Enviar estadísticas finales
    await enviarEstadisticasFinales();
    
    
    // Esperar un poco para que se envíe el mensaje
    setTimeout(() => {
      console.log('🛑 Sistema cerrado automáticamente - Fin del día');
      process.exit(0);
    }, 3000);
    
  }, tiempoHastaCierre);
}

// Iniciar programación de cierre automático
programarCierreAutomatico();

// Manejadores de errores globales para evitar crashes
process.on('uncaughtException', async (error) => {
  console.error('🚨 Error no capturado:', error.message);
});

process.on('unhandledRejection', async (reason, promise) => {
  console.error('🚨 Promesa rechazada no manejada:', reason);
});

// Manejador de cierre limpio
process.on('SIGINT', async () => {
  console.log('\n🛑 Cerrando sistema...');
  
  
  process.exit(0);
});

monitorearListaX().catch(async (error) => {
  console.error('🚨 Error crítico en monitoreo:', error.message);
  
  
  // Reintentar después de 30 segundos
  setTimeout(() => {
    console.log('🔄 Reintentando monitoreo en 30 segundos...');
    monitorearListaX().catch(console.error);
  }, 30000);
});

// Ya Funcionando todo con resolución maxima de foto y video. Version Perfecta