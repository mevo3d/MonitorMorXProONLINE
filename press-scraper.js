import fs from 'fs';
import path from 'path';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config({ override: true });
import * as cheerio from 'cheerio';
import dayjs from 'dayjs';
import { PDFParse } from 'pdf-parse';
import { exec } from 'child_process';
import util from 'util';
import OpenAI from 'openai';
import { fileURLToPath } from 'url';
import { scrapeAgendaNacional } from './elmedio-scraper.js';

const execAsync = util.promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DOWNLOADS_DIR = path.join(__dirname, 'downloads', 'sintesis');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Helper to download a file
async function downloadFile(url, destPath) {
    try {
        const response = await axios({
            url,
            method: 'GET',
            responseType: 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 15000
        });

        const writer = fs.createWriteStream(destPath);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
    } catch (error) {
        console.error(`[Download] Error downloading ${url}: ${error.message}`);
        return false;
    }
}

// Convert PDF to image using pdftoppm (only first page usually needed for covers)
async function pdfToImage(pdfPath, outPrefix) {
    try {
        // -f 1 -l 1 means first page only. -png outputs PNG.
        const cmd = `pdftoppm -png -f 1 -l 1 "${pdfPath}" "${outPrefix}"`;
        await execAsync(cmd);
        // pdftoppm appends -1.png to the prefix for the first page
        const expectedImg = `${outPrefix}-1.png`;
        if (fs.existsSync(expectedImg)) {
            return expectedImg;
        }
        return null;
    } catch (error) {
        console.error(`[PDF2IMG] Error converting ${pdfPath} to image:`, error.message);
        return null;
    }
}

// Read text from PDF
async function extractTextFromPDF(pdfPath) {
    try {
        const dataBuffer = fs.readFileSync(pdfPath);
        const options = { max: 5 }; // Only parse first 5 pages for synthesis
        const data = await new PDFParse({ data: dataBuffer, options });
        return data.text;
    } catch (error) {
        console.error(`[PDF Parse] Error reading text from ${pdfPath}:`, error.message);
        return "";
    }
}

// Extract text from image using OpenAI Vision
async function extractTextFromImage(imagePath) {
    if (!process.env.OPENAI_API_KEY) {
        console.warn("[Vision] No OPENAI_API_KEY found. Skipping image OCR.");
        return "";
    }
    try {
        const imageAsBase64 = fs.readFileSync(imagePath, 'base64');
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: "Transcribe todos los titulares y resumenes de noticias importantes de esta portada de periódico. Ignora anuncios. Agrupa por titular principal y notas secundarias." },
                        {
                            type: "image_url",
                            image_url: {
                                url: `data:image/png;base64,${imageAsBase64}`
                            }
                        }
                    ]
                }
            ],
            max_tokens: 1000
        });
        return response.choices[0].message.content;
    } catch (error) {
        console.error(`[Vision] Error extracting text from image:`, error.message);
        return "";
    }
}

