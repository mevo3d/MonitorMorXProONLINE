import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import TelegramBot from 'node-telegram-bot-api';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

try {
    const envPath = '/root/MonitorMorXPro/.env';
    console.log('Loading env from', envPath);
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
        line = line.trim();
        if (line && !line.startsWith('#') && line.includes('=')) {
            const idx = line.indexOf('=');
            const key = line.substring(0, idx).trim();
            let val = line.substring(idx + 1).trim();
            if (val.startsWith('"') && val.endsWith('"')) val = val.substring(1, val.length - 1);
            if (val.startsWith("'") && val.endsWith("'")) val = val.substring(1, val.length - 1);
            process.env[key] = val;
            console.log('Loaded env var:', key, '=', val);
        }
    });
} catch (e) {
    console.log('Error reading .env', e.message);
}


const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
let TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN_DEFAULT || process.env.TELEGRAM_TOKEN;
if (TELEGRAM_TOKEN && TELEGRAM_TOKEN.includes('XXXXX')) TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;

const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID_DEFAULT || process.env.TELEGRAM_CHAT_ID;

const TWEETS_HISTORY_FILE = path.join(__dirname, 'tweets-historico.jsonl');
const TWEETS_SEEN_FILE = path.join(__dirname, 'tweets-seen.json');

// Obtener el tipo de reporte: dia, semana, mes. ("dia" por defecto)
const tipoReporte = process.argv[2] || 'dia';

let daysToFilter = 1;
if (tipoReporte === 'semana') daysToFilter = 7;
if (tipoReporte === 'mes') daysToFilter = 30;

const bot = TELEGRAM_TOKEN ? new TelegramBot(TELEGRAM_TOKEN) : null;

// Convertir fecha de string a epoch local
function getCutoffDate() {
    const d = new Date();
    d.setDate(d.getDate() - daysToFilter);
    return d.getTime();
}

function leerTweets() {
    const cutoff = getCutoffDate();
    const validTweets = new Map(); // Map to deduplicate by text

    // Try reading the new jsonl format
    if (fs.existsSync(TWEETS_HISTORY_FILE)) {
        const lines = fs.readFileSync(TWEETS_HISTORY_FILE, 'utf-8').split('\n');
        lines.forEach(line => {
            line = line.trim();
            if (!line) return;
            try {
                const obj = JSON.parse(line);
                const tDate = new Date(obj.seenAt).getTime();
                // Skip retweets starts with RT
                if (tDate >= cutoff && !obj.text.startsWith('RT @')) {
                    // Basic deduplication
                    const cleanText = obj.text.replace(/\s+/g, ' ').substring(0, 150).toLowerCase();
                    if (!validTweets.has(cleanText)) {
                        validTweets.set(cleanText, obj.text);
                    }
                }
            } catch (e) { }
        });
    }

    // If not enough tweets in new log, check old json dump
    if (validTweets.size < 5 && fs.existsSync(TWEETS_SEEN_FILE)) {
        try {
            const oldData = JSON.parse(fs.readFileSync(TWEETS_SEEN_FILE, 'utf-8'));
            oldData.forEach(obj => {
                const tDate = new Date(obj.seenAt).getTime();
                if (tDate >= cutoff && obj.text && !obj.text.startsWith('RT @')) {
                    const cleanText = obj.text.replace(/\s+/g, ' ').substring(0, 150).toLowerCase();
                    if (!validTweets.has(cleanText)) {
                        validTweets.set(cleanText, obj.text);
                    }
                }
            });
        } catch (e) { }
    }

    // Return array of unique tweets
    return Array.from(validTweets.values());
}

async function generarReporte() {
    if (!OPENAI_API_KEY) {
        console.error('No OPENAI_API_KEY found in env');
        return;
    }

    const tweets = leerTweets();
    console.log(`Encontrados ${tweets.length} tweets únicos para el reporte de ${tipoReporte}.`);

    if (tweets.length === 0) {
        if (bot) await bot.sendMessage(TELEGRAM_CHAT_ID, `📊 *Reporte (${tipoReporte})*: No hay suficientes datos recolectados para generar un reporte.`, { parse_mode: 'Markdown' });
        return;
    }

    // To save tokens, join texts and truncate if more than e.g. 50 tweets
    // Taking a max sample of 100 recent diverse tweets
    const maxTweets = 80;
    const sampleTweets = tweets.slice(0, maxTweets);

    let tweetTextBlock = sampleTweets.map((t, i) => `[${i + 1}] ${t.substring(0, 300)}`).join('\n---\n');

    console.log(`Generando reporte con AI (${tweetTextBlock.length} chars de contexto)`);

    const prompt = `
Actúa como un analista político experto. Analiza el siguiente conjunto de tuits recolectados en el estado de Morelos (y su política) durante el periodo seleccionado (${tipoReporte}).
Tu objetivo es entregar un reporte **muy conciso** y bien organizado:
1. "Panorama General": Destaca lo más importante o de mayor relevancia (no detalles menores).
2. "Resumen Ejecutivo": Viñetas directas de hechos críticos políticos/legislativos/seguridad.
3. "Propuestas a Futuro": Como analista, menciona posibles desarrollos, estrategias a seguir o lo que se debe tener en el radar a futuro (breve).

Reglas de optimización:
- Omite formalidades, ve al grano.
- Formato fácil de leer en Telegram, usando Emojis adecuados.
- No sobrepases los 2500 caracteres en la respuesta total.

Aquí están los tuits:
${tweetTextBlock}
  `;

    try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: "gpt-4o-mini", // Lower cost, highly capable model
                messages: [{ role: "user", content: prompt }],
                temperature: 0.5,
                max_tokens: 1000
            })
        });

        const data = await res.json();
        if (data.error) {
            console.error("OpenAI Error:", data.error);
            return;
        }

        const reporteTex = data.choices[0].message.content;
        console.log("Reporte generado exitosamente.");

        if (bot && TELEGRAM_CHAT_ID) {
            await bot.sendMessage(TELEGRAM_CHAT_ID, `📋 *REPORTE IA ${tipoReporte.toUpperCase()}*\n\n` + reporteTex, { parse_mode: 'Markdown' });
            console.log("Enviado a Telegram.");
        } else {
            console.log(reporteTex);
        }
    } catch (error) {
        console.error("Fetch Error:", error.message);
    }
}

generarReporte();
