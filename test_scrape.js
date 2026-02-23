import axios from 'axios';
import * as cheerio from 'cheerio';

async function test(url) {
    try {
        console.log("Fetching home...");
        const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const html = res.data;
        const $ = cheerio.load(html);

        const scripts = [];
        $('script').each((i, el) => {
            const src = $(el).attr('src');
            if (src) scripts.push(src);
        });

        console.log("Scripts found:", scripts);

        for (const src of scripts) {
            if (src.includes('main.') || src.includes('app.')) {
                let scriptUrl = src;
                if (!scriptUrl.startsWith('http')) {
                    scriptUrl = 'https://www.elmediodemedios.com' + (src.startsWith('/') ? '' : '/') + src;
                }
                console.log("Fetching script:", scriptUrl);
                const jsRes = await axios.get(scriptUrl);
                const js = jsRes.data;
                const apiMatches = js.match(/https?:\/\/[a-zA-Z0-9.-]+\/wp-json\//g);
                if (apiMatches) {
                    console.log("Found WP API Base in JS:", [...new Set(apiMatches)]);
                }
                const apiMatches2 = js.match(/(https?:\/\/[^\/]+\/api\/[^\"]+)/g);
                if (apiMatches2) {
                    console.log("Found other APIs in JS:", [...new Set(apiMatches2)]);
                }
            }
        }
    } catch (e) {
        console.error("Error", e.message);
    }
}

test('https://www.elmediodemedios.com');
