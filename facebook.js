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
        const validSameSite = ['Strict', 'Lax', 'None'];
        return parsed
            .filter(c => c.name && c.value && c.domain) // Must have required fields
            .map(c => {
                // Normalize sameSite — browser exports use values like "no_restriction", "unspecified", "0", etc.
                let sameSite = 'Lax';
                if (c.sameSite) {
                    const ss = String(c.sameSite).toLowerCase();
                    if (ss === 'strict') sameSite = 'Strict';
                    else if (ss === 'none' || ss === 'no_restriction') sameSite = 'None';
                    else sameSite = 'Lax'; // "unspecified", "lax", numbers, etc.
                }
                return {
                    name: c.name,
                    value: c.value,
                    domain: c.domain.startsWith('.') ? c.domain : `.${c.domain}`,
                    path: c.path || '/',
                    httpOnly: !!c.httpOnly,
                    secure: sameSite === 'None' ? true : !!c.secure, // SameSite=None requires Secure=true
                    sameSite
                };
            });
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
                await delay(4000); // Wait for initial render

                // Check current URL - Facebook might redirect to login
                const currentUrl = page.url();
                if (currentUrl.includes('/login') || currentUrl.includes('checkpoint')) {
                    console.log('❌ Redirigido a login/checkpoint. Cookie caducada.');
                    continue;
                }

                // Verificar si pide login forzado (modal overlay)
                const loginIndicators = await page.evaluate(() => {
                    const loginForm = document.querySelector('form[action*="/login"]');
                    const loginBtn = document.querySelector('[data-testid="royal_login_button"]');
                    const loginDiv = document.querySelector('#login_popup_cta_form');
                    return !!(loginForm || loginBtn || loginDiv);
                });
                if (loginIndicators) {
                    console.log('❌ Modal de Login detectado. Cookie puede estar caducada.');
                    // Try to close a potential overlay
                    try {
                        await page.click('[aria-label="Close"], [aria-label="Cerrar"]', { timeout: 2000 });
                        await delay(1000);
                    } catch (e) { /* no close button */ }
                }

                // Scroll para cargar posts (more aggressive)
                for (let i = 0; i < 5; i++) {
                    await page.evaluate(() => window.scrollBy(0, 1000));
                    await delay(2000);
                }

                // Log what we can see for debugging
                const debugInfo = await page.evaluate(() => {
                    const articles = document.querySelectorAll('div[role="article"]');
                    const feeds = document.querySelectorAll('div[role="feed"]');
                    const allDivs = document.querySelectorAll('div[data-ad-preview="message"]');
                    return {
                        articles: articles.length,
                        feeds: feeds.length,
                        adPreview: allDivs.length,
                        title: document.title,
                        bodyText: document.body?.innerText?.substring(0, 200) || ''
                    };
                });
                console.log(`   📋 DOM: ${debugInfo.articles} articles, ${debugInfo.feeds} feeds, ${debugInfo.adPreview} ad-preview | title: "${debugInfo.title}"`);

                const posts = await page.evaluate((pageName) => {
                    const extracted = [];
                    const seenTexts = new Set();

                    // Strategy 1: role="article" elements (most reliable)
                    let postElements = Array.from(document.querySelectorAll('div[role="article"]'));

                    // Strategy 2: If no articles, try data-ad-preview
                    if (postElements.length === 0) {
                        postElements = Array.from(document.querySelectorAll('div[data-ad-preview="message"]'))
                            .map(el => el.closest('div[role="article"]') || el.parentElement?.parentElement?.parentElement)
                            .filter(Boolean);
                    }

                    for (const el of postElements) {
                        try {
                            // Extract text from multiple possible selectors
                            let text = '';
                            const textSelectors = [
                                'div[data-ad-preview="message"]',
                                'div[dir="auto"]',
                                'div[data-ad-comet-preview="message"]'
                            ];
                            for (const sel of textSelectors) {
                                const textEl = el.querySelector(sel);
                                if (textEl && textEl.innerText.trim().length > 10) {
                                    text = textEl.innerText.trim();
                                    break;
                                }
                            }

                            // Fallback: get all text within the article but limit it
                            if (!text) {
                                const allText = el.innerText || '';
                                // Take only first meaningful paragraph (skip UI elements)
                                const lines = allText.split('\n').filter(l => l.trim().length > 15);
                                if (lines.length > 0) {
                                    text = lines.slice(0, 5).join('\n');
                                }
                            }

                            if (!text || text.length < 10) continue;

                            // Dedup
                            const textKey = text.substring(0, 80);
                            if (seenTexts.has(textKey)) continue;
                            seenTexts.add(textKey);

                            // Find post URL
                            let postUrl = '';
                            const allLinks = Array.from(el.querySelectorAll('a[href]'));
                            for (const link of allLinks) {
                                const href = link.href || '';
                                if (href.includes('/posts/') || href.includes('fbid=') || href.includes('/permalink/') || href.includes('/photos/') || href.includes('/videos/')) {
                                    postUrl = href.split('?')[0];
                                    break;
                                }
                            }
                            // Fallback: any link with a timestamp pattern
                            if (!postUrl) {
                                for (const link of allLinks) {
                                    const href = link.href || '';
                                    if (href.includes('facebook.com') && href.includes('/') && !href.includes('/login') && !href.includes('/hashtag')) {
                                        const ariaLabel = link.getAttribute('aria-label') || '';
                                        if (ariaLabel.match(/\d+\s*(hora|min|día|hour|day|ago)/i) || link.querySelector('abbr')) {
                                            postUrl = href.split('?')[0];
                                            break;
                                        }
                                    }
                                }
                            }

                            if (!postUrl) postUrl = `${window.location.href}#post-${Date.now()}`;

                            // Media
                            const imgEl = el.querySelector('img[referrerpolicy="origin-when-cross-origin"]') ||
                                el.querySelector('img[src*="fbcdn"]');
                            const videoEl = el.querySelector('video');
                            const mediaUrls = [];
                            if (imgEl && imgEl.src && !imgEl.src.includes('emoji')) mediaUrls.push(imgEl.src);

                            // Generate stable ID
                            const idMatch = postUrl.match(/posts\/(\d+)/) || postUrl.match(/fbid=(\d+)/) || postUrl.match(/permalink\/(\d+)/);
                            const id = idMatch ? `fb_${idMatch[1]}` : `fb_${textKey.replace(/\W/g, '').substring(0, 20)}_${Date.now()}`;

                            extracted.push({
                                id,
                                handle: pageName,
                                name: pageName,
                                text: text.substring(0, 2000),
                                url: postUrl,
                                timestamp: new Date().toISOString(),
                                media: mediaUrls,
                                isVideo: !!videoEl,
                                source: 'facebook'
                            });
                        } catch (e) { /* skip individual post errors */ }
                    }
                    return extracted;
                }, fbPage.name);

                console.log(`📊 Encontrados ${posts.length} posts en ${fbPage.name}`);

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
