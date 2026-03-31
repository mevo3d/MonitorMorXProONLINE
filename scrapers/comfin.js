const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const medios = require('../config/medios');

async function scrapComfin() {
  const notas = [];
  const timestamp = new Date().toISOString();
  const fecha = new Date().toISOString().split('T')[0];

  try {
    console.log('🔍 Scrapeando ComFin PDFs...');

    const response = await axios.get(medios.comfin, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
      timeout: 30000
    });

    const html = response.data;
    const portadasNacionales = [
      { medio: 'Reforma', url: 'https://www.comfin.mx/primerasplanas/reforma.pdf' },
      { medio: 'El Universal', url: 'https://www.comfin.mx/primerasplanas/eluniversal.pdf' },
      { medio: 'Milenio', url: 'https://www.comfin.mx/primerasplanas/mileniodiario.pdf' },
      { medio: 'Excélsior', url: 'https://www.comfin.mx/primerasplanas/excelsior.pdf' },
      { medio: 'La Jornada', url: 'https://www.comfin.mx/primerasplanas/lajornada.pdf' },
      { medio: 'El Heraldo', url: 'https://www.comfin.mx/primerasplanas/elheraldo.pdf' },
      { medio: 'El Sol de México', url: 'https://www.comfin.mx/primerasplanas/elsoldemexico.pdf' },
      { medio: '24 Horas', url: 'https://www.comfin.mx/primerasplanas/24horas.pdf' },
      { medio: 'El Financiero', url: 'https://www.comfin.mx/primerasplanas/eleconomista.pdf' }
    ];

    console.log(`📰 Procesando ${portadasNacionales.length} medios nacionales...`);

    for (const portada of portadasNacionales) {
      console.log(`📄 ${portada.medio}...`);

      try {
        // Verificar que el PDF sea accesible
        const headResponse = await axios.head(portada.url, {
          timeout: 10000
        });

        if (headResponse.status === 200) {
          notas.push({
            id: uuidv4(),
            medio: portada.medio,
            titulo: `Portada de ${portada.medio} - ${fecha}`,
            resumen: `Portada nacional disponible en PDF - ${portada.url}`,
            url: portada.url,
            tipo: 'portada',
            seccion_sugerida: 'PORTADAS NACIONALES',
            es_columna: false,
            es_portada_nacional: true,
            fecha: fecha,
            timestamp_scraping: timestamp
          });

          console.log(`  ✅ ${portada.medio} - Disponible`);
        } else {
          console.log(`  ❌ ${portada.medio} - No disponible (${headResponse.status})`);
        }

      } catch (error) {
        console.log(`  ❌ ${portada.medio} - Error: ${error.message}`);
      }
    }

    console.log(`\n✅ ComFin: ${notas.length} PDFs encontrados`);

    return {
      exito: true,
      notas: notas
    };

  } catch (error) {
    console.error('❌ Error:', error.message);
    return {
      exito: false,
      error: error.message,
      notas: []
    };
  }
}

if (require.main === module) {
  scrapComfin()
    .then(r => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(r.exito ? 0 : 1);
    })
    .catch(e => {
      console.error(e);
      process.exit(1);
    });
  }

module.exports = scrapComfin;
