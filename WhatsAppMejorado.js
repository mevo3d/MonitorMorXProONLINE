// WhatsAppMejorado.js - Módulo optimizado para mantener conexión estable
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import fs from 'fs';
import path from 'path';
import TelegramBot from 'node-telegram-bot-api';

class WhatsAppBotMejorado {
  constructor() {
    this.client = null;
    this.isReady = false;
    this.chatId = process.env.WHATSAPP_CHAT_ID || null;
    this.sessionPath = './sesion-whatsapp-mejorada';
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10; // Más intentos
    this.lastActivity = Date.now();
    this.heartbeatInterval = null;
    this.connectionCheckInterval = null;
    this.lastDisconnectNotification = 0;
    this.sessionBackupPath = './sesion-whatsapp-backup';
    
    // Telegram para notificaciones
    this.telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
    this.telegramChatId = process.env.TELEGRAM_CHAT_ID;
    
    // Estadísticas de conexión
    this.stats = {
      totalReconnects: 0,
      lastConnectionTime: null,
      totalMessagessSent: 0,
      errors: []
    };
    
    // Configuración optimizada
    this.config = {
      heartbeatInterval: 60000, // 1 minuto (menos agresivo)
      connectionCheckInterval: 120000, // 2 minutos
      inactivityTimeout: 900000, // 15 minutos (más tiempo antes de keepalive)
      reconnectDelay: 5000, // 5 segundos base
      maxReconnectDelay: 300000, // 5 minutos máximo
      qrRefreshInterval: 20000, // 20 segundos para QR
      notificationCooldown: 300000, // 5 minutos entre notificaciones
      keepaliveInterval: 600000 // 10 minutos entre keepalives manuales
    };
    
    // Crear directorios necesarios
    [this.sessionPath, this.sessionBackupPath].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
    
    this.cargarEstadisticas();
  }

  // Método para registrar actividad y evitar keepalives innecesarios
  registrarActividad() {
    this.lastActivity = Date.now();
  }

  cargarEstadisticas() {
    try {
      const statsPath = './whatsapp-stats.json';
      if (fs.existsSync(statsPath)) {
        const data = fs.readFileSync(statsPath, 'utf8');
        const savedStats = JSON.parse(data);
        this.stats = { ...this.stats, ...savedStats };
        console.log('📊 Estadísticas cargadas:', {
          reconexiones: this.stats.totalReconnects,
          mensajes: this.stats.totalMessagessSent
        });
      }
    } catch (error) {
      console.log('⚠️ No se pudieron cargar estadísticas previas');
    }
  }

  guardarEstadisticas() {
    try {
      const statsPath = './whatsapp-stats.json';
      fs.writeFileSync(statsPath, JSON.stringify(this.stats, null, 2));
    } catch (error) {
      console.error('❌ Error guardando estadísticas:', error.message);
    }
  }

  async notificarTelegram(mensaje, esCritico = false) {
    try {
      const ahora = Date.now();
      // Evitar spam de notificaciones
      if (!esCritico && (ahora - this.lastDisconnectNotification) < this.config.notificationCooldown) {
        return;
      }
      
      await this.telegramBot.sendMessage(this.telegramChatId, mensaje, { parse_mode: 'Markdown' });
      
      if (!esCritico) {
        this.lastDisconnectNotification = ahora;
      }
    } catch (error) {
      console.error('❌ Error enviando notificación a Telegram:', error.message);
    }
  }

