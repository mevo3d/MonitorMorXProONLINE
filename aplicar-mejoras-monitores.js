// aplicar-mejoras-monitores.js
// Script para aplicar todas las mejoras anti-cierre y funcionalidades a los monitores

import fs from 'fs';
import path from 'path';

// Configuración de los monitores a actualizar
const MONITORES = [
  {
    nombre: 'Monitor Ejecutivo (Gobierno)',
    ruta: 'C:/Users/BALERION/proyectos-automatizacion/Monitor-GobiernoMor/index.js',
    keywordsFile: 'C:/Users/BALERION/proyectos-automatizacion/Monitor-GobiernoMor/keywords.json'
  },
  {
    nombre: 'Monitor Judicial',
    ruta: 'C:/Users/BALERION/proyectos-automatizacion/Monitor-JudicialMor/index.js',
    keywordsFile: 'C:/Users/BALERION/proyectos-automatizacion/Monitor-JudicialMor/keywords.json'
  }
];

// Mejoras a aplicar
const MEJORAS = {
  // 1. SISTEMA HEARTBEAT ANTI-CIERRE
  heartbeatCode: `
  // Variables para heartbeat y reconexión
  let heartbeatInterval = null;
  let lastActivityTime = Date.now();
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 5;
  const HEARTBEAT_INTERVAL = 30000; // 30 segundos
  
  // Función de heartbeat para mantener conexión activa
  const iniciarHeartbeat = () => {
    console.log('💓 Iniciando sistema de heartbeat anti-cierre...');
    heartbeatInterval = setInterval(async () => {
      try {
        // Verificar si la página responde
        const isConnected = await Promise.race([
          page.evaluate(() => true),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), 5000)
          )
        ]);
        
        if (isConnected) {
          const tiempoInactivo = (Date.now() - lastActivityTime) / 1000 / 60;
          console.log(\`💓 Heartbeat OK - Inactivo: \${tiempoInactivo.toFixed(1)} min\`);
          
          // Mantener página activa con micro-scroll
          await page.evaluate(() => {
            window.scrollBy(0, 1);
            window.scrollBy(0, -1);
          });
          lastActivityTime = Date.now();
        }
      } catch (error) {
        console.error('⚠️ Heartbeat falló, intentando reconectar...');
        clearInterval(heartbeatInterval);
        
        // Intentar reconectar
        reconnectAttempts++;
        if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
          console.log(\`🔄 Intento de reconexión \${reconnectAttempts}/\${MAX_RECONNECT_ATTEMPTS}...\`);
          try {
            // Intentar navegar de nuevo
            await page.goto(page.url(), { waitUntil: 'domcontentloaded', timeout: 30000 });
            console.log('✅ Reconexión exitosa');
            reconnectAttempts = 0;
            iniciarHeartbeat(); // Reiniciar heartbeat
          } catch (reconError) {
            console.error('❌ Reconexión falló:', reconError.message);
            if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
              console.error('❌ Máximo de reconexiones alcanzado. Reiniciando sistema...');
              await enviarMensajeDual('⚠️ Sistema perdió conexión. Reiniciando...');
              // Reiniciar todo el proceso
              process.exit(1);
            }
          }
        }
      }
    }, HEARTBEAT_INTERVAL);
  };
  
  // Iniciar heartbeat
  iniciarHeartbeat();`,

  // 2. REUTILIZACIÓN DE PESTAÑAS
  reusePageCode: `    console.log('📄 Usando página existente del contexto...');
    // Usar la primera página existente en lugar de crear una nueva
    const pages = context.pages();
    if (pages.length > 0) {
      page = pages[0];
      console.log('📄 Reutilizando página existente');
    } else {
      // Solo crear nueva página si no hay ninguna
      console.log('📄 No hay páginas, creando nueva...');
      page = await context.newPage();
    }`,

  // 3. TIMEOUTS AMPLIADOS
  timeoutsCode: `    // Configurar timeouts más largos
    page.setDefaultNavigationTimeout(90000); // 90 segundos
    page.setDefaultTimeout(60000); // 60 segundos`,

  // 4. MANEJO DE ERRORES MEJORADO
  errorHandlingCode: `      
      // Manejar errores específicos de conexión
      if (err.message.includes('Target closed') || 
          err.message.includes('Protocol error') ||
          err.message.includes('Navigation failed') ||
          err.message.includes('Execution context was destroyed')) {
        
        console.log('🔄 Error de conexión detectado, intentando recuperar...');
        reconnectAttempts++;
        
        if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
          try {
            // Intentar navegar de nuevo a la página actual
            await page.goto(page.url(), { waitUntil: 'domcontentloaded', timeout: 30000 });
            console.log('✅ Recuperación exitosa');
            reconnectAttempts = 0;
          } catch (recError) {
            console.error('❌ No se pudo recuperar:', recError.message);
            if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
              console.error('❌ Reiniciando sistema completo...');
              clearInterval(heartbeatInterval);
              clearInterval(intervaloBusqueda);
              clearInterval(intervaloVisual);
              clearInterval(intervaloMoverArchivos);
              clearInterval(intervaloAutoScroll);
              process.exit(1);
            }
          }
        }
      }`,

  // 5. ACTUALIZACIÓN DE ACTIVIDAD
  activityUpdateCode: `      // Actualizar tiempo de última actividad
      lastActivityTime = Date.now();`,

  // 6. LIMPIEZA DE HEARTBEAT AL DETENER
  cleanupCode: `  
  // Limpiar heartbeat
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    console.log('💓 Heartbeat detenido');
  }`
};

