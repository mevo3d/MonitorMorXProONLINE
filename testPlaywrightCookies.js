// Test Playwright con Cookies Inyectadas (Bypass Login)
import { chromium } from 'playwright';
import dotenv from 'dotenv';
dotenv.config();

const RETTIWT_API_KEY = process.env.RETTIWT_API_KEY;

async function testBrowser() {
    console.log('🚀 Iniciando prueba de Playwright con Cookies...');

    if (!RETTIWT_API_KEY) {
        console.error('❌ No RETTIWT_API_KEY found in .env');
        return;
    }

    // Decodificar cookies del API KEY
    const cookieString = Buffer.from(RETTIWT_API_KEY, 'base64').toString('ascii');
    const cookies = [];

    // Rellenar array de cookies para Playwright
    ['auth_token', 'ct0', 'twid'].forEach(name => {
        const match = cookieString.match(new RegExp(`${name}=([^;]+)`));
        if (match) {
            cookies.push({
                name,
                value: match[1],
                domain: '.x.com',
                path: '/',
                httpOnly: name === 'auth_token' || name === 'twid',
                secure: true,
                sameSite: 'None'
            });
        }
    });

    console.log(`🍪 Cookies extraídas: ${cookies.length}`);

    const browser = await chromium.launch({
        headless: true, // Headless true para servidor
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });

        // Inyectar cookies
        await context.addCookies(cookies);
        console.log('✅ Cookies inyectadas al navegador');

        const page = await context.newPage();

        console.log('🌍 Navegando a https://x.com ...');
        await page.goto('https://x.com', { waitUntil: 'domcontentloaded', timeout: 30000 });

        await page.waitForTimeout(5000);
        const title = await page.title();
        console.log(`📄 Título de página: ${title}`);

        // Verificar login
        const isLoggedIn = await page.getByTestId('SideNav_AccountSwitcher_Button').count() > 0 ||
            await page.getByTestId('AppTabBar_Home_Link').count() > 0;

        console.log(`🔐 ¿Login detectado?: ${isLoggedIn ? 'SÍ' : 'NO'}`);

        // Intentar búsqueda
        console.log('🔍 Probando búsqueda...');
        await page.goto('https://x.com/search?q=Morelos&f=live', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(5000);

        // Contar tweets (artículos)
        const tweets = await page.locator('article[data-testid="tweet"]').count();
        console.log(`📊 Tweets encontrados en DOM: ${tweets}`);

        if (tweets > 0) {
            const firstTweet = await page.locator('article[data-testid="tweet"]').first().innerText();
            console.log(`📝 Primer tweet: ${firstTweet.substring(0, 100).replace(/\n/g, ' ')}...`);
        }

        await page.screenshot({ path: 'test_browser_result.png' });
        console.log('📸 Screenshot guardado en test_browser_result.png');

    } catch (e) {
        console.error('❌ Error en navegador:', e.message);
    } finally {
        await browser.close();
    }
}

testBrowser();
