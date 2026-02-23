import axios from 'axios';
import * as cheerio from 'cheerio';

async function checkKiosko() {
    console.log('Fetching kiosko.net/mx');
    const res = await axios.get('https://kiosko.net/mx/', { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const $ = cheerio.load(res.data);

    let papers = [];
    $('.th a').each((i, el) => {
        const title = $(el).find('img').attr('alt') || $(el).attr('title') || $(el).attr('href');
        if (title) papers.push(title.toLowerCase());
    });
    console.log('Found', papers.length, 'newspapers on Kiosko Mexico');

    const targets = ['morelos', 'unión', 'excelsior', 'reforma', 'universal', 'jornada'];
    targets.forEach(target => {
        const found = papers.filter(p => p.includes(target));
        console.log(`Buscando '${target}':`, found.length > 0 ? found : 'NO ENCONTRADO');
    });
}
checkKiosko();
