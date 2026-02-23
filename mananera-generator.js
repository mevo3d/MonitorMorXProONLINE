import OpenAI from 'openai';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config({ override: true });
import dayjs from 'dayjs';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Assuming TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are available in the env when this runs
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

/**
 * Escapes characters for Telegram MarkdownV2 format while preserving custom bold/italics
 */
function cleanMarkdownForTelegram(text) {
    // Basic fallback: just send plain text if MarkdownV2 is too strict, 
    // or use standard markdown if we use parse_mode="Markdown" (V1)
    // We will use parse_mode="Markdown" to keep it simple and compatible with WhatsApp style
    return text;
}

export async function processAndSendMananera(textoExtraido) {
    if (!textoExtraido || textoExtraido.trim().length === 0) {
        console.error("[Mañanera] No text provided to summarize.");
        return false;
    }

    const fechaActual = dayjs().format('DD/MM/YYYY');
    const textoLimitado = textoExtraido.slice(0, 15000); // Limit to ~15k chars to avoid token limits

    const systemPrompt = `🇲🇽 *Eres Morelos GPT*, una inteligencia especializada en análisis político y legislativo con enfoque en el estado de Morelos.

Recibirás documentos correspondientes a la conferencia matutina presidencial (*La Mañanera del Pueblo*) y deberás generar un resumen estructurado, claro y visual, que sea útil para medios, asesores políticos y equipos de análisis legislativo.

🎯 *Objetivo:* Resumir TODOS los temas abordados en bloques temáticos, con claridad, orden visual y estilo compatible con WhatsApp/Telegram. **PRIORIDAD ABSOLUTA**: incluir temas de seguridad, controversias, críticas y decisiones federales importantes. NO omitir nada relevante.

🧩 *Formato del resumen esperado:*

*🇲🇽 La Mañanera del Pueblo – ${fechaActual}*  
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
🔹 *[Si Morelos fue mencionado directamente, forma parte de programas, cifras estatales, decisiones federales, destácalo con contexto político. Si no hay, omite esta sección.]*

*📊 OTROS TEMAS RELEVANTES:*  
🔹 *[Otros]*

⚠️ *INSTRUCCIONES CRÍTICAS:*
- NO OMITIR TEMAS DE SEGURIDAD O POLÉMICAS
- Usar abundantes *negritas*, emojis 🔥⚡🚨 y viñetas (🔹)
- Usa formato compatible con Telegram Markdown (usa * para negritas, _ para cursivas).`;

    try {
        console.log(`[Mañanera] Enviando ${textoLimitado.length} caracteres a OpenAI (gpt-4o-mini)...`);

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini", // Using mini for speed and cost, as it performs excellently for summarization
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `Extrae el resumen completo de este documento:\n\n${textoLimitado}` }
            ],
            temperature: 0.5,
            max_tokens: 2500
        });

        const resumen = response.choices[0].message.content;

        if (!resumen) {
            console.error("[Mañanera] Error: OpenAI returned empty response.");
            return false;
        }

        console.log("[Mañanera] Resumen generado exitosamente. Enviando a Telegram...");

        // Send to Telegram
        if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
            console.error("[Mañanera] Telegram credentials missing. Cannot broadcast.");
            console.log(resumen); // Print to console at least
            return true;
        }

        const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

        // Split if too long (Telegram limit is 4096)
        if (resumen.length > 4000) {
            const parts = resumen.match(/[\s\S]{1,4000}/g) || [];
            for (const part of parts) {
                await axios.post(telegramUrl, {
                    chat_id: TELEGRAM_CHAT_ID,
                    text: part,
                    parse_mode: 'Markdown'
                });
            }
        } else {
            await axios.post(telegramUrl, {
                chat_id: TELEGRAM_CHAT_ID,
                text: resumen,
                parse_mode: 'Markdown'
            });
        }

        console.log("[Mañanera] 📨 Mensaje enviado a Telegram correctamente.");
        return true;

    } catch (error) {
        console.error("[Mañanera] Error durante análisis o envío:", error.message);
        return false;
    }
}