  async inicializar() {
    try {
      console.log('🚀 Iniciando WhatsApp mejorado...');
      
      // Intentar restaurar sesión de backup si existe
      await this.restaurarSesionBackup();
      
      this.client = new Client({
        authStrategy: new LocalAuth({
          clientId: 'monitor-xpro-mejorado',
          dataPath: this.sessionPath
        }),
        puppeteer: {
          headless: false,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--disable-gpu',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor',
            // Mantener activo en segundo plano
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-features=CalculateNativeWinOcclusion',
            '--window-size=1280,800',
            '--window-position=100,100'
          ],
          timeout: 90000,
          defaultViewport: null,
          // Mantener navegador activo
          pipe: true,
          dumpio: false
        },
        // Configuración de reintentos mejorada
        restartOnAuthFail: true,
        qrMaxRetries: 5,
        takeoverOnConflict: true,
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
      await this.notificarTelegram(
        `❌ *WhatsApp Error Inicialización*\n\n` +
        `Error: ${error.message}\n` +
        `Hora: ${new Date().toLocaleString('es-MX')}`,
        true
      );
      return false;
    }
  }

  async restaurarSesionBackup() {
    try {
      if (fs.existsSync(this.sessionBackupPath) && !fs.existsSync(this.sessionPath)) {
        console.log('🔄 Restaurando sesión desde backup...');
        // Copiar archivos de backup
        const files = fs.readdirSync(this.sessionBackupPath);
        files.forEach(file => {
          const src = path.join(this.sessionBackupPath, file);
          const dest = path.join(this.sessionPath, file);
          fs.copyFileSync(src, dest);
        });
        console.log('✅ Sesión restaurada desde backup');
      }
    } catch (error) {
      console.error('❌ Error restaurando backup:', error.message);
    }
  }

  async crearBackupSesion() {
    try {
      if (fs.existsSync(this.sessionPath)) {
        console.log('💾 Creando backup de sesión...');
        // Limpiar backup anterior
        if (fs.existsSync(this.sessionBackupPath)) {
          fs.rmSync(this.sessionBackupPath, { recursive: true, force: true });
        }
        fs.mkdirSync(this.sessionBackupPath, { recursive: true });
        
        // Copiar archivos de sesión
        const files = fs.readdirSync(this.sessionPath);
        files.forEach(file => {
          const src = path.join(this.sessionPath, file);
          const dest = path.join(this.sessionBackupPath, file);
          fs.copyFileSync(src, dest);
        });
        console.log('✅ Backup de sesión creado');
      }
    } catch (error) {
      console.error('❌ Error creando backup:', error.message);
    }
  }

  configurarEventos() {
    let qrCount = 0;
    let qrTimer = null;

    // Evento QR con mejor manejo
    this.client.on('qr', (qr) => {
      qrCount++;
      console.log(`🔳 QR Code recibido (intento ${qrCount}/5)`);
      
      // Notificar solo en el primer QR
      if (qrCount === 1) {
        this.notificarTelegram(
          `📱 *WhatsApp requiere escanear QR*\n\n` +
          `Por favor, abre WhatsApp en tu teléfono y escanea el código QR en la ventana del navegador.\n\n` +
          `⏰ Tienes 2 minutos para escanearlo.`,
          true
        );
      }
      
      // Timeout para QR
      if (qrTimer) clearTimeout(qrTimer);
      qrTimer = setTimeout(() => {
        if (!this.isReady && qrCount >= 5) {
          console.log('❌ Timeout esperando escaneo de QR');
          this.notificarTelegram(
            `❌ *WhatsApp QR Timeout*\n\n` +
            `No se escaneó el código QR a tiempo.\n` +
            `El sistema reintentará automáticamente.`,
            true
          );
        }
      }, 120000); // 2 minutos
    });

    // Cliente listo
    this.client.on('ready', async () => {
      console.log('✅ WhatsApp Cliente listo!');
      this.isReady = true;
      this.reconnectAttempts = 0;
      this.lastActivity = Date.now();
      qrCount = 0;
      
      if (qrTimer) clearTimeout(qrTimer);
      
      // Información del cliente
      const clientInfo = this.client.info;
      const mensaje = `✅ *WhatsApp Conectado*\n\n` +
                     `📱 Usuario: ${clientInfo.pushname}\n` +
                     `📞 Número: ${clientInfo.wid.user}\n` +
                     `🔄 Reconexiones totales: ${this.stats.totalReconnects}\n` +
                     `📊 Mensajes enviados: ${this.stats.totalMessagessSent}\n` +
                     `🕐 Hora: ${new Date().toLocaleString('es-MX')}`;
      
      await this.notificarTelegram(mensaje, true);
      
      // Validar chat
      if (this.chatId) {
        await this.validarChatId();
      }
      
      // Crear backup de sesión exitosa
      await this.crearBackupSesion();
      
      // Iniciar sistemas de mantenimiento
      this.iniciarHeartbeat();
      this.iniciarVerificacionConexion();
      
      // Actualizar estadísticas
      this.stats.lastConnectionTime = new Date().toISOString();
      this.guardarEstadisticas();
    });

    // Autenticación exitosa
    this.client.on('authenticated', () => {
      console.log('🔐 WhatsApp autenticado correctamente');
      this.registrarActividad();
    });

    // Error de autenticación
    this.client.on('auth_failure', async (msg) => {
      console.error('❌ Fallo de autenticación WhatsApp:', msg);
      this.isReady = false;
      
      await this.notificarTelegram(
        `❌ *WhatsApp Error Autenticación*\n\n` +
        `Razón: ${msg}\n` +
        `Se requiere escanear QR nuevamente.`,
        true
      );
      
      // Limpiar sesión corrupta
      await this.limpiarSesion();
    });

    // Cliente desconectado
    this.client.on('disconnected', async (reason) => {
      console.log('⚠️ WhatsApp desconectado:', reason);
      this.isReady = false;
      this.detenerMantenimiento();
      
      await this.notificarTelegram(
        `⚠️ *WhatsApp Desconectado*\n\n` +
        `Razón: ${reason}\n` +
        `Intentando reconexión automática...\n` +
        `Intento: ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts}`
      );
      
      // Incrementar contador de reconexiones
      this.stats.totalReconnects++;
      this.guardarEstadisticas();
      
      // Intentar reconexión automática
      await this.intentarReconexion();
    });

    // Cambio de estado
    this.client.on('change_state', (state) => {
      // Solo mostrar cambios importantes
      if (state === 'CONFLICT' || state === 'UNLAUNCHED' || state === 'CONNECTED') {
        console.log('🔄 Estado WhatsApp:', state);
      }
      this.registrarActividad();
      
      // Si está en conflicto, forzar reconexión
      if (state === 'CONFLICT' || state === 'UNLAUNCHED') {
        console.log('⚠️ Conflicto detectado, forzando reconexión...');
        this.intentarReconexion();
      }
    });

    // Mensajes recibidos
    this.client.on('message', async (message) => {
      this.registrarActividad();
      
      // Comandos de control
      if (message.body === '/status') {
        const uptime = this.calcularUptime();
        const info = `📊 *Monitor X Pro - Estado WhatsApp*\n\n` +
                    `✅ Estado: Conectado\n` +
                    `⏱️ Uptime: ${uptime}\n` +
                    `🔄 Reconexiones: ${this.stats.totalReconnects}\n` +
                    `📨 Mensajes enviados: ${this.stats.totalMessagessSent}\n` +
                    `🕐 Última actividad: ${new Date(this.lastActivity).toLocaleTimeString('es-MX')}\n` +
                    `📱 Versión: ${this.client.info.phone.wa_version}`;
        await message.reply(info);
      }
      
      if (message.body === '/ping') {
        await message.reply('🤖 Monitor X Pro activo ✅');
      }
      
      if (message.body === '/help') {
        const help = `📋 *Comandos disponibles:*\n\n` +
                    `/status - Estado del sistema\n` +
                    `/ping - Verificar conexión\n` +
                    `/stats - Estadísticas detalladas\n` +
                    `/help - Esta ayuda`;
        await message.reply(help);
      }
      
      if (message.body === '/stats') {
        const stats = `📈 *Estadísticas WhatsApp*\n\n` +
                     `📊 Total reconexiones: ${this.stats.totalReconnects}\n` +
                     `📨 Mensajes enviados: ${this.stats.totalMessagessSent}\n` +
                     `🕐 Última conexión: ${this.stats.lastConnectionTime ? new Date(this.stats.lastConnectionTime).toLocaleString('es-MX') : 'N/A'}\n` +
                     `❌ Errores registrados: ${this.stats.errors.length}`;
        await message.reply(stats);
      }
    });

    // Errores generales
    this.client.on('error', async (error) => {
      console.error('❌ Error en cliente WhatsApp:', error);
      this.stats.errors.push({
        timestamp: new Date().toISOString(),
        error: error.message
      });
      
      // Mantener solo los últimos 50 errores
      if (this.stats.errors.length > 50) {
        this.stats.errors = this.stats.errors.slice(-50);
      }
      
      this.guardarEstadisticas();
    });

    // Eventos adicionales para mejor monitoreo (silencioso)
    this.client.on('loading_screen', (percent, message) => {
      // Solo mostrar cuando esté completamente cargado
      if (percent === 100) {
        console.log('✅ WhatsApp cargado completamente');
      }
      this.registrarActividad();
    });

    this.client.on('remote_session_saved', () => {
      console.log('💾 Sesión remota guardada');
      this.crearBackupSesion();
    });
  }

  iniciarHeartbeat() {
    console.log('💓 Sistema de mantenimiento iniciado (silencioso)');
    
    let keepaliveCount = 0;
    let lastKeepalive = Date.now();
    let firstKeepaliveDone = false;
    
    this.heartbeatInterval = setInterval(async () => {
      if (!this.isReady) return;
      
      try {
        // Verificar estado solo si ha pasado tiempo suficiente
        const ahora = Date.now();
        const timeSinceLastKeepalive = ahora - lastKeepalive;
        
        // Verificar estado de conexión (silencioso)
        const state = await this.client.getState();
        
        if (state !== 'CONNECTED') {
          console.log('⚠️ Estado no conectado:', state);
          await this.intentarReconexion();
          return;
        }
        
        // Keepalive inteligente: solo cada 10 minutos Y si hay inactividad
        const inactiveTime = ahora - this.lastActivity;
        const needsKeepalive = inactiveTime > this.config.inactivityTimeout && 
                             timeSinceLastKeepalive > this.config.keepaliveInterval;
        
        if (needsKeepalive) {
          keepaliveCount++;
          
          // Solo mostrar el PRIMER keepalive, después trabajar silenciosamente
          if (!firstKeepaliveDone) {
            console.log(`💓 Sistema keepalive activo - funcionando en segundo plano silenciosamente`);
            firstKeepaliveDone = true;
          }
          
          // Acción de keepalive silenciosa
          await this.client.getState();
          this.lastActivity = ahora;
          lastKeepalive = ahora;
        } else {
          // Reset contador si hay actividad reciente
          if (inactiveTime < this.config.inactivityTimeout) {
            keepaliveCount = 0;
          }
        }
        
      } catch (error) {
        console.error('❌ Error en heartbeat:', error.message);
        await this.intentarReconexion();
      }
    }, this.config.heartbeatInterval);
  }

  iniciarVerificacionConexion() {
    console.log('🔍 Verificación de conexión iniciada (silenciosa)');
    
    let checkCount = 0;
    let firstCheckDone = false;
    
    this.connectionCheckInterval = setInterval(async () => {
      if (!this.client || !this.isReady) return;
      
      checkCount++;
      
      try {
        // Verificar que la página siga activa (silencioso)
        const page = this.client.pupPage;
        if (!page || page.isClosed()) {
          console.log('🚨 Página cerrada detectada');
          await this.intentarReconexion();
          return;
        }
        
        // Verificación profunda solo cada 5 checks (cada 10 minutos) - SILENCIOSA
        if (checkCount % 5 === 0) {
          const isWhatsAppLoaded = await page.evaluate(() => {
            return !!(window.Store && window.Store.Chat);
          });
          
          if (!isWhatsAppLoaded) {
            console.log('⚠️ WhatsApp Web no está cargado correctamente');
            await this.intentarReconexion();
          } else {
            // Solo mostrar la primera verificación exitosa
            if (!firstCheckDone) {
              console.log(`✅ Sistema de verificación funcionando correctamente en segundo plano`);
              firstCheckDone = true;
            }
            // Después de la primera, todo silencioso
          }
        }
        
      } catch (error) {
        if (error.message.includes('Target closed') || 
            error.message.includes('Session closed') ||
            error.message.includes('Page has been closed')) {
          console.log('🚨 Sesión/página cerrada detectada');
          await this.intentarReconexion();
        }
        // Errores menores completamente silenciosos
      }
    }, this.config.connectionCheckInterval);
  }

  detenerMantenimiento() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    
    if (this.connectionCheckInterval) {
      clearInterval(this.connectionCheckInterval);
      this.connectionCheckInterval = null;
    }
    
    console.log('🛑 Sistemas de mantenimiento detenidos');
  }

