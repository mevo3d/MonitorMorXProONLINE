// index.js
import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import { chromium } from 'playwright';
import readline from 'readline';
import TelegramBot from 'node-telegram-bot-api';
// import WhatsAppBot from './WhatsAppMejorado.js'; // DESHABILITADO - Solo Telegram
import DetectorDuplicados from './DetectorDuplicados.js';
import https from 'https';
import path from 'path';
import { exec } from 'child_process';

import AnalizadorTendencias from './analizador-tendencias.js';

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Rutas específicas para diferentes tipos de archivos
const CARPETA_BASE = 'A:/00_AUTOMATIZACIONES/CONGRESO MORELOS/01_Monitoreo) Medios Morelos X/media/2025';
const CARPETA_VIDEOS = path.join(CARPETA_BASE, 'video');
const CARPETA_IMAGENES = path.join(CARPETA_BASE, 'img');
const CARPETA_LOGS = path.join(CARPETA_BASE, 'logs');
const RUTA_LOG_URLS = path.join(CARPETA_LOGS, 'urls_procesadas.txt');

// Rutas de respaldo en caso de fallo de la ruta principal
const CARPETA_RESPALDO = 'C:/Users/BALERION/proyectos-automatizacion/Monitor-LegislativoMor/media';
const CARPETA_VIDEOS_RESPALDO = path.join(CARPETA_RESPALDO, 'video');
const CARPETA_IMAGENES_RESPALDO = path.join(CARPETA_RESPALDO, 'img');
const CARPETA_LOGS_RESPALDO = path.join(CARPETA_RESPALDO, 'logs');
const RUTA_LOG_PENDIENTES = path.join(CARPETA_LOGS_RESPALDO, 'archivos_pendientes.json');

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
  const carpetasRespaldo = [CARPETA_RESPALDO, CARPETA_VIDEOS_RESPALDO, CARPETA_IMAGENES_RESPALDO, CARPETA_LOGS_RESPALDO];
  
  // Intentar crear carpetas principales
  let rutaPrincipalDisponible = true;
  carpetas.forEach(carpeta => {
    try {
      if (!fs.existsSync(carpeta)) {
        fs.mkdirSync(carpeta, { recursive: true });
        console.log(`📁 Carpeta creada: ${carpeta}`);
      }
    } catch (error) {
      console.error(`❌ Error creando carpeta principal: ${carpeta}`, error.message);
      rutaPrincipalDisponible = false;
    }
  });
  
  // Siempre crear carpetas de respaldo
  carpetasRespaldo.forEach(carpeta => {
    if (!fs.existsSync(carpeta)) {
      fs.mkdirSync(carpeta, { recursive: true });
      console.log(`📁 Carpeta respaldo creada: ${carpeta}`);
    }
  });
  
  if (!rutaPrincipalDisponible) {
    console.log('⚠️ Ruta principal no disponible. Usando carpetas de respaldo.');
  }
  
  return rutaPrincipalDisponible;
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

