// WhatsApp.js - Módulo para envío de mensajes vía WhatsApp con sesión persistente
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import path from 'path';

class WhatsAppBot {
  constructor() {
    this.client = null;
    this.isReady = false;
    this.chatId = process.env.WHATSAPP_CHAT_ID || null;
    this.sessionPath = './sesion-whatsapp';
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.monitoreoActivo = false;
    this.intervaloMonitoreo = null;
    this.config = this.cargarConfiguracion();
    
    // Crear directorio de sesión si no existe
    if (!fs.existsSync(this.sessionPath)) {
      fs.mkdirSync(this.sessionPath, { recursive: true });
    }
  }

  cargarConfiguracion() {
    try {
      const configPath = './config-whatsapp.json';
      if (fs.existsSync(configPath)) {
        const data = fs.readFileSync(configPath, 'utf8');
        const config = JSON.parse(data);
        console.log('⚙️ Configuración WhatsApp cargada desde config-whatsapp.json');
        return config;
      }
    } catch (error) {
      console.log('⚠️ Usando configuración por defecto de WhatsApp');
    }
    
    // Configuración por defecto
    return {
      ventana: {
        ancho: 1280,
        alto: 800,
        posicion_x: 100,
        posicion_y: 100,
        pantalla_completa: false,
        permitir_minimizar: true
      },
      comportamiento: {
        traer_al_frente_en_error: false,
        funcionar_en_segundo_plano: true,
        verificar_responsividad: true
      }
    };
  }

  generarArgumentosVentana() {
    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
      '--single-process'
    ];

    // Configurar ventana según configuración
    if (this.config.ventana.pantalla_completa) {
      args.push('--start-maximized');
    } else {
      args.push(`--window-size=${this.config.ventana.ancho},${this.config.ventana.alto}`);
      args.push(`--window-position=${this.config.ventana.posicion_x},${this.config.ventana.posicion_y}`);
    }

    // Configurar comportamiento en segundo plano
    if (this.config.comportamiento.funcionar_en_segundo_plano) {
      args.push('--disable-background-timer-throttling');
      args.push('--disable-backgrounding-occluded-windows');
      args.push('--disable-renderer-backgrounding');
      args.push('--disable-background-media-suspend');
      args.push('--disable-hang-monitor');
      args.push('--enable-aggressive-domstorage-flushing');
    }

