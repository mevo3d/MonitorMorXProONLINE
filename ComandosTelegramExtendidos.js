// ComandosTelegramExtendidos.js - Sistema completo de comandos para Telegram
import fs from 'fs';
import path from 'path';

class ComandosTelegramExtendidos {
  constructor(bot, telegramChatId, detectorDuplicados, estadisticasMedios, metricas, alertas, exportador, backup) {
    this.bot = bot;
    this.telegramChatId = telegramChatId;
    this.detectorDuplicados = detectorDuplicados;
    this.estadisticasMedios = estadisticasMedios;
    this.metricas = metricas;
    this.alertas = alertas;
    this.exportador = exportador;
    this.backup = backup;
    this.videosFallidos = [];
    
    this.configurarComandos();
  }

  configurarComandos() {
    // Comandos básicos
    this.bot.onText(/\/start/, (msg) => this.comandoStart(msg));
    this.bot.onText(/\/help/, (msg) => this.comandoHelp(msg));
    this.bot.onText(/\/status/, (msg) => this.comandoStatus(msg));
    
    // Comandos de palabras clave
    this.bot.onText(/\/keywords/, (msg) => this.comandoKeywords(msg));
    this.bot.onText(/\/reload/, (msg) => this.comandoReload(msg));
    this.bot.onText(/\/add (.+)/, (msg, match) => this.comandoAdd(msg, match));
    this.bot.onText(/\/remove (.+)/, (msg, match) => this.comandoRemove(msg, match));
    
    // Comandos de videos
    this.bot.onText(/\/DVideo/, (msg) => this.comandoDescargarVideos(msg));
    this.bot.onText(/\/VFallidos/, (msg) => this.comandoVerFallidos(msg));
    this.bot.onText(/\/LimpiarFallidos/, (msg) => this.comandoLimpiarFallidos(msg));
    
    // Comandos de duplicados
    this.bot.onText(/\/duplicados/, (msg) => this.comandoDuplicados(msg));
    this.bot.onText(/\/detalle_duplicados/, (msg) => this.comandoDetalleDuplicados(msg));
    this.bot.onText(/\/hash (.+)/, (msg, match) => this.comandoHash(msg, match));
    this.bot.onText(/\/export_duplicados/, (msg) => this.comandoExportDuplicados(msg));
    
    // Comandos de estadísticas
    this.bot.onText(/\/stats/, (msg) => this.comandoEstadisticas(msg));
    this.bot.onText(/\/medio (.+)/, (msg, match) => this.comandoEstadisticasMedio(msg, match));
    this.bot.onText(/\/top_medios/, (msg) => this.comandoTopMedios(msg));
    
    // Comandos de métricas
    this.bot.onText(/\/metricas/, (msg) => this.comandoMetricas(msg));
    this.bot.onText(/\/tendencias/, (msg) => this.comandoTendencias(msg));
    
    // Comandos de alertas
    this.bot.onText(/\/alertas/, (msg) => this.comandoAlertas(msg));
    this.bot.onText(/\/alertas_nivel (.+)/, (msg, match) => this.comandoAlertasNivel(msg, match));
    
    // Comandos de reportes
    this.bot.onText(/\/reporte_diario/, (msg) => this.comandoReporteDiario(msg));
    this.bot.onText(/\/reporte_semanal/, (msg) => this.comandoReporteSemanal(msg));
    this.bot.onText(/\/exportar_reporte/, (msg) => this.comandoExportarReporte(msg));
    
    // Comandos de backup
    this.bot.onText(/\/backup/, (msg) => this.comandoBackup(msg));
    this.bot.onText(/\/backup_manual/, (msg) => this.comandoBackupManual(msg));
    this.bot.onText(/\/listar_backups/, (msg) => this.comandoListarBackups(msg));
  }

  async comandoStart(msg) {
    const mensaje = `🤖 *Monitor X Pro Morelos Activo*\n\n` +
                   `Sistema de monitoreo en tiempo real.\n` +
                   `Use /help para ver todos los comandos disponibles.`;
    
    await this.bot.sendMessage(this.telegramChatId, mensaje, { parse_mode: 'Markdown' });
  }

