#!/usr/bin/env node
// services/telegram-notifier.js - Monitor X Morelos - Servicio de Notificaciones Telegram
import dotenv from 'dotenv';
dotenv.config();

import TelegramBot from 'node-telegram-bot-api';
import DatabaseConnection from '../database/connection.js';
import fs from 'fs';
import path from 'path';
import cron from 'node-cron';

class TelegramNotifierService {
  constructor() {
    this.bot = new TelegramBot(process.env.TELEGRAM_TOKEN);
    this.chatId = process.env.TELEGRAM_CHAT_ID;
    this.db = new DatabaseConnection();
    this.isRunning = false;

    // Contadores para reportes
    this.contadores = {
      x: { publicaciones: 0, procesadas: 0, errores: 0 },
      facebook: { publicaciones: 0, procesadas: 0, errores: 0 },
      youtube: { publicaciones: 0, procesadas: 0, errores: 0 },
      rss: { publicaciones: 0, procesadas: 0, errores: 0 }
    };

    console.log('📱 Telegram Notifier Service inicializado');
  }

  async iniciar() {
    console.log('🚀 Iniciando Telegram Notifier Service...');
    this.isRunning = true;

    // Conectar a base de datos
    await this.db.conectar();

    // Configurar comandos del bot
    this.configurarComandos();

    // Programar reportes automáticos
    this.programarReportes();

    // Enviar mensaje de inicio
    await this.enviarMensajeSistema('🚀 Monitor X Morelos v2.0 - Iniciando todos los servicios de monitoreo\n\n📊 Servicios activos:\n• X (Twitter)\n• Facebook\n• YouTube\n• RSS Feeds\n• Dashboard Web\n\n⏡ Reporte semanal: Domingos 8:00 PM');

    console.log('✅ Telegram Notifier Service iniciado');
  }

  configurarComandos() {
    this.bot.onText(/\/status/, async (msg) => {
      await this.mostrarStatus();
    });

    this.bot.onText(/\/estadisticas/, async (msg) => {
      await this.mostrarEstadisticas();
    });

    this.bot.onText(/\/ultimas/, async (msg) => {
      await this.mostrarUltimasPublicaciones();
    });

    this.bot.onText(/\/keywords/, async (msg) => {
      await this.mostrarKeywords();
    });

    this.bot.onText(/\/reporte/, async (msg) => {
      await this.enviarReporteSemanal();
    });

    this.bot.onText(/\/help/, async (msg) => {
      await this.mostrarAyuda();
    });
  }

