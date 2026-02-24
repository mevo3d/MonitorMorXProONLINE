import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { chromium } from 'playwright';
import { PDFParse } from 'pdf-parse';
import OpenAI from 'openai';
import dayjs from 'dayjs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

dotenv.config({ override: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DOWNLOADS_DIR = path.join(__dirname, 'downloads', 'sintesis');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const START_URL = 'https://www.elmediodemedios.com/publicaciones/mananeras';

export async function processAndSendMananera() {
    try {
        console.log(`[Mañanera] Iniciando extracción de La Mañanera del día...`);
        const todayStr = dayjs().format('YYYYMMDD');
        const targetDir = path.join(DOWNLOADS_DIR, todayStr);
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

        const resultPath = path.join(targetDir, 'mananera.json');

        // Check if already processed successfully today
        if (fs.existsSync(resultPath)) {
            const previousData = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
            if (previousData.success) {
                console.log(`[Mañanera] Ya se procesó exitosamente el resumen de hoy.`);
                return previousData.summary;
            }
        }

        // 1. Scrape for the latest PDF URL using Playwright
        console.log(`[Mañanera] Navegando a ${START_URL}...`);
        const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        const context = await browser.newContext();
        const page = await context.newPage();

        let pdfUrl = null;

        // Intercept requests to locate the PDF file
        page.on('response', response => {
            const url = response.url();
            if (url.toLowerCase().endsWith('.pdf') && (url.includes('uploads') || url.includes('mananera'))) {
                pdfUrl = url;
            }
        });

        await page.goto(START_URL, { waitUntil: 'networkidle', timeout: 30000 });

        // Sometimes the PDF is dynamically loaded or requires scanning links
        if (!pdfUrl) {
            const links = await page.$$eval('a', anchors => anchors.map(a => a.href));
            pdfUrl = links.find(link => link.toLowerCase().endsWith('.pdf') && (link.includes('uploads') || link.includes('mananera')));
        }

        await browser.close();

        if (!pdfUrl) {
            console.log(`[Mañanera] No se encontró un PDF de La Mañanera hoy en el sitio.`);
            return false;
        }

        console.log(`[Mañanera] PDF detectado: ${pdfUrl}. Descargando...`);

        // 2. Download the PDF
        const pdfResponse = await axios.get(pdfUrl, { responseType: 'arraybuffer', timeout: 60000 });
        const pdfBuffer = Buffer.from(pdfResponse.data);

        console.log(`[Mañanera] PDF Descargado (${Math.round(pdfBuffer.length / 1024)} KB). Extrayendo texto...`);

        const parser = new PDFParse({ data: pdfBuffer });
        const result = await parser.getText();
        await parser.destroy();
        const textoExtraido = result.text;

        if (!textoExtraido || textoExtraido.trim().length === 0) {
            console.error("[Mañanera] El PDF no contiene texto extraíble válido.");
            return false;
        }

        const textoLimitado = textoExtraido.slice(0, 15000); // Evitar límites de tokens

        // 4. Generate the Summary with GPT-4o-mini
        const fechaActualDisplay = dayjs().format('DD/MM/YYYY');
        const systemPrompt = `🇲🇽 *Eres Morelos GPT*, una inteligencia especializada en análisis político y legislativo con enfoque en el estado de Morelos.

Recibirás documentos correspondientes a la conferencia matutina presidencial (*La Mañanera del Pueblo*) y deberás generar un resumen estructurado, claro y visual, que sea útil para medios, asesores políticos y equipos de análisis legislativo.

🎯 *Objetivo:* Resumir TODOS los temas abordados en bloques temáticos, con claridad, orden visual y estilo compatible con WhatsApp/Telegram. **PRIORIDAD ABSOLUTA**: incluir temas de seguridad, controversias, críticas y decisiones federales importantes. NO omitir nada relevante.

🧩 *Formato del resumen esperado:*

*🇲🇽 La Mañanera del Pueblo – ${fechaActualDisplay}*  
📍Presidencia de *Claudia Sheinbaum*

*🎯 Temas prioritarios del día:* *[lista corta de temas clave]*

*🗣️ DECLARACIONES Y POSTURAS PRESIDENCIALES*  
🔹 *[Declaraciones]*  

*🛡️ SEGURIDAD NACIONAL Y PÚBLICA*  
🔹 *[Cifras, Guardia Nacional, etc]*  

*⚖️ JUSTICIA Y CONTROVERSIAS*  
🔹 *[Reformas, Suprema Corte, Polémicas]*  

*💰 ECONOMÍA Y PROGRAMAS SOCIALES*  
🔹 *[Apoyos, Pemex, Presupuesto]*  

*🔎 IMPLICACIONES PARA MORELOS:*  
🔹 *[Si Morelos fue mencionado directamente, forma parte de programas, cifras estatales, decisiones federales, destácalo con contexto político. Si no hay implicaciones para Morelos hoy, indica "No se mencionaron temas específicos con impacto directo en el Estado de Morelos el día de hoy."]*

*📊 OTROS TEMAS RELEVANTES:*  
🔹 *[Otros]*

⚠️ *INSTRUCCIONES CRÍTICAS:*
- NO OMITIR TEMAS DE SEGURIDAD O POLÉMICAS.
- Usar abundantes *negritas*, emojis 🔥⚡🚨 y viñetas (🔹).
- Usa formato compatible tanto con Telegram Markdown como renderizado web puro en React-Markdown (usa * para negritas, _ para cursivas).`;

        console.log(`[Mañanera] Solicitando resumen a OpenAI...`);
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `Extrae el resumen completo de este documento:\n\n${textoLimitado}` }
            ],
            temperature: 0.4,
            max_tokens: 2500
        });

        const resumen = response.choices[0].message.content;

        if (!resumen) {
            console.error("[Mañanera] Error: OpenAI no regresó un texto válido.");
            return false;
        }

        // Save result locally for Dashboard access
        fs.writeFileSync(resultPath, JSON.stringify({
            success: true,
            summary: resumen,
            pdfUrl,
            timestamp: dayjs().toISOString()
        }, null, 2));

        console.log("[Mañanera] Resumen guardado localmente. Enviando a Telegram...");

        // 5. Send to Telegram
        if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
            const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
            if (resumen.length > 4000) {
                const parts = resumen.match(/[\s\S]{1,4000}/g) || [];
                for (const part of parts) {
                    await axios.post(telegramUrl, {
                        chat_id: TELEGRAM_CHAT_ID,
                        text: part,
                        parse_mode: 'Markdown'
                    }).catch(e => console.error("[Mañanera] Error enviando parte a Telegram:", e.message));
                }
            } else {
                await axios.post(telegramUrl, {
                    chat_id: TELEGRAM_CHAT_ID,
                    text: resumen,
                    parse_mode: 'Markdown'
                }).catch(e => console.error("[Mañanera] Error enviando a Telegram:", e.message));
            }
            console.log("[Mañanera] 📨 Mensaje enviado a Telegram correctamente.");
        } else {
            console.warn("[Mañanera] Credenciales de Telegram faltantes, omitiendo envío.");
        }

        return resumen;

    } catch (error) {
        console.error("[Mañanera] Error crítico en processAndSendMananera:", error.message);
        return false;
    }
}

// Standalone test execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    processAndSendMananera().then(res => {
        if (res) console.log("Prueba exitosa.");
        else console.log("Prueba fallida o no hay PDF para hoy.");
        process.exit(0);
    });
}