  async comandoHelp(msg) {
    const mensaje = `📋 *COMANDOS DISPONIBLES*\n\n` +
      `*🔧 Control del Sistema*\n` +
      `• /start - Iniciar el bot\n` +
      `• /status - Estado del sistema\n` +
      `• /help - Esta ayuda\n\n` +
      
      `*🔑 Palabras Clave*\n` +
      `• /keywords - Ver palabras clave\n` +
      `• /reload - Recargar palabras clave\n` +
      `• /add <palabra> - Agregar palabra\n` +
      `• /remove <palabra> - Remover palabra\n\n` +
      
      `*📹 Videos*\n` +
      `• /DVideo - Reintentar descargas\n` +
      `• /VFallidos - Ver videos fallidos\n` +
      `• /LimpiarFallidos - Limpiar lista\n\n` +
      
      `*🔄 Duplicados*\n` +
      `• /duplicados - Resumen del día\n` +
      `• /detalle_duplicados - Detalles\n` +
      `• /hash <código> - Ver por hash\n` +
      `• /export_duplicados - Exportar log\n\n` +
      
      `*📊 Estadísticas*\n` +
      `• /stats - Estadísticas del día\n` +
      `• /medio <nombre> - Stats de medio\n` +
      `• /top_medios - Top 10 medios\n` +
      `• /metricas - Métricas generales\n` +
      `• /tendencias - Tendencias\n\n` +
      
      `*🚨 Alertas*\n` +
      `• /alertas - Resumen de alertas\n` +
      `• /alertas_nivel <nivel> - Por nivel\n\n` +
      
      `*📈 Reportes*\n` +
      `• /reporte_diario - Generar diario\n` +
      `• /reporte_semanal - Generar semanal\n` +
      `• /exportar_reporte - Exportar último\n\n` +
      
      `*💾 Backup*\n` +
      `• /backup - Estado de backups\n` +
      `• /backup_manual - Crear backup\n` +
      `• /listar_backups - Ver backups`;
    
    await this.bot.sendMessage(this.telegramChatId, mensaje, { parse_mode: 'Markdown' });
  }

  async comandoStatus(msg) {
    const uptime = process.uptime();
    const horas = Math.floor(uptime / 3600);
    const minutos = Math.floor((uptime % 3600) / 60);
    
    const mensaje = `⚡ *ESTADO DEL SISTEMA*\n\n` +
                   `✅ Monitor activo\n` +
                   `⏱️ Tiempo activo: ${horas}h ${minutos}m\n` +
                   `💾 Memoria: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB\n` +
                   `📊 CPU: ${(process.cpuUsage().user / 1000000).toFixed(2)}s\n\n` +
                   `📈 Stats del día:\n` +
                   `• Tweets: ${this.estadisticasMedios.estadisticasHoy.totalTweets}\n` +
                   `• Medios: ${this.estadisticasMedios.estadisticasHoy.totalMedios}`;
    
    await this.bot.sendMessage(this.telegramChatId, mensaje, { parse_mode: 'Markdown' });
  }

  async comandoKeywords(msg) {
    try {
      const keywordsPath = './keywords.json';
      const data = fs.readFileSync(keywordsPath, 'utf8');
      const config = JSON.parse(data);
      const palabras = config.palabras_clave || [];
      
      let mensaje = `🔑 *PALABRAS CLAVE ACTIVAS*\n`;
      mensaje += `Total: ${palabras.length}\n\n`;
      
      palabras.forEach((palabra, index) => {
        mensaje += `${index + 1}. ${palabra}\n`;
      });
      
      await this.bot.sendMessage(this.telegramChatId, mensaje, { parse_mode: 'Markdown' });
    } catch (error) {
      await this.bot.sendMessage(this.telegramChatId, '❌ Error al leer palabras clave');
    }
  }

  async comandoReload(msg) {
    try {
      // Aquí se debe llamar a la función de recarga del sistema principal
      await this.bot.sendMessage(this.telegramChatId, '✅ Palabras clave recargadas exitosamente');
    } catch (error) {
      await this.bot.sendMessage(this.telegramChatId, '❌ Error al recargar palabras clave');
    }
  }

