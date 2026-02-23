import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Constants
const TEMP_DIR = path.join(__dirname, '../temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);

const YYYYMMDD = new Date().toISOString().split('T')[0].replace(/-/g, ''); // e.g., 20260223
const TODAY_FORMATTED = new Date().toISOString().split('T')[0];

const KEYWORDS = [
    'Congreso', 'Diputado', 'Diputada', 'Margarita González Saravia',
    'Seguridad', 'Uriel Carmona', 'Cuernavaca', 'Urióstegui',
    'Morelos', 'Gobernadora', 'Legislatura', 'Magistrado', 'Poder Judicial'
];

function containsKeyword(text) {
    if (!text) return false;
    const lower = text.toLowerCase();
    // Use regex to find standalone words to avoid false positives if needed, but simple includes is fine for now
    return KEYWORDS.some(kw => lower.includes(kw.toLowerCase()));
}

async function scrapeDiarioDeMorelos() {
    console.log('[Diario de Morelos] Iniciando...');
    const url = 'https://www.diariodemorelos.com/';
    let articles = [];
    try {
        const response = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $ = cheerio.load(response.data);

        let links = [];
        $('a').each((i, el) => {
            let href = $(el).attr('href');
            if (href && href.includes('/noticias/') && !links.includes(href)) {
                if (href.startsWith('/')) href = `https://www.diariodemorelos.com${href}`;
                links.push(href);
            }
        });

        links = [...new Set(links)];
        console.log(`[Diario de Morelos] Encontrados ${links.length} enlaces potenciales.`);

        for (let link of links.slice(0, 15)) {
            try {
                const articleRes = await axios.get(link, { headers: { 'User-Agent': 'Mozilla/5.0' } });
                const $a = cheerio.load(articleRes.data);
                const title = $a('h1').first().text().trim().substring(0, 100);
                const content = $a('p, .field-items').text().replace(/\s+/g, ' ').trim();

                if (title && content && containsKeyword(title + ' ' + content)) {
                    articles.push({
                        title: title,
                        summary: content.substring(0, 300) + '...',
                        content: content,
                        url: link,
                        source: 'DIARIO DE MORELOS'
                    });
                    console.log(`[Diario de Morelos] Extracted: ${title.substring(0, 50)}`);
                }
            } catch (e) {
                // Skip dead links
            }
        }
    } catch (e) {
        console.error('[Diario de Morelos] Error conectando:', e.message);
    }
    return articles;
}

// ---------------------------------------------------------
// Scraper: La Unión de Morelos
// ---------------------------------------------------------
async function scrapeLaUnion() {
    console.log('[La Unión de Morelos] Iniciando...');
    const url = 'https://launion.com.mx/';
    let articles = [];
    try {
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);

        let links = [];
        $('a').each((i, el) => {
            let href = $(el).attr('href');
            if (href && href.startsWith('/') && href.includes('/morelos/')) {
                links.push(`https://launion.com.mx${href}`);
            }
        });

        links = [...new Set(links)]; // Deduplicate
        console.log(`[La Unión] Encontrados ${links.length} enlaces potenciales.`);

        for (let link of links.slice(0, 15)) { // Limit to 15 top links for speed/safety
            try {
                const articleRes = await axios.get(link);
                const $a = cheerio.load(articleRes.data);
                const title = $a('.itemTitle').text().trim() || $a('h2').first().text().trim();
                const content = $a('.itemFullText, .itemIntroText, p').text().replace(/\s+/g, ' ').trim();

                if (title && content && containsKeyword(title + ' ' + content)) {
                    articles.push({
                        title: title,
                        summary: content.substring(0, 300) + '...',
                        content: content,
                        url: link,
                        source: 'LA UNIÓN DE MORELOS'
                    });
                    console.log(`[La Unión] Extracted: ${title.substring(0, 50)}...`);
                }
            } catch (e) {
                // Skip dead links
            }
        }
    } catch (e) {
        console.error('[La Unión de Morelos] Error conectando:', e.message);
    }
    return articles;
}

// ---------------------------------------------------------
// Scraper: El Sol de Cuernavaca
// ---------------------------------------------------------
async function scrapeElSol() {
    console.log('[El Sol de Cuernavaca] Iniciando...');
    const url = 'https://www.elsoldecuernavaca.com.mx/';
    let articles = [];
    try {
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);

        let links = [];
        $('a').each((i, el) => {
            let href = $(el).attr('href');
            if (href) {
                if (href.startsWith('/')) href = `https://www.elsoldecuernavaca.com.mx${href}`;
                if (href.includes('/local/') && !links.includes(href)) {
                    links.push(href);
                }
            }
        });

        links = [...new Set(links)];
        console.log(`[El Sol de Cuernavaca] Encontrados ${links.length} enlaces potenciales.`);

        for (let link of links.slice(0, 15)) {
            try {
                const articleRes = await axios.get(link);
                const $a = cheerio.load(articleRes.data);
                const title = $a('h1.title').text().trim();
                const content = $a('.content-container p, .story-content p').text().replace(/\s+/g, ' ').trim();

                if (title && content && containsKeyword(title + ' ' + content)) {
                    articles.push({
                        title: title,
                        summary: content.substring(0, 300) + '...',
                        content: content,
                        url: link,
                        source: 'EL SOL DE CUERNAVACA'
                    });
                    console.log(`[El Sol] Extracted: ${title.substring(0, 50)}...`);
                }
            } catch (e) {
                // Ignore
            }
        }
    } catch (e) {
        console.error('[El Sol de Cuernavaca] Error conectando:', e.message);
    }
    return articles;
}


async function scrapeAll() {
    console.log(`=== INICIANDO EXTRACCIÓN DIARIA (${TODAY_FORMATTED}) ===`);
    const browser = await chromium.launch({ headless: true });

    let allNews = [];

    try {
        const dmNews = await scrapeDiarioDeMorelos(browser);
        allNews = allNews.concat(dmNews);

        const unionNews = await scrapeLaUnion();
        allNews = allNews.concat(unionNews);

        const solNews = await scrapeElSol();
        allNews = allNews.concat(solNews);

    } catch (e) {
        console.error('Error general del orquestador:', e);
    }

    await browser.close();

    const outputFilePath = path.join(TEMP_DIR, `sintesis-raw-articles-${TODAY_FORMATTED}.json`);
    fs.writeFileSync(outputFilePath, JSON.stringify(allNews, null, 2));

    console.log('=== EXTRACCIÓN COMPLETADA ===');
    console.log(`Total notas extraídas: ${allNews.length}`);
    console.log(`Guardado en: ${outputFilePath}`);
}

if (process.argv[1] === __filename) {
    scrapeAll();
}

export { scrapeAll };
