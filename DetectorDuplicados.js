// DetectorDuplicados.js - Sistema inteligente de detección de contenido similar
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import TelegramBot from 'node-telegram-bot-api';
import RegistroEnviados from './RegistroEnviados.js';

class DetectorDuplicados {
  constructor() {
    this.cache = new Map(); // Cache temporal de contenido
    this.omisionesHoy = []; // Omisiones del día actual
    this.carpetaOmisiones = './logs/omisiones';
    this.archivoEstadisticas = './logs/estadisticas-duplicados.json';
    this.registroEnviados = new RegistroEnviados(); // Sistema de tweets ENVIADOS
    
    // Telegram para notificaciones
    this.telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
    this.telegramChatId = process.env.TELEGRAM_CHAT_ID;
    
    // Configuración de similitud
    this.config = {
      umbralSimilitudTexto: 85,      // % mínimo para considerar similar
      umbralSimilitudMedia: 95,      // % para medios (más estricto)
      ventanaTiempoInmediata: 30 * 60 * 1000,    // 30 min - bloqueo total
      ventanaTiempoCorta: 2 * 60 * 60 * 1000,    // 2 horas - solo muy similares
      ventanaTiempoMedia: 24 * 60 * 60 * 1000,   // 24 horas - casi idénticos
      ventanaTiempoLarga: 7 * 24 * 60 * 60 * 1000, // 7 días - solo idénticos
      limpiezaSemanal: true,
      reporteNocturno: '23:59',      // Hora del reporte diario
      maxCacheSize: 1000             // Máximo elementos en cache
    };
    
    // Estadísticas
    this.estadisticas = {
      totalAnalizados: 0,
      totalOmitidos: 0,
      omisionesPorMedio: {},
      omisionesPorTema: {},
      inicioSesion: new Date().toISOString()
    };
    
    this.crearDirectorios();
    this.cargarEstadisticas();
    this.iniciarReporteNocturno();
  }

  crearDirectorios() {
    if (!fs.existsSync(this.carpetaOmisiones)) {
      fs.mkdirSync(this.carpetaOmisiones, { recursive: true });
    }
    if (!fs.existsSync('./logs')) {
      fs.mkdirSync('./logs', { recursive: true });
    }
  }

  // Función principal de detección
  async verificarDuplicado(tweet) {
    this.estadisticas.totalAnalizados++;
    
    const ahora = Date.now();
    const firmas = this.generarFirmas(tweet);
    const tema = this.extraerTema(tweet.texto);
    
    // PASO 1: Verificar si YA FUE ENVIADO (prioridad máxima)
    const yaEnviado = this.registroEnviados.verificarTweetYaEnviado(tweet);
    if (yaEnviado.yaEnviado) {
      return await this.procesarOmision(tweet, 'ya_enviado', {
        tipo: 'ya_enviado',
        original: yaEnviado.registro.tweet,
        similitud: 100,
        tiempoTranscurrido: yaEnviado.tiempoTranscurrido
      }, tema);
    }
    
    // PASO 2: Verificar duplicado exacto en cache temporal
    const duplicadoExacto = this.buscarDuplicadoExacto(firmas);
    if (duplicadoExacto) {
      return await this.procesarOmision(tweet, 'duplicado_exacto', duplicadoExacto, tema);
    }
    
    // PASO 3: Verificar contenido similar en cache temporal
    const contenidoSimilar = this.buscarContenidoSimilar(tweet, firmas, ahora);
    if (contenidoSimilar.encontrado) {
      return await this.procesarOmision(tweet, 'contenido_similar', contenidoSimilar, tema);
    }
    
    // No es duplicado - guardar en cache temporal
    this.guardarEnCache(tweet, firmas, tema, ahora);
    
    return {
      esDuplicado: false,
      razon: null
    };
  }

  generarFirmas(tweet) {
    // Hash del texto limpio (sin emojis, links, menciones)
    const textoLimpio = this.limpiarTexto(tweet.texto);
    const hashTexto = crypto.createHash('md5').update(textoLimpio.toLowerCase()).digest('hex');
    
    // ID de medios (imágenes/videos de Twitter)
    const mediaIds = this.extraerMediaIds(tweet.mediaUrl || '');
    
    // Hash combinado (texto + usuario + media)
    const datoCombinado = `${textoLimpio}|${tweet.usuario}|${mediaIds.join(',')}`;
    const hashCombinado = crypto.createHash('md5').update(datoCombinado.toLowerCase()).digest('hex');
    
    return {
      hashTexto,
      hashCombinado,
      mediaIds,
      textoLimpio,
      palabrasClave: this.extraerPalabrasClave(textoLimpio)
    };
  }

