// SistemaAlertas.js - Sistema de clasificación y priorización de alertas
import fs from 'fs';
import path from 'path';

class SistemaAlertas {
  constructor() {
    this.nivelesAlerta = {
      URGENTE: { valor: 4, emoji: '🚨', color: 'rojo' },
      ALTA: { valor: 3, emoji: '⚠️', color: 'naranja' },
      MEDIA: { valor: 2, emoji: '📢', color: 'amarillo' },
      BAJA: { valor: 1, emoji: '💡', color: 'azul' }
    };
    
    // Palabras clave para clasificación automática
    this.palabrasUrgentes = [
      'crisis', 'emergencia', 'urgente', 'alerta', 'peligro', 'accidente',
      'muerte', 'muerto', 'fallecio', 'herido', 'grave', 'crítico',
      'detenido', 'arrestado', 'desaparecido', 'secuestro', 'balacera',
      'explosion', 'incendio', 'sismo', 'temblor', 'derrumbe'
    ];
    
    this.palabrasAltas = [
      'importante', 'breaking', 'última hora', 'ahora', 'en vivo',
      'confirma', 'denuncia', 'investiga', 'acusa', 'demanda',
      'protesta', 'manifestación', 'bloqueo', 'paro', 'huelga'
    ];
    
    this.palabrasMedias = [
      'anuncia', 'declara', 'informa', 'presenta', 'propone',
      'reunión', 'sesión', 'votación', 'aprueba', 'rechaza',
      'proyecto', 'iniciativa', 'reforma', 'cambio', 'nuevo'
    ];
    
    // Historial de alertas
    this.carpetaAlertas = './logs/alertas';
    this.historialAlertas = [];
    this.alertasEnviadas = new Map(); // Para evitar spam
    
    this.inicializar();
  }

  inicializar() {
    if (!fs.existsSync(this.carpetaAlertas)) {
      fs.mkdirSync(this.carpetaAlertas, { recursive: true });
    }
    
    this.cargarHistorial();
  }

  cargarHistorial() {
    const hoy = new Date().toISOString().split('T')[0];
    const archivoHoy = path.join(this.carpetaAlertas, `alertas-${hoy}.json`);
    
    if (fs.existsSync(archivoHoy)) {
      try {
        const data = fs.readFileSync(archivoHoy, 'utf8');
        this.historialAlertas = JSON.parse(data);
      } catch (error) {
        console.error('Error cargando historial de alertas:', error);
      }
    }
  }

  guardarHistorial() {
    const hoy = new Date().toISOString().split('T')[0];
    const archivoHoy = path.join(this.carpetaAlertas, `alertas-${hoy}.json`);
    
    try {
      fs.writeFileSync(archivoHoy, JSON.stringify(this.historialAlertas, null, 2));
    } catch (error) {
      console.error('Error guardando historial de alertas:', error);
    }
  }

