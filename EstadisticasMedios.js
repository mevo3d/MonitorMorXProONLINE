// EstadisticasMedios.js - Sistema de estadísticas de publicaciones por medio
import fs from 'fs';
import path from 'path';

class EstadisticasMedios {
  constructor() {
    this.carpetaEstadisticas = './logs/estadisticas-medios';
    this.archivoEstadisticasHoy = null;
    this.estadisticasHoy = {
      fecha: new Date().toISOString().split('T')[0],
      totalTweets: 0,
      totalMedios: 0,
      mediosPorTweet: {},
      tweetsPorHora: {},
      palabrasClaveDetectadas: {},
      horaInicio: new Date().toISOString(),
      ultimaActualizacion: new Date().toISOString()
    };
    
    this.inicializar();
  }

  inicializar() {
    // Crear carpeta si no existe
    if (!fs.existsSync(this.carpetaEstadisticas)) {
      fs.mkdirSync(this.carpetaEstadisticas, { recursive: true });
    }
    
    // Definir archivo del día
    const hoy = new Date().toISOString().split('T')[0];
    this.archivoEstadisticasHoy = path.join(this.carpetaEstadisticas, `estadisticas-${hoy}.json`);
    
    // Cargar estadísticas existentes o crear nuevas
    if (fs.existsSync(this.archivoEstadisticasHoy)) {
      this.cargarEstadisticas();
    } else {
      this.guardarEstadisticas();
    }
  }

  cargarEstadisticas() {
    try {
      const data = fs.readFileSync(this.archivoEstadisticasHoy, 'utf8');
      this.estadisticasHoy = JSON.parse(data);
    } catch (error) {
      console.error('Error cargando estadísticas:', error);
    }
  }

  guardarEstadisticas() {
    try {
      this.estadisticasHoy.ultimaActualizacion = new Date().toISOString();
      fs.writeFileSync(
        this.archivoEstadisticasHoy, 
        JSON.stringify(this.estadisticasHoy, null, 2)
      );
    } catch (error) {
      console.error('Error guardando estadísticas:', error);
    }
  }

  registrarTweet(tweet) {
    const hora = new Date().getHours();
    const medio = this.extraerNombreMedio(tweet);
    const palabrasClave = tweet.palabrasClaveEncontradas || [];
    
    // Incrementar contador total
    this.estadisticasHoy.totalTweets++;
    
    // Registrar medio
    if (medio) {
      if (!this.estadisticasHoy.mediosPorTweet[medio]) {
        this.estadisticasHoy.mediosPorTweet[medio] = {
          nombre: medio,
          tweets: 0,
          primeraPublicacion: new Date().toISOString(),
          ultimaPublicacion: new Date().toISOString(),
          palabrasClaveDetectadas: {}
        };
      }
      
      this.estadisticasHoy.mediosPorTweet[medio].tweets++;
      this.estadisticasHoy.mediosPorTweet[medio].ultimaPublicacion = new Date().toISOString();
      
      // Registrar palabras clave por medio
      palabrasClave.forEach(palabra => {
        if (!this.estadisticasHoy.mediosPorTweet[medio].palabrasClaveDetectadas[palabra]) {
          this.estadisticasHoy.mediosPorTweet[medio].palabrasClaveDetectadas[palabra] = 0;
        }
        this.estadisticasHoy.mediosPorTweet[medio].palabrasClaveDetectadas[palabra]++;
      });
    }
    
    // Registrar por hora
    if (!this.estadisticasHoy.tweetsPorHora[hora]) {
      this.estadisticasHoy.tweetsPorHora[hora] = 0;
    }
    this.estadisticasHoy.tweetsPorHora[hora]++;
    
    // Registrar palabras clave globales
    palabrasClave.forEach(palabra => {
      if (!this.estadisticasHoy.palabrasClaveDetectadas[palabra]) {
        this.estadisticasHoy.palabrasClaveDetectadas[palabra] = 0;
      }
      this.estadisticasHoy.palabrasClaveDetectadas[palabra]++;
    });
    
    // Actualizar total de medios únicos
    this.estadisticasHoy.totalMedios = Object.keys(this.estadisticasHoy.mediosPorTweet).length;
    
    // Guardar cada 10 tweets
    if (this.estadisticasHoy.totalTweets % 10 === 0) {
      this.guardarEstadisticas();
    }
  }