  limpiarTexto(texto) {
    return texto
      .replace(/https?:\/\/[^\s]+/g, '') // Remover URLs
      .replace(/@\w+/g, '')             // Remover menciones
      .replace(/#\w+/g, '')             // Remover hashtags
      .replace(/[^\w\sáéíóúñÁÉÍÓÚÑ]/g, ' ') // Solo letras, números y espacios
      .replace(/\s+/g, ' ')             // Normalizar espacios
      .trim();
  }

  extraerMediaIds(mediaUrl) {
    const ids = [];
    // Extraer IDs de imágenes/videos de Twitter (ej: Gv2M0ZRWoAAMom6)
    const matches = mediaUrl.match(/[A-Za-z0-9_-]{15,}/g);
    if (matches) {
      ids.push(...matches);
    }
    return ids;
  }

  extraerTema(texto) {
    const textoLimpio = this.limpiarTexto(texto);
    const palabras = textoLimpio.split(' ').filter(p => p.length > 3);
    
    // Tomar las primeras 3-5 palabras más relevantes
    const temaResumido = palabras.slice(0, Math.min(5, palabras.length)).join(' ');
    return temaResumido || 'Tema no identificado';
  }

  extraerPalabrasClave(texto) {
    const palabrasComunes = ['que', 'para', 'con', 'por', 'una', 'del', 'las', 'los', 'como', 'más'];
    return texto
      .split(' ')
      .filter(p => p.length > 3 && !palabrasComunes.includes(p.toLowerCase()))
      .slice(0, 10); // Máximo 10 palabras clave
  }

  buscarDuplicadoExacto(firmas) {
    for (const [key, item] of this.cache.entries()) {
      if (item.firmas.hashCombinado === firmas.hashCombinado) {
        return {
          tipo: 'exacto',
          original: item.tweet,
          similitud: 100,
          tiempoTranscurrido: Date.now() - item.timestamp
        };
      }
    }
    return null;
  }

  buscarContenidoSimilar(tweet, firmas, ahora) {
    let mejorSimilitud = 0;
    let mejorCoincidencia = null;
    
    for (const [key, item] of this.cache.entries()) {
      const tiempoTranscurrido = ahora - item.timestamp;
      
      // Aplicar ventanas de tiempo
      let umbralRequerido = this.config.umbralSimilitudTexto;
      
      if (tiempoTranscurrido < this.config.ventanaTiempoInmediata) {
        umbralRequerido = 70; // Muy permisivo en primeros 30 min
      } else if (tiempoTranscurrido < this.config.ventanaTiempoCorta) {
        umbralRequerido = 80; // Permisivo en 2 horas
      } else if (tiempoTranscurrido < this.config.ventanaTiempoMedia) {
        umbralRequerido = 90; // Estricto en 24 horas
      } else {
        umbralRequerido = 95; // Muy estricto después de 24h
      }
      
      // Calcular similitud
      const similitudTexto = this.calcularSimilitudTexto(firmas.textoLimpio, item.firmas.textoLimpio);
      const similitudMedia = this.calcularSimilitudMedia(firmas.mediaIds, item.firmas.mediaIds);
      
      // Similitud combinada (priorizando medios)
      const similitudFinal = similitudMedia > 0 ? 
        (similitudTexto * 0.3 + similitudMedia * 0.7) : 
        similitudTexto;
      
      if (similitudFinal > umbralRequerido && similitudFinal > mejorSimilitud) {
        mejorSimilitud = similitudFinal;
        mejorCoincidencia = {
          tipo: 'similar',
          original: item.tweet,
          similitud: Math.round(similitudFinal),
          tiempoTranscurrido,
          tema: item.tema
        };
      }
    }
    
    return {
      encontrado: mejorCoincidencia !== null,
      ...mejorCoincidencia
    };
  }

  calcularSimilitudTexto(texto1, texto2) {
    if (texto1 === texto2) return 100;
    
    const palabras1 = new Set(texto1.split(' '));
    const palabras2 = new Set(texto2.split(' '));
    
    const interseccion = new Set([...palabras1].filter(x => palabras2.has(x)));
    const union = new Set([...palabras1, ...palabras2]);
    
    return (interseccion.size / union.size) * 100;
  }

  calcularSimilitudMedia(media1, media2) {
    if (media1.length === 0 || media2.length === 0) return 0;
    
    const coincidencias = media1.filter(id => media2.includes(id));
    return (coincidencias.length / Math.max(media1.length, media2.length)) * 100;
  }

  async procesarOmision(tweet, razon, detalles, tema) {
    this.estadisticas.totalOmitidos++;
    
    // Estadísticas por medio
    if (!this.estadisticas.omisionesPorMedio[tweet.usuario]) {
      this.estadisticas.omisionesPorMedio[tweet.usuario] = 0;
    }
    this.estadisticas.omisionesPorMedio[tweet.usuario]++;
    
    // Estadísticas por tema
    if (!this.estadisticas.omisionesPorTema[tema]) {
      this.estadisticas.omisionesPorTema[tema] = 0;
    }
    this.estadisticas.omisionesPorTema[tema]++;
    
    // Crear registro de omisión
    const omision = {
      id: this.generarIDUnico(),
      timestamp: Date.now(),
      fecha: new Date().toLocaleDateString('es-MX'),
      hora: new Date().toLocaleTimeString('es-MX'),
      tweet: {
        texto: tweet.texto,
        usuario: tweet.usuario,
        url: tweet.url || '#',
        mediaUrl: tweet.mediaUrl || ''
      },
      razon,
      tema,
      detalles: {
        similitud: detalles.similitud,
        tweetOriginal: {
          usuario: detalles.original.usuario,
          hora: new Date(detalles.original.timestamp || Date.now()).toLocaleTimeString('es-MX'),
          texto: detalles.original.texto.substring(0, 100) + '...'
        },
        tiempoTranscurrido: this.formatearTiempo(detalles.tiempoTranscurrido)
      }
    };
    
    // Guardar omisión
    this.omisionesHoy.push(omision);
    this.guardarOmisionEnArchivo(omision);
    
    // Notificación inmediata
    await this.notificarOmisionInmediata(omision);
    
    // Guardar estadísticas
    this.guardarEstadisticas();
    
    return {
      esDuplicado: true,
      razon,
      detalles: omision
    };
  }

  async notificarOmisionInmediata(omision) {
    try {
      const emoji = omision.razon === 'duplicado_exacto' ? '🔄' : '🔍';
      const mensaje = `${emoji} **Contenido similar detectado**\n\n` +
                     `📰 Tema: "${omision.tema}"\n` +
                     `📺 Medio: ${omision.tweet.usuario}\n` +
                     `⏰ Original: ${omision.detalles.tweetOriginal.hora}\n` +
                     `🔄 Similitud: ${omision.detalles.similitud}%\n` +
                     `📊 Hace: ${omision.detalles.tiempoTranscurrido}\n\n` +
                     `❌ Se omitirá repostear`;
      
      await this.telegramBot.sendMessage(this.telegramChatId, mensaje, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('❌ Error enviando notificación de omisión:', error.message);
    }
  }

  guardarEnCache(tweet, firmas, tema, timestamp) {
    const key = `${tweet.usuario}_${timestamp}`;
    
    this.cache.set(key, {
      tweet: {
        texto: tweet.texto,
        usuario: tweet.usuario,
        url: tweet.url,
        mediaUrl: tweet.mediaUrl,
        timestamp
      },
      firmas,
      tema,
      timestamp
    });
    
    // Limpiar cache si es muy grande
    if (this.cache.size > this.config.maxCacheSize) {
      this.limpiarCacheAntiguo();
    }
  }

  limpiarCacheAntiguo() {
    const ahora = Date.now();
    const itemsOrdenados = Array.from(this.cache.entries())
      .sort((a, b) => b[1].timestamp - a[1].timestamp);
    
    // Mantener solo los más recientes
    const mantener = itemsOrdenados.slice(0, Math.floor(this.config.maxCacheSize * 0.8));
    
    this.cache.clear();
    mantener.forEach(([key, value]) => {
      this.cache.set(key, value);
    });
    
    console.log(`🧹 Cache limpiado: ${itemsOrdenados.length} → ${this.cache.size} elementos`);
  }

  guardarOmisionEnArchivo(omision) {
    try {
      const fecha = new Date().toISOString().split('T')[0];
      const archivoOmisiones = path.join(this.carpetaOmisiones, `omisiones-${fecha}.json`);
      
      let omisiones = [];
      if (fs.existsSync(archivoOmisiones)) {
        const data = fs.readFileSync(archivoOmisiones, 'utf8');
        omisiones = JSON.parse(data);
      }
      
      omisiones.push(omision);
      fs.writeFileSync(archivoOmisiones, JSON.stringify(omisiones, null, 2));
    } catch (error) {
      console.error('❌ Error guardando omisión:', error.message);
    }
  }

  formatearTiempo(ms) {
    const minutos = Math.floor(ms / (60 * 1000));
    const horas = Math.floor(minutos / 60);
    
    if (horas > 0) {
      return `${horas}h ${minutos % 60}m`;
    }
    return `${minutos}m`;
  }

  generarIDUnico() {
    return crypto.randomBytes(4).toString('hex').toUpperCase();
  }

  cargarEstadisticas() {
    try {
      if (fs.existsSync(this.archivoEstadisticas)) {
        const data = fs.readFileSync(this.archivoEstadisticas, 'utf8');
        const estadisticasGuardadas = JSON.parse(data);
        
        // Mantener estadísticas del día
        const hoy = new Date().toDateString();
        const fechaGuardada = new Date(estadisticasGuardadas.inicioSesion).toDateString();
        
        if (hoy === fechaGuardada) {
          this.estadisticas = { ...this.estadisticas, ...estadisticasGuardadas };
        }
      }
    } catch (error) {
      console.log('⚠️ No se pudieron cargar estadísticas previas');
    }
  }

  guardarEstadisticas() {
    try {
      fs.writeFileSync(this.archivoEstadisticas, JSON.stringify(this.estadisticas, null, 2));
    } catch (error) {
      console.error('❌ Error guardando estadísticas:', error.message);
    }
  }

  // Reporte nocturno automático
  iniciarReporteNocturno() {
    const ahora = new Date();
    const [hora, minuto] = this.config.reporteNocturno.split(':');
    
    let proximoReporte = new Date();
    proximoReporte.setHours(parseInt(hora), parseInt(minuto), 0, 0);
    
    // Si ya pasó la hora, programar para mañana
    if (proximoReporte <= ahora) {
      proximoReporte.setDate(proximoReporte.getDate() + 1);
    }
    
    const msHastaReporte = proximoReporte.getTime() - ahora.getTime();
    
    setTimeout(() => {
      this.enviarReporteDiario();
      // Programar siguiente reporte (cada 24 horas)
      setInterval(() => {
        this.enviarReporteDiario();
      }, 24 * 60 * 60 * 1000);
    }, msHastaReporte);
    
    console.log(`📊 Reporte nocturno programado para las ${this.config.reporteNocturno}`);
  }

  async enviarReporteDiario() {
    try {
      const fecha = new Date().toLocaleDateString('es-MX');
      const omisionesHoy = this.omisionesHoy.length;
      
      if (omisionesHoy === 0) {
        await this.telegramBot.sendMessage(
          this.telegramChatId,
          `📊 **Reporte Diario** - ${fecha}\n\n✅ No se omitieron tweets hoy\n🎯 Sistema funcionando correctamente`,
          { parse_mode: 'Markdown' }
        );
        return;
      }
      
      // Resumen por medios
      const porMedios = Object.entries(this.estadisticas.omisionesPorMedio)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([medio, cantidad]) => `  • ${medio}: ${cantidad} omisiones`)
        .join('\n');
      
      // Temas más repetidos
      const temasTop = Object.entries(this.estadisticas.omisionesPorTema)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([tema, cantidad]) => `  • ${tema} (${cantidad}x)`)
        .join('\n');
      
      const eficiencia = this.estadisticas.totalAnalizados > 0 ?
        Math.round((this.estadisticas.totalOmitidos / this.estadisticas.totalAnalizados) * 100) : 0;
      
      const mensaje = `📊 **Reporte Diario** - ${fecha}\n\n` +
                     `🚫 Tweets omitidos: ${omisionesHoy}\n` +
                     `📊 Total analizados: ${this.estadisticas.totalAnalizados}\n` +
                     `🎯 Eficiencia: ${eficiencia}% detectados\n\n` +
                     `📺 **Por medio:**\n${porMedios}\n\n` +
                     `📋 **Temas más repetidos:**\n${temasTop}\n\n` +
                     `💡 Usa /omitidos_detalle para ver lista completa`;
      
      await this.telegramBot.sendMessage(this.telegramChatId, mensaje, { parse_mode: 'Markdown' });
      
      // Resetear estadísticas diarias
      this.omisionesHoy = [];
      this.estadisticas.omisionesPorMedio = {};
      this.estadisticas.omisionesPorTema = {};
      this.estadisticas.totalAnalizados = 0;
      this.estadisticas.totalOmitidos = 0;
      this.estadisticas.inicioSesion = new Date().toISOString();
      
    } catch (error) {
      console.error('❌ Error enviando reporte diario:', error.message);
    }
  }

