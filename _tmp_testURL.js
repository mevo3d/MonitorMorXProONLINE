import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import dayjs from 'dayjs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testScraping() {
    const today = dayjs();
    const YYYY = today.format('YYYY');
    const MM = today.format('MM');
    const DD = today.format('DD');
    const YYYYMMDD = today.format('YYYYMMDD');

    console.log(`Testing scraping for ${YYYY}-${MM}-${DD}...`);

    // 1. Lo de Hoy
    const lodehoyUrl = `https://morelos.lodehoy.com.mx/sites/default/files/pdf/${YYYY}-${MM}/${YYYYMMDD}_morelos.pdf`;
    console.log('[Lo de Hoy] URL:', lodehoyUrl);
    try {
        const hRes = await axios.head(lodehoyUrl);
        console.log('[Lo de Hoy] Status:', hRes.status);
    } catch (e) {
        console.error('[Lo de Hoy] Error:', e.message);
    }

    // 2. La Jornada Morelos (19 Feb 2026 = 1166)
    const baseDate = dayjs('2026-02-19');
    const baseEdition = 1166;
    const diffDays = today.diff(baseDate, 'day');
    const edicion = baseEdition + diffDays;
    // Format is LJM-No-01166-02-19-2026.pdf
    const paddedEdicion = edicion.toString().padStart(5, '0');
    const jornadaUrl = `https://www.lajornadamorelos.mx/wp-content/uploads/${YYYY}/${MM}/LJM-No-${paddedEdicion}-${MM}-${DD}-${YYYY}.pdf`;
    console.log('[La Jornada Morelos] URL:', jornadaUrl);
    try {
        const jRes = await axios.head(jornadaUrl);
        console.log('[La Jornada Morelos] Status:', jRes.status);
    } catch (e) {
        console.error('[La Jornada Morelos] Error:', e.message);
    }

    // 3. El Regional
    try {
        const regRes = await axios.get('https://elregional.com.mx/');
        const $ = cheerio.load(regRes.data);
        const links = [];
        $('a').each((i, el) => {
            const text = $(el).text().toLowerCase();
            if (text.includes('edición impresa') || text.includes('edicion impresa')) {
                links.push({ text: text.trim(), href: $(el).attr('href') });
            }
        });
        console.log('[El Regional] Links found:', links);
    } catch (e) {
        console.error('[El Regional] Error:', e.message);
    }
}

testScraping();
