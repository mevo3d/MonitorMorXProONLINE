// ARCHIVO DESHABILITADO - Sistema configurado para usar solo Telegram
// Para reactivar WhatsApp, descomente este archivo y las referencias en index.js

/*
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
    this.lastInitErrorNotification = 0;
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
      initErrorCooldown: 600000, // 10 minutos entre notificaciones de error de inicialización
      keepaliveInterval: 600000 // 10 minutos entre keepalives manuales
    };
    
    // Crear directorios necesarios
    [this.sessionPath, this.sessionBackupPath].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  async inicializar() {
    try {
      console.log('🚀 Iniciando WhatsApp Bot Mejorado...');
      
      // Restaurar respaldo si la sesión principal está corrupta
      await this.restaurarSesionSiNecesario();
      
      // Configuración del cliente con opciones optimizadas
      this.client = new Client({
        authStrategy: new LocalAuth({
          clientId: 'whatsapp-bot-mejorado',
          dataPath: this.sessionPath
        }),
        puppeteer: {
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            '--shm-size=3gb',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-features=TranslateUI',
            '--disable-ipc-flooding-protection',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--no-default-browser-check'
          ],
          defaultViewport: null,
          timeout: 120000 // 2 minutos de timeout
        },
        webVersionCache: {
          type: 'remote',
          remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
        }
      });

      this.configurarEventos();
      
      // Inicializar con timeout
      const initPromise = this.client.initialize();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout de inicialización')), 180000) // 3 minutos
      );
      
      await Promise.race([initPromise, timeoutPromise]);
      
      // Esperar un poco más para asegurar estabilidad
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      return true;
      
    } catch (error) {
      console.error('❌ Error inicializando WhatsApp:', error.message);
      
      // Notificar solo si ha pasado suficiente tiempo desde la última notificación
      const ahora = Date.now();
      if (ahora - this.lastInitErrorNotification > this.config.initErrorCooldown) {
        await this.notificarTelegram(`⚠️ WhatsApp: Error inicializando - ${error.message}`);
        this.lastInitErrorNotification = ahora;
      }
      
      this.stats.errors.push({
        timestamp: new Date().toISOString(),
        error: error.message,
        type: 'initialization'
      });
      
      return false;
    }
  }

  configurarEventos() {
    // Evento: Cliente listo
    this.client.on('ready', async () => {
      console.log('✅ WhatsApp Bot Mejorado listo y conectado!');
      this.isReady = true;
      this.reconnectAttempts = 0;
      this.stats.lastConnectionTime = new Date().toISOString();
      
      // Hacer backup de la sesión cuando esté lista
      await this.hacerBackupSesion();
      
      // Solo notificar si es una reconexión (no la primera vez)
      if (this.stats.totalReconnects > 0) {
        await this.notificarTelegram('✅ WhatsApp: Reconectado exitosamente');
      }
      
      // Iniciar sistemas de mantenimiento
      this.iniciarHeartbeat();
      this.iniciarVerificacionConexion();
      this.iniciarKeepaliveAutomatico();
      
      // Verificar chat configurado
      if (!this.chatId) {
        console.log('⚠️ WHATSAPP_CHAT_ID no configurado en .env');
        await this.notificarTelegram('⚠️ WhatsApp conectado pero falta configurar WHATSAPP_CHAT_ID');
      } else {
        console.log(`📱 Chat configurado: ${this.chatId}`);
      }
    });

    // Evento: QR Code (requerido para autenticación)
    this.client.on('qr', async (qr) => {
      console.log('📱 QR Code recibido - Escanear para autenticar');
      console.log(qr); // Mostrar QR en consola
      
      // Notificar a Telegram con el QR
      await this.notificarTelegram(
        `📱 WhatsApp requiere autenticación\\n\\n` +
        `QR Code:\\n\`\`\`${qr}\`\`\`\\n\\n` +
        `Escanea con WhatsApp para continuar`
      );
    });

    // Evento: Autenticado
    this.client.on('authenticated', () => {
      console.log('🔐 WhatsApp autenticado correctamente');
    });

    // Evento: Error de autenticación
    this.client.on('auth_failure', async (msg) => {
      console.error('❌ Error de autenticación:', msg);
      await this.notificarTelegram(`❌ WhatsApp: Error de autenticación - ${msg}`);
      
      // Limpiar sesión corrupta
      await this.limpiarSesion();
    });

    // Evento: Desconexión
    this.client.on('disconnected', async (reason) => {
      console.log('🔌 WhatsApp desconectado:', reason);
      this.isReady = false;
      
      // Detener sistemas de mantenimiento
      this.detenerHeartbeat();
      this.detenerVerificacionConexion();
      
      const ahora = Date.now();
      
      // Solo notificar si ha pasado suficiente tiempo desde la última notificación
      if (ahora - this.lastDisconnectNotification > this.config.notificationCooldown) {
        await this.notificarTelegram(`⚠️ WhatsApp desconectado: ${reason}. Intentando reconectar...`);
        this.lastDisconnectNotification = ahora;
      }
      
      // Intentar reconectar automáticamente con backoff exponencial
      await this.reconectarConBackoff();
    });

    // Evento: Cambio de estado
    this.client.on('change_state', state => {
      console.log(`📊 WhatsApp estado: ${state}`);
      
      if (state === 'CONNECTED') {
        this.isReady = true;
      } else if (state === 'UNPAIRED' || state === 'UNPAIRED_IDLE') {
        this.isReady = false;
      }
    });

    // Evento: Error general
    this.client.on('error', async (error) => {
      console.error('❌ Error WhatsApp:', error.message);
      
      this.stats.errors.push({
        timestamp: new Date().toISOString(),
        error: error.message,
        type: 'runtime'
      });
      
      // Solo notificar errores críticos
      if (error.message.includes('TIMEOUT') || 
          error.message.includes('Protocol error') ||
          error.message.includes('Target closed')) {
        
        const ahora = Date.now();
        if (ahora - this.lastDisconnectNotification > this.config.notificationCooldown) {
          await this.notificarTelegram(`❌ WhatsApp error crítico: ${error.message.substring(0, 100)}`);
          this.lastDisconnectNotification = ahora;
        }
      }
    });

    // Evento: Mensajes (para debugging)
    this.client.on('message', msg => {
      console.log(`💬 Mensaje recibido de ${msg.from}: ${msg.body.substring(0, 50)}...`);
      this.lastActivity = Date.now();
    });
  }

  // Sistema de Heartbeat para mantener conexión activa
  iniciarHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    this.heartbeatInterval = setInterval(async () => {
      if (this.isReady) {
        try {
          // Verificar estado del cliente
          const state = await this.client.getState();
          console.log(`💓 Heartbeat - Estado: ${state} - Última actividad: ${this.formatearTiempoTranscurrido()}`);
          
          // Si ha pasado mucho tiempo sin actividad, enviar keepalive
          if (Date.now() - this.lastActivity > this.config.inactivityTimeout) {
            await this.enviarKeepalive();
          }
          
        } catch (error) {
          console.error('❌ Error en heartbeat:', error.message);
          this.isReady = false;
        }
      }
    }, this.config.heartbeatInterval);
  }

  detenerHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  // Verificación periódica de conexión
  iniciarVerificacionConexion() {
    if (this.connectionCheckInterval) {
      clearInterval(this.connectionCheckInterval);
    }
    
    this.connectionCheckInterval = setInterval(async () => {
      if (this.isReady) {
        try {
          // Intentar obtener información del cliente
          const info = await this.client.info;
          if (info) {
            console.log(`✅ Verificación de conexión OK - ${new Date().toLocaleTimeString()}`);
          } else {
            throw new Error('No se pudo obtener información del cliente');
          }
        } catch (error) {
          console.error('❌ Verificación de conexión falló:', error.message);
          this.isReady = false;
          await this.reconectarConBackoff();
        }
      }
    }, this.config.connectionCheckInterval);
  }

  detenerVerificacionConexion() {
    if (this.connectionCheckInterval) {
      clearInterval(this.connectionCheckInterval);
      this.connectionCheckInterval = null;
    }
  }

  // Keepalive automático para prevenir desconexiones
  iniciarKeepaliveAutomatico() {
    setInterval(async () => {
      if (this.isReady) {
        await this.enviarKeepalive();
      }
    }, this.config.keepaliveInterval);
  }

  async enviarKeepalive() {
    try {
      // Enviar un mensaje keepalive invisible (a nosotros mismos)
      const myNumber = this.client.info?.wid?.user;
      if (myNumber) {
        await this.client.sendMessage(`${myNumber}@c.us`, '🔄 Keepalive');
        console.log('🔄 Keepalive enviado');
        this.lastActivity = Date.now();
      }
    } catch (error) {
      console.error('❌ Error enviando keepalive:', error.message);
    }
  }

  // Reconexión con backoff exponencial mejorado
  async reconectarConBackoff() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('❌ Máximo de intentos de reconexión alcanzado');
      await this.notificarTelegram('❌ WhatsApp: No se pudo reconectar después de 10 intentos');
      return false;
    }

    this.reconnectAttempts++;
    this.stats.totalReconnects++;
    
    // Calcular delay con backoff exponencial pero con límite
    const delay = Math.min(
      this.config.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.config.maxReconnectDelay
    );
    
    console.log(`⏳ Reconexión intento ${this.reconnectAttempts}/${this.maxReconnectAttempts} en ${delay/1000} segundos...`);
    
    await new Promise(resolve => setTimeout(resolve, delay));
    
    try {
      // Intentar destruir el cliente anterior si existe
      if (this.client) {
        try {
          await this.client.destroy();
        } catch (e) {
          console.log('⚠️ No se pudo destruir cliente anterior:', e.message);
        }
      }
      
      // Reinicializar
      const success = await this.inicializar();
      
      if (success) {
        console.log('✅ Reconexión exitosa');
        return true;
      } else {
        // Intentar de nuevo
        return await this.reconectarConBackoff();
      }
      
    } catch (error) {
      console.error('❌ Error en reconexión:', error.message);
      return await this.reconectarConBackoff();
    }
  }

  // Backup y restauración de sesión
  async hacerBackupSesion() {
    try {
      if (fs.existsSync(this.sessionPath)) {
        // Copiar toda la carpeta de sesión
        const copiarDirectorio = (src, dest) => {
          if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
          }
          
          const archivos = fs.readdirSync(src);
          for (const archivo of archivos) {
            const srcPath = path.join(src, archivo);
            const destPath = path.join(dest, archivo);
            
            if (fs.lstatSync(srcPath).isDirectory()) {
              copiarDirectorio(srcPath, destPath);
            } else {
              fs.copyFileSync(srcPath, destPath);
            }
          }
        };
        
        copiarDirectorio(this.sessionPath, this.sessionBackupPath);
        console.log('💾 Backup de sesión WhatsApp creado');
      }
    } catch (error) {
      console.error('❌ Error creando backup:', error.message);
    }
  }

  async restaurarSesionSiNecesario() {
    try {
      // Si no hay sesión principal pero sí backup, restaurar
      if (!fs.existsSync(this.sessionPath) && fs.existsSync(this.sessionBackupPath)) {
        console.log('🔄 Restaurando sesión desde backup...');
        
        const copiarDirectorio = (src, dest) => {
          if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
          }
          
          const archivos = fs.readdirSync(src);
          for (const archivo of archivos) {
            const srcPath = path.join(src, archivo);
            const destPath = path.join(dest, archivo);
            
            if (fs.lstatSync(srcPath).isDirectory()) {
              copiarDirectorio(srcPath, destPath);
            } else {
              fs.copyFileSync(srcPath, destPath);
            }
          }
        };
        
        copiarDirectorio(this.sessionBackupPath, this.sessionPath);
        console.log('✅ Sesión restaurada desde backup');
      }
    } catch (error) {
      console.error('❌ Error restaurando sesión:', error.message);
    }
  }

  async limpiarSesion() {
    try {
      // Eliminar sesión corrupta
      if (fs.existsSync(this.sessionPath)) {
        fs.rmSync(this.sessionPath, { recursive: true, force: true });
        console.log('🧹 Sesión limpiada');
      }
      
      // Intentar restaurar desde backup
      await this.restaurarSesionSiNecesario();
      
    } catch (error) {
      console.error('❌ Error limpiando sesión:', error.message);
    }
  }

  // Funciones de envío de mensajes
  async enviarMensaje(texto) {
    if (!this.isReady) {
      console.log('⚠️ WhatsApp no está listo para enviar mensajes');
      return false;
    }

    if (!this.chatId) {
      console.log('⚠️ Chat ID no configurado');
      return false;
    }

    try {
      const chatIdFormateado = this.chatId.includes('@') ? this.chatId : `${this.chatId}@g.us`;
      await this.client.sendMessage(chatIdFormateado, texto);
      
      this.lastActivity = Date.now();
      this.stats.totalMessagessSent++;
      
      console.log('✅ Mensaje enviado por WhatsApp');
      return true;
      
    } catch (error) {
      console.error('❌ Error enviando mensaje WhatsApp:', error.message);
      
      this.stats.errors.push({
        timestamp: new Date().toISOString(),
        error: error.message,
        type: 'send_message'
      });
      
      // Si el error es de conexión, intentar reconectar
      if (error.message.includes('not ready') || error.message.includes('disconnected')) {
        this.isReady = false;
        await this.reconectarConBackoff();
      }
      
      return false;
    }
  }

  async enviarImagen(rutaImagen, caption) {
    if (!this.isReady) {
      console.log('⚠️ WhatsApp no está listo para enviar imágenes');
      return false;
    }

    if (!this.chatId) {
      console.log('⚠️ Chat ID no configurado');
      return false;
    }

    try {
      const media = MessageMedia.fromFilePath(rutaImagen);
      const chatIdFormateado = this.chatId.includes('@') ? this.chatId : `${this.chatId}@g.us`;
      
      await this.client.sendMessage(chatIdFormateado, media, { caption });
      
      this.lastActivity = Date.now();
      this.stats.totalMessagessSent++;
      
      console.log('✅ Imagen enviada por WhatsApp');
      return true;
      
    } catch (error) {
      console.error('❌ Error enviando imagen WhatsApp:', error.message);
      
      this.stats.errors.push({
        timestamp: new Date().toISOString(),
        error: error.message,
        type: 'send_image'
      });
      
      if (error.message.includes('not ready') || error.message.includes('disconnected')) {
        this.isReady = false;
        await this.reconectarConBackoff();
      }
      
      return false;
    }
  }

  async enviarVideo(rutaVideo, caption) {
    if (!this.isReady) {
      console.log('⚠️ WhatsApp no está listo para enviar videos');
      return false;
    }

    if (!this.chatId) {
      console.log('⚠️ Chat ID no configurado');
      return false;
    }

    try {
      console.log(`📹 Preparando video para WhatsApp: ${rutaVideo}`);
      
      // Verificar tamaño del archivo
      const stats = fs.statSync(rutaVideo);
      const fileSizeMB = stats.size / (1024 * 1024);
      
      if (fileSizeMB > 16) {
        console.log(`⚠️ Video muy grande para WhatsApp (${fileSizeMB.toFixed(2)} MB). Máximo: 16 MB`);
        // Enviar solo el mensaje con el caption
        return await this.enviarMensaje(`${caption}\\n⚠️ Video muy grande para WhatsApp (${fileSizeMB.toFixed(2)} MB)`);
      }
      
      const media = MessageMedia.fromFilePath(rutaVideo);
      const chatIdFormateado = this.chatId.includes('@') ? this.chatId : `${this.chatId}@g.us`;
      
      console.log('📤 Enviando video por WhatsApp...');
      await this.client.sendMessage(chatIdFormateado, media, { 
        caption,
        sendMediaAsDocument: false // Enviar como video, no como documento
      });
      
      this.lastActivity = Date.now();
      this.stats.totalMessagessSent++;
      
      console.log('✅ Video enviado por WhatsApp exitosamente');
      return true;
      
    } catch (error) {
      console.error('❌ Error enviando video WhatsApp:', error.message);
      
      this.stats.errors.push({
        timestamp: new Date().toISOString(),
        error: error.message,
        type: 'send_video'
      });
      
      // Si es error de conexión, intentar reconectar
      if (error.message.includes('not ready') || error.message.includes('disconnected')) {
        this.isReady = false;
        await this.reconectarConBackoff();
      }
      
      // Si es otro tipo de error, intentar enviar solo el mensaje
      try {
        console.log('⚠️ Intentando enviar solo el texto del video...');
        return await this.enviarMensaje(`${caption}\\n⚠️ No se pudo enviar el video`);
      } catch (e) {
        console.error('❌ Tampoco se pudo enviar el mensaje de texto:', e.message);
      }
      
      return false;
    }
  }

  // Notificación a Telegram
  async notificarTelegram(mensaje) {
    try {
      await this.telegramBot.sendMessage(this.telegramChatId, mensaje, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('❌ Error enviando notificación a Telegram:', error.message);
    }
  }

  // Utilidades
  formatearTiempoTranscurrido() {
    const ahora = Date.now();
    const diferencia = ahora - this.lastActivity;
    const minutos = Math.floor(diferencia / 60000);
    const segundos = Math.floor((diferencia % 60000) / 1000);
    return `${minutos}m ${segundos}s`;
  }

  getEstado() {
    const uptime = this.stats.lastConnectionTime 
      ? this.formatearTiempoDesde(new Date(this.stats.lastConnectionTime))
      : 'N/A';
    
    return {
      conectado: this.isReady,
      chatConfigured: !!this.chatId,
      reconnectAttempts: this.reconnectAttempts,
      totalReconnects: this.stats.totalReconnects,
      totalMessagessSent: this.stats.totalMessagessSent,
      uptime,
      lastActivity: this.formatearTiempoTranscurrido(),
      errorsCount: this.stats.errors.length,
      lastErrors: this.stats.errors.slice(-3) // Últimos 3 errores
    };
  }

  formatearTiempoDesde(fecha) {
    const ahora = new Date();
    const diferencia = ahora - fecha;
    const horas = Math.floor(diferencia / 3600000);
    const minutos = Math.floor((diferencia % 3600000) / 60000);
    return `${horas}h ${minutos}m`;
  }

  async cerrar() {
    try {
      console.log('🔌 Cerrando WhatsApp Bot...');
      
      // Detener sistemas de mantenimiento
      this.detenerHeartbeat();
      this.detenerVerificacionConexion();
      
      // Hacer backup final de la sesión
      await this.hacerBackupSesion();
      
      // Cerrar cliente
      if (this.client) {
        await this.client.destroy();
      }
      
      this.isReady = false;
      console.log('✅ WhatsApp Bot cerrado correctamente');
      
    } catch (error) {
      console.error('❌ Error cerrando WhatsApp Bot:', error.message);
    }
  }
}

export default WhatsAppBotMejorado;
*/