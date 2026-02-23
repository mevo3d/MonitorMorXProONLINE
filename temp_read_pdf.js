import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse/lib/pdf-parse.js');

const pdfPath = 'C:/Users/BALERION/Downloads/SÍNTESIS DE PRENSA 20 DE FEBRERO 2026- CONGRESO.pdf';
const dataBuffer = fs.readFileSync(pdfPath);

pdfParse(dataBuffer).then(data => {
    fs.writeFileSync('pdf_extracted.txt', data.text);
    console.log('Done rendering PDF');
}).catch(console.error);
