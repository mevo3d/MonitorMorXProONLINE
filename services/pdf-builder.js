import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function buildPdf(targetDateStr) {
    const rawFile = path.join(__dirname, '../temp', `sintesis-clustered-${targetDateStr}.json`);
    if (!fs.existsSync(rawFile)) {
        console.error(`[PDFBuilder] JSON file no encontrado: ${rawFile}`);
        return null;
    }

    const data = JSON.parse(fs.readFileSync(rawFile, 'utf8'));

    // Estilos CSS para simular el PDF corporativo
    const css = `
        @import url('https://fonts.googleapis.com/css2?family=Calibri:wght@400;700&display=swap');
        body { font-family: 'Calibri', 'Arial', sans-serif; margin: 40px; color: #000; line-height: 1.5; font-size: 14px; }
        h1 { color: #8A0000; text-align: center; text-transform: uppercase; margin-bottom: 30px; font-size: 22px; }
        h2 { color: #8A0000; text-transform: uppercase; border-bottom: 2px solid #8A0000; padding-bottom: 5px; margin-top: 30px; font-size: 18px; }
        .item { margin-bottom: 15px; }
        .medios { font-weight: bold; text-decoration: underline; color: #000; }
        .titulo { font-weight: bold; }
        .nota { margin-top: 5px; text-align: justify; }
        .portada-img { max-width: 100%; height: auto; max-height: 900px; display: block; margin: 0 auto; page-break-after: auto; }
        .portadas-container { text-align: center; }
        a { color: #000; text-decoration: none; }
    `;

    // Fechas (Titulo)
    const headerTitle = data.fechas || `SÍNTESIS DE PRENSA ${targetDateStr}`;

    let html = `
        < !DOCTYPE html >
            <html lang="es">
                <head>
                    <meta charset="UTF-8">
                        <style>${css}</style>
                </head>
                <body>
                    <h1>${headerTitle}</h1>
                    `;

    // Bloques Clásicos
    const categorias = ['CONGRESO', 'GOBIERNO', 'JUDICIAL_SEGURIDAD', 'MUNICIPIOS', 'GENERAL', 'NACIONAL', 'COLUMNAS'];
    const humanLabels = {
        'CONGRESO': 'CONGRESO DEL ESTADO',
        'GOBIERNO': 'GOBIERNO DEL ESTADO',
        'JUDICIAL_SEGURIDAD': 'JUDICIAL, SEGURIDAD Y JUSTICIA',
        'MUNICIPIOS': 'MUNICIPIOS',
        'GENERAL': 'INFORMACIÓN GENERAL',
        'NACIONAL': 'INFORMACIÓN NACIONAL - MÉXICO',
        'COLUMNAS': 'COLUMNAS ESTALES Y NACIONALES'
    };

    for (const cat of categorias) {
        const items = data[cat];
        if (items && items.length > 0) {
            html += `<h2>${humanLabels[cat]}</h2>`;
            items.forEach((item, index) => {
                let linkHTML = '';
                if (item.enlaces && item.enlaces.length > 0) {
                    linkHTML = ` <a href="${item.enlaces[0]}" target="_blank">[Enlace]</a>`;
                }
                html += `
                    <div class="item">
                        <span class="medios">${item.medios}:</span>
                        <span class="titulo">${item.titulo}</span>${linkHTML}
                        <div class="nota">${item.resumen}</div>
                    </div>
                    `;
            });
        }
    }

    // Embed Portadas at the end
    const portadasDir = path.join(__dirname, '../public/portadas');
    if (fs.existsSync(portadasDir)) {
        const files = fs.readdirSync(portadasDir).filter(f => f.startsWith(targetDateStr));
        if (files.length > 0) {
            html += `<h2>PORTADAS MORELOS</h2><div class="portadas-container">`;
            for (const f of files) {
                const imgPath = path.join(portadasDir, f);
                // Convert image to base64 so Chromium local file rules don't block it
                const ext = path.extname(f).toLowerCase().replace('.', '');
                const mime = ext === 'jpg' || ext === 'jpeg' ? 'jpeg' : ext;
                const base64 = fs.readFileSync(imgPath).toString('base64');
                html += `<div style="page-break-before: always; margin-top: 40px;">
                        <h3>${f.toUpperCase().replace('.JPG', '').replace(targetDateStr + '-', '')}</h3>
                        <img class="portada-img" src="data:image/${mime};base64,${base64}" />
                    </div>`;
            }
            html += `</div>`;
        }
    }

    html += `</body></html > `;

    // Generate PDF
    const saveDir = path.join(__dirname, '../downloads/sintesis', targetDateStr.replace(/-/g, ''));
    if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });
    const outPdf = path.join(saveDir, `SINTESIS_PRENSA_${targetDateStr.replace(/-/g, '')}.pdf`);

    console.log(`[PDFBuilder] Lanzando navegador para renderizar PDF...`);
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    // Load local HTML
    await page.setContent(html, { waitUntil: 'networkidle' });

    // Output PDF options
    await page.pdf({
        path: outPdf,
        format: 'Letter',
        printBackground: true,
        margin: { top: '30px', bottom: '30px', left: '30px', right: '30px' },
        displayHeaderFooter: true,
        headerTemplate: '<div style="font-size: 10px; text-align: center; width: 100%; color: #8A0000; font-family: Arial;">Monitor Dual - Congreso de Morelos</div>',
        footerTemplate: '<div style="font-size: 10px; text-align: center; width: 100%; color: #666; font-family: Arial;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'
    });

    await browser.close();
    console.log(`[PDFBuilder] PDF Generado Exitosamente: ${outPdf} `);
    return outPdf;
}

if (process.argv[1] === __filename) {
    // Testing logic
    const today = new Date().toISOString().split('T')[0];
    buildPdf(today).catch(console.error);
}