  clasificarTweet(tweet) {
    const texto = (tweet.texto || tweet.text || '').toLowerCase();
    const medio = this.extraerNombreMedio(tweet);
    
    // Verificar si es un medio importante
    const mediosImportantes = [
      'jorgemoralesnoticias', 'elregionaldelsur', 'lavozdemorelostv',
      'launiondemorelos', 'diariodemorelos', 'elsoldecuautla'
    ];
    
    const esMedioImportante = mediosImportantes.some(m => 
      medio.toLowerCase().includes(m)
    );
    
    // Clasificar por contenido
    let nivel = this.nivelesAlerta.BAJA;
    let razon = 'Mención general';
    let palabrasDetectadas = [];
    
    // Verificar palabras urgentes
    for (const palabra of this.palabrasUrgentes) {
      if (texto.includes(palabra)) {
        nivel = this.nivelesAlerta.URGENTE;
        razon = 'Contenido urgente detectado';
        palabrasDetectadas.push(palabra);
      }
    }
    
    // Si no es urgente, verificar alta prioridad
    if (nivel.valor < this.nivelesAlerta.URGENTE.valor) {
      for (const palabra of this.palabrasAltas) {
        if (texto.includes(palabra)) {
          nivel = this.nivelesAlerta.ALTA;
          razon = 'Contenido de alta prioridad';
          palabrasDetectadas.push(palabra);
        }
      }
    }
    
    // Si no es alta, verificar media
    if (nivel.valor < this.nivelesAlerta.ALTA.valor) {
      for (const palabra of this.palabrasMedias) {
        if (texto.includes(palabra)) {
          nivel = this.nivelesAlerta.MEDIA;
          razon = 'Contenido relevante';
          palabrasDetectadas.push(palabra);
        }
      }
    }
    
    // Aumentar nivel si es medio importante
    if (esMedioImportante && nivel.valor < this.nivelesAlerta.ALTA.valor) {
      nivel = this.nivelesAlerta.MEDIA;
      razon += ' (Medio importante)';
    }
    
    // Verificar patrones específicos
    if (texto.includes('congreso') && texto.includes('aprob')) {
      nivel = this.nivelesAlerta.ALTA;
      razon = 'Aprobación legislativa';
    }
    
    if (texto.includes('fiscal') && (texto.includes('deten') || texto.includes('arrest'))) {
      nivel = this.nivelesAlerta.URGENTE;
      razon = 'Acción judicial importante';
    }
    
    return {
      nivel,
      razon,
      palabrasDetectadas: [...new Set(palabrasDetectadas)], // Eliminar duplicados
      timestamp: new Date().toISOString()
    };
  }

  procesarAlerta(tweet, clasificacion) {
    const alerta = {
      id: this.generarIdAlerta(),
      tweet: {
        texto: tweet.texto || tweet.text,
        medio: this.extraerNombreMedio(tweet),
        url: tweet.url,
        fecha: tweet.fecha || new Date().toISOString()
      },
      clasificacion,
      enviada: false,
      fechaProcesamiento: new Date().toISOString()
    };
    
    // Verificar si ya se envió una alerta similar recientemente
    const hashContenido = this.generarHashContenido(tweet.texto || tweet.text);
    const alertaReciente = this.alertasEnviadas.get(hashContenido);
    
    if (alertaReciente && (Date.now() - alertaReciente) < 3600000) { // 1 hora
      alerta.enviada = true;
      alerta.razonNoEnviada = 'Alerta similar enviada recientemente';
    }
    
    // Agregar al historial
    this.historialAlertas.push(alerta);
    
    // Guardar cada 10 alertas
    if (this.historialAlertas.length % 10 === 0) {
      this.guardarHistorial();
    }
    
    // Si es de alta prioridad y no se ha enviado, marcar para envío
    if (!alerta.enviada && clasificacion.nivel.valor >= this.nivelesAlerta.ALTA.valor) {
      this.alertasEnviadas.set(hashContenido, Date.now());
      return alerta;
    }
    
    return null;
  }