  extraerNombreMedio(tweet) {
    // Extraer el nombre del medio del tweet
    // Generalmente está en la primera línea o después del @
    try {
      const texto = tweet.texto || tweet.text || '';
      const lineas = texto.split('\n');
      
      // Buscar línea con @ (usuario)
      for (const linea of lineas) {
        if (linea.includes('@')) {
          // Extraer el @ y el nombre
          const match = linea.match(/@[\w_]+/);
          if (match) {
            return match[0].substring(1); // Quitar el @
          }
        }
      }
      
      // Si no hay @, tomar la primera línea no vacía
      for (const linea of lineas) {
        const trimmed = linea.trim();
        if (trimmed && trimmed.length > 0) {
          return trimmed.substring(0, 50); // Máximo 50 caracteres
        }
      }
      
      return 'Desconocido';
    } catch (error) {
      return 'Desconocido';
    }
  }

  obtenerTopMedios(limite = 10) {
    const medios = Object.values(this.estadisticasHoy.mediosPorTweet);
    return medios
      .sort((a, b) => b.tweets - a.tweets)
      .slice(0, limite);
  }

  obtenerResumenDiario() {
    const topMedios = this.obtenerTopMedios(5);
    const horasActivas = Object.entries(this.estadisticasHoy.tweetsPorHora)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3);
    
    return {
      fecha: this.estadisticasHoy.fecha,
      totalTweets: this.estadisticasHoy.totalTweets,
      totalMedios: this.estadisticasHoy.totalMedios,
      topMedios: topMedios.map(m => ({
        nombre: m.nombre,
        tweets: m.tweets,
        porcentaje: ((m.tweets / this.estadisticasHoy.totalTweets) * 100).toFixed(1)
      })),
      horasMasActivas: horasActivas.map(([hora, tweets]) => ({
        hora: `${hora}:00`,
        tweets
      })),
      palabrasClaveTop: Object.entries(this.estadisticasHoy.palabrasClaveDetectadas)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([palabra, count]) => ({ palabra, count }))
    };
  }

  generarReporteTelegram() {
    const resumen = this.obtenerResumenDiario();
    
    let reporte = `📊 *ESTADÍSTICAS DEL DÍA - ${resumen.fecha}*\n`;
    reporte += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    
    reporte += `📈 *RESUMEN GENERAL*\n`;
    reporte += `• Total de tweets: ${resumen.totalTweets}\n`;
    reporte += `• Medios únicos: ${resumen.totalMedios}\n\n`;
    
    reporte += `🏆 *TOP 5 MEDIOS MÁS ACTIVOS*\n`;
    resumen.topMedios.forEach((medio, index) => {
      const medalla = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '📰';
      reporte += `${medalla} ${medio.nombre}: ${medio.tweets} tweets (${medio.porcentaje}%)\n`;
    });
    
    reporte += `\n⏰ *HORAS MÁS ACTIVAS*\n`;
    resumen.horasMasActivas.forEach(hora => {
      reporte += `• ${hora.hora}: ${hora.tweets} tweets\n`;
    });
    
    if (resumen.palabrasClaveTop.length > 0) {
      reporte += `\n🔑 *PALABRAS CLAVE MÁS DETECTADAS*\n`;
      resumen.palabrasClaveTop.forEach(pc => {
        reporte += `• ${pc.palabra}: ${pc.count} veces\n`;
      });
    }
    
    return reporte;
  }

  obtenerEstadisticasMedio(nombreMedio) {
    const medio = this.estadisticasHoy.mediosPorTweet[nombreMedio];
    if (!medio) {
      return null;
    }
    
    return {
      nombre: medio.nombre,
      tweets: medio.tweets,
      porcentaje: ((medio.tweets / this.estadisticasHoy.totalTweets) * 100).toFixed(1),
      primeraPublicacion: medio.primeraPublicacion,
      ultimaPublicacion: medio.ultimaPublicacion,
      palabrasClave: Object.entries(medio.palabrasClaveDetectadas)
        .sort(([, a], [, b]) => b - a)
        .map(([palabra, count]) => ({ palabra, count }))
    };
  }

  // Método para limpiar estadísticas antiguas (mantener últimos 30 días)
  limpiarEstadisticasAntiguas() {
    try {
      const archivos = fs.readdirSync(this.carpetaEstadisticas);
      const fechaLimite = new Date();
      fechaLimite.setDate(fechaLimite.getDate() - 30);
      
      archivos.forEach(archivo => {
        const match = archivo.match(/estadisticas-(\d{4}-\d{2}-\d{2})\.json/);
        if (match) {
          const fechaArchivo = new Date(match[1]);
          if (fechaArchivo < fechaLimite) {
            fs.unlinkSync(path.join(this.carpetaEstadisticas, archivo));
            console.log(`📊 Eliminado archivo de estadísticas antiguo: ${archivo}`);
          }
        }
      });
    } catch (error) {
      console.error('Error limpiando estadísticas antiguas:', error);
    }
  }
}

export default EstadisticasMedios;