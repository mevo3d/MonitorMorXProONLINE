import axios from 'axios';

async function testDM() {
    try {
        const res = await axios.get('https://publicaciones.diariodemorelos.com/diario-de-morelos/20260221', {
            maxRedirects: 5
        });
        console.log(res.status, res.headers['content-type']);
        console.log(res.data.substring(0, 500));
    } catch (e) {
        console.error(e.message);
    }
}
testDM();
