import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dayjs from 'dayjs';
import dotenv from 'dotenv';

dotenv.config({ path: '/root/MonitorMorXPro/.env', override: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Rutas de Datos
const TWEETS_FILE = path.join(__dirname, 'tweets-seen.json');
const KEYWORDS_FILE = path.join(__dirname, 'keywords.json');
const SECRETS_FILE = path.join(__dirname, 'secrets.json');
const PM2_LOG_FILE = '/root/.pm2/logs/monitor-x-v2-out.log';
const FACEBOOK_PAGES_FILE = path.join(__dirname, 'facebook-pages.json'); // New config file para FB
const KEYWORDS_MEDIOS_FILE = path.join(__dirname, 'keywords-medios.json');
const KEYWORDS_CUAUTLA_FILE = path.join(__dirname, 'keywords-cuautla.json');
const FB_SEEN_FILE = path.join(__dirname, 'facebook-seen.json');
const SINTESIS_CONFIG_FILE = path.join(__dirname, 'sintesis_keywords.json');

// ====== HELPERS ======

function loadTweets() {
    if (!fs.existsSync(TWEETS_FILE)) return [];
    return JSON.parse(fs.readFileSync(TWEETS_FILE, 'utf8'));
}

function loadKeywords() {
    if (!fs.existsSync(KEYWORDS_FILE)) return { categorias: {} };
    return JSON.parse(fs.readFileSync(KEYWORDS_FILE, 'utf8'));
}

function loadMediosKeywords() {
    if (!fs.existsSync(KEYWORDS_MEDIOS_FILE)) return { categorias: {} };
    return JSON.parse(fs.readFileSync(KEYWORDS_MEDIOS_FILE, 'utf8'));
}

function loadCuautlaKeywords() {
    if (!fs.existsSync(KEYWORDS_CUAUTLA_FILE)) return { categorias: {} };
    return JSON.parse(fs.readFileSync(KEYWORDS_CUAUTLA_FILE, 'utf8'));
}

function loadFbPosts() {
    if (!fs.existsSync(FB_SEEN_FILE)) return [];
    try { return JSON.parse(fs.readFileSync(FB_SEEN_FILE, 'utf8')); } catch (e) { return []; }
}

// Clasificar un tweet por categoría de medios
function clasificarPorMedios(tweetText, tweetHandle, keywords) {
    const text = (tweetText || '').toLowerCase();
    const handle = (tweetHandle || '').toLowerCase();
    const cats = keywords.categorias || {};
    const result = {};
    for (const cat of Object.keys(cats)) result[cat] = false;

    for (const [cat, palabras] of Object.entries(cats)) {
        if (!Array.isArray(palabras)) continue;
        for (const palabra of palabras) {
            const p = palabra.toLowerCase();
            // Check handle matches (for @mentions)
            if (p.startsWith('@') && handle.includes(p.replace('@', ''))) {
                result[cat] = true;
                break;
            }
            if (text.includes(p)) {
                result[cat] = true;
                break;
            }
        }
    }
    return result;
}

// Check if a tweet matches ANY medios keyword
function matchesMediosKeywords(tweetText, tweetHandle, keywords) {
    const clf = clasificarPorMedios(tweetText, tweetHandle, keywords);
    return Object.values(clf).some(v => v);
}

// Clasificar un tweet por poder basándose en keywords
function clasificarPorPoder(tweetText, keywords) {
    const text = (tweetText || '').toLowerCase();
    const result = { legislativo: false, gobierno: false, judicial: false };

    const cats = keywords.categorias || {};
    for (const [poder, palabras] of Object.entries(cats)) {
        if (!Array.isArray(palabras)) continue;
        for (const palabra of palabras) {
            if (text.includes(palabra.toLowerCase())) {
                // Mapear nombre de categoría a poder
                if (['legislativo'].includes(poder)) result.legislativo = true;
                else if (['gobierno', 'ejecutivo'].includes(poder)) result.gobierno = true;
                else if (['judicial'].includes(poder)) result.judicial = true;
                break; // Una coincidencia es suficiente para este poder
            }
        }
    }
    return result;
}

// ====== ENDPOINT: Estadísticas Reales ======
app.get('/api/stats', (req, res) => {
    try {
        const allTweets = loadTweets();
        const keywords = loadKeywords();

        // Filtrar tweets legacy "migrated" y "desconocido"
        const SKIP = ['migrated', 'desconocido', '@migrated', '@desconocido'];
        const tweets = allTweets.filter(t =>
            !SKIP.includes(t.handle) &&
            t.text !== 'migrated' && t.name !== 'migrated'
        );

        if (tweets.length === 0) {
            return res.json({
                totalTweets: 0, totalMedios: 0,
                topMedios: [], conteoPorPoder: {},
                palabrasClaveTop: [], horasMasActivas: []
            });
        }

        // 1. Top Medios (por handle) - contar tweets por usuario
        const handleCount = {};
        const handleNames = {};
        const handleAvatars = {};
        for (const t of tweets) {
            if (!t.handle) continue;
            const h = t.handle.replace('@', '');
            if (!h) continue;
            handleCount[h] = (handleCount[h] || 0) + 1;
            if (t.name) handleNames[h] = t.name;
            if (t.profileImage && !handleAvatars[h]) handleAvatars[h] = t.profileImage;
        }

        const topMedios = Object.entries(handleCount)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([handle, count]) => ({
                handle: '@' + handle,
                nombre: handleNames[handle] || handle,
                tweets: count,
                profileImage: handleAvatars[handle] || null
            }));

        // 2. Distribución por Poder (usando keywords reales)
        const conteoPorPoder = { legislativo: 0, gobierno: 0, judicial: 0, otros: 0 };
        for (const t of tweets) {
            const clf = clasificarPorPoder(t.text, keywords);
            if (clf.legislativo) conteoPorPoder.legislativo++;
            if (clf.gobierno) conteoPorPoder.gobierno++;
            if (clf.judicial) conteoPorPoder.judicial++;
            if (!clf.legislativo && !clf.gobierno && !clf.judicial) conteoPorPoder.otros++;
        }

        // 3. Palabras Clave más mencionadas (buscar en todos los tweets)
        const kwCount = {};
        const allKws = [];
        for (const catPalabras of Object.values(keywords.categorias || {})) {
            if (Array.isArray(catPalabras)) allKws.push(...catPalabras);
        }
        // Solo contar keywords que NO sean handles (@)
        const searchableKws = allKws.filter(k => !k.startsWith('@') && k.length > 3);

        for (const t of tweets) {
            const text = (t.text || '').toLowerCase();
            for (const kw of searchableKws) {
                if (text.includes(kw.toLowerCase())) {
                    kwCount[kw] = (kwCount[kw] || 0) + 1;
                }
            }
        }

        const palabrasClaveTop = Object.entries(kwCount)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 15)
            .map(([palabra, count]) => ({ palabra, count }));

        // 4. Horas más activas
        const horaCount = {};
        for (const t of tweets) {
            if (t.date) {
                const hora = new Date(t.date).getHours();
                const horaStr = hora + ':00';
                horaCount[horaStr] = (horaCount[horaStr] || 0) + 1;
            }
        }
        const horasMasActivas = Object.entries(horaCount)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([hora, count]) => ({ hora, count }));

        // 5. Medios únicos
        const mediosUnicos = new Set(tweets.map(t => (t.handle || '').replace('@', '')));

        // 6. Temas por medio (para Top Medios)
        // Para cada top medio, buscar qué keywords aparecen más en sus tweets
        for (const medio of topMedios) {
            const handleClean = medio.handle.replace('@', '');
            const medioTweets = tweets.filter(t => (t.handle || '').replace('@', '') === handleClean);
            const temaCount = {};
            for (const t of medioTweets) {
                const text = (t.text || '').toLowerCase();
                for (const kw of searchableKws.slice(0, 50)) { // Limitar para performance
                    if (text.includes(kw.toLowerCase())) {
                        temaCount[kw] = (temaCount[kw] || 0) + 1;
                    }
                }
            }
            medio.temas = Object.entries(temaCount)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([tema]) => tema);
        }

        res.json({
            totalTweets: tweets.length,
            totalMedios: mediosUnicos.size,
            topMedios,
            conteoPorPoder,
            palabrasClaveTop,
            horasMasActivas,
            fecha: new Date().toISOString()
        });
    } catch (e) {
        console.error('Error en /api/stats:', e);
        res.status(500).json({ error: e.message });
    }
});

