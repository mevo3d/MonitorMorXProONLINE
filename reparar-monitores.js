// reparar-monitores.js
// Script para reparar los monitores con sintaxis correcta

import fs from 'fs';

const MONITORES = [
  'C:/Users/BALERION/proyectos-automatizacion/Monitor-GobiernoMor/index.js',
  'C:/Users/BALERION/proyectos-automatizacion/Monitor-JudicialMor/index.js'
];

function repararMonitor(rutaArchivo) {
  console.log(`🔧 Reparando: ${rutaArchivo}`);
  
  try {
    let contenido = fs.readFileSync(rutaArchivo, 'utf8');
    
    // 1. AGREGAR SISTEMA HEARTBEAT después de await agregarOverlay(page);
    if (!contenido.includes('heartbeatInterval')) {
      console.log('  ✅ Agregando sistema heartbeat...');
      
      const heartbeatCode = `
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
  iniciarHeartbeat();

`;
      
      // Buscar donde insertar heartbeat
      const regexInsert = /(await agregarOverlay\(page\);[\s\S]*?)(\n\n\s*\/\/ Determinar desde cuándo buscar tweets)/;
      if (regexInsert.test(contenido)) {
        contenido = contenido.replace(regexInsert, `$1${heartbeatCode}$2`);
      }
    }
    
    // 2. REEMPLAZAR CREACIÓN DE PÁGINA
    if (contenido.includes(`console.log('📄 Creando nueva página...');`)) {
      console.log('  ✅ Corrigiendo creación de página...');
      contenido = contenido.replace(
        /console\.log\('📄 Creando nueva página\.\.\.'\);\s*page = await context\.newPage\(\);/,
        `console.log('📄 Usando página existente del contexto...');
    // Usar la primera página existente en lugar de crear una nueva
    const pages = context.pages();
    if (pages.length > 0) {
      page = pages[0];
      console.log('📄 Reutilizando página existente');
    } else {
      // Solo crear nueva página si no hay ninguna
      console.log('📄 No hay páginas, creando nueva...');
      page = await context.newPage();
    }`
      );
    }
    
    // 3. AMPLIAR TIMEOUTS
    if (contenido.includes('page.setDefaultNavigationTimeout(60000)')) {
      console.log('  ✅ Ampliando timeouts...');
      contenido = contenido.replace(
        /\/\/ Configurar timeouts.*\n\s*page\.setDefaultNavigationTimeout\(60000\);\s*\n\s*page\.setDefaultTimeout\(30000\);/,
        `// Configurar timeouts más largos
    page.setDefaultNavigationTimeout(90000); // 90 segundos
    page.setDefaultTimeout(60000); // 60 segundos`
      );
    }
    
    // 4. AGREGAR ACTUALIZACIÓN DE ACTIVIDAD
    if (!contenido.includes('lastActivityTime = Date.now()') && contenido.includes('for (const tweetElement of tweets)')) {
      console.log('  ✅ Agregando actualización de actividad...');
      contenido = contenido.replace(
        /(for \(const tweetElement of tweets\) \{)/,
        `      // Actualizar tiempo de última actividad
      lastActivityTime = Date.now();
      
      $1`
      );
    }
    
    // 5. MEJORAR MANEJO DE ERRORES EN INTERVALO DE BÚSQUEDA
    if (!contenido.includes('Error de conexión detectado, intentando recuperar')) {
      console.log('  ✅ Mejorando manejo de errores...');
      // Buscar el patrón del catch en el intervalo de búsqueda
      const regexErrorHandling = /(} catch \(err\) \{\s*console\.error\('❌ Error durante el monitoreo:', err\.message\);[\s\S]*?)(}\s*}, 30000\);)/;
      if (regexErrorHandling.test(contenido)) {
        contenido = contenido.replace(
          regexErrorHandling,
          `} catch (err) {
      console.error('❌ Error durante el monitoreo:', err.message);
      
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
      }
    $2`
        );
      }
    }
    
    // 6. AGREGAR LIMPIEZA DE HEARTBEAT
    if (!contenido.includes('Heartbeat detenido')) {
      console.log('  ✅ Agregando limpieza de heartbeat...');
      const regexClearIntervals = /(clearInterval\(intervaloVisual\);\s*clearInterval\(intervaloBusqueda\);\s*clearInterval\(intervaloMoverArchivos\);\s*clearInterval\(intervaloAutoScroll\);)/;
      if (regexClearIntervals.test(contenido)) {
        contenido = contenido.replace(
          regexClearIntervals,
          `$1
    
    // Limpiar heartbeat
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      console.log('💓 Heartbeat detenido');
    }`
        );
      }
    }
    
    // 7. DESACTIVAR CIERRE AUTOMÁTICO
    if (contenido.includes('programarCierreAutomatico();') && !contenido.includes('// programarCierreAutomatico();')) {
      console.log('  ✅ Desactivando cierre automático...');
      contenido = contenido.replace(
        /\/\/ Iniciar programación de cierre automático\nprogramarCierreAutomatico\(\);/,
        `// DESHABILITADO: Cierre automático comentado para evitar cierres inesperados
// Si necesitas el cierre automático, descomenta las siguientes líneas:
// programarCierreAutomatico();
console.log('⚠️ Cierre automático a las 23:59 DESHABILITADO - El monitor funcionará continuamente');`
      );
    }
    
    // Escribir archivo reparado
    fs.writeFileSync(rutaArchivo, contenido);
    console.log(`  ✅ ${rutaArchivo} reparado exitosamente!`);
    
  } catch (error) {
    console.error(`  ❌ Error reparando ${rutaArchivo}:`, error.message);
  }
}

// Ejecutar reparaciones
console.log('🔧 INICIANDO REPARACIÓN DE MONITORES...\n');

MONITORES.forEach(monitor => {
  repararMonitor(monitor);
  console.log();
});

console.log('✅ REPARACIÓN COMPLETADA - Los monitores ahora deben funcionar correctamente');