import { chromium } from 'playwright';
import dotenv from 'dotenv';

dotenv.config();

const USER = process.env.TWITTER_USER;
const PASS = process.env.TWITTER_PASS;

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log("🌐 Abriendo X Pro...");
  await page.goto('https://pro.x.com/', { waitUntil: 'load' });

  // Esperamos si redirige a login
  if (page.url().includes('login')) {
    console.log("🔒 No estás logueado. Iniciando sesión...");

    await page.fill('input[name="text"]', USER);
    await page.click('div[role="button"]:has-text("Next")');

    await page.waitForTimeout(2000); // tiempo para que cargue siguiente campo
    await page.fill('input[name="password"]', PASS);
    await page.click('div[role="button"]:has-text("Log in")');

    await page.waitForNavigation({ waitUntil: 'networkidle' });

    console.log("✅ Login exitoso");
  } else {
    console.log("✅ Ya estás logueado en X Pro");
  }

  await browser.close();
})();