  // Limpieza semanal automática
  limpiezaSemanal() {
    const ahora = new Date();
    if (ahora.getDay() === 1) { // Lunes
      console.log('🧹 Iniciando limpieza semanal de duplicados...');
      
      // Limpiar archivos de omisiones antiguos (> 7 días)
      const hace7Dias = Date.now() - (7 * 24 * 60 * 60 * 1000);
      
      try {
        if (fs.existsSync(this.carpetaOmisiones)) {
          const archivos = fs.readdirSync(this.carpetaOmisiones);
          let archivosEliminados = 0;
          
          archivos.forEach(archivo => {
            const rutaArchivo = path.join(this.carpetaOmisiones, archivo);
            const stats = fs.statSync(rutaArchivo);
            
            if (stats.mtime.getTime() < hace7Dias) {
              fs.unlinkSync(rutaArchivo);
              archivosEliminados++;
            }
          });
          
          if (archivosEliminados > 0) {
            console.log(`🗑️ Eliminados ${archivosEliminados} archivos de omisiones antiguos`);
          }
        }
        
        // Limpiar cache completamente
        this.cache.clear();
        console.log('🧹 Cache de duplicados limpiado');
        
        // Limpiar registros de enviados antiguos
        this.registroEnviados.limpiezaSemanal();
        
      } catch (error) {
        console.error('❌ Error en limpieza semanal:', error.message);
      }
    }
  }