// Función para verificar disponibilidad de ruta
function verificarRutaDisponible(ruta) {
  try {
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
  
  if (verificarRutaDisponible(rutaPrincipal)) {
    return { carpeta: rutaPrincipal, esRespaldo: false };
  } else {
    console.log(`⚠️ Ruta principal no disponible para ${tipo}. Usando respaldo...`);
    return { carpeta: rutaRespaldo, esRespaldo: true };
  }
}

// Función para registrar archivos pendientes de mover
function registrarArchivoPendiente(archivoOrigen, archivoDestino, tipo) {
  try {
    let pendientes = [];
    if (fs.existsSync(RUTA_LOG_PENDIENTES)) {
      const contenido = fs.readFileSync(RUTA_LOG_PENDIENTES, 'utf8');
      pendientes = JSON.parse(contenido);
    }
    
    pendientes.push({
      origen: archivoOrigen,
      destino: archivoDestino,
      tipo: tipo,
      fecha: new Date().toISOString()
    });
    
    fs.writeFileSync(RUTA_LOG_PENDIENTES, JSON.stringify(pendientes, null, 2));
    console.log(`📝 Archivo registrado como pendiente de mover: ${path.basename(archivoOrigen)}`);
  } catch (error) {
    console.error('❌ Error registrando archivo pendiente:', error.message);
  }
}

// Función para mover archivos pendientes cuando se restaure la ruta
async function moverArchivosPendientes() {
  if (!fs.existsSync(RUTA_LOG_PENDIENTES)) {
    return;
  }
  
  try {
    const contenido = fs.readFileSync(RUTA_LOG_PENDIENTES, 'utf8');
    let pendientes = JSON.parse(contenido);
    const pendientesRestantes = [];
    let archivosMovidos = 0;
    
    for (const archivo of pendientes) {
      if (verificarRutaDisponible(path.dirname(archivo.destino))) {
        try {
          // Crear carpeta destino si no existe
          const carpetaDestino = path.dirname(archivo.destino);
          if (!fs.existsSync(carpetaDestino)) {
            fs.mkdirSync(carpetaDestino, { recursive: true });
          }
          
          // Mover archivo
          fs.copyFileSync(archivo.origen, archivo.destino);
          fs.unlinkSync(archivo.origen);
          console.log(`✅ Archivo movido: ${path.basename(archivo.origen)} → ${archivo.destino}`);
          archivosMovidos++;
        } catch (error) {
          console.error(`❌ Error moviendo archivo ${archivo.origen}:`, error.message);
          pendientesRestantes.push(archivo);
        }
      } else {
        pendientesRestantes.push(archivo);
      }
    }
    
    // Actualizar lista de pendientes
    if (pendientesRestantes.length > 0) {
      fs.writeFileSync(RUTA_LOG_PENDIENTES, JSON.stringify(pendientesRestantes, null, 2));
    } else {
      fs.unlinkSync(RUTA_LOG_PENDIENTES);
    }
    
    if (archivosMovidos > 0) {
      console.log(`📊 Total archivos movidos: ${archivosMovidos}`);
      await enviarMensajeDual(`✅ Archivos restaurados: ${archivosMovidos} archivos movidos a la ruta principal`);
    }
  } catch (error) {
    console.error('❌ Error procesando archivos pendientes:', error.message);
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
      
      // Obtener carpeta destino con fallback
      const { carpeta, esRespaldo } = obtenerCarpetaDestino('video');
      console.log(`📁 Guardando en: ${carpeta}`);
      
      // Comando yt-dlp optimizado con nombre basado en ID
      const comando = `yt-dlp --no-check-certificate --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" --encoding utf-8 -P "${carpeta}" -o "${nombreArchivo}" --format-sort "res:2160,fps,br,asr" -f "best[height<=2160]/best" --no-post-overwrites "${urlCompleta}"`;

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
          const archivos = fs.readdirSync(carpeta);
          const archivoDescargado = archivos.find(archivo => 
            archivo.startsWith(`video_${tweetId}`) && 
            (archivo.endsWith('.mp4') || archivo.endsWith('.webm') || archivo.endsWith('.mkv'))
          );
          
          if (archivoDescargado) {
            const rutaCompleta = path.join(carpeta, archivoDescargado);
            console.log(`✅ Video descargado [${tweetId}]: ${archivoDescargado}`);
            
            // Si se guardó en respaldo, registrar como pendiente
            if (esRespaldo) {
              const rutaDestinoPrincipal = path.join(CARPETA_VIDEOS, archivoDescargado);
              registrarArchivoPendiente(rutaCompleta, rutaDestinoPrincipal, 'video');
            }
            
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
      
      // Obtener carpeta destino con fallback
      const { carpeta, esRespaldo } = obtenerCarpetaDestino('imagen');
      const rutaCompleta = path.join(carpeta, nombreArchivo);
      
      console.log(`🖼️ Descargando imagen [${tweetId}]: ${nombreArchivo}`);
      console.log(`📁 Guardando en: ${carpeta}`);

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
            
            // Si se guardó en respaldo, registrar como pendiente
            if (esRespaldo) {
              const rutaDestinoPrincipal = path.join(CARPETA_IMAGENES, nombreArchivo);
              registrarArchivoPendiente(rutaCompleta, rutaDestinoPrincipal, 'imagen');
            }
            
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

const XPRO_BASE_URL = 'https://x.com';
const USER_DATA_DIR = path.resolve('./sesion-x');
const bot = new TelegramBot(TELEGRAM_TOKEN);
// const whatsapp = new WhatsAppBot(); // DESHABILITADO - Solo Telegram
const detectorDuplicados = new DetectorDuplicados();
const analizadorTendencias = new AnalizadorTendencias();
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

// DESHABILITADO - Solo Telegram
/* Comando para ver estado de WhatsApp con monitoreo mejorado
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
*/

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
                 `*🔄 Sincronización:*\n` +
                 `• /test_envio_dual - Probar envío a ambas plataformas\n\n` +
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

bot.onText(/\/test_envio_dual/, async (msg) => {
  try {
    const mensaje = `🧪 **Test de Envío Dual**\n\n` +
                   `⏰ Hora: ${new Date().toLocaleTimeString('es-MX')}\n` +
                   `📱 Este mensaje debe llegar IDÉNTICO a Telegram y WhatsApp\n` +
                   `🔄 Incluye reintento automático si falla una plataforma`;
    
    console.log('🧪 Iniciando test de envío dual...');
    const resultados = await enviarMensajeDual(mensaje);
    
    const reporte = `📊 **Resultado del Test:**\n\n` +
                   `✅ Telegram: ${resultados.telegram ? 'Enviado' : 'Falló'}\n` +
                   `✅ WhatsApp: ${resultados.whatsapp ? 'Enviado' : 'Falló'}\n\n` +
                   `${(resultados.telegram && resultados.whatsapp) ? '🎯 PERFECTO: Ambas plataformas' : '⚠️ VERIFICAR: Envío parcial'}`;
    
    await bot.sendMessage(msg.chat.id, reporte, { parse_mode: 'Markdown' });
  } catch (error) {
    await bot.sendMessage(msg.chat.id, `❌ Error en test: ${error.message}`);
  }
});

// Funciones para envío dual (Telegram + WhatsApp) - MEJORADAS
// MODIFICADO: Solo usa Telegram, WhatsApp deshabilitado
async function enviarMensajeDual(mensaje) {
  const resultados = { telegram: false, whatsapp: false };
  
  console.log(`📤 Enviando mensaje dual: "${mensaje.substring(0, 50)}..."`);
  
  // Enviar a Telegram
  try {
    await bot.sendMessage(TELEGRAM_CHAT_ID, mensaje);
    console.log('✅ Telegram: Mensaje enviado exitosamente');
    resultados.telegram = true;
  } catch (error) {
    console.error('❌ Telegram: Error enviando mensaje:', error.message);
  }
  
  // DESHABILITADO - Solo Telegram
  /*
  // Enviar a WhatsApp
  const estadoWA = whatsapp.getEstado();
  if (estadoWA.conectado) {
    try {
      const exitoso = await whatsapp.enviarMensaje(mensaje);
      if (exitoso) {
        console.log('✅ WhatsApp: Mensaje enviado exitosamente');
        resultados.whatsapp = true;
      } else {
        console.error('❌ WhatsApp: Falló el envío del mensaje');
      }
    } catch (error) {
      console.error('❌ WhatsApp: Error enviando mensaje:', error.message);
    }
  } else {
    console.log('⚠️ WhatsApp: No conectado, mensaje no enviado');
  }
  */
  
  // Reporte de resultados
  const envios = [];
  if (resultados.telegram) envios.push('Telegram');
  if (resultados.whatsapp) envios.push('WhatsApp');
  
  if (envios.length === 0) {
    console.error('❌ CRÍTICO: Mensaje NO se envió a ninguna plataforma');
  } else if (envios.length === 1) {
    console.log(`⚠️ PARCIAL: Mensaje enviado solo a ${envios[0]}`);
    
    // REINTENTO AUTOMÁTICO después de 3 segundos
    await new Promise(resolve => setTimeout(resolve, 3000));
    const resultadosReintento = await reintentarEnvio('mensaje', { mensaje }, resultados);
    
    // Verificar si el reintento fue exitoso
    const enviosFinales = [];
    if (resultadosReintento.telegram) enviosFinales.push('Telegram');
    if (resultadosReintento.whatsapp) enviosFinales.push('WhatsApp');
    
    if (enviosFinales.length === 2) {
      console.log('✅ REINTENTO EXITOSO: Mensaje ahora enviado a ambas plataformas');
    }
    
    return resultadosReintento;
  } else {
    console.log(`✅ COMPLETO: Mensaje enviado a ${envios.join(' y ')}`);
  }
  
  return resultados;
}

async function enviarImagenDual(rutaImagen, caption) {
  const resultados = { telegram: false, whatsapp: false };
  
  console.log(`🖼️ Enviando imagen dual: ${rutaImagen} con caption: "${caption.substring(0, 30)}..."`);
  
  // Enviar a Telegram
  try {
    await bot.sendPhoto(TELEGRAM_CHAT_ID, rutaImagen, { caption });
    console.log('✅ Telegram: Imagen enviada exitosamente');
    resultados.telegram = true;
  } catch (error) {
    console.error('❌ Telegram: Error enviando imagen:', error.message);
  }
  
  // DESHABILITADO - Solo Telegram
  /*
  // Enviar a WhatsApp
  const estadoWA = whatsapp.getEstado();
  if (estadoWA.conectado) {
    try {
      const exitoso = await whatsapp.enviarImagen(rutaImagen, caption);
      if (exitoso) {
        console.log('✅ WhatsApp: Imagen enviada exitosamente');
        resultados.whatsapp = true;
      } else {
        console.error('❌ WhatsApp: Falló el envío de imagen');
      }
    } catch (error) {
      console.error('❌ WhatsApp: Error enviando imagen:', error.message);
    }
  } else {
    console.log('⚠️ WhatsApp: No conectado, imagen no enviada');
  }
  */
  
  // Reporte de resultados
  const envios = [];
  if (resultados.telegram) envios.push('Telegram');
  if (resultados.whatsapp) envios.push('WhatsApp');
  
  if (envios.length === 0) {
    console.error('❌ CRÍTICO: Imagen NO se envió a ninguna plataforma');
  } else if (envios.length === 1) {
    console.log(`⚠️ PARCIAL: Imagen enviada solo a ${envios[0]}`);
    
    // REINTENTO AUTOMÁTICO después de 5 segundos (más tiempo para imágenes)
    await new Promise(resolve => setTimeout(resolve, 5000));
    const resultadosReintento = await reintentarEnvio('imagen', { rutaImagen, caption }, resultados);
    
    // Verificar si el reintento fue exitoso
    const enviosFinales = [];
    if (resultadosReintento.telegram) enviosFinales.push('Telegram');
    if (resultadosReintento.whatsapp) enviosFinales.push('WhatsApp');
    
    if (enviosFinales.length === 2) {
      console.log('✅ REINTENTO EXITOSO: Imagen ahora enviada a ambas plataformas');
    }
    
    return resultadosReintento;
  } else {
    console.log(`✅ COMPLETO: Imagen enviada a ${envios.join(' y ')}`);
  }
  
  return resultados;
}

async function enviarVideoDual(rutaVideo, caption) {
  const resultados = { telegram: false, whatsapp: false };
  
  console.log(`🎬 Enviando video dual: ${rutaVideo} con caption: "${caption.substring(0, 30)}..."`);
  
  // Enviar a Telegram
  try {
    await bot.sendVideo(TELEGRAM_CHAT_ID, rutaVideo, { caption });
    console.log('✅ Telegram: Video enviado exitosamente');
    resultados.telegram = true;
  } catch (error) {
    console.error('❌ Telegram: Error enviando video:', error.message);
  }
  
  // DESHABILITADO - Solo Telegram
  /*
  // Enviar a WhatsApp
  const estadoWA = whatsapp.getEstado();
  if (estadoWA.conectado) {
    try {
      console.log('📱 WhatsApp: Intentando enviar video...');
      const exitoso = await whatsapp.enviarVideo(rutaVideo, caption);
      if (exitoso) {
        console.log('✅ WhatsApp: Video enviado exitosamente');
        resultados.whatsapp = true;
      } else {
        console.error('❌ WhatsApp: Falló el envío de video');
      }
    } catch (error) {
      console.error('❌ WhatsApp: Error enviando video:', error.message);
    }
  } else {
    console.log('⚠️ WhatsApp: No conectado, video no enviado');
  }
  */
  
  // Reporte de resultados
  const envios = [];
  if (resultados.telegram) envios.push('Telegram');
  if (resultados.whatsapp) envios.push('WhatsApp');
  
  if (envios.length === 0) {
    console.error('❌ CRÍTICO: Video NO se envió a ninguna plataforma');
  } else if (envios.length === 1) {
    console.log(`⚠️ PARCIAL: Video enviado solo a ${envios[0]}`);
    
    // REINTENTO AUTOMÁTICO después de 10 segundos (más tiempo para videos)
    await new Promise(resolve => setTimeout(resolve, 10000));
    const resultadosReintento = await reintentarEnvio('video', { rutaVideo, caption }, resultados);
    
    // Verificar si el reintento fue exitoso
    const enviosFinales = [];
    if (resultadosReintento.telegram) enviosFinales.push('Telegram');
    if (resultadosReintento.whatsapp) enviosFinales.push('WhatsApp');
    
    if (enviosFinales.length === 2) {
      console.log('✅ REINTENTO EXITOSO: Video ahora enviado a ambas plataformas');
    }
    
    return resultadosReintento;
  } else {
    console.log(`✅ COMPLETO: Video enviado a ${envios.join(' y ')}`);
  }
  
  return resultados;
}

// Función para reintentar envío si falló una plataforma
async function reintentarEnvio(tipoEnvio, parametros, resultadosPrevios) {
  console.log(`🔄 Reintentando envío ${tipoEnvio} para plataformas fallidas...`);
  
  const resultadosReintento = { ...resultadosPrevios };
  
  // Reintentar Telegram si falló
  if (!resultadosPrevios.telegram) {
    try {
      if (tipoEnvio === 'mensaje') {
        await bot.sendMessage(TELEGRAM_CHAT_ID, parametros.mensaje);
      } else if (tipoEnvio === 'imagen') {
        await bot.sendPhoto(TELEGRAM_CHAT_ID, parametros.rutaImagen, { caption: parametros.caption });
      } else if (tipoEnvio === 'video') {
        await bot.sendVideo(TELEGRAM_CHAT_ID, parametros.rutaVideo, { caption: parametros.caption });
      }
      console.log('✅ Telegram: Reintento exitoso');
      resultadosReintento.telegram = true;
    } catch (error) {
      console.error('❌ Telegram: Reintento falló:', error.message);
    }
  }
  
  // DESHABILITADO - Solo Telegram
  /*
  // Reintentar WhatsApp si falló
  if (!resultadosPrevios.whatsapp && whatsapp.getEstado().conectado) {
    try {
      let exitoso = false;
      if (tipoEnvio === 'mensaje') {
        exitoso = await whatsapp.enviarMensaje(parametros.mensaje);
      } else if (tipoEnvio === 'imagen') {
        exitoso = await whatsapp.enviarImagen(parametros.rutaImagen, parametros.caption);
      } else if (tipoEnvio === 'video') {
        exitoso = await whatsapp.enviarVideo(parametros.rutaVideo, parametros.caption);
      }
      
      if (exitoso) {
        console.log('✅ WhatsApp: Reintento exitoso');
        resultadosReintento.whatsapp = true;
      } else {
        console.error('❌ WhatsApp: Reintento falló');
      }
    } catch (error) {
      console.error('❌ WhatsApp: Reintento falló:', error.message);
    }
  }
  */
  
  return resultadosReintento;
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
    div.style.background = 'rgba(0,0,0,0.9)';
    div.style.color = '#00ff00';
    div.style.padding = '15px 25px';
    div.style.zIndex = 9999;
    div.style.fontFamily = 'Consolas, monospace';
    div.style.fontSize = '13px';
    div.style.borderRadius = '8px';
    div.style.border = '2px solid #00ff00';
    div.style.boxShadow = '0 4px 12px rgba(0,255,0,0.3)';
    div.style.textAlign = 'left';
    div.style.minWidth = '450px';
    div.style.maxWidth = '600px';
    div.innerText = '🤖 Monitor X Pro - Iniciando...';
    document.body.appendChild(div);
  });
}

async function actualizarOverlay(page, segundosRestantes, tweetsEncontrados, columnasMonitoreadas = 0, nombresColumnas = [], segundosHastaScroll = 0, ultimoScrollStatus = '') {
  await page.evaluate(({ segundos, encontrados, columnas, nombres, scrollSegundos, scrollStatus }) => {
    const div = document.getElementById('overlay-monitor');
    if (div) {
      const tiempo = new Date().toLocaleTimeString('es-MX');
      
      // Calcular minutos y segundos para el auto-scroll
      const scrollMinutos = Math.floor(scrollSegundos / 60);
      const scrollSegs = scrollSegundos % 60;
      
      let contenido = `🤖 Monitor X Pro ACTIVO | ⏰ ${tiempo}\n`;
      contenido += `────────────────────────────────────────\n`;
      contenido += `🔄 Próxima revisión tweets: ${segundos}s\n`;
      contenido += `⬆️ Auto-scroll decks en: ${scrollMinutos}m ${scrollSegs}s\n`;
      
      if (scrollStatus) {
        contenido += `✅ Último scroll: ${scrollStatus}\n`;
      }
      
      contenido += `────────────────────────────────────────\n`;
      contenido += `📊 Columnas detectadas: ${columnas}\n`;
      contenido += `📨 Tweets enviados hoy: ${encontrados}\n`;
      
      if (nombres && nombres.length > 0) {
        contenido += `────────────────────────────────────────\n`;
        contenido += `📋 Decks monitoreados:\n`;
        nombres.slice(0, 8).forEach((nombre, i) => {
          contenido += `  ${i + 1}. ${nombre}\n`;
        });
        if (nombres.length > 8) {
          contenido += `  ... y ${nombres.length - 8} más\n`;
        }
      }
      
      div.innerText = contenido;
      
      // Actualizar estilos para mejor visibilidad
      div.style.background = 'linear-gradient(135deg, rgba(0,0,0,0.95) 0%, rgba(0,20,0,0.95) 100%)';
      div.style.backdropFilter = 'blur(5px)';
    }
  }, { 
    segundos: segundosRestantes, 
    encontrados: tweetsEncontrados, 
    columnas: columnasMonitoreadas,
    nombres: nombresColumnas,
    scrollSegundos: segundosHastaScroll,
    scrollStatus: ultimoScrollStatus
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

async function inicializarXProConReintentos(maxIntentos = 3, delaySegundos = 30) {
  for (let intento = 1; intento <= maxIntentos; intento++) {
    try {
      console.log(`🌐 Intento ${intento}/${maxIntentos} - Iniciando navegador...`);
      
      const result = await monitorearListaX();
      console.log('✅ X Pro conectado exitosamente');
      return result;
      
    } catch (error) {
      console.error(`❌ Error iniciando navegador (intento ${intento}/${maxIntentos}):`, error.message);
      
      if (intento === maxIntentos) {
        console.error('❌ No se pudo conectar a X Pro después de todos los intentos');
        await enviarMensajeDual(`❌ Error crítico: No se pudo conectar a X Pro después de ${maxIntentos} intentos. Sistema detenido.`);
        throw error;
      }
      
      console.log(`⏳ Esperando ${delaySegundos} segundos antes del siguiente intento...`);
      await new Promise(resolve => setTimeout(resolve, delaySegundos * 1000));
    }
  }
}

// DESHABILITADO - Solo Telegram
/*
async function inicializarWhatsAppConReintentos(maxIntentos = 3, delaySegundos = 30) {
  let lastNotificationTime = 0;
  const NOTIFICATION_COOLDOWN = 10 * 60 * 1000; // 10 minutos entre notificaciones
  
  for (let intento = 1; intento <= maxIntentos; intento++) {
    try {
      console.log(`📱 Intento ${intento}/${maxIntentos} - Inicializando WhatsApp...`);
      
      const success = await whatsapp.inicializar();
      if (success) {
        console.log('✅ WhatsApp inicializado correctamente');
        return true;
      } else {
        throw new Error('WhatsApp inicialización falló');
      }
      
    } catch (error) {
      console.error(`❌ Error inicializando WhatsApp (intento ${intento}/${maxIntentos}):`, error.message);
      
      // Solo enviar notificación en el primer intento o si han pasado 10 minutos
      const now = Date.now();
      if (intento === 1 || (now - lastNotificationTime) > NOTIFICATION_COOLDOWN) {
        await enviarMensajeDual(`⚠️ WhatsApp falló en intento ${intento}/${maxIntentos}. ${intento < maxIntentos ? 'Reintentando...' : 'Continuando solo con Telegram.'}`);
        lastNotificationTime = now;
      }
      
      if (intento === maxIntentos) {
        console.log('⚠️ WhatsApp no se pudo inicializar - solo se usará Telegram');
        return false;
      }
      
      console.log(`⏳ Esperando ${delaySegundos} segundos antes del siguiente intento...`);
      await new Promise(resolve => setTimeout(resolve, delaySegundos * 1000));
    }
  }
  
  return false;
}
*/

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
    
    console.log('📄 Usando página existente del contexto...');
    // Usar la primera página existente en lugar de crear una nueva
    const pages = context.pages();
    if (pages.length > 0) {
      page = pages[0];
      console.log('📄 Reutilizando página existente');
    } else {
      // Solo crear nueva página si no hay ninguna
      console.log('📄 No hay páginas, creando nueva...');
      page = await context.newPage();
    }
    
    // Configurar timeouts más largos
    page.setDefaultNavigationTimeout(90000); // 90 segundos
    page.setDefaultTimeout(60000); // 60 segundos
    
    console.log('🌐 Navegando a X...');
    await page.goto(XPRO_BASE_URL, { 
      waitUntil: 'domcontentloaded',
      timeout: 60000 
    });
    
    console.log('⏳ Esperando carga inicial...');
    await page.waitForTimeout(5000);
    
    // Verificar si necesitamos login
    const currentUrl = page.url();
    console.log(`📍 URL actual: ${currentUrl}`);
    
    if (currentUrl.includes('login') || currentUrl.includes('i/flow/login')) {
      await enviarMensajeDual('❌ No estás logueado en X. Por favor inicia sesión manualmente.');
      console.log('❌ No logueado. Esperando login manual...');
      
      // Esperar hasta que esté logueado (URL cambie a home)
      await page.waitForFunction(() => {
        return window.location.href.includes('/home') || 
               window.location.href === 'https://x.com/' ||
               !window.location.href.includes('login');
      }, { timeout: 0 });
      
      console.log('🔐 Login completado. Continuando...');
      await page.waitForTimeout(3000);
    } else {
      console.log('✅ Ya estás logueado.');
    }
    
    // Navegar a Pro X si no estamos ya ahí
    if (!page.url().includes('pro.x.com')) {
      console.log('🔄 Navegando a X Pro...');
      await page.goto('https://pro.x.com', { 
        waitUntil: 'domcontentloaded',
        timeout: 60000 
      });
      await page.waitForTimeout(3000);
    }
    
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
    await enviarMensajeDual('❌ Error iniciando navegador. Verifica conexión a internet o que no haya otras instancias abiertas.');
    
    throw error;
  }

  console.log('📄 Iniciando monitoreo de DECKS en X Pro...');
  await agregarOverlay(page);

  // Variables para heartbeat y reconexión
  let heartbeatInterval = null;
  let lastActivityTime = Date.now();
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 5;
  const HEARTBEAT_INTERVAL = 30000; // 30 segundos
  
  // Función de heartbeat para mantener conexión activa
  const iniciarHeartbeat = () => {
    console.log('💓 Iniciando sistema de heartbeat anti-cierre...');
    heartbeatInterval = setInterval(async () => {
      try {
        // Verificar si la página responde
        const isConnected = await Promise.race([
          page.evaluate(() => true),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), 5000)
          )
        ]);
        
        if (isConnected) {
          const tiempoInactivo = (Date.now() - lastActivityTime) / 1000 / 60;
          console.log(`💓 Heartbeat OK - Inactivo: ${tiempoInactivo.toFixed(1)} min`);
          
          // Mantener página activa con micro-scroll
          await page.evaluate(() => {
            window.scrollBy(0, 1);
            window.scrollBy(0, -1);
          });
          lastActivityTime = Date.now();
        }
      } catch (error) {
        console.error('⚠️ Heartbeat falló, intentando reconectar...');
        clearInterval(heartbeatInterval);
        
        // Intentar reconectar
        reconnectAttempts++;
        if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
          console.log(`🔄 Intento de reconexión ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}...`);
          try {
            // Intentar navegar de nuevo
            await page.goto(page.url(), { waitUntil: 'domcontentloaded', timeout: 30000 });
            console.log('✅ Reconexión exitosa');
            reconnectAttempts = 0;
            iniciarHeartbeat(); // Reiniciar heartbeat
          } catch (reconError) {
            console.error('❌ Reconexión falló:', reconError.message);
            if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
              console.error('❌ Máximo de reconexiones alcanzado. Reiniciando sistema...');
              await enviarMensajeDual('⚠️ Sistema perdió conexión. Reiniciando...');
              // Reiniciar todo el proceso
              process.exit(1);
            }
          }
        }
      }
    }, HEARTBEAT_INTERVAL);
  };
  
  // Iniciar heartbeat
  iniciarHeartbeat();

  // Determinar desde cuándo buscar tweets
  const ahora = new Date();
  const hora = ahora.getHours();
  const minutos = ahora.getMinutes();
  let inicioHora;
  
  if (hora === 0 && minutos >= 1 && minutos <= 30) {
    // Si es entre 00:01 y 00:30, buscar tweets de las últimas 24 horas
    inicioHora = Date.now() - (24 * 60 * 60 * 1000);
    console.log('🕐 Verificando tweets de las últimas 24 horas...');
  } else if (hora >= 1) {
    // Si es después de las 01:00, buscar desde las 00:00 del día actual
    const inicioDelDia = new Date(ahora);
    inicioDelDia.setHours(0, 0, 0, 0); // 00:00:00 del día actual
    inicioHora = inicioDelDia.getTime();
    console.log(`🌅 Buscando tweets desde las 00:00 hrs del día actual (${inicioDelDia.toLocaleString('es-MX')})`);
  } else {
    // Entre 00:31 y 00:59, buscar última hora para evitar duplicados del día anterior
    inicioHora = Date.now() - (60 * 60 * 1000);
    console.log('🕛 Buscando tweets de la última hora...');
  }
  
  console.log('🤖 Monitoreo activo. Presiona ENTER para detener...');

  let segundos = 30;
  let tweetsEncontrados = 0;
  let columnasMonitoreadas = 0;
  let nombresColumnas = [];
  let primeraDeteccion = true; // Para controlar logs iniciales
  
  // Variables para el auto-scroll
  let segundosHastaScroll = 180; // 3 minutos = 180 segundos
  let ultimoScrollStatus = '';
  let ultimoScrollTime = Date.now();

  const intervaloVisual = setInterval(() => {
    segundos -= 1;
    if (segundos < 0) segundos = 30;
    
    // Actualizar contador de auto-scroll
    segundosHastaScroll -= 1;
    if (segundosHastaScroll < 0) segundosHastaScroll = 180;
    
    actualizarOverlay(page, segundos, tweetsEncontrados, columnasMonitoreadas, nombresColumnas, segundosHastaScroll, ultimoScrollStatus);
  }, 1000);
  
  // Intervalo para verificar y mover archivos pendientes (cada 5 minutos)
  const intervaloMoverArchivos = setInterval(async () => {
    await moverArchivosPendientes();
  }, 5 * 60 * 1000);
  
  // Intervalo para auto-scroll al tope de cada deck (cada 3 minutos)
  const intervaloAutoScroll = setInterval(async () => {
    try {
      const horaScroll = new Date().toLocaleTimeString('es-MX');
      console.log(`🔄 [${horaScroll}] Auto-scroll: Iniciando scroll de todos los decks...`);
      
      let columnasScrolleadas = 0;
      let metodoUsado = '';
      
      // Método 1: Buscar columnas con el selector principal
      let columnasActuales = await page.$$('[data-testid="multi-column-layout-column-content"]');
      
      if (columnasActuales.length === 0) {
        console.log('  🔍 Buscando columnas con selectores alternativos...');
        // Método 2: Buscar con selectores alternativos
        const selectoresAlternativos = [
          'div[data-testid*="column"]',
          'section[role="region"]',
          'div[class*="css-1dbjc4n r-1h8ys4a"]', // Selector de clase común en X
          'div[aria-label*="Timeline"]'
        ];
        
        for (const selector of selectoresAlternativos) {
          columnasActuales = await page.$$(selector);
          if (columnasActuales.length > 0) {
            console.log(`  ✅ Encontradas ${columnasActuales.length} columnas con: ${selector}`);
            metodoUsado = selector;
            break;
          }
        }
      } else {
        metodoUsado = 'data-testid="multi-column-layout-column-content"';
        console.log(`  📋 Encontradas ${columnasActuales.length} columnas con selector principal`);
      }
      
      if (columnasActuales.length > 0) {
        console.log(`  🎯 Aplicando scroll a ${columnasActuales.length} columnas...`);
        
        // Aplicar scroll a cada columna encontrada
        for (let i = 0; i < columnasActuales.length; i++) {
          try {
            const scrollExitoso = await columnasActuales[i].evaluate((el, index) => {
              // Buscar el elemento scrollable dentro de la columna
              const scrollables = [
                el,
                el.querySelector('[data-testid="primaryColumn"]'),
                el.querySelector('div > div > div'),
                el.firstElementChild,
                el.parentElement
              ].filter(Boolean);
              
              let scrolled = false;
              for (const scrollable of scrollables) {
                if (scrollable && scrollable.scrollHeight > scrollable.clientHeight) {
                  scrollable.scrollTop = 0;
                  scrollable.dispatchEvent(new Event('scroll', { bubbles: true }));
                  scrolled = true;
                  break;
                }
              }
              
              // También intentar con el scroll principal de la columna
              if (!scrolled && el.scrollTop > 0) {
                el.scrollTop = 0;
                el.dispatchEvent(new Event('scroll', { bubbles: true }));
                scrolled = true;
              }
              
              return scrolled;
            }, i);
            
            if (scrollExitoso) {
              columnasScrolleadas++;
              console.log(`    ✅ Columna ${i + 1}: Scroll aplicado`);
            } else {
              console.log(`    ⚠️ Columna ${i + 1}: Ya estaba al tope o no es scrollable`);
            }
            
            // Pequeña pausa entre columnas para evitar conflictos
            await page.waitForTimeout(100);
            
          } catch (error) {
            console.log(`    ❌ Columna ${i + 1}: Error - ${error.message}`);
          }
        }
        
        // Actualizar estado
        ultimoScrollStatus = `${columnasScrolleadas}/${columnasActuales.length} decks @ ${horaScroll}`;
        console.log(`  🏁 Auto-scroll completado: ${ultimoScrollStatus}`);
        
      } else {
        console.log('  ⚠️ No se encontraron columnas para hacer scroll');
        ultimoScrollStatus = `Sin columnas @ ${horaScroll}`;
      }
      
      // Reiniciar contador
      segundosHastaScroll = 180;
      ultimoScrollTime = Date.now();
      
    } catch (error) {
      console.log(`❌ Error en auto-scroll: ${error.message}`);
      ultimoScrollStatus = `Error @ ${new Date().toLocaleTimeString('es-MX')}`;
    }
  }, 3 * 60 * 1000); // Cada 3 minutos

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
      
      // Si no encontramos columnas, intentar detectar por contenido genérico
      if (columnas.length === 0 && primeraDeteccion) {
        console.log('🔍 No se encontraron columnas con selectores estándar, buscando alternativas...');
        try {
          // Buscar TODOS los contenedores posibles de columnas sin limitarse a nombres específicos
          const selectoresAlternativos = [
            '[data-testid="multi-column-layout-column-content"]',
            '[data-testid="primaryColumn"]',
            '[data-testid="sidebarColumn"]',
            '[role="region"][aria-label*="Timeline"]',
            'div[aria-label*="column"]',
            'section[role="region"]'
          ];
          
          for (const selector of selectoresAlternativos) {
            const contenedores = await page.$$(selector);
            if (contenedores.length > 0) {
              columnas = contenedores;
              console.log(`📋 Encontradas ${columnas.length} columnas con selector: ${selector}`);
              break;
            }
          }
          
          // Si aún no encontramos, buscar cualquier contenedor con artículos (tweets)
          if (columnas.length === 0) {
            const todosLosContenedores = await page.$$('div');
            const contenedoresConTweets = [];
            
            for (const contenedor of todosLosContenedores) {
              const articulos = await contenedor.$$('article');
              if (articulos.length > 0) {
                contenedoresConTweets.push(contenedor);
              }
            }
            
            if (contenedoresConTweets.length > 0) {
              columnas = contenedoresConTweets;
              console.log(`📋 Encontradas ${columnas.length} columnas por detección de contenido`);
            }
          }
        } catch (error) {
          console.log(`❌ Error buscando columnas alternativas: ${error.message}`);
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

      // Actualizar tiempo de última actividad
      lastActivityTime = Date.now();
      
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
              
              // Agregar al analizador de tendencias
              analizadorTendencias.agregarTweet({
                id: tweetId,
                texto: textoTweet,
                autor: autor,
                fecha: new Date(),
                url: tweetUrlCompleta,
                categorias: palabrasEncontradas,
                palabrasClave: palabrasEncontradas
              }, false);
              
              // Notificar omisiones pendientes después del envío exitoso
              await detectorDuplicados.notificarOmisionesPendientes();
              
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
              
              // Agregar al analizador de tendencias
              analizadorTendencias.agregarTweet({
                id: tweetId,
                texto: textoTweet,
                autor: autor,
                fecha: new Date(),
                url: tweetUrlCompleta,
                categorias: palabrasEncontradas,
                palabrasClave: palabrasEncontradas
              }, false);
              
              // Notificar omisiones pendientes después del envío exitoso
              await detectorDuplicados.notificarOmisionesPendientes();
              
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
        
        // Agregar al analizador de tendencias
        analizadorTendencias.agregarTweet({
          id: tweetId,
          texto: textoTweet,
          autor: autor,
          fecha: new Date(),
          url: tweetUrlCompleta,
          categorias: palabrasEncontradas,
          palabrasClave: palabrasEncontradas
        }, false);
        
        tweetsEncontrados++;
        console.log(`✅ Enviado [${tweetId}] - ${nombreColumna}`);
      }
      
      // SCROLL AUTOMÁTICO: Subir hacia arriba para ver tweets más recientes
      // DETECTAR Y CLICKEAR BOTONES "VER POSTS NUEVOS"
      try {
        const botonesClickeados = await page.evaluate(() => {
          let clicksRealizados = 0;
          
          // Buscar botones "Ver posts nuevos" o similares
          const selectoresBotones = [
            'div[role="button"][tabindex="0"]',
            'div[data-testid="cellInnerDiv"] div[role="button"]',
            'button[role="button"]',
            'div[role="button"]'
          ];
          
          // Primero buscar banner principal en la parte superior
          for (const selector of selectoresBotones) {
            const elementos = document.querySelectorAll(selector);
            
            for (const elemento of elementos) {
              try {
                const texto = elemento.textContent || elemento.innerText || '';
                const ariaLabel = elemento.getAttribute('aria-label') || '';
                const textoCompleto = (texto + ' ' + ariaLabel).toLowerCase();
                
                // Verificar si es el banner de nuevos tweets/posts
                if ((textoCompleto.includes('ver') && textoCompleto.includes('nuevo')) ||
                    (textoCompleto.includes('show') && textoCompleto.includes('new')) ||
                    (textoCompleto.includes('tweet') && textoCompleto.includes('nuevo')) ||
                    (textoCompleto.includes('post') && textoCompleto.includes('nuevo')) ||
                    textoCompleto.includes('más reciente') ||
                    textoCompleto.includes('most recent')) {
                  
                  const rect = elemento.getBoundingClientRect();
                  
                  // Verificar que esté visible Y en la parte superior (primeros 500px)
                  const esVisible = rect.width > 0 && rect.height > 0 && 
                                  rect.top >= 0 && rect.top < 500 && rect.left >= 0;
                  
                  if (esVisible) {
                    elemento.click();
                    clicksRealizados++;
                    
                    // Hacer un pequeño scroll para asegurar que se cargue el contenido
                    setTimeout(() => {
                      window.scrollBy(0, 100);
                      setTimeout(() => {
                        window.scrollBy(0, -100);
                      }, 300);
                    }, 500);
                    
                    return clicksRealizados; // Salir después del primer click exitoso
                  }
                }
              } catch (error) {
                // Error silencioso
              }
            }
          }
          
          // Si no hay banner principal, buscar en columnas individuales
          if (clicksRealizados === 0) {
            const columnas = document.querySelectorAll('[data-testid="column-content"]');
            
            for (const columna of columnas) {
              if (clicksRealizados >= 3) break; // Máximo 3 clicks
              
              const botonesColumna = columna.querySelectorAll('div[role="button"], button[role="button"]');
              
              for (const boton of botonesColumna) {
                const texto = boton.textContent || boton.innerText || '';
                const textoLower = texto.toLowerCase();
                
                if ((textoLower.includes('ver') && textoLower.includes('nuevo')) ||
                    (textoLower.includes('show') && textoLower.includes('new')) ||
                    (textoLower.includes('post') && textoLower.includes('nuevo'))) {
                  
                  const rect = boton.getBoundingClientRect();
                  if (rect.width > 0 && rect.height > 0 && rect.top >= 0) {
                    boton.click();
                    clicksRealizados++;
                    break; // Solo un click por columna
                  }
                }
              }
            }
          }
          
          return clicksRealizados;
        });
        
        // Después de clickear botones, hacer scroll automático
        await page.evaluate(() => {
          // Hacer scroll hacia arriba en todas las columnas
          const columnas = document.querySelectorAll('[data-testid="column-content"]');
          columnas.forEach(columna => {
            if (columna) {
              columna.scrollTop = 0; // Subir al inicio de cada columna
            }
          });
          
          // También hacer scroll en la página principal
          window.scrollTo(0, 0);
        });
        
        // Funciona silenciosamente - no mostrar mensajes repetitivos
      } catch (scrollError) {
        if (primeraDeteccion) {
          console.log('⚠️ Error en scroll automático:', scrollError.message);
        }
      }
      
    } catch (err) {
      console.error('❌ Error durante el monitoreo:', err.message);
      
      // Manejar errores específicos de conexión
      if (err.message.includes('Target closed') || 
          err.message.includes('Protocol error') ||
          err.message.includes('Navigation failed') ||
          err.message.includes('Execution context was destroyed')) {
        
        console.log('🔄 Error de conexión detectado, intentando recuperar...');
        reconnectAttempts++;
        
        if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
          try {
            // Intentar navegar de nuevo a la página actual
            await page.goto(page.url(), { waitUntil: 'domcontentloaded', timeout: 30000 });
            console.log('✅ Recuperación exitosa');
            reconnectAttempts = 0;
          } catch (recError) {
            console.error('❌ No se pudo recuperar:', recError.message);
            if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
              console.error('❌ Reiniciando sistema completo...');
              clearInterval(heartbeatInterval);
              clearInterval(intervaloBusqueda);
              clearInterval(intervaloVisual);
              clearInterval(intervaloMoverArchivos);
              clearInterval(intervaloAutoScroll);
              process.exit(1);
            }
          }
        }
      }
    }
  }, 30000);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('', async () => {
    clearInterval(intervaloVisual);
    clearInterval(intervaloBusqueda);
    clearInterval(intervaloMoverArchivos);
    clearInterval(intervaloAutoScroll);
    
    // Limpiar heartbeat
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      console.log('💓 Heartbeat detenido');
    }

    const resumen = Object.entries(resumenDiario.menciones)
      .sort(([, a], [, b]) => b - a)
      .map(([k, v]) => `- ${k}: ${v}`)
      .join('\n');

    const resumenTexto = `🧾 Resumen Diario:\n- Menciones totales: ${resumenDiario.total}\n- Tweets enviados: ${resumenDiario.enviados}\n- Más mencionados:\n${resumen}`;

    await enviarMensajeDual(resumenTexto);
    await enviarMensajeDual('🛑 Monitoreo detenido manualmente.');
    console.log('🛑 Monitoreo detenido manualmente. Cerrando navegador...');
    
    // DESHABILITADO - Solo Telegram
    /*
    // Cerrar WhatsApp si está conectado
    if (whatsapp.getEstado().conectado) {
      try {
        await whatsapp.cerrar();
      } catch (error) {
        console.log('⚠️ Error cerrando WhatsApp:', error.message);
      }
    }
    */
    
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
console.log('🚀 Monitor de X Pro Deck iniciado (Solo Telegram)');

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



// DESHABILITADO - Solo Telegram
/*
// Inicializar WhatsApp con reintentos
console.log('📱 Inicializando WhatsApp...');
inicializarWhatsAppConReintentos(3, 30).then(success => {
  if (success) {
    console.log('✅ WhatsApp inicializado correctamente');
  } else {
    console.log('⚠️ WhatsApp no se pudo inicializar - solo se usará Telegram');
  }
}).catch(error => {
  console.error('❌ Error inicializando WhatsApp:', error.message);
  console.log('⚠️ Continuando solo con Telegram');
});
*/

// Enviar notificación de inicio
setTimeout(() => {
  const mensaje = `🚀 *Monitor X Pro INICIADO*\n\n` +
    `📱 Telegram: ✅ Conectado\n` +
    // DESHABILITADO - Solo Telegram
    // `📱 WhatsApp: ${whatsapp.getEstado().conectado ? '✅ Conectado' : '⏳ Conectando...'}\n\n` +
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
    // DESHABILITADO - Solo Telegram
    // `• /whatsapp - Ver estado WhatsApp\n` +
    `• /help - Ver todos los comandos\n\n` +
    `📹 Videos y 🖼️ imágenes se descargan con ID único\n` +
    `🧹 Limpieza automática los lunes\n` +
    `🔄 Monitoreo automático de múltiples columnas\n` +
    `📲 Envío solo por Telegram`;

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

// DESHABILITADO: Cierre automático comentado para evitar cierres inesperados
// Si necesitas el cierre automático, descomenta las siguientes líneas:
// programarCierreAutomatico();
console.log('⚠️ Cierre automático a las 23:59 DESHABILITADO - El monitor funcionará continuamente');

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

inicializarXProConReintentos(3, 30).catch(async (error) => {
  console.error('🚨 Error crítico en monitoreo:', error.message);
  
  // Reintentar después de 30 segundos
  setTimeout(() => {
    console.log('🔄 Reintentando monitoreo en 30 segundos...');
    inicializarXProConReintentos(3, 30).catch(console.error);
  }, 30000);
});

// Ya Funcionando todo con resolución maxima de foto y video. Version Perfecta