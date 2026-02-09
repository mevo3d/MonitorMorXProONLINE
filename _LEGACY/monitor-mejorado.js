// monitor-mejorado.js - Sistema robusto con auto-reconexión y prevención de cierres

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// CONFIGURACIÓN
const USER_DATA_DIR = path.join(__dirname, 'chrome_profile');
const XPRO_BASE_URL = 'https://pro.x.com';
const HEARTBEAT_INTERVAL = 30000; // 30 segundos
const RECONNECT_DELAY = 10000; // 10 segundos para reconectar
const MAX_RECONNECT_ATTEMPTS = 5;

class MonitorMejorado {
  constructor() {
    this.context = null;
    this.page = null;
    this.isRunning = false;
    this.heartbeatInterval = null;
    this.reconnectAttempts = 0;
    this.lastActivityTime = Date.now();
    this.crashCount = 0;
  }

  async iniciar() {
    console.log('🚀 Iniciando Monitor Mejorado con protección anti-cierre...');
    this.isRunning = true;
    
    try {
      await this.conectar();
      this.iniciarHeartbeat();
      await this.loopPrincipal();
    } catch (error) {
      console.error('❌ Error fatal en monitor:', error);
      await this.reconectar();
    }
  }

  async conectar() {
    try {
      console.log('🌐 Conectando navegador...');
      
      const browserOptions = {
        headless: false,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
          // CRÍTICO: Prevenir suspensión en background
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows', 
          '--disable-renderer-backgrounding',
          '--disable-background-media-suspend',
          '--disable-hang-monitor',
          '--enable-aggressive-domstorage-flushing',
          '--disable-features=CalculateNativeWinOcclusion',
          '--disable-field-trial-config',
          '--disable-ipc-flooding-protection',
          // Mantener conexión activa
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
          // Ventana compacta
          '--window-size=900,700',
          '--window-position=100,100'
        ],
        timeout: 60000,
        slowMo: 50
      };

      this.context = await chromium.launchPersistentContext(USER_DATA_DIR, browserOptions);
      
      // Usar página existente o crear nueva
      const pages = this.context.pages();
      if (pages.length > 0) {
        this.page = pages[0];
        console.log('📄 Usando página existente');
      } else {
        this.page = await this.context.newPage();
        console.log('📄 Nueva página creada');
      }

      // Configurar timeouts generosos
      this.page.setDefaultNavigationTimeout(90000);
      this.page.setDefaultTimeout(60000);

      // Navegar a X Pro
      await this.navegarAXPro();
      
      // Marcar conexión exitosa
      this.reconnectAttempts = 0;
      this.lastActivityTime = Date.now();
      console.log('✅ Conexión establecida exitosamente');
      
    } catch (error) {
      console.error('❌ Error conectando:', error.message);
      throw error;
    }
  }

  async navegarAXPro() {
    try {
      const currentUrl = this.page.url();
      
      if (!currentUrl.includes('pro.x.com')) {
        console.log('🔄 Navegando a X Pro...');
        await this.page.goto(XPRO_BASE_URL, { 
          waitUntil: 'domcontentloaded',
          timeout: 60000 
        });
        await this.page.waitForTimeout(3000);
      }
      
      console.log('✅ En X Pro');
    } catch (error) {
      console.error('❌ Error navegando a X Pro:', error.message);
      throw error;
    }
  }

  iniciarHeartbeat() {
    console.log('💓 Iniciando sistema de heartbeat...');
    
    this.heartbeatInterval = setInterval(async () => {
      try {
        // Verificar si la página responde
        const isConnected = await this.verificarConexion();
        
        if (!isConnected) {
          console.log('⚠️ Heartbeat: Conexión perdida, intentando reconectar...');
          clearInterval(this.heartbeatInterval);
          await this.reconectar();
        } else {
          const tiempoInactivo = (Date.now() - this.lastActivityTime) / 1000 / 60;
          console.log(`💓 Heartbeat OK - Tiempo inactivo: ${tiempoInactivo.toFixed(1)} min`);
          
          // Mantener página activa con micro-interacción
          await this.mantenerActivo();
        }
      } catch (error) {
        console.error('❌ Error en heartbeat:', error.message);
        clearInterval(this.heartbeatInterval);
        await this.reconectar();
      }
    }, HEARTBEAT_INTERVAL);
  }

  async verificarConexion() {
    try {
      // Intentar evaluar algo simple en la página
      const resultado = await Promise.race([
        this.page.evaluate(() => true),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout verificando conexión')), 5000)
        )
      ]);
      
      return resultado === true;
    } catch (error) {
      console.log('❌ Verificación de conexión falló:', error.message);
      return false;
    }
  }

  async mantenerActivo() {
    try {
      // Micro-scroll para mantener la página activa
      await this.page.evaluate(() => {
        window.scrollBy(0, 1);
        window.scrollBy(0, -1);
      });
      
      // Actualizar tiempo de actividad
      this.lastActivityTime = Date.now();
    } catch (error) {
      console.log('⚠️ Error manteniendo activo:', error.message);
    }
  }

  async reconectar() {
    this.reconnectAttempts++;
    
    if (this.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      console.error('❌ Máximo de intentos de reconexión alcanzado. Reiniciando completamente...');
      this.reconnectAttempts = 0;
      this.crashCount++;
      
      // Reinicio completo
      await this.limpiar();
      await new Promise(resolve => setTimeout(resolve, RECONNECT_DELAY * 2));
      return await this.iniciar();
    }

    console.log(`🔄 Intento de reconexión ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}...`);
    
    try {
      // Limpiar recursos antiguos
      await this.limpiar();
      
      // Esperar antes de reconectar
      await new Promise(resolve => setTimeout(resolve, RECONNECT_DELAY));
      
      // Reconectar
      await this.conectar();
      
      // Reiniciar heartbeat
      this.iniciarHeartbeat();
      
      // Continuar con el loop principal
      await this.loopPrincipal();
      
    } catch (error) {
      console.error('❌ Fallo en reconexión:', error.message);
      // Intentar de nuevo
      await this.reconectar();
    }
  }

  async loopPrincipal() {
    console.log('🔄 Iniciando loop principal de monitoreo...');
    
    while (this.isRunning) {
      try {
        // Tu lógica de monitoreo aquí
        console.log('👀 Monitoreando...');
        
        // Simular trabajo (reemplazar con tu lógica real)
        await this.page.waitForTimeout(10000);
        
        // Actualizar actividad
        this.lastActivityTime = Date.now();
        
        // Verificar salud del sistema cada 10 ciclos
        if (Math.random() < 0.1) {
          await this.verificarSalud();
        }
        
      } catch (error) {
        console.error('❌ Error en loop principal:', error.message);
        
        // Intentar recuperar sin reiniciar todo
        if (error.message.includes('Target closed') || 
            error.message.includes('Protocol error') ||
            error.message.includes('Navigation failed')) {
          console.log('🔄 Error recuperable detectado, reconectando...');
          await this.reconectar();
          return; // Salir del loop actual, reconectar creará uno nuevo
        }
        
        // Para otros errores, continuar
        console.log('⏳ Esperando 5 segundos antes de continuar...');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  async verificarSalud() {
    const memoriaUsada = process.memoryUsage().heapUsed / 1024 / 1024;
    const tiempoEjecutando = (Date.now() - this.lastActivityTime) / 1000 / 60;
    
    console.log(`
    📊 === ESTADO DEL SISTEMA ===
    💾 Memoria: ${memoriaUsada.toFixed(2)} MB
    ⏱️ Tiempo ejecutando: ${tiempoEjecutando.toFixed(1)} min
    🔄 Reconexiones: ${this.reconnectAttempts}
    💥 Crashes recuperados: ${this.crashCount}
    ==========================
    `);
    
    // Reiniciar si la memoria es muy alta
    if (memoriaUsada > 500) {
      console.log('⚠️ Memoria alta detectada, reiniciando navegador...');
      await this.reconectar();
    }
  }

  async limpiar() {
    try {
      clearInterval(this.heartbeatInterval);
      
      if (this.page) {
        await this.page.close().catch(() => {});
      }
      
      if (this.context) {
        await this.context.close().catch(() => {});
      }
      
      console.log('🧹 Recursos limpiados');
    } catch (error) {
      console.log('⚠️ Error limpiando recursos:', error.message);
    }
  }

  async detener() {
    console.log('🛑 Deteniendo monitor...');
    this.isRunning = false;
    await this.limpiar();
    process.exit(0);
  }
}

// MANEJADORES GLOBALES DE ERRORES
process.on('uncaughtException', async (error) => {
  console.error('🚨 Error no capturado:', error);
  // No salir, intentar recuperar
});

process.on('unhandledRejection', async (reason) => {
  console.error('🚨 Promesa rechazada:', reason);
  // No salir, intentar recuperar
});

// SEÑALES DE TERMINACIÓN
process.on('SIGINT', async () => {
  console.log('\n⚠️ CTRL+C detectado');
  await monitor.detener();
});

process.on('SIGTERM', async () => {
  console.log('\n⚠️ Señal de terminación recibida');
  await monitor.detener();
});

// INICIAR
const monitor = new MonitorMejorado();
monitor.iniciar().catch(error => {
  console.error('❌ Error iniciando monitor:', error);
  setTimeout(() => {
    console.log('🔄 Reintentando inicio en 10 segundos...');
    monitor.iniciar();
  }, 10000);
});

console.log(`
╔══════════════════════════════════════════════╗
║     MONITOR MEJORADO - ANTI-CIERRE v2.0      ║
╠══════════════════════════════════════════════╣
║  ✅ Auto-reconexión habilitada               ║
║  ✅ Heartbeat cada 30 segundos               ║  
║  ✅ Prevención de suspensión en background   ║
║  ✅ Recuperación automática de crashes       ║
║  ✅ Monitoreo de memoria                     ║
╚══════════════════════════════════════════════╝

🎯 El sistema ahora es resistente a:
   - Pérdida de conexión con el navegador
   - Suspensión por inactividad
   - Errores de navegación
   - Problemas de memoria
   - Minimización de ventana

💡 Presiona CTRL+C para detener
`);