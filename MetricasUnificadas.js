// MetricasUnificadas.js - Sistema de métricas y análisis avanzado
import fs from 'fs';
import path from 'path';

class MetricasUnificadas {
  constructor() {
    this.carpetaMetricas = './logs/metricas';
    this.archivoMetricas = path.join(this.carpetaMetricas, 'metricas-generales.json');
    
    this.metricas = {
      general: {
        totalTweetsHistorico: 0,
        totalMediosHistorico: new Set(),
        fechaInicio: null,
        diasActivo: 0
      },
      tendencias: {
        tweetsUltimos7Dias: [],
        tweetsUltimos30Dias: [],
        palabrasClaveUltimos7Dias: {},
        mediosMasActivosHistorico: {}
      },
      rendimiento: {
        tiempoRespuestaPromedio: 0,
        tweetsProceadosPorMinuto: 0,
        eficienciaDeteccion: 0
      },
      alertas: {
        picosTweets: [],
        nuevosMediosDetectados: [],
        palabrasClaveEmergentes: []
      }
    };
    
    this.inicializar();
  }

  inicializar() {
    if (!fs.existsSync(this.carpetaMetricas)) {
      fs.mkdirSync(this.carpetaMetricas, { recursive: true });
    }
    
    if (fs.existsSync(this.archivoMetricas)) {
      this.cargarMetricas();
    } else {
      this.metricas.general.fechaInicio = new Date().toISOString();
      this.guardarMetricas();
    }
  }

  cargarMetricas() {
    try {
      const data = fs.readFileSync(this.archivoMetricas, 'utf8');
      const metricasCargadas = JSON.parse(data);
      
      // Convertir Set de medios
      if (metricasCargadas.general.totalMediosHistorico) {
        metricasCargadas.general.totalMediosHistorico = new Set(metricasCargadas.general.totalMediosHistorico);
      }
      
      this.metricas = metricasCargadas;
    } catch (error) {
      console.error('Error cargando métricas:', error);
    }
  }

  guardarMetricas() {
    try {
      const metricasParaGuardar = JSON.parse(JSON.stringify(this.metricas));
      
      // Convertir Set a Array para guardar
      if (this.metricas.general.totalMediosHistorico instanceof Set) {
        metricasParaGuardar.general.totalMediosHistorico = Array.from(this.metricas.general.totalMediosHistorico);
      }
      
      fs.writeFileSync(this.archivoMetricas, JSON.stringify(metricasParaGuardar, null, 2));
    } catch (error) {
      console.error('Error guardando métricas:', error);
    }
  }

  actualizarMetricas(tweet, tiempoProcesamiento = 0) {
    // Actualizar métricas generales
    this.metricas.general.totalTweetsHistorico++;
    
    const medio = this.extraerNombreMedio(tweet);
    if (medio && medio !== 'Desconocido') {
      this.metricas.general.totalMediosHistorico.add(medio);
      
      // Actualizar medios más activos
      if (!this.metricas.tendencias.mediosMasActivosHistorico[medio]) {
        this.metricas.tendencias.mediosMasActivosHistorico[medio] = 0;
        
        // Registrar nuevo medio detectado
        this.metricas.alertas.nuevosMediosDetectados.push({
          medio,
          fecha: new Date().toISOString()
        });
        
        // Mantener solo los últimos 50 nuevos medios
        if (this.metricas.alertas.nuevosMediosDetectados.length > 50) {
          this.metricas.alertas.nuevosMediosDetectados.shift();
        }
      }
      this.metricas.tendencias.mediosMasActivosHistorico[medio]++;
    }
    
    // Actualizar días activo
    const fechaInicio = new Date(this.metricas.general.fechaInicio);
    const hoy = new Date();
    this.metricas.general.diasActivo = Math.floor((hoy - fechaInicio) / (1000 * 60 * 60 * 24)) + 1;
    
    // Actualizar rendimiento
    if (tiempoProcesamiento > 0) {
      const totalProcesados = this.metricas.general.totalTweetsHistorico;
      this.metricas.rendimiento.tiempoRespuestaPromedio = 
        ((this.metricas.rendimiento.tiempoRespuestaPromedio * (totalProcesados - 1)) + tiempoProcesamiento) / totalProcesados;
    }
    
    // Actualizar tendencias de palabras clave
    if (tweet.palabrasClaveEncontradas) {
      tweet.palabrasClaveEncontradas.forEach(palabra => {
        if (!this.metricas.tendencias.palabrasClaveUltimos7Dias[palabra]) {
          this.metricas.tendencias.palabrasClaveUltimos7Dias[palabra] = 0;
        }
        this.metricas.tendencias.palabrasClaveUltimos7Dias[palabra]++;
      });
    }
    
    // Guardar cada 25 tweets
    if (this.metricas.general.totalTweetsHistorico % 25 === 0) {
      this.guardarMetricas();
    }
  }

  extraerNombreMedio(tweet) {
    try {
      const texto = tweet.texto || tweet.text || '';
      const lineas = texto.split('\n');
      
      for (const linea of lineas) {
        if (linea.includes('@')) {
          const match = linea.match(/@[\w_]+/);
          if (match) {
            return match[0].substring(1);
          }
        }
      }
      
      return 'Desconocido';
    } catch (error) {
      return 'Desconocido';
    }
  }

  registrarPicoActividad(cantidadTweets) {
    const ahora = new Date();
    const pico = {
      fecha: ahora.toISOString(),
      hora: ahora.getHours(),
      cantidadTweets,
      dia: ahora.toLocaleDateString('es-MX')
    };
    
    this.metricas.alertas.picosTweets.push(pico);
    
    // Mantener solo los últimos 100 picos
    if (this.metricas.alertas.picosTweets.length > 100) {
      this.metricas.alertas.picosTweets.shift();
    }
  }