  // Métodos para comandos Telegram
  async obtenerOmisionesHoy() {
    const fecha = new Date().toLocaleDateString('es-MX');
    
    if (this.omisionesHoy.length === 0) {
      return `📋 **Omisiones de hoy** - ${fecha}\n\n✅ No se han omitido tweets hoy`;
    }
    
    let mensaje = `📋 **Omisiones de hoy** - ${fecha} (${this.omisionesHoy.length}):\n\n`;
    
    this.omisionesHoy.slice(0, 10).forEach((omision, index) => {
      mensaje += `🕐 ${omision.hora} - ${omision.tweet.usuario}\n`;
      mensaje += `"${omision.tweet.texto.substring(0, 80)}..."\n`;
      mensaje += `❌ ${omision.razon === 'duplicado_exacto' ? 'Duplicado exacto' : 'Contenido similar'} (${omision.detalles.similitud}%)\n\n`;
    });
    
    if (this.omisionesHoy.length > 10) {
      mensaje += `... y ${this.omisionesHoy.length - 10} más`;
    }
    
    return mensaje;
  }

  // Registrar que un tweet fue ENVIADO exitosamente
  registrarTweetEnviado(tweet, tweetId, nombreColumna, tipoMedia = 'texto') {
    return this.registroEnviados.registrarTweetEnviado(tweet, tweetId, nombreColumna, tipoMedia);
  }