export async function scrapeDailyPress(targetDate = dayjs()) {
    if (!fs.existsSync(DOWNLOADS_DIR)) {
        fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
    }

    const YYYY = targetDate.format('YYYY');
    const MM = targetDate.format('MM');
    const DD = targetDate.format('DD');
    const YYYYMMDD = targetDate.format('YYYYMMDD');
    const todayDir = path.join(DOWNLOADS_DIR, YYYYMMDD);

    if (!fs.existsSync(todayDir)) fs.mkdirSync(todayDir, { recursive: true });

    // Stateful Reading
    const finalFile = path.join(todayDir, 'raw_extraction.json');
    let results = { locales: {}, nacionales: {} };
    if (fs.existsSync(finalFile)) {
        try {
            results = JSON.parse(fs.readFileSync(finalFile, 'utf8'));
        } catch (e) {
            console.error("Error leyendo extraction anterior:", e.message);
        }
    }

    console.log(`\n=== INICIANDO EXTRACCIÓN SÍNTESIS DE PRENSA (${YYYY}-${MM}-${DD}) ===`);
    let pendingCount = 0;

    // 1. Lo de Hoy (Morelos)
    if (!results.locales['Lo de Hoy']) {
        const urlLoDeHoy = `https://morelos.lodehoy.com.mx/sites/default/files/pdf/${YYYY}-${MM}/${YYYYMMDD}_morelos.pdf`;
        const destLoDeHoy = path.join(todayDir, 'lo_de_hoy.pdf');
        console.log(`[Lo de Hoy] Bajando PDF...`);
        if (await downloadFile(urlLoDeHoy, destLoDeHoy)) {
            console.log(`[Lo de Hoy] PDF descargado, extrayendo texto...`);
            const txt = await extractTextFromPDF(destLoDeHoy);
            if (txt) results.locales['Lo de Hoy'] = txt;
        }
        if (!results.locales['Lo de Hoy']) pendingCount++;
    }

    // 2. La Jornada Morelos (Secuencial)
    if (!results.locales['La Jornada Morelos']) {
        const baseDate = dayjs('2026-02-19');
        const baseEdition = 1166;
        const diffDays = targetDate.diff(baseDate, 'day');
        const edicion = baseEdition + diffDays;
        const paddedEdicion = edicion.toString().padStart(5, '0');
        const urlJornada = `https://www.lajornadamorelos.mx/wp-content/uploads/${YYYY}/${MM}/LJM-No-${paddedEdicion}-${MM}-${DD}-${YYYY}.pdf`;
        const destJornada = path.join(todayDir, 'la_jornada_morelos.pdf');
        console.log(`[La Jornada Morelos] Bajando PDF (Edición ${paddedEdicion})...`);
        if (await downloadFile(urlJornada, destJornada)) {
            console.log(`[La Jornada Morelos] PDF descargado, extrayendo texto...`);
            const txt = await extractTextFromPDF(destJornada);
            if (txt) results.locales['La Jornada Morelos'] = txt;
        }
        if (!results.locales['La Jornada Morelos']) pendingCount++;
    }

    // 3. El Regional
    if (!results.locales['El Regional']) {
        try {
            console.log(`[El Regional] Buscando link del día...`);
            const regRes = await axios.get('https://elregional.com.mx/');
            const $ = cheerio.load(regRes.data);
            let regionalPdfUrl = null;
            $('a').each((i, el) => {
                const text = $(el).text().toLowerCase();
                if (text.includes('edición impresa')) {
                    const href = $(el).attr('href');
                    if (href) regionalPdfUrl = href;
                }
            });

            if (regionalPdfUrl) {
                const pageRes = await axios.get(regionalPdfUrl);
                const $page = cheerio.load(pageRes.data);
                let finalPdfUrl = null;
                $page('a').each((i, el) => {
                    const href = $page(el).attr('href');
                    if (href && href.endsWith('.pdf')) {
                        finalPdfUrl = href;
                    }
                });
                if (finalPdfUrl) {
                    const destRegional = path.join(todayDir, 'el_regional.pdf');
                    console.log(`[El Regional] Bajando PDF...`);
                    if (await downloadFile(finalPdfUrl, destRegional)) {
                        console.log(`[El Regional] PDF descargado, extrayendo texto...`);
                        const txt = await extractTextFromPDF(destRegional);
                        if (txt) results.locales['El Regional'] = txt;
                    }
                }
            }
        } catch (e) {
            console.error(`[El Regional] Falló scraping:`, e.message);
        }
        if (!results.locales['El Regional']) pendingCount++;
    }

    // 4. La Unión de Morelos (Web Fallback para Columnas)
    if (!results.locales['La Unión de Morelos']) {
        try {
            console.log(`[La Unión] Buscando columnas web...`);
            // Attempt #1: Try main index for specific section (Opinión/Blogs)
            const dStr = targetDate.format('D-MM-YYYY');
            // This is a dummy example structure since La Union is mostly HTML
            // We'll scrape the home page for "Opinión" or "Columnas"
            const pageRes = await axios.get('https://launion.com.mx/opinion.html');
            const $page = cheerio.load(pageRes.data);
            let opinionText = "=== COLUMNAS LA UNIÓN ===\n";
            $page('.catItemHeader a').each((i, el) => {
                const title = $page(el).text().trim();
                opinionText += `- ${title}\n`;
            });
            if (opinionText.length > 30) {
                results.locales['La Unión de Morelos'] = opinionText;
                console.log(`[La Unión] Extraídas cabeceras de columnas web.`);
            }
        } catch (e) {
            console.error(`[La Unión] Falló scraping opiniones:`, e.message);
        }
        if (!results.locales['La Unión de Morelos']) pendingCount++;
    }

    // 5. Diario de Morelos (Placeholder pending specific strategy)
    if (!results.locales['Diario de Morelos']) {
        pendingCount++; // Placeholder, just tracking it as missing
    }

    // 6. Nacionales (Imágenes compartidas por Diputados)
    const nacionales = [
        { key: 'Reforma', file: 'ref.pdf' },
        { key: 'El Universal', file: 'uni.pdf' },
        { key: 'La Jornada', file: 'jor.pdf' },
        { key: 'Excelsior', file: 'exc.pdf' }
    ];

    for (const nac of nacionales) {
        if (!results.nacionales[nac.key]) {
            const url = `https://comunicacion.diputados.gob.mx/sintesis/notas/whats/PRIMERAS/${nac.file}`;
            const destPdf = path.join(todayDir, `${nac.key}.pdf`);
            console.log(`[${nac.key}] Bajando PDF Nacional...`);
            if (await downloadFile(url, destPdf)) {
                console.log(`[${nac.key}] Convirtiendo PDF a imagen...`);
                const prefix = path.join(todayDir, nac.key);
                const imgPath = await pdfToImage(destPdf, prefix);
                if (imgPath) {
                    console.log(`[${nac.key}] Extrayendo texto con Vision AI...`);
                    const txt = await extractTextFromImage(imgPath);
                    if (txt) results.nacionales[nac.key] = txt;
                }
            }
            if (!results.nacionales[nac.key]) pendingCount++;
        }
    }

    // 7. Agenda Nacional (Playwright scraper)
    if (!results.locales['Agenda Nacional']) {
        console.log(`[Agenda Nacional] Intentando extraer vía Playwright...`);
        const agendaTxt = await scrapeAgendaNacional();
        if (agendaTxt) {
            results.locales['Agenda Nacional'] = "=== AGENDA NACIONAL: LO MÁS RELEVANTE ===\n" + agendaTxt;
        } else {
            pendingCount++;
        }
    }

    // 8. Medios Adicionales (Configurados por el Usuario)
    const configPath = path.join(__dirname, 'sintesis_keywords.json');
    if (fs.existsSync(configPath)) {
        try {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            const mediosExtra = config.medios_adicionales || [];

            for (const medio of mediosExtra) {
                // Determine if it should go to locales or nacionales
                const bucket = medio.tipo === 'nacional' ? results.nacionales : results.locales;

                if (!bucket[medio.nombre]) {
                    // Replace template variables
                    let url = medio.url_template.replace(/{YYYY}/g, YYYY)
                        .replace(/{MM}/g, MM)
                        .replace(/{DD}/g, DD)
                        .replace(/{YYYYMMDD}/g, YYYYMMDD);

                    const destPdf = path.join(todayDir, `${medio.nombre.replace(/ /g, '_')}.pdf`);
                    console.log(`[${medio.nombre}] Bajando medio adicional...`);

                    if (await downloadFile(url, destPdf)) {
                        let txt = "";
                        if (medio.vision) {
                            console.log(`[${medio.nombre}] Usando Vision AI...`);
                            const prefix = path.join(todayDir, medio.nombre.replace(/ /g, '_'));
                            const imgPath = await pdfToImage(destPdf, prefix);
                            if (imgPath) txt = await extractTextFromImage(imgPath);
                        } else {
                            console.log(`[${medio.nombre}] Extrayendo texto directo del PDF...`);
                            txt = await extractTextFromPDF(destPdf);
                        }

                        if (txt) bucket[medio.nombre] = txt;
                    }
                    if (!bucket[medio.nombre]) pendingCount++;
                }
            }
        } catch (e) {
            console.error("Error procesando medios_adicionales de config:", e.message);
        }
    }

    // Save final raw extraction JSON
    fs.writeFileSync(finalFile, JSON.stringify(results, null, 2));

    // Status object
    const isComplete = pendingCount === 0;
    console.log(`\n=== EXTRACCIÓN TERMINADA. Pendientes: ${pendingCount}. Completo: ${isComplete} ===`);

    return {
        isComplete,
        results,
        pendingCount
    };
}

// Si se ejecuta directo:
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    scrapeDailyPress().then(res => console.log("Final check:", res.isComplete)).catch(console.error);
}
