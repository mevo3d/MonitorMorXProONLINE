import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dayjs from 'dayjs';

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

// ====== HELPERS ======

function loadTweets() {
    if (!fs.existsSync(TWEETS_FILE)) return [];
    return JSON.parse(fs.readFileSync(TWEETS_FILE, 'utf8'));
}

function loadKeywords() {
    if (!fs.existsSync(KEYWORDS_FILE)) return { categorias: {} };
    return JSON.parse(fs.readFileSync(KEYWORDS_FILE, 'utf8'));
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
        for (const t of tweets) {
            if (!t.handle) continue; // Ignorar tweets sin handle
            const h = t.handle.replace('@', '');
            if (!h) continue;
            handleCount[h] = (handleCount[h] || 0) + 1;
            if (t.name) handleNames[h] = t.name;
        }

        const topMedios = Object.entries(handleCount)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([handle, count]) => ({
                handle: '@' + handle,
                nombre: handleNames[handle] || handle,
                tweets: count
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
