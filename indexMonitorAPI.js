import dotenv from 'dotenv';
dotenv.config({ path: '/root/MonitorMorXPro/.env', override: true });

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import TelegramBot from 'node-telegram-bot-api';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import crypto from 'crypto';
import https from 'https';
import { exec } from 'child_process';
import util from 'util';
import { scrapeFacebookPages } from './facebook.js';
import { scrapeDailyPress } from './press-scraper.js';
import { generateSynthesis } from './synthesis-generator.js';
import { processAndSendMananera } from './mananera-generator.js';

// === IMPORTACIÓN DE MÓDULOS LEGACY ===
import EstadisticasMedios from './EstadisticasMedios.js';
import SistemaAlertas from './SistemaAlertas.js';
import ExportadorReportes from './ExportadorReportes.js';

const execPromise = util.promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ====== CONFIGURACIÓN ======
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const RETTIWT_API_KEY = process.env.RETTIWT_API_KEY;
const KEYWORDS_FILE = 'keywords.json';
const KEYWORDS_MEDIOS_FILE = path.join(__dirname, 'keywords-medios.json');
const KEYWORDS_CUAUTLA_FILE = path.join(__dirname, 'keywords-cuautla.json');
const SEEN_FILE = path.join(__dirname, 'tweets-seen.json');
const FB_SEEN_FILE = path.join(__dirname, 'facebook-seen.json');
const CHECK_INTERVAL_MS = 60000; // 60 segundos entre ciclos
const MAX_CRASH_RETRIES = 50;

// Configuración de rutas Legacy
const CARPETA_BASE = path.join(__dirname, 'media');
const CARPETA_VIDEOS = path.join(CARPETA_BASE, 'video');
const CARPETA_IMAGENES = path.join(CARPETA_BASE, 'img');
const CARPETA_VIDEOS_RESPALDO = path.join(__dirname, 'media_backup', 'video');

// ====== VARIABLES GLOBALES ======
let bot = null;
const botsEspecializados = {};
let allKeywords = [];
let categorias = {};
let allMediosKeywords = [];
let categoriasMedios = {};
let allCuautlaKeywords = [];
let categoriasCuautla = {};
const tweetsEnviados = new Set();
let crashCount = 0;
let tweetsEncontradosCount = 0;
const startTime = Date.now();

// Instancias de Módulos
const estadisticas = new EstadisticasMedios();
const sistemaAlertas = new SistemaAlertas();
const exportador = new ExportadorReportes();
// Mock de Métricas para Exportador (si es necesario)
const metricasMock = { obtenerResumenMetricas: () => ({ tendencias: { tendencia7Dias: 'Estable', palabrasClavePopulares: [] } }) };


// ====== INICIALIZACIÓN ======
console.log('🤖 Monitor Legislativo (Legacy Enhanced) - Iniciando...');
console.log('=====================================================');

// Crear carpetas necesarias
[CARPETA_VIDEOS, CARPETA_IMAGENES, CARPETA_VIDEOS_RESPALDO].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Cargar historial
try {
    if (fs.existsSync(SEEN_FILE)) {
        const loaded = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8'));
        loaded.forEach(item => {
            const id = typeof item === 'string' ? item : item.id;
            tweetsEnviados.add(id);
        });
        console.log(`📂 Cargados ${tweetsEnviados.size} tweets previos del historial.`);
    }
} catch (e) { console.error('Error cargando historial:', e.message); }

// Telegram
if (TELEGRAM_TOKEN && TELEGRAM_CHAT_ID) {
    bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false }); // Polling false porque usamos un loop propio
    console.log('📱 Bot Telegram configurado (Principal)');

    const canales = ['DEFAULT', 'LEGISLATIVO', 'EJECUTIVO', 'JUDICIAL', 'MORELOS', 'CUAUTLA'];
    canales.forEach(canal => {
        const token = process.env[`TELEGRAM_TOKEN_${canal}`];
        const chatId = process.env[`TELEGRAM_CHAT_ID_${canal}`];
        if (token && chatId) {
            botsEspecializados[canal.toLowerCase()] = {
                bot: new TelegramBot(token, { polling: false }),
                chatId
            };
            console.log(`📱 Bot Telegram configurado para canal: ${canal}`);
        }
    });

} else {
    console.warn('⚠️ Telegram no configurado');
}