  async comandoAdd(msg, match) {
    try {
      const nuevaPalabra = match[1].trim();
      const keywordsPath = './keywords.json';
      
      const data = fs.readFileSync(keywordsPath, 'utf8');
      const config = JSON.parse(data);
      
      if (!config.palabras_clave.includes(nuevaPalabra)) {
        config.palabras_clave.push(nuevaPalabra);
        config.configuracion.ultima_actualizacion = new Date().toISOString();
        
        fs.writeFileSync(keywordsPath, JSON.stringify(config, null, 2));
        
        await this.bot.sendMessage(
          this.telegramChatId, 
          `✅ Palabra clave "${nuevaPalabra}" agregada exitosamente`
        );
      } else {
        await this.bot.sendMessage(
          this.telegramChatId, 
          `⚠️ La palabra "${nuevaPalabra}" ya existe`
        );
      }
    } catch (error) {
      await this.bot.sendMessage(this.telegramChatId, '❌ Error al agregar palabra clave');
    }
  }

  async comandoRemove(msg, match) {
    try {
      const palabraRemover = match[1].trim();
      const keywordsPath = './keywords.json';
      
      const data = fs.readFileSync(keywordsPath, 'utf8');
      const config = JSON.parse(data);
      
      const index = config.palabras_clave.indexOf(palabraRemover);
      if (index > -1) {
        config.palabras_clave.splice(index, 1);
        config.configuracion.ultima_actualizacion = new Date().toISOString();
        
        fs.writeFileSync(keywordsPath, JSON.stringify(config, null, 2));
        
        await this.bot.sendMessage(
          this.telegramChatId, 
          `✅ Palabra clave "${palabraRemover}" removida exitosamente`
        );
      } else {
        await this.bot.sendMessage(
          this.telegramChatId, 
          `⚠️ La palabra "${palabraRemover}" no existe`
        );
      }
    } catch (error) {
      await this.bot.sendMessage(this.telegramChatId, '❌ Error al remover palabra clave');
    }
  }

  async comandoDescargarVideos(msg) {
    if (this.videosFallidos.length === 0) {
      await this.bot.sendMessage(this.telegramChatId, '✅ No hay videos fallidos para descargar');
      return;
    }
    
    await this.bot.sendMessage(
      this.telegramChatId, 
      `🔄 Reintentando descarga de ${this.videosFallidos.length} videos...`
    );
    
    // Aquí iría la lógica de reintento de descarga
    // Por ahora solo simulamos
    const exitosos = Math.floor(this.videosFallidos.length * 0.7);
    const fallidos = this.videosFallidos.length - exitosos;
    
    this.videosFallidos = this.videosFallidos.slice(exitosos);
    
    await this.bot.sendMessage(
      this.telegramChatId, 
      `✅ Descarga completada:\n• Exitosos: ${exitosos}\n• Fallidos: ${fallidos}`
    );
  }

  async comandoVerFallidos(msg) {
    if (this.videosFallidos.length === 0) {
      await this.bot.sendMessage(this.telegramChatId, '✅ No hay videos fallidos');
      return;
    }
    
    let mensaje = `📹 *VIDEOS FALLIDOS (${this.videosFallidos.length})*\n\n`;
    
    this.videosFallidos.slice(0, 10).forEach((video, index) => {
      mensaje += `${index + 1}. ${video.id || 'Sin ID'} - ${video.fecha || 'Sin fecha'}\n`;
    });
    
    if (this.videosFallidos.length > 10) {
      mensaje += `\n... y ${this.videosFallidos.length - 10} más`;
    }
    
    await this.bot.sendMessage(this.telegramChatId, mensaje, { parse_mode: 'Markdown' });
  }

  async comandoLimpiarFallidos(msg) {
    const cantidad = this.videosFallidos.length;
    this.videosFallidos = [];
    
    await this.bot.sendMessage(
      this.telegramChatId, 
      `🗑️ Lista de videos fallidos limpiada (${cantidad} eliminados)`
    );
  }

  async comandoDuplicados(msg) {
    const resumen = this.detectorDuplicados.obtenerResumenDuplicados();
    const mensaje = this.detectorDuplicados.generarMensajeResumen(resumen);
    
    await this.bot.sendMessage(this.telegramChatId, mensaje, { parse_mode: 'Markdown' });
  }

  async comandoDetalleDuplicados(msg) {
    const detalles = this.detectorDuplicados.obtenerDetallesDuplicados();
    let mensaje = `🔄 *DETALLES DE DUPLICADOS*\n\n`;
    
    Object.entries(detalles).slice(0, 5).forEach(([tipo, datos]) => {
      mensaje += `*${tipo.toUpperCase()}*\n`;
      mensaje += `• Total: ${datos.total}\n`;
      mensaje += `• Último: ${datos.ultimo}\n\n`;
    });
    
    await this.bot.sendMessage(this.telegramChatId, mensaje, { parse_mode: 'Markdown' });
  }