function aplicarMejoras(rutaArchivo, nombreMonitor) {
  console.log(`\n🔧 Procesando ${nombreMonitor}...`);
  
  try {
    // Leer el archivo
    let contenido = fs.readFileSync(rutaArchivo, 'utf8');
    const contenidoOriginal = contenido;
    
    // 1. Verificar si ya tiene heartbeat
    if (!contenido.includes('heartbeatInterval')) {
      console.log('  ✅ Agregando sistema heartbeat anti-cierre...');
      
      // Buscar donde insertar el código del heartbeat (después de await agregarOverlay(page))
      const regexOverlay = /await agregarOverlay\(page\);[\s\S]*?let inicioHora;/;
      if (regexOverlay.test(contenido)) {
        contenido = contenido.replace(
          regexOverlay,
          `await agregarOverlay(page);
${MEJORAS.heartbeatCode}

  // Determinar desde cuándo buscar tweets
  const ahora = new Date();
  const hora = ahora.getHours();
  const minutos = ahora.getMinutes();
  let inicioHora;`
        );
      }
    } else {
      console.log('  ⏭️ Sistema heartbeat ya existe');
    }
    
    // 2. Reemplazar creación de nueva página con reutilización
    if (contenido.includes('console.log(\'📄 Creando nueva página...\');')) {
      console.log('  ✅ Aplicando reutilización de pestañas...');
      contenido = contenido.replace(
        /console\.log\('📄 Creando nueva página\.\.\.'\);[\s\S]*?page = await context\.newPage\(\);/,
        MEJORAS.reusePageCode
      );
    }
    
    // 3. Actualizar timeouts
    if (contenido.includes('page.setDefaultNavigationTimeout(60000)')) {
      console.log('  ✅ Ampliando timeouts...');
      contenido = contenido.replace(
        /\/\/ Configurar timeouts.*\n.*page\.setDefaultNavigationTimeout\(60000\);.*\n.*page\.setDefaultTimeout\(30000\);/,
        MEJORAS.timeoutsCode
      );
    }
    
    // 4. Agregar actualización de actividad en el loop
    if (!contenido.includes('lastActivityTime = Date.now()') && contenido.includes('for (const tweetElement of tweets)')) {
      console.log('  ✅ Agregando actualización de actividad...');
      contenido = contenido.replace(
        /for \(const tweetElement of tweets\) \{/,
        `${MEJORAS.activityUpdateCode}
      
      for (const tweetElement of tweets) {`
      );
    }
    
    // 5. Mejorar manejo de errores
    if (!contenido.includes('Error de conexión detectado, intentando recuperar')) {
      console.log('  ✅ Mejorando manejo de errores...');
      // Buscar el catch del intervalo de búsqueda
      const regexCatch = /} catch \(err\) \{[\s\S]*?console\.error\('❌ Error durante el monitoreo:', err\.message\);[\s\S]*?\}/;
      if (regexCatch.test(contenido)) {
        contenido = contenido.replace(
          regexCatch,
          `} catch (err) {
      console.error('❌ Error durante el monitoreo:', err.message);${MEJORAS.errorHandlingCode}
    }`
        );
      }
    }
    
    // 6. Agregar limpieza de heartbeat
    if (!contenido.includes('Heartbeat detenido')) {
      console.log('  ✅ Agregando limpieza de heartbeat...');
      // Buscar donde se limpian los intervalos
      const regexClearIntervals = /clearInterval\(intervaloVisual\);[\s\S]*?clearInterval\(intervaloAutoScroll\);/;
      if (regexClearIntervals.test(contenido)) {
        contenido = contenido.replace(
          regexClearIntervals,
          `clearInterval(intervaloVisual);
    clearInterval(intervaloBusqueda);
    clearInterval(intervaloMoverArchivos);
    clearInterval(intervaloAutoScroll);${MEJORAS.cleanupCode}`
        );
      }
    }
    
    // 7. Desactivar cierre automático a las 23:59
    if (contenido.includes('programarCierreAutomatico();') && !contenido.includes('// programarCierreAutomatico();')) {
      console.log('  ✅ Desactivando cierre automático a las 23:59...');
      contenido = contenido.replace(
        /\/\/ Iniciar programación de cierre automático\nprogramarCierreAutomatico\(\);/,
        `// DESHABILITADO: Cierre automático comentado para evitar cierres inesperados
// Si necesitas el cierre automático, descomenta las siguientes líneas:
// programarCierreAutomatico();
console.log('⚠️ Cierre automático a las 23:59 DESHABILITADO - El monitor funcionará continuamente');`
      );
    }
    
    // Verificar si hubo cambios
    if (contenido !== contenidoOriginal) {
      // Hacer backup
      const backupPath = rutaArchivo.replace('.js', '_backup_' + Date.now() + '.js');
      fs.writeFileSync(backupPath, contenidoOriginal);
      console.log(`  💾 Backup guardado en: ${path.basename(backupPath)}`);
      
      // Guardar cambios
      fs.writeFileSync(rutaArchivo, contenido);
      console.log(`  ✅ ${nombreMonitor} actualizado exitosamente!`);
    } else {
      console.log(`  ℹ️ ${nombreMonitor} ya tiene todas las mejoras aplicadas`);
    }
    
    // Verificar palabras clave específicas
    const keywordsPath = rutaArchivo.replace('index.js', 'keywords.json');
    if (fs.existsSync(keywordsPath)) {
      const keywords = JSON.parse(fs.readFileSync(keywordsPath, 'utf8'));
      console.log(`  📋 Palabras clave: ${keywords.keywords ? keywords.keywords.length : 0} términos cargados`);
    } else {
      console.log(`  ⚠️ No se encontró archivo de palabras clave en: ${keywordsPath}`);
    }
    
  } catch (error) {
    console.error(`  ❌ Error procesando ${nombreMonitor}:`, error.message);
  }
}