  actualizarTendenciasDiarias(estadisticasDia) {
    const registro = {
      fecha: estadisticasDia.fecha,
      totalTweets: estadisticasDia.totalTweets,
      totalMedios: estadisticasDia.totalMedios
    };
    
    // Actualizar últimos 7 días
    this.metricas.tendencias.tweetsUltimos7Dias.push(registro);
    if (this.metricas.tendencias.tweetsUltimos7Dias.length > 7) {
      this.metricas.tendencias.tweetsUltimos7Dias.shift();
    }
    
    // Actualizar últimos 30 días
    this.metricas.tendencias.tweetsUltimos30Dias.push(registro);
    if (this.metricas.tendencias.tweetsUltimos30Dias.length > 30) {
      this.metricas.tendencias.tweetsUltimos30Dias.shift();
    }
    
    this.guardarMetricas();
  }

  obtenerResumenMetricas() {
    const totalMedios = this.metricas.general.totalMediosHistorico instanceof Set 
      ? this.metricas.general.totalMediosHistorico.size 
      : 0;
    
    // Calcular promedio de tweets por día
    const promedioDiario = this.metricas.general.diasActivo > 0 
      ? (this.metricas.general.totalTweetsHistorico / this.metricas.general.diasActivo).toFixed(1)
      : 0;
    
    // Top 10 medios históricos
    const topMedios = Object.entries(this.metricas.tendencias.mediosMasActivosHistorico)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([medio, count]) => ({ medio, count }));
    
    // Tendencia últimos 7 días
    const tendencia7Dias = this.calcularTendencia(this.metricas.tendencias.tweetsUltimos7Dias);
    
    return {
      general: {
        totalTweets: this.metricas.general.totalTweetsHistorico,
        totalMedios,
        diasActivo: this.metricas.general.diasActivo,
        promedioDiario,
        fechaInicio: this.metricas.general.fechaInicio
      },
      tendencias: {
        tendencia7Dias,
        topMediosHistorico: topMedios,
        palabrasClavePopulares: Object.entries(this.metricas.tendencias.palabrasClaveUltimos7Dias)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 10)
          .map(([palabra, count]) => ({ palabra, count }))
      },
      rendimiento: {
        tiempoRespuestaPromedio: `${this.metricas.rendimiento.tiempoRespuestaPromedio.toFixed(2)}ms`,
        eficienciaDeteccion: `${this.metricas.rendimiento.eficienciaDeteccion.toFixed(1)}%`
      }
    };
  }

  calcularTendencia(datos) {
    if (datos.length < 2) return 'neutral';
    
    const ultimosDatos = datos.slice(-2);
    const diferencia = ultimosDatos[1].totalTweets - ultimosDatos[0].totalTweets;
    const porcentaje = (diferencia / ultimosDatos[0].totalTweets) * 100;
    
    if (porcentaje > 10) return 'creciendo';
    if (porcentaje < -10) return 'decreciendo';
    return 'estable';
  }

  generarReporteMetricasTelegram() {
    const resumen = this.obtenerResumenMetricas();
    
    let reporte = `📊 *MÉTRICAS DEL SISTEMA*\n`;
    reporte += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    
    reporte += `📈 *ESTADÍSTICAS GENERALES*\n`;
    reporte += `• Total histórico: ${resumen.general.totalTweets} tweets\n`;
    reporte += `• Medios únicos: ${resumen.general.totalMedios}\n`;
    reporte += `• Días activo: ${resumen.general.diasActivo}\n`;
    reporte += `• Promedio diario: ${resumen.general.promedioDiario} tweets\n\n`;
    
    const tendenciaEmoji = {
      'creciendo': '📈',
      'decreciendo': '📉',
      'estable': '➡️'
    };
    
    reporte += `📊 *TENDENCIAS*\n`;
    reporte += `• Últimos 7 días: ${tendenciaEmoji[resumen.tendencias.tendencia7Dias]} ${resumen.tendencias.tendencia7Dias}\n\n`;
    
    if (resumen.tendencias.topMediosHistorico.length > 0) {
      reporte += `🏆 *TOP 5 MEDIOS HISTÓRICOS*\n`;
      resumen.tendencias.topMediosHistorico.slice(0, 5).forEach((medio, index) => {
        const medalla = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '📰';
        reporte += `${medalla} ${medio.medio}: ${medio.count} tweets\n`;
      });
    }
    
    reporte += `\n⚡ *RENDIMIENTO*\n`;
    reporte += `• Tiempo respuesta: ${resumen.rendimiento.tiempoRespuestaPromedio}\n`;
    
    return reporte;
  }

  // Método para detectar anomalías
  detectarAnomalias(tweetsUltimaHora) {
    const promedioPorHora = this.metricas.general.totalTweetsHistorico / (this.metricas.general.diasActivo * 24);
    
    // Si los tweets de la última hora son 3x el promedio, es una anomalía
    if (tweetsUltimaHora > promedioPorHora * 3) {
      this.registrarPicoActividad(tweetsUltimaHora);
      return {
        esAnomalia: true,
        tipo: 'pico_actividad',
        mensaje: `⚠️ Pico de actividad detectado: ${tweetsUltimaHora} tweets en la última hora (promedio: ${promedioPorHora.toFixed(1)})`
      };
    }
    
    return { esAnomalia: false };
  }
}

export default MetricasUnificadas;