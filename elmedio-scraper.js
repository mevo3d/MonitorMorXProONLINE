import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import https from 'https';
import { PDFParse } from 'pdf-parse';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DOWNLOADS_DIR = path.join(__dirname, 'downloads', 'sintesis');

async function extractTextFromPDF(pdfPath) {
    try {
        const dataBuffer = fs.readFileSync(pdfPath);
        const options = { max: 15 }; // Scrape up to 15 pages for Mananeras
        const data = await new PDFParse({ data: dataBuffer, options });
        return data.text;
    } catch (error) {
        console.error(`[PDF Parse] Error reading text from ${pdfPath}:`, error.message);
        return "";
    }
}

async function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        try {
            const file = fs.createWriteStream(destPath);
            const timeoutId = setTimeout(() => {
                file.destroy();
                reject(new Error(`Timeout HTTP`));
            }, 60000);

            const request = https.get(url, (response) => {
                if (response.statusCode !== 200) {
                    clearTimeout(timeoutId);
                    file.destroy();
                    reject(new Error(`Error HTTP ${response.statusCode}`));
                    return;
                }
                response.pipe(file);
                file.on('finish', () => {
                    clearTimeout(timeoutId);
                    file.close();
                    resolve(true);
                });
                file.on('error', (error) => {
                    clearTimeout(timeoutId);
                    file.destroy();
                    reject(error);
                });
            });
            request.on('error', (error) => {
                clearTimeout(timeoutId);
                file.destroy();
                reject(error);
            });
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * Common Logic to scrape elmediodemedios SPA via Playwright network interception
 */
async function scrapeElMedioPDF(urlSite, prefixFileLabel) {
    let browser = null;
    try {
        console.log(`[Playwright] Launching browser for ${prefixFileLabel}...`);
        browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        let pdfUrl = null;

        // Intercept network requests to catch the PDF link loading
        page.on('request', (request) => {
            const url = request.url();
            if (url.endsWith('.pdf') && (url.includes('uploads') || url.includes('mananera') || url.includes('agenda'))) {
                pdfUrl = url;
                console.log(`[Playwright] Caught PDF stream: ${path.basename(url)}`);
            }
        });

        await page.goto(urlSite, { waitUntil: 'networkidle', timeout: 30000 });

        // Scroll to trigger lazy requests exactly like user's script
        try {
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await page.waitForTimeout(3000);
        } catch (e) { }

        if (!pdfUrl) {
            console.log(`[Playwright] No PDF found for ${prefixFileLabel}.`);
            return null;
        }

        // We have the URL. Download and parse it locally
        if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

        const timestamp = Date.now();
        const destPath = path.join(DOWNLOADS_DIR, `${prefixFileLabel}_${timestamp}.pdf`);

        console.log(`[Playwright] Downloading PDF to ${destPath}...`);
        await downloadFile(pdfUrl, destPath);

        console.log(`[Playwright] Converting PDF to text...`);
        const text = await extractTextFromPDF(destPath);

        // Clean up pdf file if desired to save disk space over time
        try { fs.unlinkSync(destPath); } catch (e) { }

        return text;

    } catch (error) {
        console.error(`[Playwright] Error in ${prefixFileLabel}:`, error.message);
        return null;
    } finally {
        if (browser) {
            await browser.close().catch(() => { });
        }
    }
}

export async function scrapeAgendaNacional() {
    return scrapeElMedioPDF('https://www.elmediodemedios.com/publicaciones/agenda-nacional', 'agenda_nacional');
}

export async function scrapeMananera() {
    return scrapeElMedioPDF('https://www.elmediodemedios.com/publicaciones/mananeras', 'mananera');
}
