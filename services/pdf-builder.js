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

    // Estilos CSS corporativos avanzados (igualados al PDF Legacy pero modernos)
    const headerTitle = data.fechas || `SÍNTESIS DE PRENSA ${targetDateStr.split('-').reverse().join(' DE ')}`;

    const css = `
        @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;700;900&display=swap');
        
        @page {
            margin: 0;
            size: letter;
        }
        
        body { 
            font-family: 'Roboto', 'Arial', sans-serif; 
            margin: 0; 
            padding: 0;
            color: #333; 
            line-height: 1.5; 
            font-size: 16px; 
            background: #fff;
        }
        
        .page-container {
            padding: 40px 50px;
        }

        /* HEADER PRINCIPAL (Se inserta solo en la primera página por Playwright o manualmente) */
        .pdf-header {
            background-color: #D9D9D9;
            padding: 20px 40px;
            font-family: 'Arial', sans-serif;
            margin-bottom: 30px;
            display: flex;
            align-items: center;
            justify-content: flex-start;
            border-bottom: 5px solid #D50000;
        }

        .header-column {
            display: flex;
            flex-direction: column;
        }

        .header-rojo {
            color: #D50000;
            text-transform: uppercase;
            font-size: 32px;
            font-weight: 900;
            margin: 0;
            letter-spacing: 1px;
        }
        
        .header-azul {
            color: #2F69C3;
            text-transform: uppercase;
            font-size: 24px;
            font-weight: 900;
            margin: 0;
        }
        
        .header-fecha {
            color: #FBC02D;
            background-color: #333; /* Fondo oscuro para contrastar con amarillo si se desea, o texto directo */
            display: inline-block;
            padding: 4px 10px;
            font-weight: bold;
            font-size: 14px;
            margin-top: 5px;
            border-radius: 3px;
        }

        /* SEPARADORES Y CATEGORIAS */
        .seccion-titulo { 
            color: #D50000; 
            text-transform: uppercase; 
            border-bottom: 2px solid #CCCCCC; 
            padding-bottom: 5px; 
            margin-top: 35px; 
            margin-bottom: 20px;
            font-size: 16px; 
            font-weight: bold;
            page-break-after: avoid;
        }
        
        /* NOTAS PERIODÍSTICAS */
        .nota-item { 
            display: flex;
            align-items: flex-start;
            margin-bottom: 25px; 
            page-break-inside: avoid;
            text-align: justify;
        }

        .nota-logo {
            flex-shrink: 0;
            width: 70px;
            height: 70px;
            background-color: #f1f1f1;
            border: 2px solid #ddd;
            margin-right: 18px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 11px;
            text-align: center;
            color: #555;
            font-weight: bold;
            box-shadow: 2px 2px 5px rgba(0,0,0,0.1);
            overflow: hidden;
            text-transform: uppercase;
        }

        .nota-content {
            flex: 1;
        }
        
        .nota-fuente { 
            font-weight: bold; 
            text-decoration: underline; 
            color: #000; 
            text-transform: uppercase;
        }
        
        .nota-titulo { 
            font-weight: bold; 
            color: #000;
            margin-left: 5px;
        }
        
        .nota-resumen { 
            margin-top: 8px; 
            color: #444; 
            font-size: 15px; /* Bigger sub-text */
            padding-left: 2px;
        }
        
        .nota-link {
            color: #2F69C3;
            text-decoration: none;
            font-size: 12px;
            margin-left: 5px;
        }

        /* PORTADAS */
        .portadas-wrapper { text-align: center; }
        .portada-titulo {
            background: #D9D9D9; 
            padding: 10px; 
            font-weight: bold; 
            color: #000;
            margin-bottom: 20px;
        }
        .portada-img { 
            max-width: 90%; 
            max-height: 850px; 
            display: block; 
            margin: 0 auto; 
            box-shadow: 0 4px 8px rgba(0,0,0,0.1); 
            border: 1px solid #ccc;
        }
    `;

    let html = `
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <style>${css}</style>
        </head>
        <body>
            <!-- Portada Cover Oficial similar a Legacy -->
            <div class="pdf-header">
                <div class="header-column">
                    <div class="header-rojo">SÍNTESIS DE PRENSA</div>
                    <div class="header-azul">SÍNTESIS DE PRENSA</div>
                    <div class="header-fecha">${headerTitle}</div>
                </div>
            </div>
            <div class="page-container">
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
            html += `<div class="seccion-titulo">${humanLabels[cat]}</div>`;
            items.forEach((item, index) => {
                let linkHTML = '';
                if (item.enlaces && item.enlaces.length > 0) {
                    linkHTML = `<a class="nota-link" href="${item.enlaces[0]}" target="_blank">[Ver fuente original]</a>`;
                }

                // Formatear titulares que traigan la fuente pegada (a veces falla la IA)
                let renderFuente = item.medios;
                let renderTitulo = item.titulo;

                html += `
                    <div class="nota-item">
                        <div class="nota-logo">
                            ${renderFuente}
                        </div>
                        <div class="nota-content">
                            <div>
                                <span class="nota-fuente">${renderFuente}:</span> 
                                <span class="nota-titulo">${renderTitulo}</span>
                                ${linkHTML}
                            </div>
                            <div class="nota-resumen">${item.resumen}</div>
                        </div>
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
            html += `</div> <!-- Close Text Container -->
                     <div class="portadas-wrapper">`;

            for (const f of files) {
                const imgPath = path.join(portadasDir, f);
                const ext = path.extname(f).toLowerCase().replace('.', '');
                const mime = ext === 'jpg' || ext === 'jpeg' ? 'jpeg' : ext;
                const base64 = fs.readFileSync(imgPath).toString('base64');
                const titleStr = f.toUpperCase().replace('.JPG', '').replace('.PNG', '').replace(targetDateStr + '-', '');

                html += `<div style="page-break-before: always; padding-top: 40px;">
                        <div class="portada-titulo">${titleStr}</div>
                        <img class="portada-img" src="data:image/${mime};base64,${base64}" />
                    </div>`;
            }
            html += `</div>`;
        } else {
            html += `</div> <!-- Close Text Container -->`;
        }
    } else {
        html += `</div> <!-- Close Text Container -->`;
    }

    html += `</body></html>`;

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