// ====== FUNCIONES AUXILIARES ======
async function descargarVideo(url, id, esReintento = false) {
    try {
        const nombreArchivo = `video_${id}.mp4`;
        let urlCompleta = url.startsWith('http') ? url : `https://x.com${url}`;

        console.log(`📥 ${esReintento ? 'Reintentando' : 'Descargando'} video [${id}]`);

        // Usar carpeta primaria o respaldo
        let carpeta = CARPETA_VIDEOS;
        if (!fs.existsSync(carpeta)) carpeta = CARPETA_VIDEOS_RESPALDO;

        const outputPath = path.join(carpeta, nombreArchivo);

        // Comando yt-dlp ROBUSTO (Legacy + Thumbnail)
        // --write-thumbnail: Descarga la miniatura
        // --convert-thumbnails jpg: Asegura formato JPG
        const comando = `yt-dlp --no-check-certificate --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" --encoding utf-8 -P "${carpeta}" -o "${nombreArchivo}" --write-thumbnail --convert-thumbnails jpg -f "best[ext=mp4]/best" --no-post-overwrites "${urlCompleta}"`;

        await execPromise(comando, { timeout: 120000, maxBuffer: 1024 * 1024 * 10 });

        if (fs.existsSync(outputPath)) return outputPath;
        return null;
    } catch (e) {
        console.error(`❌ Error descargando video [${id}]:`, e.message);
        return null;
    }
}

