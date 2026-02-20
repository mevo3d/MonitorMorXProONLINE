// EstadisticasMedios.js - Sistema de estadísticas de publicaciones por medio
import fs from 'fs';
import path from 'path';

class EstadisticasMedios {
  constructor() {
    this.carpetaEstadisticas = './logs/estadisticas-medios';
    this.archivoEstadisticasHoy = null;
    this.categorias = {}; // Se llenará con actualizarCategorias
    this.estadisticasHoy = {
      fecha: new Date().toISOString().split('T')[0],
      totalTweets: 0,
      totalMedios: 0,
      conteoPorPoder: { legislativo: 0, gobierno: 0, judicial: 0, otros: 0 }, // Nueva métrica
      mediosPorTweet: {},
      tweetsPorHora: {},
      palabrasClaveDetectadas: {},
      interaccionesOficiales: {},
      horaInicio: new Date().toISOString(),
      ultimaActualizacion: new Date().toISOString()
    };

    this.inicializar();
  }

  inicializar() {
    if (!fs.existsSync(this.carpetaEstadisticas)) {
      fs.mkdirSync(this.carpetaEstadisticas, { recursive: true });
    }

    const hoy = new Date().toISOString().split('T')[0];
    this.archivoEstadisticasHoy = path.join(this.carpetaEstadisticas, `estadisticas-${hoy}.json`);

    if (fs.existsSync(this.archivoEstadisticasHoy)) {
      this.cargarEstadisticas();
    } else {
      this.guardarEstadisticas();
    }
  }

  actualizarCategorias(configCategorias) {
    this.categorias = configCategorias || {};
    console.log(`📊 Estadísticas: Categorías actualizadas (${Object.keys(this.categorias).length} grupos)`);
  }

  cargarEstadisticas() {
    try {
      const data = fs.readFileSync(this.archivoEstadisticasHoy, 'utf8');
      const loaded = JSON.parse(data);
      // Merge seguro para no perder estructura nueva si cargamos archivo viejo
      this.estadisticasHoy = { ...this.estadisticasHoy, ...loaded };
      if (!this.estadisticasHoy.conteoPorPoder) {
        this.estadisticasHoy.conteoPorPoder = { legislativo: 0, gobierno: 0, judicial: 0, otros: 0 };
      }
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

  extraerNombreMedio(tweet) {
    // Prioridad 1: Handle directo
    if (tweet.handle) return tweet.handle;

    // Prioridad 2: Buscar @ en texto
    const texto = tweet.texto || tweet.text || '';
    const match = texto.match(/@[\w_]+/);
    if (match) return match[0]; // Retorna con @

    return 'Desconocido';
  }

  detectarPoder(handle, texto) {
    // Normalizar
    const h = handle.toLowerCase();
    const t = (texto || '').toLowerCase();

    // Buscar en categorías cargadas
    for (const [categoria, keywords] of Object.entries(this.categorias)) {
      // Check simple: si alguna keyword de la categoría está en el handle o texto
      // NOTA: Esto es simplificado. Idealmente buscaríamos match exacto de handle en una lista de handles.
      // Pero keywords.json mezcla nombres y handles.
      const match = keywords.some(k =>
        h.includes(k.toLowerCase()) || t.includes(k.toLowerCase())
      );
      if (match) return categoria; // legislativo, gobierno, judicial
    }
    return 'otros';
  }

  registrarTweet(tweet) {
    const hora = new Date().getHours();
    const medio = this.extraerNombreMedio(tweet);
    const palabrasClave = tweet.palabrasClaveEncontradas || [];

    // Incrementar contador total
    this.estadisticasHoy.totalTweets++;

    // Clasificar Poder
    const poder = this.detectarPoder(medio, tweet.texto);
    if (!this.estadisticasHoy.conteoPorPoder) this.estadisticasHoy.conteoPorPoder = {};
    if (!this.estadisticasHoy.conteoPorPoder[poder]) this.estadisticasHoy.conteoPorPoder[poder] = 0;
    this.estadisticasHoy.conteoPorPoder[poder]++;

    // Registrar medio
    if (medio) {
      if (!this.estadisticasHoy.mediosPorTweet[medio]) {
        this.estadisticasHoy.mediosPorTweet[medio] = {
          nombre: medio,
          tweets: 0,
          poder: poder, // Guardar clasificación
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

    // Registrar Interacciones (Simplificado)
    // ... (Mantenemos logica anterior si es necesaria, o la simplificamos)

    // Actualizar total de medios únicos
    this.estadisticasHoy.totalMedios = Object.keys(this.estadisticasHoy.mediosPorTweet).length;

    // Guardar periodicamente
    if (this.estadisticasHoy.totalTweets % 5 === 0) {
      this.guardarEstadisticas();
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
      conteoPorPoder: this.estadisticasHoy.conteoPorPoder, // Include in summary
      topMedios: topMedios.map(m => ({
        nombre: m.nombre,
        tweets: m.tweets,
        poder: m.poder,
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
    reporte += `• Medios únicos: ${resumen.totalMedios}\n`;

    if (resumen.conteoPorPoder) {
      reporte += `\n🏛️ *POR PODER*\n`;
      reporte += `• Leg: ${resumen.conteoPorPoder.legislativo || 0} | Gob: ${resumen.conteoPorPoder.gobierno || 0} | Jud: ${resumen.conteoPorPoder.judicial || 0}\n`;
    }

    reporte += `\n🏆 *TOP 5 MEDIOS MÁS ACTIVOS*\n`;
    resumen.topMedios.forEach((medio, index) => {
      const medalla = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '📰';
      reporte += `${medalla} ${medio.nombre}: ${medio.tweets} (${medio.porcentaje}%)\n`;
    });

    reporte += `\n🔑 *PALABRAS CLAVE*\n`;
    resumen.palabrasClaveTop.forEach(pc => {
      reporte += `• ${pc.palabra}: ${pc.count}\n`;
    });

    return reporte;
  }

  obtenerEstadisticasMedio(nombreMedio) {
    const medio = this.estadisticasHoy.mediosPorTweet[nombreMedio];
    if (!medio) return null;

    return {
      nombre: medio.nombre,
      tweets: medio.tweets,
      poder: medio.poder,
      porcentaje: ((medio.tweets / this.estadisticasHoy.totalTweets) * 100).toFixed(1),
      primeraPublicacion: medio.primeraPublicacion,
      ultimaPublicacion: medio.ultimaPublicacion,
      palabrasClave: Object.entries(medio.palabrasClaveDetectadas)
        .sort(([, a], [, b]) => b - a)
        .map(([palabra, count]) => ({ palabra, count }))
    };
  }

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