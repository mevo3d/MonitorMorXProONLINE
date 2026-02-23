import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ override: true });
import dayjs from 'dayjs';
import 'dayjs/locale/es.js';
import OpenAI from 'openai';
import { fileURLToPath } from 'url';

dayjs.locale('es');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DOWNLOADS_DIR = path.join(__dirname, 'downloads', 'sintesis');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

export async function generateSynthesis(targetDate = dayjs()) {
    if (!process.env.OPENAI_API_KEY) {
        console.error("[Generator] Error: Falta OPENAI_API_KEY en las variables de entorno.");
        return null;
    }

    const YYYY_MM_DD = targetDate.format('YYYY-MM-DD');
    const rawFile = path.join(__dirname, 'temp', `sintesis-raw-articles-${YYYY_MM_DD}.json`);

    if (!fs.existsSync(rawFile)) {
        console.error(`[Generator] Archivo ${rawFile} no existe. Corre scraper primero.`);
        return null;
    }

    const rawData = JSON.parse(fs.readFileSync(rawFile, 'utf8'));

    // We only send title, summary, source and url to GPT to save tokens
    const slimData = rawData.map(a => ({
        source: a.source,
        title: a.title,
        summary: a.summary,
        url: a.url
    }));

    const systemPrompt = `Eres un editor jefe estructurando la Síntesis de Prensa Diaria de Morelos.
Tu objetivo es analizar notas periodísticas y agruparlas en categorías ESTRICTAS para su renderizado en PDF.

REGLAS DE AGRUPACIÓN:
1. Clasifica cada nota en UNA de estas categorías: 'CONGRESO', 'GOBIERNO', 'JUDICIAL_SEGURIDAD', 'MUNICIPIOS', 'GENERAL', 'NACIONAL', 'COLUMNAS'.
2. Prioridad de clasificación: Si menciona al Congreso de Morelos o Diputados locales, SIEMPRE va en CONGRESO. Gobernadora o Gabinete en GOBIERNO.
3. Si varias notas cubren la MSIMA noticia exacta, FUSIONA la información en un solo ítem y une las fuentes (ej. "LA UNIÓN / DIARIO DE MORELOS").
4. El json devuelto NO debe tener escapes markdown como \`\`\`json. Solo el raw object.
5. Mantén los enlaces en un array de strings.

ESQUEMA JSON OBLIGATORIO:
{
  "fechas": "SÍNTESIS DE PRENSA DÍA DE MES AÑO",
  "CONGRESO": [ { "medios": "LA UNIÓN", "titulo": "...", "resumen": "...", "enlaces": ["http..."] } ],
  "GOBIERNO": [],
  "JUDICIAL_SEGURIDAD": [],
  "MUNICIPIOS": [],
  "GENERAL": [],
  "NACIONAL": [],
  "COLUMNAS": []
}`;

    const userPrompt = `Aquí están las noticias crudas extraídas hoy:\n${JSON.stringify(slimData)}\n\nGenera el JSON estructurado final.`;

    console.log(`[Generator] Enviando ${slimData.length} notas a GPT-4o-mini para clustering JSON...`);
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            temperature: 0.1,
            max_tokens: 4000
        });

        let rawResponse = response.choices[0].message.content.trim();
        // Fallback cleanup if GPT adds markdown blocks despite prompt
        if (rawResponse.startsWith('\`\`\`json')) {
            rawResponse = rawResponse.replace(/^\`\`\`json/m, '').replace(/\`\`\`$/m, '').trim();
        }

        const jsonObj = JSON.parse(rawResponse);

        const saveDir = path.join(__dirname, 'temp');
        if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir);

        const outFile = path.join(saveDir, `sintesis-clustered-${YYYY_MM_DD}.json`);
        fs.writeFileSync(outFile, JSON.stringify(jsonObj, null, 2));
        console.log(`[Generator] Clustering exitoso. Guardado en: ${outFile}`);

        return jsonObj;
    } catch (e) {
        console.error(`[Generator] Error generando la síntesis con AI: ${e.message}`);
        return null;
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    generateSynthesis().catch(console.error);
}
