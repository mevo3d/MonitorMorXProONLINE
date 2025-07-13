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

const PALABRAS_CLAVE = [
  'Daniel Martínez Terrazas', 'Andrea Valentina Gordillo', 'Sergio Omar Livera Chavarría',
  'Guillermina Maya Rendón', 'Jazmín Juana Solano López', 'Rafael Reyes Reyes',
  'Nayla Carolina Ruiz Rodríguez', 'Luz María Mendoza Domínguez', 'Alfredo Domínguez Mandujano',
  'Francisco Erik Sánchez Zavala', 'Alfonso de Jesús Sotelo Martínez', 'Melissa Montes de Oca Montoya',
  'Isaac Pimentel Mejía', 'Brenda Espinoza López', 'Gerardo Abarca Peña',
  'Luz Dary Quevedo Maldonado', 'Tania Valentina Rodríguez Ruiz', 'Luis Eduardo Pedrero González',
  'Eleonor Martínez Gómez', 'Ruth Cleotilde Rodríguez López',
  'Congreso Morelos', 'diputado', 'diputada', 'LVI Legislatura', '@CongresoMorelos',
  'Rafa Reyes', 'Andy Gordillo', 'Chino Livera', 'Isaac Pimentel',
  'Congreso del Estado', 'Mesa Directiva', 'Diputación Permanente', 'Iniciativa de Ley',
  'Reforma legislativa', 'Comisión legislativa', 'Reglamento del Congreso', 'Proceso legislativo',
  'Sesión ordinaria', 'Período legislativo', 'Transparencia legislativa', 'Debate parlamentario',
  'Comisión de Reglamentos', 'Comisión de Participación Ciudadana', 'Reforma política',
  'Plurinominal Morena', 'Presidente de Comisión', 'Exalcalde de Ayala', 'Transformación de Morelos',
  'Participación democrática', 'MORENA Morelos', 'Unidad y progreso social', 'Legislador progresista',
  'Congresista joven', 'Normas de debate', 'Mejores prácticas parlamentarias', 'Diálogo legislativo',
  'Investigación parlamentaria', 'Asamblea Ciudadana', 'Revocación de mandato',
  'Presupuesto participativo', 'Reforma a la Ley de Participación Ciudadana', 'Democracia directa',
  'Pueblos indígenas y participación', 'Parlamento abierto', 'Consulta ciudadana',
  'Gobernanza democrática', 'Plan de Ayala', 'Emiliano Zapata', 'Aniversario de Morelos',
  'Natalicio de José María Morelos', '12 de enero', '15 de diciembre', 'Ayala', 'Cuautla',
  'Morelos', 'Tierra y Libertad', 'Historia morelense', 'Movimiento zapatista',
  'Comunidad indígena', 'Cultura cívica', 'Daniel Martínez', 'Martínez Terrazas', 'Diputado Daniel',
  'Diputado Martínez', 'Daniel PAN', 'Andrea Gordillo', 'Valentina Gordillo', 'Gordillo Vega',
  'Diputada Andrea', 'Andrea PAN', 'Sergio Livera', 'Omar Livera', 'Livera Chavarría',
  'Diputado Sergio', 'Sergio Morena', 'Guillermina Maya', 'Maya Rendón', 'Diputada Guillermina',
  'Guillermina Morena', 'Jazmín Solano', 'Juana Solano', 'Solano López', 'Diputada Jazmín',
  'Jazmín Morena', 'Rafael Reyes', 'Reyes Reyes', 'Diputado Rafael', 'Reyes Morena',
  'Nayla Ruiz', 'Carolina Ruiz', 'Ruiz Rodríguez', 'Diputada Nayla', 'Nayla Morena',
  'Luz María Mendoza', 'Mendoza Domínguez', 'Diputada Luz María', 'Luz María PAN',
  'Alfredo Domínguez', 'Domínguez Mandujano', 'Diputado Alfredo', 'Alfredo Morena',
  'Francisco Sánchez', 'Erik Sánchez', 'Sánchez Zavala', 'Diputado Francisco', 'Francisco PAN',
  'Alfonso Sotelo', 'Sotelo Martínez', 'Diputado Alfonso', 'Alfonso Morena',
  'Melissa Montes de Oca', 'Montes de Oca', 'Diputada Melissa', 'Melissa Morena',
  'Brenda Espinoza', 'Espinoza López', 'Diputada Brenda', 'Brenda Morena',
  'Gerardo Abarca', 'Abarca Peña', 'Diputado Gerardo', 'Gerardo PAN',
  'Luz Dary Quevedo', 'Quevedo Maldonado', 'Diputada Luz Dary', 'Luz Dary MC',
  'Tania Rodríguez', 'Valentina Rodríguez', 'Rodríguez Ruiz', 'Diputada Tania', 'Tania PT',
  'Luis Pedrero', 'Eduardo Pedrero', 'Pedrero González', 'Diputado Luis Eduardo', 'Luis PVEM',
  'Eleonor Martínez', 'Martínez Gómez', 'Diputada Eleonor', 'Eleonor PRI',
  'Ruth Rodríguez', 'Cleotilde Rodríguez', 'Rodríguez López', 'Diputada Ruth', 'Ruth Nueva Alianza'
];

const LISTA_URL = 'https://pro.x.com/i/decks/1853883906551898346';
const USER_DATA_DIR = './sesion-x';
const bot = new TelegramBot(TELEGRAM_TOKEN);
const resumenDiario = { total: 0, enviados: 0, menciones: {} };
const historialTweets = new Set();

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

        const contieneClave = PALABRAS_CLAVE.some(p => innerText.includes(p));
        if (!contieneClave) continue;

        resumenDiario.total++;
        resumenDiario.enviados++;

        let mensaje = `${innerText.substring(0, 400)}...\nhttps://x.com${url}`;

        PALABRAS_CLAVE.forEach(palabra => {
          if (innerText.includes(palabra)) {
            resumenDiario.menciones[palabra] = (resumenDiario.menciones[palabra] || 0) + 1;
          }
        });

        const media = await tweetElement.$('img');
        const video = await tweetElement.$('video');

        if (media) {
          const src = await media.getAttribute('src');
          if (src && !src.includes('profile_images')) {
            const pathImagen = await descargarImagen(src);
            await bot.sendPhoto(TELEGRAM_CHAT_ID, pathImagen, { caption: mensaje });
            fs.unlinkSync(pathImagen);
            tweetsEncontrados++;
            continue;
          }
        }

        if (video) {
          mensaje += '\n[🎥 Video no descargable automáticamente]';
        }

        await bot.sendMessage(TELEGRAM_CHAT_ID, mensaje);
        tweetsEncontrados++;
        console.log(`✅ Enviado: ${innerText.substring(0, 80)}...`);
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

monitorearListaX();
