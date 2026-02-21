import dotenv from 'dotenv';
dotenv.config();

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
const SEEN_FILE = path.join(__dirname, 'tweets-seen.json');
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

    const canales = ['LEGISLATIVO', 'EJECUTIVO', 'JUDICIAL'];
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

        console.log(`🔍 Listas para buscar: ${allKeywords.length} keywords`);
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

        todosLosTweets = await page.evaluate(() => {
            const articles = document.querySelectorAll('article[data-testid="tweet"]');
            const data = [];
            articles.forEach(article => {
                try {
                    const userEl = article.querySelector('div[data-testid="User-Name"]');
                    const textEl = article.querySelector('div[data-testid="tweetText"]');
                    const timeEl = article.querySelector('time');
                    const linkEl = article.querySelector('a[href*="/status/"]');

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
                            cardUrl, cardImage, cardTitle
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
            const { id, handle, text, name, timestamp, url, media, isVideo, cardUrl, cardImage, cardTitle } = tweet;

            // Filtro de duplicados
            if (tweetsEnviados.has(id)) continue;

            const normalizedText = normalizeText(text);
            const foundKeyword = allKeywords.find(k => normalizedText.includes(normalizeText(k)));

            if (!foundKeyword && !normalizedText.includes('morelos')) continue;

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

                caption += `\n\n🔗 [Ver Tweet](${url})`;

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
                    source: tweet.source || 'twitter'
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

            // 2. Scraping de Facebook (Meta)
            try {
                const fbPosts = await scrapeFacebookPages();
                if (fbPosts && fbPosts.length > 0) nuevosItems.push(...fbPosts);
            } catch (e) {
                console.error('Error scrapeando Facebook:', e.message);
            }

            // 3. Procesamiento Unificado
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
setInterval(() => {
    const now = new Date();

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