  generarIdAlerta() {
    return `ALT-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
  }

  generarHashContenido(texto) {
    // Simple hash para detectar contenido similar
    const textoLimpio = texto.toLowerCase().replace(/[^a-z0-9]/g, '');
    let hash = 0;
    for (let i = 0; i < textoLimpio.length; i++) {
      const char = textoLimpio.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString();
  }

  extraerNombreMedio(tweet) {
    try {
      const texto = tweet.texto || tweet.text || '';
      const match = texto.match(/@[\w_]+/);
      return match ? match[0].substring(1) : 'Desconocido';
    } catch (error) {
      return 'Desconocido';
    }
  }

  formatearAlertaTelegram(alerta) {
    const { nivel, razon, palabrasDetectadas } = alerta.clasificacion;
    const tweet = alerta.tweet;
    
    let mensaje = `${nivel.emoji} *ALERTA ${Object.keys(this.nivelesAlerta).find(k => this.nivelesAlerta[k] === nivel)}*\n`;
    mensaje += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    
    mensaje += `📰 *Medio:* ${tweet.medio}\n`;
    mensaje += `⚡ *Razón:* ${razon}\n`;
    
    if (palabrasDetectadas.length > 0) {
      mensaje += `🔍 *Palabras clave:* ${palabrasDetectadas.join(', ')}\n`;
    }
    
    mensaje += `\n📝 *Contenido:*\n${tweet.texto.substring(0, 500)}${tweet.texto.length > 500 ? '...' : ''}\n`;
    
    if (tweet.url) {
      mensaje += `\n🔗 [Ver tweet original](${tweet.url})`;
    }
    
    return mensaje;
  }

  obtenerResumenAlertas() {
    const hoy = new Date().toISOString().split('T')[0];
    const alertasHoy = this.historialAlertas.filter(a => 
      a.fechaProcesamiento.startsWith(hoy)
    );
    
    const resumen = {
      total: alertasHoy.length,
      porNivel: {},
      porMedio: {},
      palabrasClaveMasDetectadas: {}
    };
    
    // Contar por nivel
    Object.keys(this.nivelesAlerta).forEach(nivel => {
      resumen.porNivel[nivel] = 0;
    });
    
    alertasHoy.forEach(alerta => {
      // Por nivel
      const nivelNombre = Object.keys(this.nivelesAlerta).find(k => 
        this.nivelesAlerta[k] === alerta.clasificacion.nivel
      );
      resumen.porNivel[nivelNombre]++;
      
      // Por medio
      const medio = alerta.tweet.medio;
      if (!resumen.porMedio[medio]) {
        resumen.porMedio[medio] = 0;
      }
      resumen.porMedio[medio]++;
      
      // Palabras clave
      alerta.clasificacion.palabrasDetectadas.forEach(palabra => {
        if (!resumen.palabrasClaveMasDetectadas[palabra]) {
          resumen.palabrasClaveMasDetectadas[palabra] = 0;
        }
        resumen.palabrasClaveMasDetectadas[palabra]++;
      });
    });
    
    return resumen;
  }

  generarReporteAlertasTelegram() {
    const resumen = this.obtenerResumenAlertas();
    
    let reporte = `🚨 *RESUMEN DE ALERTAS DEL DÍA*\n`;
    reporte += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    
    reporte += `📊 *Total de alertas:* ${resumen.total}\n\n`;
    
    reporte += `📈 *Por nivel de prioridad:*\n`;
    Object.entries(resumen.porNivel).forEach(([nivel, count]) => {
      if (count > 0) {
        reporte += `${this.nivelesAlerta[nivel].emoji} ${nivel}: ${count}\n`;
      }
    });
    
    const topMedios = Object.entries(resumen.porMedio)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);
    
    if (topMedios.length > 0) {
      reporte += `\n📰 *Medios con más alertas:*\n`;
      topMedios.forEach(([medio, count]) => {
        reporte += `• ${medio}: ${count} alertas\n`;
      });
    }
    
    const topPalabras = Object.entries(resumen.palabrasClaveMasDetectadas)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);
    
    if (topPalabras.length > 0) {
      reporte += `\n🔍 *Términos más detectados:*\n`;
      topPalabras.forEach(([palabra, count]) => {
        reporte += `• ${palabra}: ${count} veces\n`;
      });
    }
    
    return reporte;
  }

  // Limpiar alertas antiguas (mantener últimos 7 días)
  limpiarAlertasAntiguas() {
    try {
      const archivos = fs.readdirSync(this.carpetaAlertas);
      const fechaLimite = new Date();
      fechaLimite.setDate(fechaLimite.getDate() - 7);
      
      archivos.forEach(archivo => {
        const match = archivo.match(/alertas-(\d{4}-\d{2}-\d{2})\.json/);
        if (match) {
          const fechaArchivo = new Date(match[1]);
          if (fechaArchivo < fechaLimite) {
            fs.unlinkSync(path.join(this.carpetaAlertas, archivo));
            console.log(`🚨 Eliminado archivo de alertas antiguo: ${archivo}`);
          }
        }
      });
      
      // Limpiar cache de alertas enviadas
      this.alertasEnviadas.clear();
    } catch (error) {
      console.error('Error limpiando alertas antiguas:', error);
    }
  }
}

export default SistemaAlertas;