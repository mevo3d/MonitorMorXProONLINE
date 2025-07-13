// index.js
import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import { chromium } from 'playwright';
import TelegramBot from 'node-telegram-bot-api';
import https from 'https';
import path from 'path';
import { exec } from 'child_process';
import dayjs from 'dayjs';

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const PALABRAS_CLAVE = [
  "Congreso Morelos", "Legislatura 56", "Congreso del Estado", "Diputado local",
  "Mesa Directiva", "Diputación Permanente", "Iniciativa de Ley", "Reforma legislativa",
  "Comisión legislativa", "Reglamento del Congreso", "Proceso legislativo", "Sesión ordinaria",
  "Período legislativo", "Transparencia legislativa", "Debate parlamentario",
  "Isaac Pimentel", "Diputado Isaac", "Diputado local MORENA", "Isaac Pimentel Mejía",
  "Comisión de Reglamentos", "Comisión de Participación Ciudadana", "Reforma política",
  "Plurinominal Morena", "Presidente de Comisión", "Exalcalde de Ayala","Participación democrática", "MORENA Morelos",
  "Unidad y progreso social", "Legislador progresista", "Congresista joven",
  "Normas de debate", "Mejores prácticas parlamentarias", "Diálogo legislativo",
  "Investigación parlamentaria", "Participación ciudadana", "Asamblea Ciudadana",
  "Revocación de mandato", "Presupuesto participativo", "Reforma a la Ley de Participación Ciudadana",
  "Democracia directa", "Pueblos indígenas y participación", "Parlamento abierto",
  "Consulta ciudadana", "Gobernanza democrática", "Daniel Martínez Terrazas", "Andrea Valentina Gordillo", "Sergio Omar Livera Chavarría",
  "Guillermina Maya Rendón", "Jazmín Juana Solano López", "Rafael Reyes Reyes",
  "Nayla Carolina Ruiz Rodríguez", "Luz María Mendoza Domínguez", "Alfredo Domínguez Mandujano",
  "Francisco Erik Sánchez Zavala", "Alfonso de Jesús Sotelo Martínez", "Melissa Montes de Oca Montoya",
  "Brenda Espinoza López", "Gerardo Abarca Peña", "Luz Dary Quevedo Maldonado",
  "Tania Valentina Rodríguez Ruiz", "Luis Eduardo Pedrero González", "Eleonor Martínez Gómez",
  "Ruth Cleotilde Rodríguez López", "Rafa Reyes", "Andy Gordillo", "Chino Livera" , "Presidente de la Mesa Directiva del Congreso de Morelos" 
]; 


const LISTAS_X_PRO = [
  'https://pro.x.com/i/decks/1938329800252232136',
  'https://pro.x.com/i/decks/897971039212261377'
];

const USER_DATA_DIR = './sesion-x';
const CARPETA_MEDIA = 'A:/00_AUTOMATIZACIONES/CONGRESO MORELOS/01_Monitoreo) Medios Morelos X/media/2025';
const RUTA_LOG = path.join(CARPETA_MEDIA, 'log_descargas.txt');
const bot = new TelegramBot(TELEGRAM_TOKEN);
const historialTweets = new Set();

function limpiarTexto(texto) {
  return texto.replace(/\s+/g, ' ').trim();
}

function registrarLog(mensaje) {
  const linea = `[${new Date().toISOString()}] ${mensaje}\n`;
  fs.appendFileSync(RUTA_LOG, linea);
}

function limpiarMediaSiEsLunes() {
  const hoy = new Date();
  const dia = hoy.getDay();
  if (dia === 1) { // Lunes
    if (fs.existsSync(CARPETA_MEDIA)) {
      fs.readdirSync(CARPETA_MEDIA).forEach(file => {
        const ruta = path.join(CARPETA_MEDIA, file);
        if (fs.lstatSync(ruta).isFile() && (file.endsWith('.jpg') || file.endsWith('.png') || file.endsWith('.mp4'))) {
          fs.unlinkSync(ruta);
        }
      });
      registrarLog('🧹 Limpieza semanal de archivos media realizada.');
    }
  }
}