// ====== ENDPOINT: Síntesis de Prensa ======
app.get('/api/synthesis/today', (req, res) => {
    try {
        const todayStr = dayjs().format('YYYYMMDD');
        const synthesisFile = path.join(__dirname, 'downloads', 'sintesis', todayStr, 'sintesis_final.txt');
        if (fs.existsSync(synthesisFile)) {
            const content = fs.readFileSync(synthesisFile, 'utf8');
            res.json({ success: true, content, date: dayjs().toISOString() });
        } else {
            res.json({ success: false, message: 'La síntesis de hoy aún no ha sido generada.' });
        }
    } catch (e) {
        console.error('Error en /api/synthesis/today:', e.message);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/synthesis/download-pdf', async (req, res) => {
    try {
        const todayStr = dayjs().format('YYYY-MM-DD');
        const pdfFile = path.join(__dirname, 'downloads', 'sintesis', todayStr.replace(/-/g, ''), `SINTESIS_PRENSA_${todayStr.replace(/-/g, '')}.pdf`);

        if (fs.existsSync(pdfFile)) {
            res.download(pdfFile);
        } else {
            // Generar PDF al vuelo si no existe
            const builder = await import('./services/pdf-builder.js');
            const newPdfPath = await builder.buildPdf(todayStr);
            if (newPdfPath && fs.existsSync(newPdfPath)) {
                res.download(newPdfPath);
            } else {
                res.status(404).json({ error: 'Primero debes generar la síntesis web antes de poder descargar el PDF.' });
            }
        }
    } catch (e) {
        console.error('Error enviando PDF:', e.message);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/synthesis/status', (req, res) => {
    try {
        const todayStr = dayjs().format('YYYYMMDD');
        const rawFile = path.join(__dirname, 'downloads', 'sintesis', todayStr, 'raw_extraction.json');

        let status = { locales: {}, nacionales: {} };
        if (fs.existsSync(rawFile)) {
            const results = JSON.parse(fs.readFileSync(rawFile, 'utf8'));
            // Map true/false based on if text is populated
            for (const key of Object.keys(results.locales || {})) {
                status.locales[key] = !!results.locales[key];
            }
            for (const key of Object.keys(results.nacionales || {})) {
                status.nacionales[key] = !!results.nacionales[key];
            }
        }
        res.json({ success: true, status });
    } catch (e) {
        console.error('Error en /api/synthesis/status:', e.message);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/synthesis/mananera', (req, res) => {
    try {
        const todayStr = dayjs().format('YYYYMMDD');
        const mananeraFile = path.join(__dirname, 'downloads', 'sintesis', todayStr, 'mananera.json');

        if (fs.existsSync(mananeraFile)) {
            const data = JSON.parse(fs.readFileSync(mananeraFile, 'utf8'));
            res.json(data);
        } else {
            res.json({ success: false, message: 'El resumen de La Mañanera de hoy aún no ha sido generado.' });
        }
    } catch (e) {
        console.error('Error en /api/synthesis/mananera:', e.message);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/synthesis/generate', async (req, res) => {
    try {
        const scraper = await import('./press-scraper.js');
        const generator = await import('./synthesis-generator.js');
        const extracted = await scraper.scrapeDailyPress();
        if (extracted.isComplete || extracted.pendingCount < 5) {
            const finalStr = await generator.generateSynthesis();
            res.json({ success: true, content: finalStr, status: extracted });
        } else {
            res.json({ success: false, message: `Aún faltan muchos medios (${extracted.pendingCount} pendientes). Intenta más tarde.`, status: extracted });
        }
    } catch (e) {
        console.error('Error generando síntesis on-demand:', e.message);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/synthesis/config', (req, res) => {
    try {
        if (!fs.existsSync(SINTESIS_CONFIG_FILE)) {
            res.json({
                columnistas_destacados: [],
                temas_clave: [],
                medios_requeridos: {},
                horarios: {
                    sintesis: { inicio: "06:00", fin: "10:00" },
                    mananera: { inicio: "11:30", fin: "14:30" }
                }
            });
            return;
        }
        const data = fs.readFileSync(SINTESIS_CONFIG_FILE, 'utf8');
        const parsed = JSON.parse(data);

        // Ensure horarios exists for backward compatibility
        if (!parsed.horarios) {
            parsed.horarios = {
                sintesis: { inicio: "06:00", fin: "10:00" },
                mananera: { inicio: "11:30", fin: "14:30" }
            };
        }

        res.json(parsed);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/synthesis/config', (req, res) => {
    try {
        const config = req.body;
        fs.writeFileSync(SINTESIS_CONFIG_FILE, JSON.stringify(config, null, 2));
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ====== ENDPOINT: Configuración Facebook ======
app.get('/api/config/facebook', (req, res) => {
    try {
        if (!fs.existsSync(FACEBOOK_PAGES_FILE)) {
            return res.json({ pages: [], cookies: [] });
        }
        res.json(JSON.parse(fs.readFileSync(FACEBOOK_PAGES_FILE, 'utf8')));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/config/facebook/pages', (req, res) => {
    try {
        let config = { pages: [], cookies: [] };
        if (fs.existsSync(FACEBOOK_PAGES_FILE)) {
            config = JSON.parse(fs.readFileSync(FACEBOOK_PAGES_FILE, 'utf8'));
        }
        config.pages = req.body.pages || [];
        fs.writeFileSync(FACEBOOK_PAGES_FILE, JSON.stringify(config, null, 2));
        res.json({ success: true, totalPages: config.pages.length });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/config/facebook/cookies', (req, res) => {
    try {
        let config = { pages: [], cookies: [] };
        if (fs.existsSync(FACEBOOK_PAGES_FILE)) {
            config = JSON.parse(fs.readFileSync(FACEBOOK_PAGES_FILE, 'utf8'));
        }
        config.cookies = req.body.cookies || [];
        fs.writeFileSync(FACEBOOK_PAGES_FILE, JSON.stringify(config, null, 2));
        res.json({ success: true, totalCookies: config.cookies.length });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ====== ENDPOINT: Estadísticas Facebook ======
app.get('/api/stats/facebook', (req, res) => {
    try {
        const fbPosts = loadFbPosts();
        if (fbPosts.length === 0) {
            return res.json({ totalPosts: 0, topPages: [] });
        }

        const pageCount = {};
        const pageNames = {};
        const pageAvatars = {};

        for (const p of fbPosts) {
            if (!p.handle) continue;
            const h = p.handle;
            pageCount[h] = (pageCount[h] || 0) + 1;
            if (p.name) pageNames[h] = p.name;
            if (p.profileImage && !pageAvatars[h]) pageAvatars[h] = p.profileImage;
        }

        const topPages = Object.entries(pageCount)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([handle, count]) => ({
                handle,
                nombre: pageNames[handle] || handle,
                posts: count,
                profileImage: pageAvatars[handle] || null
            }));

        res.json({
            totalPosts: fbPosts.length,
            topPages,
            fecha: new Date().toISOString()
        });
    } catch (e) {
        console.error('Error en /api/stats/facebook:', e);
        res.status(500).json({ error: e.message });
    }
});

// ====== ENDPOINT: Posts de Facebook ======
app.get('/api/posts/facebook', (req, res) => {
    try {
        if (fs.existsSync(FB_SEEN_FILE)) {
            let data = JSON.parse(fs.readFileSync(FB_SEEN_FILE, 'utf8'));

            if (req.query.keyword) {
                const searchKw = req.query.keyword.toLowerCase();
                data = data.filter(p => (p.text || '').toLowerCase().includes(searchKw));
            }

            const limit = parseInt(req.query.limit) || 100;
            const sorted = [...data].reverse().slice(0, limit);
            res.json(sorted);
        } else {
            res.json([]);
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ====== ENDPOINT: Estadísticas Medios (Zona Oriente) ======
app.get('/api/stats/medios', (req, res) => {
    try {
        const allTweets = loadTweets();
        const mediosKw = loadMediosKeywords();

        const SKIP = ['migrated', 'desconocido', '@migrated', '@desconocido'];
        const allFiltered = allTweets.filter(t =>
            !SKIP.includes(t.handle) &&
            t.text !== 'migrated' && t.name !== 'migrated'
        );

        // Only tweets matching medios keywords
        const tweets = allFiltered.filter(t => matchesMediosKeywords(t.text, t.handle, mediosKw));

        if (tweets.length === 0) {
            return res.json({
                totalTweets: 0, totalMedios: 0,
                topMedios: [], conteoPorCategoria: {},
                palabrasClaveTop: [], horasMasActivas: []
            });
        }

        // Top Medios
        const handleCount = {};
        const handleNames = {};
        const handleAvatars = {};
        for (const t of tweets) {
            if (!t.handle) continue;
            const h = t.handle.replace('@', '');
            if (!h) continue;
            handleCount[h] = (handleCount[h] || 0) + 1;
            if (t.name) handleNames[h] = t.name;
            if (t.profileImage && !handleAvatars[h]) handleAvatars[h] = t.profileImage;
        }
        const topMedios = Object.entries(handleCount)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([handle, count]) => ({
                handle: '@' + handle,
                nombre: handleNames[handle] || handle,
                tweets: count,
                profileImage: handleAvatars[handle] || null
            }));

        // Distribución por categoría de medios
        const conteoPorCategoria = {};
        for (const cat of Object.keys(mediosKw.categorias || {})) conteoPorCategoria[cat] = 0;
        for (const t of tweets) {
            const clf = clasificarPorMedios(t.text, t.handle, mediosKw);
            for (const [cat, matched] of Object.entries(clf)) {
                if (matched) conteoPorCategoria[cat]++;
            }
        }

        // Palabras clave top
        const allKws = [];
        for (const catPalabras of Object.values(mediosKw.categorias || {})) {
            if (Array.isArray(catPalabras)) allKws.push(...catPalabras);
        }
        const searchableKws = allKws.filter(k => !k.startsWith('@') && k.length > 3);
        const kwCount = {};
        for (const t of tweets) {
            const text = (t.text || '').toLowerCase();
            for (const kw of searchableKws) {
                if (text.includes(kw.toLowerCase())) {
                    kwCount[kw] = (kwCount[kw] || 0) + 1;
                }
            }
        }
        const palabrasClaveTop = Object.entries(kwCount)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 15)
            .map(([palabra, count]) => ({ palabra, count }));

        // Horas más activas
        const horaCount = {};
        for (const t of tweets) {
            if (t.date) {
                const hora = new Date(t.date).getHours();
                horaCount[hora + ':00'] = (horaCount[hora + ':00'] || 0) + 1;
            }
        }
        const horasMasActivas = Object.entries(horaCount)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([hora, count]) => ({ hora, count }));

        const mediosUnicos = new Set(tweets.map(t => (t.handle || '').replace('@', '')));

        res.json({
            totalTweets: tweets.length,
            totalMedios: mediosUnicos.size,
            topMedios,
            conteoPorCategoria,
            palabrasClaveTop,
            horasMasActivas,
            fecha: new Date().toISOString()
        });
    } catch (e) {
        console.error('Error en /api/stats/medios:', e);
        res.status(500).json({ error: e.message });
    }
});

// ====== ENDPOINT: Historial de Tweets (Con Filtros) ======
app.get('/api/tweets', (req, res) => {
    try {
        if (fs.existsSync(TWEETS_FILE)) {
            let data = JSON.parse(fs.readFileSync(TWEETS_FILE, 'utf8'));

            // 1. Filtrar Legacy si no se pide explícitamente
            const SKIP = ['migrated', 'desconocido', '@migrated', '@desconocido'];
            data = data.filter(t => !SKIP.includes(t.handle) && t.text !== 'migrated');

            // 2. Filtro por Handle (Usuario)
            if (req.query.handle) {
                const searchHandle = req.query.handle.toLowerCase().replace('@', '');
                data = data.filter(t => (t.handle || '').toLowerCase().replace('@', '').includes(searchHandle));
            }

            // 3. Filtro por Keyword (Texto)
            if (req.query.keyword) {
                const searchKw = req.query.keyword.toLowerCase();
                data = data.filter(t => (t.text || '').toLowerCase().includes(searchKw));
            }

            const limit = parseInt(req.query.limit) || 100;
            // Más recientes primero
            const sorted = [...data].reverse().slice(0, limit);
            res.json(sorted);
        } else {
            res.json([]);
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ====== ENDPOINT: Tweets filtrados por Medios ======
app.get('/api/tweets/medios', (req, res) => {
    try {
        if (fs.existsSync(TWEETS_FILE)) {
            let data = JSON.parse(fs.readFileSync(TWEETS_FILE, 'utf8'));
            const mediosKw = loadMediosKeywords();

            const SKIP = ['migrated', 'desconocido', '@migrated', '@desconocido'];
            data = data.filter(t => !SKIP.includes(t.handle) && t.text !== 'migrated');

            // Filter only tweets matching medios keywords
            data = data.filter(t => matchesMediosKeywords(t.text, t.handle, mediosKw));

            if (req.query.handle) {
                const searchHandle = req.query.handle.toLowerCase().replace('@', '');
                data = data.filter(t => (t.handle || '').toLowerCase().replace('@', '').includes(searchHandle));
            }
            if (req.query.keyword) {
                const searchKw = req.query.keyword.toLowerCase();
                data = data.filter(t => (t.text || '').toLowerCase().includes(searchKw));
            }

            const limit = parseInt(req.query.limit) || 100;
            const sorted = [...data].reverse().slice(0, limit);
            res.json(sorted);
        } else {
            res.json([]);
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ====== ENDPOINT: Estadísticas Detalladas por Usuario ======
app.get('/api/stats/user/:handle', (req, res) => {
    try {
        const handle = req.params.handle.toLowerCase().replace('@', '');
        const tweets = loadTweets().filter(t => (t.handle || '').toLowerCase().replace('@', '') === handle);

        if (tweets.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });

        const stats = {
            total: tweets.length,
            firstTweet: tweets[tweets.length - 1]?.date,
            lastTweet: tweets[0]?.date,
            byDay: {},
            byWeek: {},
            byMonth: {}
        };

        tweets.forEach(t => {
            const d = dayjs(t.date);
            if (!d.isValid()) return;

            const dayKey = d.format('YYYY-MM-DD');
            const weekKey = d.format('YYYY-w');
            const monthKey = d.format('YYYY-MM');

            stats.byDay[dayKey] = (stats.byDay[dayKey] || 0) + 1;
            stats.byWeek[weekKey] = (stats.byWeek[weekKey] || 0) + 1;
            stats.byMonth[monthKey] = (stats.byMonth[monthKey] || 0) + 1;
        });

        res.json(stats);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ====== ENDPOINT: Descargar Archivo de Texto ======
app.get('/api/archive/:handle', (req, res) => {
    try {
        const handle = req.params.handle.toLowerCase().replace('@', '');
        const tweets = loadTweets().filter(t => (t.handle || '').toLowerCase().replace('@', '') === handle);

        let content = `HISTORIAL DE TWEETS: @${handle}\n`;
        content += `Generado: ${new Date().toISOString()}\n`;
        content += `Total Tweets: ${tweets.length}\n`;
        content += `===========================================\n\n`;

        tweets.forEach(t => {
            content += `[${dayjs(t.date).format('DD/MM/YYYY HH:mm')}] ${t.name} (@${t.handle})\n`;
            content += `${t.text}\n`;
            content += `Media: ${t.mediaUrls?.join(', ') || 'N/A'}\n`;
            content += `Link: https://x.com/i/status/${t.id}\n`;
            content += `-------------------------------------------\n\n`;
        });

        res.setHeader('Content-disposition', `attachment; filename=tweets_${handle}.txt`);
        res.setHeader('Content-type', 'text/plain');
        res.send(content);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ====== ENDPOINT: Configuración (Categorías) ======
app.get('/api/config', (req, res) => {
    try {
        if (fs.existsSync(KEYWORDS_FILE)) {
            const config = JSON.parse(fs.readFileSync(KEYWORDS_FILE, 'utf8'));
            // Calcular total
            let total = 0;
            if (config.categorias) {
                Object.values(config.categorias).forEach(arr => total += arr.length);
            }
            res.json({ categorias: config.categorias, totalKeywords: total });
        } else {
            res.status(404).json({ error: 'Configuración no encontrada' });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ====== ENDPOINT: Configuración (Facebook Pages) ======
app.get('/api/config/facebook', (req, res) => {
    try {
        if (fs.existsSync(FACEBOOK_PAGES_FILE)) {
            const config = JSON.parse(fs.readFileSync(FACEBOOK_PAGES_FILE, 'utf8'));
            res.json({ success: true, pages: config.pages || [], cookies: config.cookies || [] });
        } else {
            res.json({ success: true, pages: [], cookies: [] });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ====== ENDPOINT: Guardar Facebook Pages ======
app.post('/api/config/facebook', (req, res) => {
    try {
        const { pages, cookies } = req.body;

        let existingConfig = { pages: [], cookies: [] };
        if (fs.existsSync(FACEBOOK_PAGES_FILE)) {
            try {
                const data = JSON.parse(fs.readFileSync(FACEBOOK_PAGES_FILE, 'utf8'));
                existingConfig.pages = Array.isArray(data.pages) ? data.pages : [];
                existingConfig.cookies = Array.isArray(data.cookies) ? data.cookies : [];
            } catch (e) { }
        }

        const newConfig = {
            pages: Array.isArray(pages) ? pages : existingConfig.pages,
            cookies: Array.isArray(cookies) ? cookies : existingConfig.cookies
        };

        fs.writeFileSync(FACEBOOK_PAGES_FILE, JSON.stringify(newConfig, null, 2));

        console.log(`📝 Facebook Config guardada. Páginas: ${newConfig.pages.length}, Cookies: ${newConfig.cookies.length}`);
        res.json({ success: true, message: 'Configuración guardada' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ====== ENDPOINT: Guardar Keywords ======
app.post('/api/config/keywords', (req, res) => {
    try {
        const { categorias } = req.body;
        if (!categorias) return res.status(400).json({ error: 'Falta objeto categorias' });

        const newConfig = { categorias };
        fs.writeFileSync(KEYWORDS_FILE, JSON.stringify(newConfig, null, 2));

        let total = 0;
        Object.values(categorias).forEach(arr => total += arr.length);

        console.log(`📝 Keywords actualizadas. Total: ${total}`);
        res.json({ success: true, totalKeywords: total });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ====== ENDPOINT: Configuración (Medios Keywords) ======
app.get('/api/config/medios', (req, res) => {
    try {
        if (fs.existsSync(KEYWORDS_MEDIOS_FILE)) {
            const config = JSON.parse(fs.readFileSync(KEYWORDS_MEDIOS_FILE, 'utf8'));
            let total = 0;
            if (config.categorias) {
                Object.values(config.categorias).forEach(arr => total += arr.length);
            }
            res.json({ categorias: config.categorias, totalKeywords: total });
        } else {
            res.json({ categorias: {}, totalKeywords: 0 });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/config/keywords-medios', (req, res) => {
    try {
        const { categorias } = req.body;
        if (!categorias) return res.status(400).json({ error: 'Falta objeto categorias' });

        const existing = fs.existsSync(KEYWORDS_MEDIOS_FILE)
            ? JSON.parse(fs.readFileSync(KEYWORDS_MEDIOS_FILE, 'utf8'))
            : {};
        const newConfig = { ...existing, categorias };
        fs.writeFileSync(KEYWORDS_MEDIOS_FILE, JSON.stringify(newConfig, null, 2));

        let total = 0;
        Object.values(categorias).forEach(arr => total += arr.length);

        console.log(`📝 Keywords Medios actualizadas. Total: ${total}`);
        res.json({ success: true, totalKeywords: total });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ====== ENDPOINTS: Cuautla y Zona Oriente ======
app.get('/api/stats/cuautla', (req, res) => {
    try {
        const allTweets = loadTweets();
        const cuautlaKw = loadCuautlaKeywords();
        const SKIP = ['migrated', 'desconocido', '@migrated', '@desconocido'];
        const allFiltered = allTweets.filter(t => !SKIP.includes(t.handle) && t.text !== 'migrated' && t.name !== 'migrated');
        const tweets = allFiltered.filter(t => matchesMediosKeywords(t.text, t.handle, cuautlaKw));

        if (tweets.length === 0) {
            return res.json({ totalTweets: 0, totalMedios: 0, topMedios: [], conteoPorCategoria: {}, palabrasClaveTop: [], horasMasActivas: [] });
        }

        const handleCount = {};
        const handleNames = {};
        const handleAvatars = {};
        for (const t of tweets) {
            if (!t.handle) continue;
            const h = t.handle.replace('@', '');
            if (!h) continue;
            handleCount[h] = (handleCount[h] || 0) + 1;
            if (t.name) handleNames[h] = t.name;
            if (t.profileImage && !handleAvatars[h]) handleAvatars[h] = t.profileImage;
        }
        const topMedios = Object.entries(handleCount).sort((a, b) => b[1] - a[1]).slice(0, 10)
            .map(([handle, count]) => ({ handle: '@' + handle, nombre: handleNames[handle] || handle, tweets: count, profileImage: handleAvatars[handle] || null }));

        const conteoPorCategoria = {};
        for (const cat of Object.keys(cuautlaKw.categorias || {})) conteoPorCategoria[cat] = 0;
        for (const t of tweets) {
            const clf = clasificarPorMedios(t.text, t.handle, cuautlaKw);
            for (const [cat, matched] of Object.entries(clf)) { if (matched) conteoPorCategoria[cat]++; }
        }

        const allKws = [];
        for (const catPalabras of Object.values(cuautlaKw.categorias || {})) { if (Array.isArray(catPalabras)) allKws.push(...catPalabras); }
        const searchableKws = allKws.filter(k => !k.startsWith('@') && k.length > 3);
        const kwCount = {};
        for (const t of tweets) {
            const text = (t.text || '').toLowerCase();
            for (const kw of searchableKws) { if (text.includes(kw.toLowerCase())) kwCount[kw] = (kwCount[kw] || 0) + 1; }
        }
        const palabrasClaveTop = Object.entries(kwCount).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([palabra, count]) => ({ palabra, count }));

        const horaCount = {};
        for (const t of tweets) { if (t.date) { const hora = new Date(t.date).getHours(); horaCount[hora + ':00'] = (horaCount[hora + ':00'] || 0) + 1; } }
        const horasMasActivas = Object.entries(horaCount).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([hora, count]) => ({ hora, count }));

        const mediosUnicos = new Set(tweets.map(t => (t.handle || '').replace('@', '')));
        res.json({ totalTweets: tweets.length, totalMedios: mediosUnicos.size, topMedios, conteoPorCategoria, palabrasClaveTop, horasMasActivas, fecha: new Date().toISOString() });
    } catch (e) {
        console.error('Error en /api/stats/cuautla:', e);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/tweets/cuautla', (req, res) => {
    try {
        if (fs.existsSync(TWEETS_FILE)) {
            let data = JSON.parse(fs.readFileSync(TWEETS_FILE, 'utf8'));
            const cuautlaKw = loadCuautlaKeywords();
            const SKIP = ['migrated', 'desconocido', '@migrated', '@desconocido'];
            data = data.filter(t => !SKIP.includes(t.handle) && t.text !== 'migrated');
            data = data.filter(t => matchesMediosKeywords(t.text, t.handle, cuautlaKw));
            if (req.query.handle) { const sh = req.query.handle.toLowerCase().replace('@', ''); data = data.filter(t => (t.handle || '').toLowerCase().replace('@', '').includes(sh)); }
            if (req.query.keyword) { const sk = req.query.keyword.toLowerCase(); data = data.filter(t => (t.text || '').toLowerCase().includes(sk)); }
            const limit = parseInt(req.query.limit) || 100;
            res.json([...data].reverse().slice(0, limit));
        } else { res.json([]); }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/config/cuautla', (req, res) => {
    try {
        if (fs.existsSync(KEYWORDS_CUAUTLA_FILE)) {
            const config = JSON.parse(fs.readFileSync(KEYWORDS_CUAUTLA_FILE, 'utf8'));
            let total = 0;
            if (config.categorias) { Object.values(config.categorias).forEach(arr => total += arr.length); }
            res.json({ categorias: config.categorias, totalKeywords: total });
        } else { res.json({ categorias: {}, totalKeywords: 0 }); }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/config/keywords-cuautla', (req, res) => {
    try {
        const { categorias } = req.body;
        if (!categorias) return res.status(400).json({ error: 'Falta objeto categorias' });
        const existing = fs.existsSync(KEYWORDS_CUAUTLA_FILE) ? JSON.parse(fs.readFileSync(KEYWORDS_CUAUTLA_FILE, 'utf8')) : {};
        const newConfig = { ...existing, categorias };
        fs.writeFileSync(KEYWORDS_CUAUTLA_FILE, JSON.stringify(newConfig, null, 2));
        let total = 0;
        Object.values(categorias).forEach(arr => total += arr.length);
        console.log(`📝 Keywords Cuautla actualizadas. Total: ${total}`);
        res.json({ success: true, totalKeywords: total });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ====== ENDPOINTS: Facebook ======
app.get('/api/stats/facebook', (req, res) => {
    try {
        const posts = loadFbPosts();
        if (posts.length === 0) {
            return res.json({ totalPosts: 0, totalPaginas: 0, topPaginas: [], postsPorDia: [], postsPorTipo: {}, ultimaActualizacion: null });
        }

        // Top Páginas (con profileImage)
        const handleData = {};
        for (const p of posts) {
            const h = p.handle || p.name || 'desconocido';
            if (!handleData[h]) handleData[h] = { count: 0, profileImage: '' };
            handleData[h].count++;
            if (p.profileImage && !handleData[h].profileImage) handleData[h].profileImage = p.profileImage;
        }
        const topPaginas = Object.entries(handleData).sort((a, b) => b[1].count - a[1].count).slice(0, 10)
            .map(([pagina, data]) => ({ pagina, posts: data.count, profileImage: data.profileImage }));

        // Posts por día (últimos 7 días)
        const postsPorDia = {};
        for (const p of posts) {
            if (p.date) {
                const day = dayjs(p.date).format('YYYY-MM-DD');
                postsPorDia[day] = (postsPorDia[day] || 0) + 1;
            }
        }
        const diasOrdenados = Object.entries(postsPorDia).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 7)
            .map(([dia, count]) => ({ dia, count })).reverse();

        // Posts por tipo
        const postsPorTipo = { text: 0, photo: 0, video: 0 };
        for (const p of posts) {
            const tipo = p.type || 'text';
            postsPorTipo[tipo] = (postsPorTipo[tipo] || 0) + 1;
        }

        const paginasUnicas = new Set(posts.map(p => p.handle || p.name));
        const ultimoPost = posts[posts.length - 1];

        res.json({
            totalPosts: posts.length,
            totalPaginas: paginasUnicas.size,
            topPaginas,
            postsPorDia: diasOrdenados,
            postsPorTipo,
            ultimaActualizacion: ultimoPost?.date || null
        });
    } catch (e) {
        console.error('Error en /api/stats/facebook:', e);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/posts/facebook', (req, res) => {
    try {
        let data = loadFbPosts();
        if (req.query.pagina) {
            const search = req.query.pagina.toLowerCase();
            data = data.filter(p => ((p.handle || p.name || '')).toLowerCase().includes(search));
        }
        if (req.query.keyword) {
            const kw = req.query.keyword.toLowerCase();
            data = data.filter(p => (p.text || '').toLowerCase().includes(kw));
        }
        const limit = parseInt(req.query.limit) || 100;
        res.json([...data].reverse().slice(0, limit));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ====== ENDPOINT: Configuración (Facebook) ======
app.get('/api/config/facebook', (req, res) => {
    try {
        const pages = fs.existsSync(FACEBOOK_PAGES_FILE) ? JSON.parse(fs.readFileSync(FACEBOOK_PAGES_FILE, 'utf8')).pages || [] : [];
        const cookiesFile = path.join(__dirname, 'cookies.json');
        let cookies = [];
        if (fs.existsSync(cookiesFile)) {
            try {
                const raw = fs.readFileSync(cookiesFile, 'utf8');
                // cookies.json puede ser un array directo o un objeto con "cookies" key
                const parsed = JSON.parse(raw);
                cookies = Array.isArray(parsed) ? [raw] : (parsed.cookies || [raw]);
            } catch (e) { cookies = []; }
        }
        res.json({ pages, cookies });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/config/facebook/pages', (req, res) => {
    try {
        const { pages } = req.body;
        if (!pages || !Array.isArray(pages)) return res.status(400).json({ error: 'Falta array de pages' });
        // Filtrar páginas vacías
        const validPages = pages.filter(p => p.name && p.url);
        fs.writeFileSync(FACEBOOK_PAGES_FILE, JSON.stringify({ pages: validPages }, null, 2));
        console.log(`📘 Páginas Facebook actualizadas: ${validPages.length} páginas`);
        res.json({ success: true, totalPages: validPages.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/config/facebook/cookies', (req, res) => {
    try {
        const { cookies } = req.body;
        if (!cookies || !Array.isArray(cookies)) return res.status(400).json({ error: 'Falta array de cookies' });
        const cookiesFile = path.join(__dirname, 'cookies.json');
        // Guardar la primera cookie activa como el archivo principal
        if (cookies.length > 0) {
            fs.writeFileSync(cookiesFile, cookies[0]);
        }
        console.log(`🍪 Cookies Facebook actualizadas: ${cookies.length} cuentas`);
        res.json({ success: true, totalCookies: cookies.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ====== ENDPOINT: Configuración (Telegram) ======
app.get('/api/config/telegram', (req, res) => {
    try {
        const envPath = path.join(__dirname, '.env');
        if (fs.existsSync(envPath)) {
            const rawEnv = fs.readFileSync(envPath, 'utf8');
            const lines = rawEnv.split('\n');
            const telegramConfig = {};

            lines.forEach(line => {
                if (line.trim().startsWith('TELEGRAM_')) {
                    const parts = line.split('=');
                    if (parts.length >= 2) {
                        const key = parts[0].trim();
                        const value = parts.slice(1).join('=').trim();
                        telegramConfig[key] = value;
                    }
                }
            });

            res.json({ success: true, config: telegramConfig });
        } else {
            res.json({ success: true, config: {} });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ====== ENDPOINT: Guardar Configuración (Telegram) ======
app.post('/api/config/telegram', (req, res) => {
    try {
        const { config } = req.body;
        if (!config) return res.status(400).json({ error: 'Data was missing.' });

        const envPath = path.join(__dirname, '.env');
        let lines = [];
        if (fs.existsSync(envPath)) {
            lines = fs.readFileSync(envPath, 'utf8').split('\n');
        }

        // Modifica solo las lineas presentes o añade si no existen
        for (const [key, value] of Object.entries(config)) {
            if (!key.startsWith('TELEGRAM_')) continue;

            let found = false;
            let valTrimmed = (value || '').trim();
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].trim().startsWith(`${key}=`)) {
                    lines[i] = `${key}=${valTrimmed}`;
                    found = true;
                    break;
                }
            }
            if (!found) lines.push(`${key}=${valTrimmed}`);
        }

        fs.writeFileSync(envPath, lines.join('\n'));
        console.log(`📝 Telegram Config updated.`);
        res.json({ success: true, message: 'Configuración de Telegram guardada' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ====== ENDPOINT: Probar Configuración (Telegram) ======
app.post('/api/config/telegram/test', async (req, res) => {
    try {
        const token = (req.body.token || '').trim();
        const chatId = (req.body.chatId || '').trim();
        const { channel } = req.body;
        if (!token || !chatId) return res.status(400).json({ error: 'Token y Chat ID son requeridos para la prueba.' });

        const url = `https://api.telegram.org/bot${token}/sendMessage`;
        const channelName = channel === 'DEFAULT' ? 'Global Principal' : `Poder ${channel}`;
        const text = `✅ ¡Prueba de conexión exitosa desde *MonitorMor Pro*!\nEl canal asignado a *${channelName}* está funcionando correctamente. 🚀`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: text,
                parse_mode: 'Markdown'
            })
        });

        const data = await response.json();

        if (data.ok) {
            res.json({ success: true, message: 'Mensaje de prueba enviado correctamente.' });
        } else {
            console.error('Error de Telegram en prueba:', data);
            res.status(400).json({ error: `Error de API Telegram: ${data.description}` });
        }
    } catch (e) {
        console.error('Error probando Telegram:', e.message);
        res.status(500).json({ error: 'Error de red al intentar verificar: ' + e.message });
    }
});

// ====== ENDPOINT: Guardar API Keys ======
app.post('/api/config/save', (req, res) => {
    try {
        const { openaiKey } = req.body;
        if (!openaiKey) return res.status(400).json({ error: 'Falta openaiKey' });

        let secrets = {};
        if (fs.existsSync(SECRETS_FILE)) {
            secrets = JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8'));
        }

        secrets.openaiKey = openaiKey;
        fs.writeFileSync(SECRETS_FILE, JSON.stringify(secrets, null, 2));
        console.log('🔑 API Key guardada correctamente');
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ====== ENDPOINT: IA Chat ======
app.post('/api/ai', async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt) return res.status(400).json({ error: 'Falta prompt' });

        if (!fs.existsSync(SECRETS_FILE)) return res.status(401).json({ error: 'API Key no configurada' });
        const secrets = JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8'));
        if (!secrets.openaiKey) return res.status(401).json({ error: 'API Key no configurada' });

        let contextTweets = [];
        if (fs.existsSync(TWEETS_FILE)) {
            const allTweets = JSON.parse(fs.readFileSync(TWEETS_FILE, 'utf8'));
            contextTweets = allTweets.slice(-50).map(t => `- ${t.handle} (${t.date}): ${t.text}`).join('\n');
        }

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${secrets.openaiKey}`
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: "Eres un analista político experto en el Congreso de Morelos. Responde basándote en los siguientes tweets recientes del monitor legislativo. Sé conciso y objetivo." },
                    { role: "system", content: `CONTEXTO RECIENTE:\n${contextTweets}` },
                    { role: "user", content: prompt }
                ]
            })
        });

        const data = await response.json();

        if (data.error) {
            console.error('OpenAI Error:', data.error);
            return res.status(500).json({ error: data.error.message });
        }

        const reply = data.choices?.[0]?.message?.content || "No pude generar una respuesta.";
        res.json({ reply });

    } catch (e) {
        console.error('AI Error:', e);
        res.status(500).json({ error: e.message });
    }
});

// ====== ENDPOINT: Logs en Tiempo Real ======
app.get('/api/logs', (req, res) => {
    try {
        if (fs.existsSync(PM2_LOG_FILE)) {
            const content = fs.readFileSync(PM2_LOG_FILE, 'utf8');
            const lines = content.trim().split('\n');
            const lastLines = lines.slice(-50).join('\n');
            res.json({ logs: lastLines });
        } else {
            res.json({ logs: 'Esperando logs del sistema...' });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ====== ENDPOINT: Health Check ======
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
});

app.listen(PORT, () => {
    console.log(`🚀 API Server corriendo en puerto ${PORT}`);
});