  async limpiarSesion() {
    try {
      this.detenerMantenimiento();
      
      if (fs.existsSync(this.sessionPath)) {
        console.log('🧹 Limpiando sesión corrupta...');
        fs.rmSync(this.sessionPath, { recursive: true, force: true });
        console.log('✅ Sesión limpiada');
      }
    } catch (error) {
      console.error('❌ Error limpiando sesión:', error.message);
    }
  }

  async intentarReconexion() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('❌ Máximo de reintentos alcanzado');
      await this.notificarTelegram(
        `❌ *WhatsApp Reconexión Fallida*\n\n` +
        `Se alcanzó el máximo de reintentos (${this.maxReconnectAttempts}).\n` +
        `Por favor, reinicia el sistema manualmente.`,
        true
      );
      return;
    }
    
    this.reconnectAttempts++;
    
    // Calcular delay exponencial con límite
    const delay = Math.min(
      this.config.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.config.maxReconnectDelay
    );
    
    console.log(`🔄 Reintentando en ${delay/1000} segundos... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    setTimeout(async () => {
      try {
        // Cerrar cliente anterior si existe
        if (this.client) {
          try {
            await this.client.destroy();
          } catch (e) {
            console.log('⚠️ Error cerrando cliente anterior:', e.message);
          }
        }
        
        // Reinicializar
        const success = await this.inicializar();
        
        if (!success && this.reconnectAttempts < this.maxReconnectAttempts) {
          // Si falla, intentar de nuevo
          await this.intentarReconexion();
        }
      } catch (error) {
        console.error('❌ Error en reconexión:', error.message);
        
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          await this.intentarReconexion();
        }
      }
    }, delay);
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
      
      await this.notificarTelegram(
        `❌ *WhatsApp Chat ID Inválido*\n\n` +
        `El ID configurado no es válido: ${this.chatId}\n` +
        `Por favor, verifica la configuración.`,
        true
      );
      
      return false;
    }
  }

  async enviarMensaje(mensaje, reintentos = 3) {
    if (!this.isReady) {
      console.error('❌ WhatsApp no está listo');
      return false;
    }

    if (!this.chatId) {
      console.error('❌ WHATSAPP_CHAT_ID no configurado');
      return false;
    }

    for (let intento = 1; intento <= reintentos; intento++) {
      try {
        await this.client.sendMessage(this.chatId, mensaje);
        console.log('✅ Mensaje WhatsApp enviado');
        
        // Registrar actividad - esto evitará keepalives innecesarios
        this.registrarActividad();
        this.stats.totalMessagessSent++;
        this.guardarEstadisticas();
        
        return true;
      } catch (error) {
        console.error(`❌ Error enviando mensaje (intento ${intento}/${reintentos}):`, error.message);
        
        if (intento < reintentos) {
          // Esperar antes de reintentar
          await new Promise(resolve => setTimeout(resolve, 2000 * intento));
          
          // Verificar si sigue conectado
          try {
            const state = await this.client.getState();
            if (state !== 'CONNECTED') {
              console.log('⚠️ Reconectando antes de reintentar...');
              await this.intentarReconexion();
              return false;
            }
          } catch (e) {
            console.error('❌ Error verificando estado:', e.message);
          }
        }
      }
    }
    
    return false;
  }

  async enviarImagen(rutaImagen, caption = '', reintentos = 3) {
    if (!this.isReady || !this.chatId) {
      console.error('❌ WhatsApp no está listo o chatId no configurado');
      return false;
    }

    for (let intento = 1; intento <= reintentos; intento++) {
      try {
        const media = MessageMedia.fromFilePath(rutaImagen);
        await this.client.sendMessage(this.chatId, media, { caption });
        console.log('✅ Imagen WhatsApp enviada:', path.basename(rutaImagen));
        
        this.registrarActividad();
        this.stats.totalMessagessSent++;
        this.guardarEstadisticas();
        
        return true;
      } catch (error) {
        console.error(`❌ Error enviando imagen (intento ${intento}/${reintentos}):`, error.message);
        
        if (intento < reintentos) {
          await new Promise(resolve => setTimeout(resolve, 3000 * intento));
        }
      }
    }
    
    return false;
  }

  async enviarVideo(rutaVideo, caption = '', reintentos = 3) {
    if (!this.isReady || !this.chatId) {
      console.error('❌ WhatsApp no está listo o chatId no configurado');
      return false;
    }

    for (let intento = 1; intento <= reintentos; intento++) {
      try {
        const media = MessageMedia.fromFilePath(rutaVideo);
        await this.client.sendMessage(this.chatId, media, { caption });
        console.log('✅ Video WhatsApp enviado:', path.basename(rutaVideo));
        
        this.registrarActividad();
        this.stats.totalMessagessSent++;
        this.guardarEstadisticas();
        
        return true;
      } catch (error) {
        console.error(`❌ Error enviando video (intento ${intento}/${reintentos}):`, error.message);
        
        if (intento < reintentos) {
          // Mayor delay para videos por su tamaño
          await new Promise(resolve => setTimeout(resolve, 5000 * intento));
        }
      }
    }
    
    return false;
  }

  calcularUptime() {
    if (!this.stats.lastConnectionTime) return 'N/A';
    
    const ahora = Date.now();
    const inicio = new Date(this.stats.lastConnectionTime).getTime();
    const diff = ahora - inicio;
    
    const horas = Math.floor(diff / (1000 * 60 * 60));
    const minutos = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    return `${horas}h ${minutos}m`;
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

  async cerrar() {
    try {
      console.log('🔴 Cerrando WhatsApp...');
      
      this.detenerMantenimiento();
      
      // Guardar estadísticas finales
      this.guardarEstadisticas();
      
      if (this.client) {
        await this.client.destroy();
        console.log('✅ Cliente WhatsApp cerrado correctamente');
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
      lastActivity: new Date(this.lastActivity).toLocaleTimeString('es-MX'),
      totalReconnects: this.stats.totalReconnects,
      totalMessagessSent: this.stats.totalMessagessSent,
      uptime: this.calcularUptime()
    };
  }
}

export default WhatsAppBotMejorado;