function normalizeText(text) {
    return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function escapeMarkdown(text) {
    return text.replace(/([_*[`])/g, '\\$1');
}

function getTimeAgo(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffHrs = Math.floor(diffMs / 3600000);
    const diffMins = Math.floor(diffMs / 60000);
    const diffSecs = Math.floor(diffMs / 1000);
    if (diffHrs > 0) return `*${diffHrs}h*`;
    if (diffMins > 0) return `*${diffMins}m*`;
    return `*${diffSecs}s*`;
}

function formatTime(date) {
    return date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

// ====== KEYWORDS ======
async function cargarPalabrasClave() {
    try {
        const data = await fs.promises.readFile(KEYWORDS_FILE, 'utf8');
        const config = JSON.parse(data);
        categorias = config.categorias || {};
        allKeywords = [];
        for (const cat in categorias) {
            allKeywords.push(...categorias[cat]);
        }

        // Actualizar categorías en módulo de estadísticas
        if (estadisticas) estadisticas.actualizarCategorias(categorias);

        console.log(`🔍 Listas para buscar: ${allKeywords.length} keywords (poderes)`);

        // Cargar keywords de medios
        try {
            if (fs.existsSync(KEYWORDS_MEDIOS_FILE)) {
                const mediosData = await fs.promises.readFile(KEYWORDS_MEDIOS_FILE, 'utf8');
                const mediosConfig = JSON.parse(mediosData);
                categoriasMedios = mediosConfig.categorias || {};
                allMediosKeywords = [];
                for (const cat in categoriasMedios) {
                    allMediosKeywords.push(...categoriasMedios[cat]);
                }
                console.log(`📰 Listas para buscar: ${allMediosKeywords.length} keywords (medios)`);
            }
        } catch (e2) {
            console.error('Error cargando keywords medios:', e2.message);
        }

        // Cargar keywords de cuautla
        try {
            if (fs.existsSync(KEYWORDS_CUAUTLA_FILE)) {
                const cuautlaData = await fs.promises.readFile(KEYWORDS_CUAUTLA_FILE, 'utf8');
                const cuautlaConfig = JSON.parse(cuautlaData);
                categoriasCuautla = cuautlaConfig.categorias || {};
                allCuautlaKeywords = [];
                for (const cat in categoriasCuautla) {
                    allCuautlaKeywords.push(...categoriasCuautla[cat]);
                }
                console.log(`📍 Listas para buscar: ${allCuautlaKeywords.length} keywords (cuautla)`);
            }
        } catch (e3) {
            console.error('Error cargando keywords cuautla:', e3.message);
        }

        return allKeywords;
    } catch (e) {
        console.error('Error cargando keywords:', e.message);
        return allKeywords;
    }
}

// ====== BROWSER / SCRAPER (Mantenemos la versión X Pro Deck eficiente) ======
async function getCookiesFromEnv() {
    if (!RETTIWT_API_KEY) return [];
    try {
        const cookieString = Buffer.from(RETTIWT_API_KEY, 'base64').toString('ascii');
        const cookies = [];
        ['auth_token', 'ct0', 'twid'].forEach(name => {
            const match = cookieString.match(new RegExp(`${name}=([^;]+)`));
            if (match) {
                cookies.push({
                    name, value: match[1], domain: '.x.com', path: '/',
                    httpOnly: ['auth_token', 'twid'].includes(name), secure: true, sameSite: 'None'
                });
            }
        });
        return cookies;
    } catch (e) {
        console.error('Error decodificando cookies:', e);
        return [];
    }
}

const TWITTER_PRO_URL = 'https://pro.x.com/i/decks/1853883906551898346';

async function buscarTweetsBrowser() {
    let browser = null;
    let todosLosTweets = [];

    try {
        const cookies = await getCookiesFromEnv();
        if (cookies.length === 0) throw new Error('No hay cookies válidas en RETTIWT_API_KEY');

        browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });

        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });
        await context.addCookies(cookies);
        const page = await context.newPage();

        console.log(`🌍 Navegando a X Pro: ${TWITTER_PRO_URL}`);
        await page.goto(TWITTER_PRO_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(5000);

        if (page.url().includes('x.com/home') || page.url().includes('twitter.com/home')) {
            console.log('⚠️ Redirigido a Home, reintentando ir a Deck...');
            await page.goto(TWITTER_PRO_URL, { waitUntil: 'networkidle', timeout: 60000 });
        }

        try {
            await page.waitForSelector('article[data-testid="tweet"]', { timeout: 30000 });
        } catch (e) {
            console.log('⚠️ No se detectaron tweets en el tiempo límite.');
        }

        await page.evaluate(() => window.scrollBy(0, 500));
        await page.waitForTimeout(2000);

        // Expandir tweets largos ("Mostrar más")
        await page.evaluate(() => {
            const showMoreBtns = document.querySelectorAll('[data-testid="tweet-text-show-more-link"]');
            showMoreBtns.forEach(btn => {
                try { btn.click(); } catch (e) { }
            });
            // Fallback por si usan span con "Mostrar más"
            const spans = document.querySelectorAll('span');
            spans.forEach(span => {
                if (span.innerText === 'Mostrar más' || span.innerText === 'Show more') {
                    try { span.click(); } catch (e) { }
                }
            });
        });
        await page.waitForTimeout(1500); // Esperar a que el DOM se expanda

        todosLosTweets = await page.evaluate(() => {
            const articles = document.querySelectorAll('article[data-testid="tweet"]');
            const data = [];
            articles.forEach(article => {
                try {
                    const userEl = article.querySelector('div[data-testid="User-Name"]');
                    const textEl = article.querySelector('div[data-testid="tweetText"]');
                    const timeEl = article.querySelector('time');
                    const linkEl = article.querySelector('a[href*="/status/"]');

                    // Profile avatar image
                    const avatarImg = article.querySelector('div[data-testid="Tweet-User-Avatar"] img');
                    const profileImage = avatarImg ? avatarImg.src : null;

                    // Imágenes y Videos del tweet (no card)
                    const imgEls = article.querySelectorAll('div[data-testid="tweetPhoto"] img');
                    const isVideo = article.querySelector('div[data-testid="videoComponent"]') !== null ||
                        article.querySelector('video') !== null;

                    // Link Preview Cards (Noticias, YouTube, etc)
                    const cardEl = article.querySelector('[data-testid="card.wrapper"]');
                    let cardUrl = null, cardImage = null, cardTitle = null;

                    if (cardEl) {
                        const cardLink = cardEl.querySelector('a');
                        if (cardLink) cardUrl = cardLink.href;

                        const cardImg = cardEl.querySelector('img');
                        if (cardImg) cardImage = cardImg.src;

                        // Intentar sacar título del card
                        const cardText = cardEl.innerText.split('\n');
                        if (cardText.length > 0) cardTitle = cardText[0];
                    }

                    if (userEl && timeEl && linkEl) {
                        const rawText = userEl.innerText.split('\n');
                        const name = rawText[0];
                        const handle = rawText[1];

                        // Sacar texto completo
                        let text = textEl ? textEl.innerText : '';
                        if (textEl) {
                            const linkElements = textEl.querySelectorAll('a[href]');
                            let linksFound = [];
                            linkElements.forEach(a => {
                                const href = a.href;
                                if (href.startsWith('http') && !href.includes('/status/') && !href.includes('/hashtag/') && !href.includes('/search?')) {
                                    if (!text.includes(href) && !href.includes('pro.x.com')) {
                                        linksFound.push(href);
                                    }
                                }
                            });
                            if (linksFound.length > 0) {
                                linksFound = [...new Set(linksFound)];
                                text += '\\n\\n🔗 Enlaces en Tweet: ' + linksFound.join(' ');
                            }
                        }

                        const timestamp = timeEl.getAttribute('datetime');
                        const url = linkEl.href;
                        const id = url.split('/status/')[1];
                        const media = Array.from(imgEls).map(img => img.src);

                        data.push({
                            id, name, handle, text, timestamp, url, media, isVideo,
                            cardUrl, cardImage, cardTitle, profileImage
                        });
                    }
                } catch (err) { }
            });
            return data;
        });

        console.log(`📊 Tweets extraídos de X Pro: ${todosLosTweets.length}`);
        return todosLosTweets;

    } catch (e) {
        console.error('❌ Error en browser:', e.message);
        return [];
    } finally {
        if (browser) await browser.close();
    }
}

// ====== PROCESAMIENTO ======
// ====== PROCESAMIENTO ======
async function procesarTweets(tweets) {
    let count = 0;
    for (const tweet of tweets) {
        try {
            const { id, handle, text, name, timestamp, url, media, isVideo, cardUrl, cardImage, cardTitle, profileImage } = tweet;

            // Filtro de duplicados
            if (tweetsEnviados.has(id)) continue;

            const normalizedText = normalizeText(text);
            const foundKeyword = allKeywords.find(k => normalizedText.includes(normalizeText(k)));

            if (!foundKeyword && !normalizedText.includes('morelos')) {
                // Also check medios keywords before skipping
                const foundMediosKw = allMediosKeywords.find(k => normalizedText.includes(normalizeText(k)) || (k.startsWith('@') && (handle || '').toLowerCase().includes(k.toLowerCase().replace('@', ''))));
                if (!foundMediosKw) continue;
            }

            tweetsEnviados.add(id);
            count++;

            console.log(`📢 Nuevo Tweet: ${handle} - ${text.substring(0, 40)}...`);

            // 1. Registrar Estadísticas (Legacy Module)
            try {
                estadisticas.registrarTweet({
                    handle,
                    texto: text,
                    fecha: timestamp,
                    palabrasClaveEncontradas: foundKeyword ? [foundKeyword] : []
                });
                estadisticas.guardarEstadisticas();
            } catch (e) {
                console.error('Error registrando estadísticas:', e.message);
            }

            // 2. Procesar Alertas (Legacy Module)
            let alertaGenerada = null;
            try {
                const clasificacion = sistemaAlertas.clasificarTweet({ texto: text, handle, url });
                if (clasificacion.nivel.valor >= sistemaAlertas.nivelesAlerta.ALTA.valor) {
                    alertaGenerada = sistemaAlertas.procesarAlerta({ texto: text, medio: handle, url, fecha: timestamp }, clasificacion);
                }
            } catch (e) {
                console.error('Error procesando alertas:', e.message);
            }

            // 4. Enviar a Telegram
            let videoPath = null; // Variable para almacenar path local

            // Determinar categoría del tweet
            const categoriasDelTweet = [];
            for (const [catName, keys] of Object.entries(categorias)) {
                if (keys.some(k => normalizedText.includes(normalizeText(k)))) {
                    categoriasDelTweet.push(catName.toLowerCase());
                }
            }

            let targetBot = bot;
            let targetChatId = TELEGRAM_CHAT_ID;

            // Prioridad: Legislativo (congreso) > Ejecutivo (gobierno) > Judicial
            if (categoriasDelTweet.includes('legislativo')) {
                if (botsEspecializados['legislativo']) {
                    targetBot = botsEspecializados['legislativo'].bot;
                    targetChatId = botsEspecializados['legislativo'].chatId;
                }
            } else if (categoriasDelTweet.includes('gobierno') || categoriasDelTweet.includes('ejecutivo')) {
                if (botsEspecializados['ejecutivo']) {
                    targetBot = botsEspecializados['ejecutivo'].bot;
                    targetChatId = botsEspecializados['ejecutivo'].chatId;
                }
            } else if (categoriasDelTweet.includes('judicial')) {
                if (botsEspecializados['judicial']) {
                    targetBot = botsEspecializados['judicial'].bot;
                    targetChatId = botsEspecializados['judicial'].chatId;
                }
            } else if (categoriasDelTweet.includes('cuautla')) {
                if (botsEspecializados['cuautla']) {
                    targetBot = botsEspecializados['cuautla'].bot;
                    targetChatId = botsEspecializados['cuautla'].chatId;
                }
            } else if (categoriasDelTweet.length > 0) { // Fallback para cualquier otra categoria (morelos/general)
                if (botsEspecializados['morelos']) {
                    targetBot = botsEspecializados['morelos'].bot;
                    targetChatId = botsEspecializados['morelos'].chatId;
                }
            }

            // Si a pesar de todo no tiene asginación y está en default, forzamos target fallback
            if (!targetBot && botsEspecializados['default']) {
                targetBot = botsEspecializados['default'].bot;
                targetChatId = botsEspecializados['default'].chatId;
            }

            // === DUAL ROUTING: También enviar a bot de Medios si coincide con keywords de medios ===
            const foundMediosKw = allMediosKeywords.find(k => normalizedText.includes(normalizeText(k)) || (k.startsWith('@') && (handle || '').toLowerCase().includes(k.toLowerCase().replace('@', ''))));
            if (foundMediosKw && botsEspecializados['morelos']) {
                const mediosBot = botsEspecializados['morelos'].bot;
                const mediosChatId = botsEspecializados['morelos'].chatId;
                // Only send to medios bot if it's different from the target bot
                if (mediosBot !== targetBot || mediosChatId !== targetChatId) {
                    try {
                        const timeAgoM = getTimeAgo(new Date(timestamp));
                        let captionM = `📰 *${escapeMarkdown(name)}* ${escapeMarkdown(handle)}\n• ${formatTime(new Date(timestamp))} ${timeAgoM}\n\n${escapeMarkdown(text)}`;
                        captionM += `\n\n🔗 [Ver Tweet](${url})`;
                        await mediosBot.sendMessage(mediosChatId, captionM, { parse_mode: 'Markdown', disable_web_page_preview: false });
                    } catch (mediosErr) {
                        console.error('Error enviando a bot Medios:', mediosErr.message);
                    }
                }
            }

            if (targetBot) {
                const timeAgo = getTimeAgo(new Date(timestamp));
                let caption = `*${escapeMarkdown(name)}* ${escapeMarkdown(handle)}\n• ${formatTime(new Date(timestamp))} ${timeAgo}\n\n${escapeMarkdown(text)}`;

                // Agregar etiqueta de alerta si es urgente
                if (alertaGenerada) {
                    caption = `🚨 *ALERTA ${alertaGenerada.clasificacion.nivel.emoji}*\n\n` + caption;
                }

                if (cardUrl) {
                    caption += `\n\n🔗 *${escapeMarkdown(cardTitle || 'Enlace externo')}*\n${escapeMarkdown(cardUrl)}`;
                }

                caption += `\n\n🐦 [Ver Tweet](${url})`;

                let sent = false;

                if (isVideo) {
                    // Usar Path Legacy: media/video/
                    videoPath = await descargarVideo(url, id);
                    if (videoPath) {
                        try {
                            await targetBot.sendVideo(targetChatId, videoPath, { caption, parse_mode: 'Markdown' });
                            sent = true;
                            // Nota: No borramos el video. Se archiva semanalmente.
                        } catch (err) {
                            console.error('Error enviando video:', err.message);
                        }
                    } else {
                        // Fallback si falla descarga de video
                        caption += `\n\n⚠️ _(Video no disponible para descarga)_`;
                    }
                }

                if (!sent && media && media.length > 0) {
                    await targetBot.sendPhoto(targetChatId, media[0], { caption, parse_mode: 'Markdown' });
                    sent = true;
                } else if (!sent && cardImage) {
                    // Send Link Preview Image if no native media
                    try {
                        await targetBot.sendPhoto(targetChatId, cardImage, { caption, parse_mode: 'Markdown' });
                        sent = true;
                    } catch (e) {
                        console.error('Error enviando card image:', e.message);
                    }
                }

                if (!sent) {
                    await targetBot.sendMessage(targetChatId, caption, {
                        parse_mode: 'Markdown',
                        disable_web_page_preview: !isVideo && !cardImage // Disable preview if we have video or card image ensuring no duplicate previews? Actually usually allowed.
                    });
                }
            }

            // 3. Persistencia Simple (JSON Historial) - MOVIDO AL FINAL PARA INCLUIR VIDEO PATH y MEDIA
            try {
                const history = fs.existsSync(SEEN_FILE) ? JSON.parse(fs.readFileSync(SEEN_FILE)) : [];
                history.push({
                    id,
                    handle,
                    name,
                    text: text, // Guardar texto completo sin truncar
                    date: new Date().toISOString(),
                    type: isVideo ? 'video' : (media && media.length > 0 ? 'photo' : 'text'),
                    mediaUrls: media || [], // Guardar URLs originales
                    localPath: videoPath ? path.basename(videoPath) : null, // Guardar nombre de archivo local si existe
                    cardUrl: cardUrl || null,
                    cardTitle: cardTitle || null,
                    cardImage: cardImage || null,
                    source: tweet.source || 'twitter',
                    profileImage: profileImage || null
                });
                if (history.length > 2000) history.shift();
                fs.writeFileSync(SEEN_FILE, JSON.stringify(history, null, 2));
            } catch (e) {
                console.error("Error guardando historial:", e.message);
            }

        } catch (e) {
            console.error('Error procesando tweet:', e.message);
        }
    }
    return count;
}

// ====== MANTENIMIENTO Y REPORTES (Legacy Logic) ======
function obtenerNumeroSemana(d) {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

async function limpiezaSemanalLegacy() {
    try {
        console.log('🧹 Ejecutando mantenimiento semanal (Legacy Archiving)...');
        const hoy = new Date();
        const folderName = `${hoy.getFullYear()}-W${obtenerNumeroSemana(hoy)}`;
        const archiveDir = path.join(CARPETA_BASE, 'archive', folderName);

        if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });

        // Mover videos de la semana a archivo
        if (fs.existsSync(CARPETA_VIDEOS)) {
            const videos = fs.readdirSync(CARPETA_VIDEOS);
            let movidos = 0;
            for (const file of videos) {
                // Mover tanto videos como miniaturas (.jpg, .webp)
                if (file.match(/\.(mp4|jpg|jpeg|webp)$/)) {
                    const src = path.join(CARPETA_VIDEOS, file);
                    const dest = path.join(archiveDir, file);
                    try {
                        fs.renameSync(src, dest);
                        movidos++;
                    } catch (e) {
                        // Cross-device link fallback
                        fs.copyFileSync(src, dest);
                        fs.unlinkSync(src);
                        movidos++;
                    }
                }
            }
            console.log(`📦 Archivados ${movidos} items (videos/thumbs) en ${folderName}`);
        }

        // Limpiar alertas antiguas
        sistemaAlertas.limpiarAlertasAntiguas();

    } catch (e) {
        console.error('Error en limpieza semanal:', e.message);
    }
}

async function limpiezaMensualLegacy() {
    try {
        console.log('🗑️ Ejecutando limpieza mensual (Video Retention Policy)...');
        const archiveBase = path.join(CARPETA_BASE, 'archive');
        if (!fs.existsSync(archiveBase)) return;

        const carpetas = fs.readdirSync(archiveBase);
        const hoy = new Date();
        const UN_MES_MS = 30 * 24 * 60 * 60 * 1000;
        let videosEliminados = 0;

        for (const carpeta of carpetas) { // Formato carpeta: YYYY-Www
            // Estimar fecha de la carpeta
            const [year, week] = carpeta.split('-W').map(Number);
            if (!year || !week) continue;

            // Fecha aproximada del inicio de esa semana
            const simpleDate = new Date(year, 0, (week - 1) * 7); // Enero 1 + semanas

            if (hoy - simpleDate > UN_MES_MS) {
                // Carpeta tiene más de 30 días
                const rutaCarpeta = path.join(archiveBase, carpeta);
                const archivos = fs.readdirSync(rutaCarpeta);

                for (const archivo of archivos) {
                    if (archivo.endsWith('.mp4')) {
                        // Eliminar video, dejar thumbnail
                        fs.unlinkSync(path.join(rutaCarpeta, archivo));
                        videosEliminados++;
                    }
                }
            }
        }

        if (videosEliminados > 0) {
            console.log(`🗑️ Se eliminaron ${videosEliminados} videos antiguos de >30 días (Thumbnails conservados).`);
            if (bot) bot.sendMessage(TELEGRAM_CHAT_ID, `🗑️ Limpieza Mensual: ${videosEliminados} videos depurados para ahorrar espacio (Miniaturas conservadas).`);
        }

    } catch (e) {
        console.error('Error en limpieza mensual:', e.message);
    }
}

// ====== CICLO PRINCIPAL (Loop) ======
async function iniciarMonitor() {
    await cargarPalabrasClave();

    while (true) {
        try {
            console.log(`\n--- 🔄 Ciclo: ${new Date().toLocaleTimeString()} ---`);
            let nuevosItems = [];

            // 1. Scraping de Twitter (X Pro)
            try {
                const tweets = await buscarTweetsBrowser();
                if (tweets && tweets.length > 0) nuevosItems.push(...tweets);
            } catch (e) {
                console.error('Error scrapeando Twitter:', e.message);
            }

            // 2. Scraping de Facebook (Meta) — guardado separado
            try {
                const fbPosts = await scrapeFacebookPages();
                if (fbPosts && fbPosts.length > 0) {
                    // Guardar FB posts en su propio archivo JSON
                    const fbHistory = fs.existsSync(FB_SEEN_FILE) ? JSON.parse(fs.readFileSync(FB_SEEN_FILE)) : [];
                    const fbSeenIds = new Set(fbHistory.map(p => p.id));
                    const fbSeenTexts = new Set(fbHistory.map(p => (p.text || '').substring(0, 80).replace(/\W/g, '').toLowerCase()));
                    let fbNewCount = 0;
                    for (const post of fbPosts) {
                        const postKey = (post.text || '').substring(0, 80).replace(/\W/g, '').toLowerCase();
                        if (fbSeenIds.has(post.id)) continue;
                        if (postKey.length > 20 && fbSeenTexts.has(postKey)) continue; // Extra safety layer against dynamic IDs
                        fbHistory.push({
                            id: post.id,
                            handle: post.handle,
                            name: post.name,
                            text: post.text,
                            date: new Date().toISOString(),
                            url: post.url,
                            type: post.isVideo ? 'video' : (post.media && post.media.length > 0 ? 'photo' : 'text'),
                            mediaUrls: post.media || [],
                            source: 'facebook',
                            profileImage: post.profileImage || ''
                        });
                        fbSeenIds.add(post.id);
                        fbNewCount++;

                        // === Enviar a Telegram por sección (keywords) ===
                        try {
                            const postTextLower = (post.text || '').toLowerCase();
                            const postHandleLower = (post.handle || post.name || '').toLowerCase();
                            const fbName = escapeMarkdown(post.name || post.handle || 'Facebook');
                            const fbText = escapeMarkdown((post.text || '').substring(0, 1500));
                            const fbUrl = post.url || '';

                            // Determinar a qué secciones enviar basado en keywords
                            const matchesSection = (keywords) => {
                                for (const kw of keywords) {
                                    const k = kw.toLowerCase();
                                    if (k.startsWith('@') && postHandleLower.includes(k.replace('@', ''))) return true;
                                    if (postTextLower.includes(k)) return true;
                                }
                                return false;
                            };

                            const targets = [];
                            if (matchesSection(allKeywords)) targets.push('default');
                            if (matchesSection(allMediosKeywords)) targets.push('morelos');
                            if (matchesSection(allCuautlaKeywords)) targets.push('cuautla');
                            // Si no matchea ninguna, enviar al default
                            if (targets.length === 0) targets.push('default');

                            for (const canal of targets) {
                                const spec = botsEspecializados[canal];
                                const tgBot = spec ? spec.bot : bot;
                                const tgChatId = spec ? spec.chatId : TELEGRAM_CHAT_ID;
                                if (!tgBot || !tgChatId) continue;

                                let caption = `📘 *${fbName}*\n\n${fbText}`;
                                if (fbUrl && !fbUrl.includes('#post-')) {
                                    caption += `\n\n📘 [Ver Post Face](${fbUrl})`;
                                }

                                let sent = false;

                                // Si tiene imagen, enviar como foto con caption
                                if (post.media && post.media.length > 0 && post.media[0]) {
                                    try {
                                        await tgBot.sendPhoto(tgChatId, post.media[0], {
                                            caption,
                                            parse_mode: 'Markdown'
                                        });
                                        sent = true;
                                    } catch (photoErr) {
                                        console.error(`Error enviando foto FB a ${canal}:`, photoErr.message);
                                    }
                                }

                                // Fallback: texto con preview del link
                                if (!sent) {
                                    await tgBot.sendMessage(tgChatId, caption, {
                                        parse_mode: 'Markdown',
                                        disable_web_page_preview: false
                                    });
                                }

                                console.log(`📘 FB -> ${canal.toUpperCase()}: ${post.name}`);
                            }
                        } catch (tgErr) {
                            console.error('Error enviando post FB a Telegram:', tgErr.message);
                        }
                    }
                    if (fbHistory.length > 5000) fbHistory.splice(0, fbHistory.length - 5000);
                    fs.writeFileSync(FB_SEEN_FILE, JSON.stringify(fbHistory, null, 2));
                    if (fbNewCount > 0) console.log(`📘 ${fbNewCount} nuevos posts de Facebook guardados (total: ${fbHistory.length})`);
                }
            } catch (e) {
                console.error('Error scrapeando Facebook:', e.message);
            }

            // 3. Procesamiento Unificado (solo Twitter)
            if (nuevosItems.length > 0) {
                await procesarTweets(nuevosItems);
            }

            const uptime = Math.floor((Date.now() - startTime) / 1000);
            console.log(`✅ Uptime: ${Math.floor(uptime / 60)}m | Ítems Históricos Procesados: ${tweetsEnviados.size}`);

        } catch (e) {
            console.error('💥 Error global en el ciclo:', e.message);
            crashCount++;
            if (crashCount > MAX_CRASH_RETRIES) process.exit(1);
        }

        await new Promise(r => setTimeout(r, CHECK_INTERVAL_MS));
    }
}

// ====== SCHEDULER (Interval Independent) ======
let pressSynthesisDoneToday = null;
let mananeraDoneToday = null;

function isWithinTimeRange(now, inicioStr, finStr) {
    if (!inicioStr || !finStr) return false;
    const [hInicio, mInicio] = inicioStr.split(':').map(Number);
    const [hFin, mFin] = finStr.split(':').map(Number);
    const currentMins = now.getHours() * 60 + now.getMinutes();
    const startMins = hInicio * 60 + mInicio;
    const endMins = hFin * 60 + mFin;
    return currentMins >= startMins && currentMins <= endMins;
}

function getSintesisHorarios() {
    try {
        const SINTESIS_CONFIG_FILE = path.join(__dirname, 'sintesis_keywords.json');
        if (fs.existsSync(SINTESIS_CONFIG_FILE)) {
            const data = fs.readFileSync(SINTESIS_CONFIG_FILE, 'utf8');
            const parsed = JSON.parse(data);
            if (parsed.horarios) return parsed.horarios;
        }
    } catch (e) { }
    // Default fallback
    return {
        sintesis: { inicio: "06:00", fin: "10:00" },
        mananera: { inicio: "11:30", fin: "14:30" }
    };
}

setInterval(() => {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    const horarios = getSintesisHorarios();

    // Entre horarios programados: Intentar Síntesis de Prensa cada 15 minutos (aprox)
    const withinSintesisHours = isWithinTimeRange(now, horarios.sintesis.inicio, horarios.sintesis.fin);
    if (withinSintesisHours && (now.getMinutes() % 15 < 2) && pressSynthesisDoneToday !== todayStr) {
        console.log(`🗞️ Intentando Síntesis de Prensa (${now.getHours()}:${now.getMinutes()})...`);
        scrapeDailyPress()
            .then(ExtractedData => {
                if (ExtractedData) {
                    // Calculamos matematicamente 15 minutos antes del final como hard cutoff
                    const [hFin, mFin] = horarios.sintesis.fin.split(':').map(Number);
                    const endMins = hFin * 60 + mFin;
                    const currentMins = now.getHours() * 60 + now.getMinutes();
                    const isHardCutoff = currentMins >= (endMins - 15);
                    if (ExtractedData.isComplete || ExtractedData.pendingCount <= 1 || isHardCutoff) {
                        pressSynthesisDoneToday = todayStr;
                        console.log('✅ Medios listos o límite de tiempo alcanzado. Generando...');
                        return generateSynthesis();
                    } else {
                        console.log(`⏳ Faltan ${ExtractedData.pendingCount} medios. Reintentando en 15 mins.`);
                        return null;
                    }
                }
            })
            .then(sintesisFinal => {
                if (sintesisFinal && bot) {
                    // Split the synthesis into parts if it exceeds Telegram's limit
                    const partes = sintesisFinal.split('===');
                    partes.forEach((parte, index) => {
                        if (parte.trim().length > 0) {
                            setTimeout(() => {
                                bot.sendMessage(TELEGRAM_CHAT_ID, parte.trim(), { parse_mode: 'Markdown' }).catch(err => {
                                    console.error(`💥 Error enviando parte ${index + 1} de la síntesis: ${err.message}`);
                                });
                            }, index * 1000); // 1 sec delay between messages
                        }
                    });
                }
            })
            .catch(e => console.error('💥 Error global en Síntesis de Prensa:', e.message));
    }

    // Entre horario programado: Intentar La Mañanera cada 20 minutos
    const withinMananeraHours = isWithinTimeRange(now, horarios.mananera.inicio, horarios.mananera.fin);
    if (withinMananeraHours && (now.getMinutes() % 20 < 2) && mananeraDoneToday !== todayStr) {
        console.log(`🇲🇽 Intentando escanear La Mañanera del Pueblo (${now.getHours()}:${now.getMinutes()})...`);
        processAndSendMananera()
            .then(resumenText => {
                if (resumenText) {
                    console.log('✅ PDF de La Mañanera localizado y procesado con IA exitosamente.');
                    mananeraDoneToday = todayStr; // Prevent further runs today
                } else {
                    console.log('⏳ Aún no suben el PDF de La Mañanera o faltó texto. Reintentando en 20 mins.');
                }
            })
            .catch(e => console.error('💥 Error global en La Mañanera:', e.message));
    }

    // Diario 9:00 PM: Reporte Diario
    if (now.getHours() === 21 && now.getMinutes() < 2) {
        // Solo generar si no se ha generado hoy (check simple en memoria o log)
        console.log('📄 Generando Reporte Diario...');
        exportador.generarReporteDiario(estadisticas, metricasMock, sistemaAlertas)
            .then(rutas => {
                if (bot) {
                    const msg = exportador.generarReporteTelegramExportacion('diario', rutas);
                    bot.sendMessage(TELEGRAM_CHAT_ID, msg, { parse_mode: 'Markdown' });
                    // Enviar archivo físico
                    if (rutas.excel) bot.sendDocument(TELEGRAM_CHAT_ID, rutas.excel);
                }
            })
            .catch(e => console.error('Error reporte diario:', e));
    }

    // Viernes 6:00 PM: Reporte Semanal (Legacy Stats)
    if (now.getDay() === 5 && now.getHours() === 18 && now.getMinutes() < 2) {
        console.log('📊 Generando Reporte Semanal...');
        const fechaInicio = new Date();
        fechaInicio.setDate(fechaInicio.getDate() - 7);
        const fechaFin = new Date();

        exportador.generarReporteSemanal(
            fechaInicio.toISOString().split('T')[0],
            fechaFin.toISOString().split('T')[0]
        ).then(rutas => {
            if (bot) {
                const msg = exportador.generarReporteTelegramExportacion('semanal', rutas);
                bot.sendMessage(TELEGRAM_CHAT_ID, msg, { parse_mode: 'Markdown' });
                if (rutas.json) bot.sendDocument(TELEGRAM_CHAT_ID, rutas.json);
            }
        }).catch(e => console.error('Error reporte semanal:', e));
    }

    // Lunes 3:00 AM: Limpieza Semanal (Archivado)
    if (now.getDay() === 1 && now.getHours() === 3 && now.getMinutes() < 2) {
        limpiezaSemanalLegacy();
    }

    // Día 1 de cada mes a las 4:00 AM: Limpieza Mensual (Borrado Videos viejos)
    if (now.getDate() === 1 && now.getHours() === 4 && now.getMinutes() < 2) {
        limpiezaMensualLegacy();
    }
}, 60000 * 2); // Chequear cada 2 mins

iniciarMonitor();

