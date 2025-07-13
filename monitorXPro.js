// index.js
import dotenv from 'dotenv';
dotenv.config();

import { chromium } from 'playwright';
import readline from 'readline';
import TelegramBot from 'node-telegram-bot-api';

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TWITTER_LIST_URL = 'https://x.com/i/lists/1938329800252232136'; // Lista #MediosMorelos
const PALABRAS_CLAVE = [
  'Isaac Pimentel', 'Congreso Morelos', 'diputado', 'LVI Legislatura',
  'Andrea Gordillo', 'Jazmín Solano', 'Sergio Livera', 'Guillermina Maya',
  'Eleonor Martínez', 'Luis Pedrero', 'Tania Valentina', 'Ruth Rodríguez'
];

const bot = new TelegramBot(TELEGRAM_TOKEN);

async function monitorearXPro() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('🌐 Iniciando navegador...');
  await page.goto('https://pro.x.com');
  await page.waitForTimeout(10000); // Esperar para que cargue sesión

  if (page.url().includes('login')) {
    await bot.sendMessage(TELEGRAM_CHAT_ID, '❌ No estás logueado en X Pro. Por favor haz login manualmente.');
    console.log('❌ No logueado. Esperando login manual.');
    await page.waitForURL('https://pro.x.com/', { timeout: 0 });
  } else {
    console.log('✅ Ya estás logueado.');
  }

  await page.goto(TWITTER_LIST_URL);
  console.log('📄 Entrando a la lista de medios...');
  await page.waitForTimeout(10000);

  const tweetsYaEnviados = new Set();

  console.log('🤖 Monitoreo activo. Presiona ENTER para detener...');

  const intervalId = setInterval(async () => {
    const tweets = await page.$$eval('article', articles =>
      articles.map(article => article.innerText)
    );

    for (const tweet of tweets) {
      if (PALABRAS_CLAVE.some(palabra => tweet.includes(palabra))) {
        if (!tweetsYaEnviados.has(tweet)) {
          tweetsYaEnviados.add(tweet);
          await bot.sendMessage(TELEGRAM_CHAT_ID, `📢 Mención encontrada:\n\n${tweet.substring(0, 400)}...`);
          console.log(`✅ Enviado: ${tweet.substring(0, 80)}...`);
        }
      }
    }
  }, 60 * 1000); // cada minuto

  // Crear interfaz para detener
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('', async () => {
    clearInterval(intervalId);
    await bot.sendMessage(TELEGRAM_CHAT_ID, '🛑 Monitoreo detenido manualmente.');
    console.log('🛑 Monitoreo detenido manualmente. Cerrando navegador...');
    await browser.close();
    rl.close();
  });
}

monitorearXPro();