async function descargarImagen(url, carpeta = CARPETA_MEDIA) {
  if (!fs.existsSync(carpeta)) fs.mkdirSync(carpeta, { recursive: true });
  return new Promise((resolve, reject) => {
    const nombre = path.basename(url).split('?')[0];
    const destino = path.join(carpeta, nombre);
    const archivo = fs.createWriteStream(destino);
    https.get(url, respuesta => {
      respuesta.pipe(archivo);
      archivo.on('finish', () => {
        archivo.close(() => {
          registrarLog(`📷 Imagen descargada: ${nombre}`);
          resolve(destino);
        });
      });
    }).on('error', reject);
  });
}

async function descargarVideo(linkTweet, carpeta = CARPETA_MEDIA) {
  if (!fs.existsSync(carpeta)) fs.mkdirSync(carpeta, { recursive: true });
  return new Promise((resolve, reject) => {
    const comando = `yt-dlp -P "${carpeta}" -f mp4 https://x.com${linkTweet}`;
    exec(comando, (error, stdout, stderr) => {
      if (error) return reject(error);
      const matches = stdout.match(/\[downloaded\] (.+\.mp4)/);
      if (matches && matches[1]) {
        registrarLog(`🎥 Video descargado: ${matches[1]}`);
        resolve(path.join(carpeta, matches[1]));
      } else resolve(null);
    });
  });
}

async function enviarATelegram(texto, imagen = null, video = null) {
  try {
    if (video) {
      await bot.sendVideo(TELEGRAM_CHAT_ID, video, { caption: texto });
      registrarLog(`📤 Video enviado a Telegram.`);
    } else if (imagen) {
      await bot.sendPhoto(TELEGRAM_CHAT_ID, imagen, { caption: texto });
      registrarLog(`📤 Imagen enviada a Telegram.`);
      fs.unlinkSync(imagen);
    } else {
      await bot.sendMessage(TELEGRAM_CHAT_ID, texto);
      registrarLog(`📤 Texto enviado a Telegram.`);
    }
  } catch (e) {
    registrarLog(`❌ Error enviando a Telegram: ${e.message}`);
  }
}

async function monitorearColumnasX() {
  limpiarMediaSiEsLunes();
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, { headless: false });
  const page = await context.newPage();

  for (const url of LISTAS_X_PRO) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(10000);

    if (page.url().includes('login')) {
      await bot.sendMessage(TELEGRAM_CHAT_ID, '❌ No estás logueado en X Pro. Inicia sesión manualmente.');
      await page.waitForURL('https://x.com/', { timeout: 0 });
    }

    const articulos = await page.$$('article');
    for (const tweet of articulos) {
      const texto = limpiarTexto(await tweet.innerText());
      const enlace = await tweet.$('a[href*="/status/"]');
      if (!enlace) continue;
      const href = await enlace.getAttribute('href');
      if (historialTweets.has(href)) continue;
      historialTweets.add(href);

      if (PALABRAS_CLAVE.some(p => texto.includes(p))) {
        const menciones = PALABRAS_CLAVE.filter(p => texto.includes(p));
        const resumen = `📝 *Mención encontrada:*
${menciones.join(', ')}
🔗 https://x.com${href}`;

        const img = await tweet.$('img');
        const video = await tweet.$('video');

        try {
          if (video) {
            const rutaVideo = await descargarVideo(href);
            if (rutaVideo) await enviarATelegram(resumen, null, rutaVideo);
            else await enviarATelegram(resumen + '\n⚠️ Video no descargado');
          } else if (img) {
            const src = await img.getAttribute('src');
            if (src && !src.includes('profile_images')) {
              const rutaImg = await descargarImagen(src);
              await enviarATelegram(resumen, rutaImg);
            } else {
              await enviarATelegram(resumen);
            }
          } else {
            await enviarATelegram(resumen);
          }
        } catch (e) {
          registrarLog(`❌ Error procesando tweet: ${e.message}`);
        }
      }
    }
  }

  await context.close();
}

monitorearColumnasX();