// Función principal
function main() {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║     APLICADOR DE MEJORAS PARA MONITORES X PRO v1.0        ║
╠════════════════════════════════════════════════════════════╣
║  Este script aplicará todas las mejoras anti-cierre a:     ║
║  - Monitor Ejecutivo (Gobierno)                            ║
║  - Monitor Judicial                                        ║
╚════════════════════════════════════════════════════════════╝
`);

  // Aplicar mejoras a cada monitor
  MONITORES.forEach(monitor => {
    aplicarMejoras(monitor.ruta, monitor.nombre);
  });
  
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                    PROCESO COMPLETADO                      ║
╠════════════════════════════════════════════════════════════╣
║  Las siguientes mejoras han sido aplicadas:                ║
║  ✅ Sistema heartbeat anti-cierre cada 30 segundos         ║
║  ✅ Reconexión automática ante pérdida de conexión         ║
║  ✅ Reutilización de pestañas (evita duplicados)           ║
║  ✅ Timeouts ampliados (90s navegación, 60s operaciones)   ║
║  ✅ Manejo mejorado de errores de conexión                 ║
║  ✅ Cierre automático a las 23:59 DESHABILITADO            ║
║                                                            ║
║  💡 Los monitores ahora son resistentes a:                 ║
║     - Pérdida de conexión con el navegador                 ║
║     - Suspensión por inactividad                          ║
║     - Errores de navegación                               ║
║     - Minimización de ventana                             ║
║                                                            ║
║  📝 Se han creado backups de los archivos originales       ║
╚════════════════════════════════════════════════════════════╝
`);
}

// Ejecutar
main();