  async enviarAlerta(plataforma, tipo, contenido, metadata = {}) {
    try {
      const iconos = {
        x: '🐦',
        facebook: '📘',
        youtube: '📺',
        rss: '📰'
      };

      const emojiTipo = {
        normal: 'ℹ️',
        urgente: '🚨',
        info: '📋',
        error: '❌'
      };

      const icono = iconos[plataforma] || '📢';
      const emoji = emojiTipo[tipo] || emojiTipo.normal;

      let mensaje = `${icono} **${plataforma.toUpperCase()} ${emoji}**\n\n`;

      // Agregar categorías si existen
      if (metadata.categorias && metadata.categorias.length > 0) {
        mensaje += `🏷️ Categorías: ${metadata.categorias.join(', ')}\n`;
      }

      // Agregar sentimiento si existe
      if (metadata.sentimiento !== undefined) {
        const sentimientoEmoji = metadata.sentimiento > 0.3 ? '😊' : metadata.sentimiento < -0.3 ? '😟' : '😐';
        mensaje += `🎭 Sentimiento: ${sentimientoEmoji} ${metadata.sentimiento.toFixed(2)}\n`;
      }

      mensaje += `\n${contenido.substring(0, 800)}${contenido.length > 800 ? '...' : ''}`;

      // Agregar información adicional
      if (metadata.autor) {
        mensaje += `\n\n👤 Autor: ${metadata.autor}`;
      }

      if (metadata.url) {
        mensaje += `\n🔗 [Ver original](${metadata.url})`;
      }

      if (metadata.idUnico) {
        mensaje += `\n🆔 ID: ${metadata.idUnico}`;
      }

      await this.bot.sendMessage(this.chatId, mensaje, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      });

      // Actualizar contadores
      if (this.contadores[plataforma]) {
        this.contadores[plataforma].procesadas++;
      }

      // Registrar en base de datos
      await this.registrarEnvio(plataforma, tipo, contenido, metadata);

      console.log(`✅ Alerta enviada - ${plataforma}: ${contenido.substring(0, 50)}...`);

    } catch (error) {
      console.error('❌ Error enviando alerta:', error.message);

      if (this.contadores[plataforma]) {
        this.contadores[plataforma].errores++;
      }
    }
  }

  async enviarMensajeSistema(mensaje) {
    try {
      await this.bot.sendMessage(this.chatId, `🤖 **SISTEMA**\n\n${mensaje}`, {
        parse_mode: 'Markdown'
      });
    } catch (error) {
      console.error('❌ Error enviando mensaje de sistema:', error.message);
    }
  }

  async mostrarStatus() {
    try {
      let mensaje = '📊 **ESTADO DEL SISTEMA**\n\n';

      // Estado de servicios
      const servicios = [
        { nombre: 'X Monitor', plataforma: 'x', estado: '🟢 Activo' },
        { nombre: 'Facebook Monitor', plataforma: 'facebook', estado: '🟡 Iniciando' },
        { nombre: 'YouTube Monitor', plataforma: 'youtube', estado: '🟡 Iniciando' },
        { nombre: 'RSS Monitor', plataforma: 'rss', estado: '🟡 Iniciando' },
        { nombre: 'Base de Datos', plataforma: 'db', estado: '🟢 Conectada' },
        { nombre: 'Dashboard Web', plataforma: 'web', estado: '🟡 Preparando' }
      ];

      mensaje += '🔧 **Servicios:**\n';
      servicios.forEach(servicio => {
        mensaje += `  ${servicio.estado} ${servicio.nombre}\n`;
      });

      mensaje += '\n📈 **Contadores del día:**\n';
      for (const [plataforma, contador] of Object.entries(this.contadores)) {
        const icono = { x: '🐦', facebook: '📘', youtube: '📺', rss: '📰' }[plataforma] || '📢';
        mensaje += `  ${icono} ${plataforma.toUpperCase()}: ${contador.procesadas} procesadas`;
        if (contador.errores > 0) {
          mensaje += ` ❌ ${contador.errores} errores`;
        }
        mensaje += '\n';
      }

      // Última actualización
      mensaje += `\n🕐 Última actualización: ${new Date().toLocaleString('es-MX')}`;

      await this.bot.sendMessage(this.chatId, mensaje, {
        parse_mode: 'Markdown'
      });

    } catch (error) {
      console.error('❌ Error mostrando status:', error.message);
    }
  }

  async mostrarEstadisticas() {
    try {
      // Obtener estadísticas de la base de datos
      const stats = await this.obtenerEstadisticasBD();

      let mensaje = '📈 **ESTADÍSTICAS GENERALES**\n\n';

      mensaje += '📊 **Publicaciones totales por plataforma:**\n';
      if (stats && stats.length > 0) {
        stats.forEach(stat => {
          const icono = {
            x: '🐦',
            facebook: '📘',
            youtube: '📺',
            rss: '📰'
          }[stat.plataforma] || '📢';

          mensaje += `  ${icono} ${stat.plataforma.toUpperCase()}: ${stat.total} publicaciones\n`;
        });
      } else {
        mensaje += '  📂 No hay datos disponibles\n';
      }

      // Agregar estadísticas locales del día
      mensaje += '\n📋 **Hoy (contadores locales):**\n';
      for (const [plataforma, contador] of Object.entries(this.contadores)) {
        const icono = { x: '🐦', facebook: '📘', youtube: '📺', rss: '📰' }[plataforma] || '📢';
        mensaje += `  ${icono} ${plataforma.toUpperCase()}: ${contador.procesadas} procesadas, ${contador.errores} errores\n`;
      }

      await this.bot.sendMessage(this.chatId, mensaje, {
        parse_mode: 'Markdown'
      });

    } catch (error) {
      console.error('❌ Error mostrando estadísticas:', error.message);
      await this.enviarMensajeSistema('❌ Error al obtener estadísticas de la base de datos');
    }
  }

  async mostrarUltimasPublicaciones() {
    try {
      const publicaciones = await this.db.obtenerPublicaciones(10, 0, {});

      let mensaje = '📰 **ÚLTIMAS 10 PUBLICACIONES**\n\n';

      if (publicaciones.length === 0) {
        mensaje += '📂 No hay publicaciones recientes';
      } else {
        publicaciones.forEach((pub, index) => {
          const icono = {
            x: '🐦',
            facebook: '📘',
            youtube: '📺',
            rss: '📰'
          }[pub.plataforma] || '📢';

          const urgencia = pub.urgencia === 'urgente' ? '🚨' : '';
          const fecha = new Date(pub.fecha_publicacion).toLocaleString('es-MX');

          mensaje += `${index + 1}. ${urgencia}${icono} **${pub.plataforma.toUpperCase()}** (${pub.id_unico})\n`;
          mensaje += `   ${pub.contenido.substring(0, 100)}${pub.contenido.length > 100 ? '...' : ''}\n`;
          mensaje += `   🕐 ${fecha}\n\n`;
        });
      }

      await this.bot.sendMessage(this.chatId, mensaje, {
        parse_mode: 'Markdown'
      });

    } catch (error) {
      console.error('❌ Error mostrando últimas publicaciones:', error.message);
    }
  }

  async mostrarKeywords() {
    try {
      try {
        const keywordsData = JSON.parse(fs.readFileSync('keywords.json', 'utf8'));
        const keywords = keywordsData.palabras || [];

        let mensaje = `🔑 **PALABRAS CLAVE ACTIVAS**\n\n`;
        mensaje += `📊 Total: ${keywords.length} palabras\n\n`;

        // Mostrar primeras 20 palabras clave
        const mostrar = keywords.slice(0, 20);
        mostrar.forEach((keyword, index) => {
          mensaje += `${index + 1}. ${keyword}\n`;
        });

        if (keywords.length > 20) {
          mensaje += `\n... y ${keywords.length - 20} más`;
        }

        mensaje += `\n\n📅 Última actualización: ${keywordsData.fecha_actualizacion || 'Desconocida'}`;

        await this.bot.sendMessage(this.chatId, mensaje, {
          parse_mode: 'Markdown'
        });

      } catch (fileError) {
        await this.enviarMensajeSistema('❌ No se pudo cargar el archivo de palabras clave');
      }

    } catch (error) {
      console.error('❌ Error mostrando keywords:', error.message);
    }
  }

  async mostrarAyuda() {
    const mensaje = `🤖 **COMANDOS DISPONIBLES**\n\n` +
      `📊 **Estado y Estadísticas:**\n` +
      `  /status - Estado actual del sistema\n` +
      `  /estadisticas - Estadísticas generales\n` +
      `  /ultimas - Últimas 10 publicaciones\n\n` +
      `🔑 **Configuración:**\n` +
      `  /keywords - Mostrar palabras clave activas\n` +
      `  /reporte - Enviar reporte semanal manual\n\n` +
      `📋 **Información:**\n` +
      `  /help - Mostrar esta ayuda\n\n` +
      `💡 **Monitor X Morelos v2.0**\n` +
      `   Monitoreo 24/7 de X, Facebook, YouTube y RSS`;

    await this.bot.sendMessage(this.chatId, mensaje, {
      parse_mode: 'Markdown'
    });
  }

  async enviarReporteSemanal() {
    try {
      const stats = await this.obtenerEstadisticasBD();
      const fechaActual = new Date().toLocaleDateString('es-MX');

      let mensaje = `📊 **REPORTE SEMANAL - Monitor X Morelos**\n\n`;
      mensaje += `📅 Semana del: ${fechaActual}\n\n`;

      // Resumen de actividad
      let totalPublicaciones = 0;
      if (stats && stats.length > 0) {
        stats.forEach(stat => {
          totalPublicaciones += parseInt(stat.total) || 0;
        });
      }

      mensaje += `📈 **Resumen de actividad:**\n`;
      mensaje += `  📰 Total publicaciones monitoreadas: ${totalPublicaciones}\n`;
      mensaje += `  ✅ Publicaciones procesadas: ${this.contadores.x.procesadas + this.contadores.facebook.procesadas + this.contadores.youtube.procesadas + this.contadores.rss.procesadas}\n`;
      mensaje += `  ❌ Errores registrados: ${this.contadores.x.errores + this.contadores.facebook.errores + this.contadores.youtube.errores + this.contadores.rss.errores}\n\n`;

      // Detalles por plataforma
      mensaje += `🔍 **Detalles por plataforma:**\n`;
      if (stats && stats.length > 0) {
        stats.forEach(stat => {
          const icono = {
            x: '🐦',
            facebook: '📘',
            youtube: '📺',
            rss: '📰'
          }[stat.plataforma] || '📢';

          mensaje += `  ${icono} ${stat.plataforma.toUpperCase()}: ${stat.total} publicaciones\n`;
        });
      }

      mensaje += `\n💡 **Sistema operativo**: 24/7\n`;
      mensaje += `🕐 **Generado**: ${new Date().toLocaleString('es-MX')}`;

      await this.bot.sendMessage(this.chatId, mensaje, {
        parse_mode: 'Markdown'
      });

      console.log('✅ Reporte semanal enviado');

    } catch (error) {
      console.error('❌ Error generando reporte semanal:', error.message);
    }
  }

  async obtenerEstadisticasBD() {
    try {
      const query = `
        SELECT plataforma, COUNT(*) as total
        FROM publicaciones
        WHERE fecha_publicacion >= CURRENT_DATE - INTERVAL '7 days'
        GROUP BY plataforma
        ORDER BY total DESC
      `;

      const result = await this.db.ejecutarQuery(query);
      return result.rows;

    } catch (error) {
      console.error('❌ Error obteniendo estadísticas:', error.message);
      return [];
    }
  }

  async registrarEnvio(plataforma, tipo, contenido, metadata) {
    try {
      // Actualizar contador de publicaciones procesadas
      if (this.contadores[plataforma]) {
        this.contadores[plataforma].publicaciones++;
      }

      // Insertar en base de datos
      await this.db.insertarPublicacion({
        idUnico: metadata.idUnico || `tel-${Date.now()}`,
        plataforma: plataforma,
        tipo: tipo,
        contenido: contenido,
        autor: metadata.autor,
        url: metadata.url,
        palabrasClave: metadata.palabrasClave || [],
        categorias: metadata.categorias || [],
        sentimiento: metadata.sentimiento,
        urgencia: tipo === 'urgente' ? 'urgente' : 'normal',
        mediaUrls: metadata.mediaUrls || [],
        metadata: {
          enviadoPor: 'telegram-notifier',
          fechaEnvio: new Date().toISOString(),
          ...metadata
        }
      });

    } catch (error) {
      console.error('❌ Error registrando envío:', error.message);
    }
  }

  programarReportes() {
    // Reporte semanal - Todos los domingos a las 8:00 PM
    cron.schedule('0 20 * * 0', async () => {
      console.log('📊 Generando reporte semanal programado...');
      await this.enviarReporteSemanal();
    });

    // Status diario - Todos los días a las 9:00 AM
    cron.schedule('0 9 * * *', async () => {
      console.log('📊 Enviando status diario programado...');
      await this.mostrarStatus();
    });

    console.log('⏰ Reportes programados configurados');
  }

  async detener() {
    console.log('🛑 Deteniendo Telegram Notifier Service...');
    this.isRunning = false;

    if (this.db) {
      await this.db.desconectar();
    }

    await this.enviarMensajeSistema('🛑 Monitor X Morelos v2.0 - Sistema detenido');

    console.log('✅ Telegram Notifier Service detenido');
  }
}

// Iniciar el servicio
const telegramNotifier = new TelegramNotifierService();

// Manejar señales de cierre
process.on('SIGINT', async () => {
  await telegramNotifier.detener();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await telegramNotifier.detener();
  process.exit(0);
});

// Iniciar servicio
telegramNotifier.iniciar().catch(error => {
  console.error('❌ Error fatal en Telegram Notifier Service:', error);
  process.exit(1);
});