    return args;
  }

  async inicializar() {
    console.log('🟢 Inicializando cliente WhatsApp...');
    
    try {
      this.client = new Client({
        authStrategy: new LocalAuth({
          clientId: 'monitor-xpro',
          dataPath: this.sessionPath
        }),
        puppeteer: {
          headless: false,
          args: this.generarArgumentosVentana(),
          timeout: 60000,
          defaultViewport: this.config.ventana.pantalla_completa ? null : {
            width: this.config.ventana.ancho,
            height: this.config.ventana.alto
          },
          devtools: false
        },
        webVersionCache: {
          type: 'remote',
          remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
        }
      });

      this.configurarEventos();
      await this.client.initialize();
      
      return true;
    } catch (error) {
      console.error('❌ Error inicializando WhatsApp:', error.message);
      this.limpiarSesion();
      return false;
    }
  }

  limpiarSesion() {
    try {
      if (fs.existsSync(this.sessionPath)) {
        console.log('🧹 Limpiando sesión corrupta...');
        fs.rmSync(this.sessionPath, { recursive: true, force: true });
        console.log('✅ Sesión limpiada');
      }
    } catch (error) {
      console.error('❌ Error limpiando sesión:', error.message);
    }
  }

  configurarEventos() {
    // Evento QR para login inicial
    this.client.on('qr', (qr) => {
      console.log('📱 Escanea el código QR con WhatsApp:');
      qrcode.generate(qr, { small: true });
      console.log('⏳ Esperando escaneo del código QR...');
    });

    // Cliente listo
    this.client.on('ready', async () => {
      console.log('✅ WhatsApp Cliente listo!');
      this.isReady = true;
      this.reconnectAttempts = 0;
      
      // Obtener información del cliente
      const clientInfo = this.client.info;
      console.log(`📱 Conectado como: ${clientInfo.pushname} (${clientInfo.wid.user})`);
      
      // Validar chat ID si está configurado
      if (this.chatId) {
        await this.validarChatId();
      }
      
      // Iniciar monitoreo de ventana cuando esté listo
      this.iniciarMonitoreoVentana();
    });

    // Autenticación exitosa
    this.client.on('authenticated', () => {
      console.log('🔐 WhatsApp autenticado correctamente');
    });

    // Error de autenticación
    this.client.on('auth_failure', (msg) => {
      console.error('❌ Fallo de autenticación WhatsApp:', msg);
      this.isReady = false;
    });

    // Cliente desconectado
    this.client.on('disconnected', (reason) => {
      console.log('⚠️ WhatsApp desconectado:', reason);
      this.isReady = false;
      
      // NO intentar reconexión automática para evitar conflictos
      console.log('💡 WhatsApp desconectado. Reinicia el script manualmente para reconectar.');
    });

    // Mensajes recibidos (para comandos básicos)
    this.client.on('message', async (message) => {
      if (message.body === '/ping') {
        await message.reply('🤖 Monitor X Pro activo ✅');
      }
      
      if (message.body === '/info') {
        const info = `📊 *Monitor X Pro - Estado*\n\n` +
                    `✅ WhatsApp: Conectado\n` +
                    `🕐 Hora: ${new Date().toLocaleString('es-MX')}\n` +
                    `🔄 Monitoreando múltiples columnas`;
        await message.reply(info);
      }
    });

    // Errores generales
    this.client.on('error', (error) => {
      console.error('❌ Error en cliente WhatsApp:', error);
    });

    // Detectar cuando se cierra la ventana del navegador
    this.client.on('disconnected', (reason) => {
      console.log('🚨 WhatsApp desconectado - Ventana posiblemente cerrada:', reason);
      this.isReady = false;
      this.detenerMonitoreo();
      
      if (this.monitoreoActivo) {
        console.log('🔄 Reintentando abrir WhatsApp automáticamente...');
        setTimeout(() => {
          this.intentarReconexion();
        }, 3000);
      }
    });
  }

  async validarChatId() {
    try {
      if (!this.chatId) {
        console.log('⚠️ WHATSAPP_CHAT_ID no configurado');
        return false;
      }

      const chat = await this.client.getChatById(this.chatId);
      if (chat) {
        console.log(`✅ Chat WhatsApp válido: ${chat.name || 'Chat privado'}`);
        return true;
      }
    } catch (error) {
      console.error(`❌ Chat ID inválido: ${this.chatId}`, error.message);
      return false;
    }
  }

  async intentarReconexion() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`🔄 Intentando reconexión WhatsApp (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
      
      setTimeout(async () => {
        try {
          // Limpiar sesión corrupta antes de reconectar
          this.limpiarSesion();
          await this.inicializar();
        } catch (error) {
          console.error('❌ Error en reconexión:', error.message);
        }
      }, 10000 * this.reconnectAttempts); // Incrementar delay más agresivamente
    } else {
      console.error('❌ Máximo de reintentos alcanzado para WhatsApp');
      console.log('💡 Sugerencia: Reinicia el script manualmente');
    }
  }

  async enviarMensaje(mensaje) {
    if (!this.isReady) {
      console.error('❌ WhatsApp no está listo');
      return false;
    }

    if (!this.chatId) {
      console.error('❌ WHATSAPP_CHAT_ID no configurado');
      return false;
    }

    try {
      await this.client.sendMessage(this.chatId, mensaje);
      console.log('✅ Mensaje WhatsApp enviado');
      return true;
    } catch (error) {
      console.error('❌ Error enviando mensaje WhatsApp:', error.message);
      return false;
    }
  }

  async enviarImagen(rutaImagen, caption = '') {
    if (!this.isReady) {
      console.error('❌ WhatsApp no está listo');
      return false;
    }

    if (!this.chatId) {
      console.error('❌ WHATSAPP_CHAT_ID no configurado');
      return false;
    }

    try {
      // Verificar que la ventana esté activa antes de enviar
      await this.verificarVentanaActiva();
      
      const media = MessageMedia.fromFilePath(rutaImagen);
      await this.client.sendMessage(this.chatId, media, { caption });
      console.log('✅ Imagen WhatsApp enviada:', path.basename(rutaImagen));
      return true;
    } catch (error) {
      console.error('❌ Error enviando imagen WhatsApp:', error.message);
      return false;
    }
  }

  async verificarVentanaActiva() {
    try {
      if (!this.config.comportamiento.verificar_responsividad) {
        return true; // Saltar verificación si está deshabilitada
      }

      // Verificar que el cliente esté funcionando 
      // (permitir que funcione minimizada pero asegurar que la página responda)
      const isPageResponsive = await this.client.pupPage.evaluate(() => {
        return document.readyState === 'complete';
      });
      
      if (!isPageResponsive && this.config.comportamiento.traer_al_frente_en_error) {
        console.log('⚠️ Página WhatsApp no responde, reactivando...');
        await this.client.pupPage.bringToFront();
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else if (!isPageResponsive) {
        console.log('⚠️ Página WhatsApp no responde (pero permitiendo funcionar minimizada)');
      }
      
      return true;
    } catch (error) {
      console.error('❌ Error verificando ventana WhatsApp:', error.message);
      return false;
    }
  }

  async enviarVideo(rutaVideo, caption = '') {
    if (!this.isReady) {
      console.error('❌ WhatsApp no está listo');
      return false;
    }

    if (!this.chatId) {
      console.error('❌ WHATSAPP_CHAT_ID no configurado');
      return false;
    }

    try {
      // Verificar que la ventana esté activa antes de enviar
      await this.verificarVentanaActiva();
      
      const media = MessageMedia.fromFilePath(rutaVideo);
      await this.client.sendMessage(this.chatId, media, { caption });
      console.log('✅ Video WhatsApp enviado:', path.basename(rutaVideo));
      return true;
    } catch (error) {
      console.error('❌ Error enviando video WhatsApp:', error.message);
      
      // Si hay error, intentar traer ventana al frente y reintentar una vez
      try {
        console.log('🔄 Reintentando envío de video...');
        await this.verificarVentanaActiva();
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const media = MessageMedia.fromFilePath(rutaVideo);
        await this.client.sendMessage(this.chatId, media, { caption });
        console.log('✅ Video WhatsApp enviado en segundo intento:', path.basename(rutaVideo));
        return true;
      } catch (retryError) {
        console.error('❌ Error en segundo intento de video WhatsApp:', retryError.message);
        return false;
      }
    }
  }

  async obtenerChats() {
    if (!this.isReady) {
      console.error('❌ WhatsApp no está listo');
      return [];
    }

    try {
      const chats = await this.client.getChats();
      return chats.slice(0, 20).map(chat => ({
        id: chat.id._serialized,
        name: chat.name || 'Chat sin nombre',
        isGroup: chat.isGroup
      }));
    } catch (error) {
      console.error('❌ Error obteniendo chats:', error.message);
      return [];
    }
  }

  async obtenerChatsFormateados() {
    const chats = await this.obtenerChats();
    if (chats.length === 0) {
      return '❌ No se pudieron obtener los chats';
    }

    let mensaje = '📱 *Chats disponibles:*\n\n';
    chats.forEach((chat, index) => {
      const tipo = chat.isGroup ? '👥' : '👤';
      mensaje += `${tipo} ${chat.name}\n`;
      mensaje += `   ID: \`${chat.id}\`\n\n`;
    });

    mensaje += '\n💡 Copia el ID y configúralo en WHATSAPP_CHAT_ID';
    return mensaje;
  }


  iniciarMonitoreoVentana() {
    this.monitoreoActivo = true;
    console.log('👁️ Iniciando monitoreo de ventana WhatsApp...');
    
    // Verificar estado de la ventana cada 10 segundos
    this.intervaloMonitoreo = setInterval(async () => {
      await this.verificarEstadoVentana();
    }, 10000);
  }

  detenerMonitoreo() {
    this.monitoreoActivo = false;
    if (this.intervaloMonitoreo) {
      clearInterval(this.intervaloMonitoreo);
      this.intervaloMonitoreo = null;
      console.log('🛑 Monitoreo de ventana WhatsApp detenido');
    }
  }

  async verificarEstadoVentana() {
    if (!this.client || !this.isReady) {
      return;
    }

    try {
      // Verificar si la página del navegador sigue existiendo
      const isPageAlive = await this.client.pupPage.evaluate(() => {
        return document.readyState === 'complete';
      });

      if (!isPageAlive) {
        console.log('🚨 Ventana WhatsApp cerrada - Reinitiando...');
        this.isReady = false;
        await this.intentarReconexion();
      }

    } catch (error) {
      if (error.message.includes('Target closed') || 
          error.message.includes('Session closed') ||
          error.message.includes('Page has been closed')) {
        
        console.log('🚨 Ventana WhatsApp cerrada detectada - Reinitiando...');
        this.isReady = false;
        await this.intentarReconexion();
      }
    }
  }

  async cerrar() {
    try {
      this.detenerMonitoreo();
      
      if (this.client) {
        await this.client.destroy();
        console.log('🔴 Cliente WhatsApp cerrado');
      }
    } catch (error) {
      console.error('❌ Error cerrando WhatsApp:', error.message);
    }
  }

  getEstado() {
    return {
      conectado: this.isReady,
      chatConfigured: !!this.chatId,
      reconnectAttempts: this.reconnectAttempts,
      monitoreoActivo: this.monitoreoActivo
    };
  }
}

export default WhatsAppBot;