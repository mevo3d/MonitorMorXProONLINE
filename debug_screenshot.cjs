const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  console.log('Iniciando debug...');
  const browser = await chromium.launch({ headless: false }); // Headless false para usar Xvfb
  const context = await browser.newContext({ storageState: 'storage/xpro-session.json' });
  const page = await context.newPage();
  try {
    console.log('Navegando a X Pro...');
    await page.goto('https://pro.x.com', { timeout: 60000 });
    console.log('Esperando carga (10s)...');
    await page.waitForTimeout(10000);
    await page.screenshot({ path: 'debug_screenshot.png', fullPage: true });
    console.log('✅ Screenshot EXITOSO: debug_screenshot.png');
  } catch (e) {
    console.error('❌ Error:', e);
    await page.screenshot({ path: 'error_screenshot.png' });
    console.log('⚠️ Screenshot ERROR: error_screenshot.png');
  }
  await browser.close();
})();
