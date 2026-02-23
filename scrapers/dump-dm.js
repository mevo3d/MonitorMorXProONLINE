import { chromium } from 'playwright';

const url = 'https://publicaciones.diariodemorelos.com/diario-de-morelos/20260223';

async function dump() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    let articleIds = new Set();
    let authToken = '';

    page.on('request', (request) => {
        if (request.url().includes('ingress.pressreader.com/services/')) {
            const headers = request.headers();
            if (headers['authorization']) authToken = headers['authorization'];
        }
    });

    page.on('response', async (response) => {
        if (response.url().includes('/services/v1/articles/')) {
            try {
                const json = await response.json();
                if (json.id) articleIds.add(json.id);
            } catch (e) { }
        }
    });

    await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 });
    await page.waitForTimeout(10000);

    const ids = Array.from(articleIds);
    if (ids.length > 0) {
        const fetchUrl = `https://ingress.pressreader.com/services/v1/articles/${ids[0]}/?articleFields=768&isHyphenated=true&fullBody=true`;
        console.log('Fetching', fetchUrl, 'with token', authToken ? 'YES' : 'NO');

        const fullJson = await page.evaluate(async ({ url, token }) => {
            const res = await window.fetch(url, {
                headers: token ? { 'Authorization': token } : {}
            });
            return await res.json();
        }, { url: fetchUrl, token: authToken });

        console.log('--- FULL JSON DUMP ---');
        console.log(JSON.stringify(fullJson, null, 2).substring(0, 1500));
        console.log('----------------------');
    }
    await browser.close();
}
dump();