  obtenerEstadisticas() {
    const eficiencia = this.estadisticas.totalAnalizados > 0 ?
      Math.round((this.estadisticas.totalOmitidos / this.estadisticas.totalAnalizados) * 100) : 0;
    
    const estadisticasEnviados = this.registroEnviados.obtenerEstadisticasEnviados();
    
    return `📈 **Estadísticas del Sistema**\n\n` +
           `📊 Tweets analizados: ${this.estadisticas.totalAnalizados}\n` +
           `🚫 Tweets omitidos: ${this.estadisticas.totalOmitidos}\n` +
           `✅ Tweets enviados hoy: ${estadisticasEnviados.totalHoy}\n` +
           `🎯 Eficiencia de detección: ${eficiencia}%\n` +
           `💾 Elementos en cache: ${this.cache.size}\n` +
           `🕐 Sesión iniciada: ${new Date(this.estadisticas.inicioSesion).toLocaleString('es-MX')}`;
  }

  obtenerTweetsEnviados() {
    const tweetsEnviados = this.registroEnviados.obtenerTweetsEnviadosHoy();
    
    if (tweetsEnviados.length === 0) {
      return `📋 **Tweets Enviados Hoy**\n\n✅ No se han enviado tweets hoy`;
    }
    
    let mensaje = `📋 **Tweets Enviados Hoy** (${tweetsEnviados.length}):\n\n`;
    
    tweetsEnviados.slice(0, 10).forEach((tweet, index) => {
      mensaje += `🕐 ${tweet.hora} - ${tweet.usuario}\n`;
      mensaje += `📰 "${tweet.texto}"\n`;
      mensaje += `📊 ${tweet.columna} | ${tweet.tipo} | ID: ${tweet.id}\n\n`;
    });
    
    if (tweetsEnviados.length > 10) {
      mensaje += `... y ${tweetsEnviados.length - 10} más`;
    }
    
    return mensaje;
  }
}

export default DetectorDuplicados;