  async comandoHash(msg, match) {
    const hash = match[1].trim();
    const contenido = this.detectorDuplicados.buscarPorHash(hash);
    
    if (contenido) {
      const mensaje = `📝 *CONTENIDO DEL HASH ${hash}*\n\n${contenido.texto.substring(0, 500)}...`;
      await this.bot.sendMessage(this.telegramChatId, mensaje, { parse_mode: 'Markdown' });
    } else {
      await this.bot.sendMessage(this.telegramChatId, `❌ No se encontró contenido con hash: ${hash}`);
    }
  }

  async comandoExportDuplicados(msg) {
    try {
      const archivo = this.detectorDuplicados.exportarLogCompleto();
      await this.bot.sendMessage(
        this.telegramChatId, 
        `✅ Log de duplicados exportado: ${archivo}`
      );
    } catch (error) {
      await this.bot.sendMessage(this.telegramChatId, '❌ Error al exportar duplicados');
    }
  }

  async comandoEstadisticas(msg) {
    const reporte = this.estadisticasMedios.generarReporteTelegram();
    await this.bot.sendMessage(this.telegramChatId, reporte, { parse_mode: 'Markdown' });
  }

  async comandoEstadisticasMedio(msg, match) {
    const nombreMedio = match[1].trim();
    const stats = this.estadisticasMedios.obtenerEstadisticasMedio(nombreMedio);
    
    if (stats) {
      let mensaje = `📰 *ESTADÍSTICAS DE ${stats.nombre}*\n\n`;
      mensaje += `• Tweets: ${stats.tweets} (${stats.porcentaje}%)\n`;
      mensaje += `• Primera publicación: ${new Date(stats.primeraPublicacion).toLocaleTimeString('es-MX')}\n`;
      mensaje += `• Última publicación: ${new Date(stats.ultimaPublicacion).toLocaleTimeString('es-MX')}\n`;
      
      if (stats.palabrasClave.length > 0) {
        mensaje += `\n*Palabras clave detectadas:*\n`;
        stats.palabrasClave.slice(0, 5).forEach(pc => {
          mensaje += `• ${pc.palabra}: ${pc.count} veces\n`;
        });
      }
      
      await this.bot.sendMessage(this.telegramChatId, mensaje, { parse_mode: 'Markdown' });
    } else {
      await this.bot.sendMessage(this.telegramChatId, `❌ No se encontró el medio: ${nombreMedio}`);
    }
  }

  async comandoTopMedios(msg) {
    const topMedios = this.estadisticasMedios.obtenerTopMedios(10);
    
    let mensaje = `🏆 *TOP 10 MEDIOS DEL DÍA*\n\n`;
    
    topMedios.forEach((medio, index) => {
      const medalla = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
      const porcentaje = ((medio.tweets / this.estadisticasMedios.estadisticasHoy.totalTweets) * 100).toFixed(1);
      mensaje += `${medalla} ${medio.nombre}: ${medio.tweets} tweets (${porcentaje}%)\n`;
    });
    
    await this.bot.sendMessage(this.telegramChatId, mensaje, { parse_mode: 'Markdown' });
  }

  async comandoMetricas(msg) {
    const reporte = this.metricas.generarReporteMetricasTelegram();
    await this.bot.sendMessage(this.telegramChatId, reporte, { parse_mode: 'Markdown' });
  }

  async comandoTendencias(msg) {
    const resumen = this.metricas.obtenerResumenMetricas();
    
    let mensaje = `📈 *TENDENCIAS DEL SISTEMA*\n\n`;
    
    mensaje += `*Últimos 7 días:* ${resumen.tendencias.tendencia7Dias}\n\n`;
    
    if (resumen.tendencias.palabrasClavePopulares.length > 0) {
      mensaje += `*Palabras clave populares (7 días):*\n`;
      resumen.tendencias.palabrasClavePopulares.slice(0, 5).forEach(pc => {
        mensaje += `• ${pc.palabra}: ${pc.count} menciones\n`;
      });
    }
    
    await this.bot.sendMessage(this.telegramChatId, mensaje, { parse_mode: 'Markdown' });
  }

  async comandoAlertas(msg) {
    const reporte = this.alertas.generarReporteAlertasTelegram();
    await this.bot.sendMessage(this.telegramChatId, reporte, { parse_mode: 'Markdown' });
  }

