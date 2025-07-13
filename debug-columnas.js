// debug-columnas.js - Script para diagnosticar detección de columnas en X Pro
import { chromium } from 'playwright';
import readline from 'readline';

const USER_DATA_DIR = './sesion-x';

async function debugearColumnas() {
  console.log('🔍 Iniciando debugging de columnas X Pro...');

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, { 
    headless: false,
    viewport: { width: 1920, height: 1080 }
  });
  
  const page = await context.newPage();
  await page.goto('https://pro.x.com', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  // Verificar login
  if (page.url().includes('login')) {
    console.log('❌ No logueado. Haz login manualmente y presiona ENTER para continuar...');
    return;
  }

  console.log('✅ Logueado correctamente');
  await page.waitForTimeout(3000);

  console.log('\n🔍 PASO 1: Detectando TODOS los elementos que podrían ser columnas...');
  
  // Selectores más amplios para encontrar columnas
  const selectoresPosibles = [
    '[data-testid="deckColumn"]',
    '[data-testid="deck"]', 
    '[class*="column"]',
    '[class*="deck"]',
    '[class*="Column"]',
    '[class*="Deck"]',
    'div[role="region"]',
    'section',
    'article[role="region"]',
    'div[style*="width"]',
    '[data-testid*="column"]',
    '[data-testid*="deck"]'
  ];

  for (let i = 0; i < selectoresPosibles.length; i++) {
    const selector = selectoresPosibles[i];
    console.log(`\n📋 Probando selector ${i + 1}/${selectoresPosibles.length}: "${selector}"`);
    
    try {
      const elementos = await page.$$(selector);
      console.log(`   ✅ Encontrados: ${elementos.length} elementos`);
      
      if (elementos.length > 0 && elementos.length < 20) { // Filtrar resultados razonables
        console.log(`   🎯 Analizando contenido de estos ${elementos.length} elementos...`);
        
        for (let j = 0; j < Math.min(elementos.length, 5); j++) {
          try {
            const elemento = elementos[j];
            const texto = await elemento.innerText();
            const html = await elemento.innerHTML();
            
            console.log(`     📄 Elemento ${j + 1}:`);
            console.log(`       📝 Texto (primeros 100 chars): ${texto.substring(0, 100).replace(/\n/g, ' ')}`);
            console.log(`       🏷️  HTML (primeros 150 chars): ${html.substring(0, 150).replace(/\n/g, ' ')}`);
            
            // Buscar headers dentro del elemento
            const headers = await elemento.$$('h1, h2, h3, h4, h5, h6, [role="heading"]');
            if (headers.length > 0) {
              console.log(`       📋 Headers encontrados: ${headers.length}`);
              for (let k = 0; k < Math.min(headers.length, 3); k++) {
                const headerText = await headers[k].innerText();
                console.log(`         🎯 Header ${k + 1}: "${headerText.substring(0, 50)}"`);
              }
            }
          } catch (error) {
            console.log(`     ❌ Error analizando elemento ${j + 1}: ${error.message}`);
          }
        }
      }
    } catch (error) {
      console.log(`   ❌ Error con selector: ${error.message}`);
    }
  }

  console.log('\n🔍 PASO 2: Buscando específicamente nombres de columnas conocidos...');
  
  const nombresEsperados = [
    'Isaac Pimentel',
    '#MediosMorelos', 
    'Congreso Morelos',
    'Medio Morelos',
    'congreso morelos',
    'isaac pimentel'
  ];

  for (const nombre of nombresEsperados) {
    console.log(`\n🎯 Buscando: "${nombre}"`);
    
    try {
      // Buscar texto exacto
      const elementosTexto = await page.$$(`text="${nombre}"`);
      console.log(`   📝 Texto exacto: ${elementosTexto.length} elementos`);
      
      // Buscar texto parcial (case insensitive)
      const elementosTextoCI = await page.$$(`text=/${nombre}/i`);
      console.log(`   📝 Texto parcial (case insensitive): ${elementosTextoCI.length} elementos`);
      
      // Si encontramos elementos, analizar sus padres
      if (elementosTexto.length > 0 || elementosTextoCI.length > 0) {
        const elementos = elementosTexto.length > 0 ? elementosTexto : elementosTextoCI;
        
        for (let i = 0; i < Math.min(elementos.length, 3); i++) {
          try {
            const elemento = elementos[i];
            const padre = await elemento.locator('..').first();
            const abuelo = await elemento.locator('../..').first();
            
            console.log(`     🔍 Elemento ${i + 1}:`);
            console.log(`       📍 Texto del elemento: "${await elemento.innerText()}"`);
            console.log(`       👆 Padre: "${(await padre.innerText()).substring(0, 100)}"`);
            console.log(`       👴 Abuelo: "${(await abuelo.innerText()).substring(0, 100)}"`);
            
            // Buscar atributos relevantes
            const attributes = await elemento.evaluate(el => {
              const attrs = {};
              for (let attr of el.attributes) {
                attrs[attr.name] = attr.value;
              }
              return attrs;
            });
            
            console.log(`       🏷️  Atributos:`, Object.keys(attributes).slice(0, 5));
            
          } catch (error) {
            console.log(`     ❌ Error analizando elemento: ${error.message}`);
          }
        }
      }
    } catch (error) {
      console.log(`   ❌ Error buscando "${nombre}": ${error.message}`);
    }
  }

  console.log('\n🔍 PASO 3: Análisis de estructura DOM general...');
  
  try {
    // Obtener información general de la página
    const bodyHTML = await page.$eval('body', el => el.outerHTML.substring(0, 1000));
    console.log(`📄 HTML del body (primeros 1000 chars):\n${bodyHTML}`);
    
    // Buscar todos los data-testid
    const testIds = await page.$$eval('[data-testid]', elements => 
      [...new Set(elements.map(el => el.getAttribute('data-testid')))].slice(0, 20)
    );
    console.log(`🧪 data-testid encontrados (primeros 20):`, testIds);
    
    // Buscar todas las clases que contengan 'column' o 'deck'
    const clases = await page.$$eval('[class*="column"], [class*="deck"], [class*="Column"], [class*="Deck"]', elements => 
      [...new Set(elements.map(el => el.className))].slice(0, 10)
    );
    console.log(`🎨 Clases relacionadas con columnas/decks:`, clases);
    
  } catch (error) {
    console.log(`❌ Error en análisis DOM: ${error.message}`);
  }

  console.log('\n✅ Debugging completado. Revisa la información anterior para identificar los selectores correctos.');
  console.log('💡 Presiona ENTER para cerrar...');
  
  // Esperar input del usuario
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  
  rl.question('', async () => {
    await context.close();
    rl.close();
    process.exit(0);
  });
}

debugearColumnas().catch(console.error);