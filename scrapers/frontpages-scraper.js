import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, '../public/portadas');
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });

const YYYYMMDD = new Date().toISOString().split('T')[0].replace(/-/g, ''); // e.g., 20260223
const TODAY_FORMATTED = new Date().toISOString().split('T')[0];

async function fetchPortadas() {
    console.log(`=== INICIANDO DESCARGA PORTADAS (${TODAY_FORMATTED}) ===`);
    const browser = await chromium.launch({ headless: true });

    // 1. Diario de Morelos
    console.log('[Diario de Morelos] Buscando portada...');
    const context = await browser.newContext();
    const page = await context.newPage();
    const dmUrl = `https://publicaciones.diariodemorelos.com/diario-de-morelos/${YYYYMMDD}`;

    let portadaGrabbed = false;

    page.on('response', async (response) => {
        const reqUrl = response.url();
        if (reqUrl.includes('t.prcdn.co/img?file=') && reqUrl.includes('page=1') && !reqUrl.includes('thumbnail')) {
            try {
                const buffer = await response.body();
                const dest = path.join(PUBLIC_DIR, `${TODAY_FORMATTED}-diariodemorelos.jpg`);
                fs.writeFileSync(dest, buffer);
                console.log(`[Diario de Morelos] Portada descargada exitosamente en: ${dest}`);
                portadaGrabbed = true;
            } catch (e) {
                console.error('[Diario de Morelos] Error capturando buffer de imagen:', e.message);
            }
        }
    });

    try {
        await page.goto(dmUrl, { waitUntil: 'networkidle', timeout: 90000 });
        await page.waitForTimeout(5000); // Wait for images to load
    } catch (e) {
        console.error('[Diario de Morelos] Error navegando:', e.message);
    }

    if (!portadaGrabbed) {
        // Fallback: take a screenshot of the viewer
        try {
            console.log('[Diario de Morelos] Fallback: Tomando screenshot del visor');
            const dest = path.join(PUBLIC_DIR, `${TODAY_FORMATTED}-diariodemorelos-fallback.png`);
            await page.screenshot({ path: dest, clip: { x: 50, y: 50, width: 800, height: 1100 } });
            console.log(`[Diario de Morelos] Screenshot guardado en: ${dest}`);
        } catch (e) { /* ignore */ }
    }

    await context.close();

    // Add other newspapers conditionally or via screenshotting their homepages
    // ...

    await browser.close();
    console.log('=== DESCARGA PORTADAS COMPLETADA ===');
}

if (process.argv[1] === __filename) {
    fetchPortadas();
}

export { fetchPortadas };
