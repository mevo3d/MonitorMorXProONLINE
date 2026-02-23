import { chromium } from 'playwright';
import fs from 'fs';

const url = 'https://publicaciones.diariodemorelos.com/diario-de-morelos/20260223';

(async () => {
    console.log('Launching browser...');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    let articles = [];

    page.on('response', async (response) => {
        const reqUrl = response.url();
        if (reqUrl.includes('/services/v1/articles/') && reqUrl.includes('fullBody=true')) {
            try {
                const json = await response.json();
                articles.push({
                    title: json.title,
                    text: json.text,
                    id: json.id
                });
                console.log('Saved article:', json.title?.substring(0, 30) + '...');
            } catch (e) {
                // Ignore parsing errors
            }
        }
    });

    console.log('Navigating to', url);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });

    // Simulate user reading to trigger page loads
    console.log('Waiting for articles to load...');
    await page.waitForTimeout(10000);

    fs.writeFileSync('dm_articles.json', JSON.stringify(articles, null, 2));
    console.log(`Saved ${articles.length} articles to dm_articles.json`);

    await browser.close();
})();