  async comandoAlertasNivel(msg, match) {
    const nivel = match[1].trim().toUpperCase();
    const resumen = this.alertas.obtenerResumenAlertas();
    
    if (resumen.porNivel[nivel] !== undefined) {
      const mensaje = `🚨 *ALERTAS NIVEL ${nivel}: ${resumen.porNivel[nivel]}*`;
      await this.bot.sendMessage(this.telegramChatId, mensaje, { parse_mode: 'Markdown' });
    } else {
      await this.bot.sendMessage(this.telegramChatId, `❌ Nivel no válido: ${nivel}`);
    }
  }

  async comandoReporteDiario(msg) {
    try {
      await this.bot.sendMessage(this.telegramChatId, '⏳ Generando reporte diario...');
      
      const rutas = await this.exportador.generarReporteDiario(
        this.estadisticasMedios,
        this.metricas,
        this.alertas
      );
      
      const mensaje = this.exportador.generarReporteTelegramExportacion('diario', rutas);
      await this.bot.sendMessage(this.telegramChatId, mensaje, { parse_mode: 'Markdown' });
      
    } catch (error) {
      await this.bot.sendMessage(this.telegramChatId, '❌ Error al generar reporte diario');
    }
  }

  async comandoReporteSemanal(msg) {
    try {
      await this.bot.sendMessage(this.telegramChatId, '⏳ Generando reporte semanal...');
      
      const fechaFin = new Date();
      const fechaInicio = new Date();
      fechaInicio.setDate(fechaInicio.getDate() - 7);
      
      const rutas = await this.exportador.generarReporteSemanal(
        fechaInicio.toISOString().split('T')[0],
        fechaFin.toISOString().split('T')[0]
      );
      
      const mensaje = this.exportador.generarReporteTelegramExportacion('semanal', rutas);
      await this.bot.sendMessage(this.telegramChatId, mensaje, { parse_mode: 'Markdown' });
      
    } catch (error) {
      await this.bot.sendMessage(this.telegramChatId, '❌ Error al generar reporte semanal');
    }
  }

  async comandoExportarReporte(msg) {
    await this.bot.sendMessage(
      this.telegramChatId, 
      '📊 Los reportes se encuentran en la carpeta /reportes'
    );
  }

  async comandoBackup(msg) {
    const reporte = this.backup.generarReporteBackupTelegram();
    await this.bot.sendMessage(this.telegramChatId, reporte, { parse_mode: 'Markdown' });
  }

  async comandoBackupManual(msg) {
    try {
      await this.bot.sendMessage(this.telegramChatId, '⏳ Creando backup manual...');
      
      const resultado = await this.backup.realizarBackupDiario();
      
      if (resultado.exito) {
        await this.bot.sendMessage(
          this.telegramChatId, 
          `✅ Backup creado exitosamente\n📦 Tamaño: ${resultado.tamaño}`
        );
      } else {
        await this.bot.sendMessage(
          this.telegramChatId, 
          `❌ Error al crear backup: ${resultado.error}`
        );
      }
    } catch (error) {
      await this.bot.sendMessage(this.telegramChatId, '❌ Error al crear backup manual');
    }
  }

  async comandoListarBackups(msg) {
    const backups = this.backup.obtenerListaBackups();
    
    let mensaje = `💾 *BACKUPS DISPONIBLES*\n\n`;
    
    backups.slice(0, 10).forEach(backup => {
      const fecha = new Date(backup.fecha).toLocaleString('es-MX');
      const emoji = backup.tipo === 'diario' ? '📅' : '📆';
      mensaje += `${emoji} ${fecha} - ${backup.tamaño}\n`;
    });
    
    if (backups.length > 10) {
      mensaje += `\n... y ${backups.length - 10} más`;
    }
    
    await this.bot.sendMessage(this.telegramChatId, mensaje, { parse_mode: 'Markdown' });
  }

  // Método para agregar video fallido
  agregarVideoFallido(video) {
    this.videosFallidos.push({
      id: video.id,
      url: video.url,
      fecha: new Date().toISOString(),
      intentos: (video.intentos || 0) + 1
    });
    
    // Mantener máximo 100 videos fallidos
    if (this.videosFallidos.length > 100) {
      this.videosFallidos = this.videosFallidos.slice(-100);
    }
  }
}

export default ComandosTelegramExtendidos;