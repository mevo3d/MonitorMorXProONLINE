import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dayjs from 'dayjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

chromium.use(stealthPlugin());

const FACEBOOK_PAGES_FILE = path.join(__dirname, 'facebook-pages.json');

// --- Helpers ---
const delay = (ms) => new Promise(res => setTimeout(res, ms));

const loadFacebookConfig = () => {
    if (!fs.existsSync(FACEBOOK_PAGES_FILE)) return { pages: [], cookies: [] };
    try {
        return JSON.parse(fs.readFileSync(FACEBOOK_PAGES_FILE, 'utf8'));
    } catch (e) {
        console.error('Error leyendo config FB:', e.message);
        return { pages: [], cookies: [] };
    }
};

const formatCookieString = (cookieStr) => {
    try {
        const parsed = JSON.parse(cookieStr);
        // Transformar formato de "Export Cookie JSON" a formato Playwright
        return parsed.map(c => ({
            name: c.name,
            value: c.value,
            domain: c.domain.startsWith('.') ? c.domain : `.${c.domain}`,
            path: c.path,
            httpOnly: c.httpOnly || false,
            secure: c.secure || true,
            sameSite: c.sameSite || 'Lax'
        }));
    } catch (e) {
        console.error('Error parseando cookies JSON:', e.message);
        return [];
    }
};

export async function scrapeFacebookPages(onNewPost) {
    const config = loadFacebookConfig();
    if (!config.pages.length || !config.cookies.length) {
        console.log('⚠️ No hay páginas o cookies configuradas para Facebook.');
        return [];
    }

    // Rotar cuentas
    const cookieString = config.cookies[Math.floor(Math.random() * config.cookies.length)];
    const validCookies = formatCookieString(cookieString);

    if (!validCookies.length) {
        console.log('⚠️ Cookies inválidas.');
        return [];
    }

    console.log(`🌍 Iniciando Scraper Facebook (${config.pages.length} páginas)...`);

    let browser;
    const todosLosPosts = [];

    try {
        browser = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-notifications'
            ]
        });

        const context = await browser.newContext({
            viewport: { width: 1280, height: 720 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        });

        await context.addCookies(validCookies);

        const page = await context.newPage();

        for (const fbPage of config.pages) {
            console.log(`\n🔍 Explorando: ${fbPage.name} -> ${fbPage.url}`);
            try {
                await page.goto(fbPage.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
                await delay(3000); // Wait for initial render

                // Verificar si pide login forzado
                const isLoginModal = await page.locator('form[action="/login/"]').count();
                if (isLoginModal > 0) {
                    console.log('❌ Bloqueado por Modal de Login Cautivo de FB. Cookie puede estar caducada.');
                    // Se podría cerrar el modal si es posible, pero usualmente te saca.
                    continue;
                }

                // Scroll para cargar posts
                for (let i = 0; i < 3; i++) {
                    await page.evaluate(() => window.scrollBy(0, 800));
                    await delay(1500);
                }

                const posts = await page.evaluate((pageName) => {
                    const extracted = [];
                    // Selectors de Facebook cambian constantemente, usamos aproximaciones visuales
                    // 'div[data-ad-preview="message"]' suele ser el texto del post 
                    const postElements = Array.from(document.querySelectorAll('div[data-ad-preview="message"]')).map(el => el.closest('div[role="article"]')).filter(Boolean);

                    for (const el of postElements) {
                        try {
                            const textEl = el.querySelector('div[data-ad-preview="message"]');
                            const text = textEl ? textEl.innerText : '';

                            // Obtener enlaces, buscar ID del post
                            const linkEls = Array.from(el.querySelectorAll('a[role="link"]'));
                            let postUrl = '';
                            for (const link of linkEls) {
                                if (link.href && (link.href.includes('/posts/') || link.href.includes('fbid='))) {
                                    postUrl = link.href.split('?')[0]; // Limpiar querystrings si es posts
                                    break;
                                }
                            }

                            // Media (Imagenes o Videos)
                            const imgEl = el.querySelector('img[referrerpolicy="origin-when-cross-origin"]'); // Aproximación
                            const videoEl = el.querySelector('video');

                            const isVideo = !!videoEl;
                            const mediaUrls = [];
                            if (imgEl && imgEl.src) mediaUrls.push(imgEl.src);

                            if (text && postUrl) {
                                // Generar ID único basado en URL
                                const idMatch = postUrl.match(/posts\/(\d+)/) || postUrl.match(/fbid=(\d+)/);
                                const id = idMatch ? `fb_${idMatch[1]}` : `fb_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

                                extracted.push({
                                    id,
                                    handle: pageName,
                                    name: pageName,
                                    text: text,
                                    url: postUrl,
                                    timestamp: new Date().toISOString(), // FB timestamp is hard to parse accurately without hover
                                    media: mediaUrls,
                                    isVideo: isVideo,
                                    source: 'facebook'
                                });
                            }
                        } catch (e) { }
                    }
                    return extracted;
                }, fbPage.name);

                console.log(`📊 Encontrados ${posts.length} posts en ${fbPage.name}`);

                // Procesar cada post
                for (const post of posts) {
                    todosLosPosts.push(post);
                    if (onNewPost) {
                        await onNewPost(post);
                    }
                }

            } catch (err) {
                console.error(`❌ Error scrapeando ${fbPage.name}:`, err.message);
            }
        }

    } catch (err) {
        console.error('❌ Error Crítico en Scraper de Facebook:', err.message);
    } finally {
        if (browser) await browser.close();
        console.log('✅ Browser de Facebook cerrado.');
    }

    return todosLosPosts;
}
