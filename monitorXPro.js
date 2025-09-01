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
      return null;
    }
  }



  console.log('🤖 Monitoreo activo. Presiona ENTER para detener...');

  
  let lastScrollPosition = 0;
  let scrollStuckCount = 0;
  let tweetsProcessed = 0;

  const intervalId = setInterval(async () => {
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
    }
  }, 30 * 1000); // Ejecutar cada 30 segundos en lugar de cada minuto
 // cada minuto

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
