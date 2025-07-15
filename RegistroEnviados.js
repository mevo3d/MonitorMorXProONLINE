// RegistroEnviados.js - Sistema para rastrear tweets REALMENTE enviados
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

class RegistroEnviados {
  constructor() {
    this.carpetaRegistros = './logs/tweets-enviados';
    this.archivoRegistroHoy = null;
    this.tweetsEnviadosHoy = new Map(); // Cache en memoria para el día actual
    this.maxRegistrosPorArchivo = 1000;
    
    this.crearDirectorios();
    this.cargarRegistroHoy();
  }

  crearDirectorios() {
    if (!fs.existsSync(this.carpetaRegistros)) {
      fs.mkdirSync(this.carpetaRegistros, { recursive: true });
    }
  }

  cargarRegistroHoy() {
    const fechaHoy = new Date().toISOString().split('T')[0];
    this.archivoRegistroHoy = path.join(this.carpetaRegistros, `enviados-${fechaHoy}.json`);
    
    try {
      if (fs.existsSync(this.archivoRegistroHoy)) {
        const data = fs.readFileSync(this.archivoRegistroHoy, 'utf8');
        const registros = JSON.parse(data);
        
        // Cargar en cache para búsquedas rápidas
        registros.forEach(registro => {
          this.tweetsEnviadosHoy.set(registro.hashCombinado, registro);
        });
        
        console.log(`📋 Cargados ${registros.length} tweets enviados del día`);
      }
    } catch (error) {
      console.error('❌ Error cargando registro de enviados:', error.message);
    }
  }

  // Registrar que un tweet fue ENVIADO exitosamente
  registrarTweetEnviado(tweet, tweetId, nombreColumna, tipoMedia = 'texto') {
    const ahora = Date.now();
    const timestamp = new Date().toISOString();
    
    // Generar firmas igual que el detector de duplicados
    const textoLimpio = this.limpiarTexto(tweet.texto);
    const hashTexto = crypto.createHash('md5').update(textoLimpio.toLowerCase()).digest('hex');
    const mediaIds = this.extraerMediaIds(tweet.mediaUrl || '');
    
    const datoCombinado = `${textoLimpio}|${tweet.usuario}|${mediaIds.join(',')}`;
    const hashCombinado = crypto.createHash('md5').update(datoCombinado.toLowerCase()).digest('hex');
    
    const registro = {
      id: tweetId,
      timestamp: ahora,
      fecha: timestamp.split('T')[0],
      hora: new Date(ahora).toLocaleTimeString('es-MX'),
      tweet: {
        texto: tweet.texto,
        textoLimpio: textoLimpio,
        usuario: tweet.usuario,
        url: tweet.url,
        mediaUrl: tweet.mediaUrl || ''
      },
      firmas: {
        hashTexto: hashTexto,
        hashCombinado: hashCombinado,
        mediaIds: mediaIds
      },
      meta: {
        columna: nombreColumna,
        tipoMedia: tipoMedia,
        tema: this.extraerTema(textoLimpio)
      }
    };
    
    // Agregar a cache en memoria
    this.tweetsEnviadosHoy.set(hashCombinado, registro);
    
    // Guardar en archivo
    this.guardarRegistroEnArchivo(registro);
    
    console.log(`📝 Registrado tweet enviado [${tweetId}]: ${registro.meta.tema.substring(0, 30)}...`);
    
    return registro;
  }

  // Verificar si un tweet YA FUE ENVIADO (no solo detectado)
  verificarTweetYaEnviado(tweet) {
    const textoLimpio = this.limpiarTexto(tweet.texto);
    const mediaIds = this.extraerMediaIds(tweet.mediaUrl || '');
    
    const datoCombinado = `${textoLimpio}|${tweet.usuario}|${mediaIds.join(',')}`;
    const hashCombinado = crypto.createHash('md5').update(datoCombinado.toLowerCase()).digest('hex');
    
    // Buscar en cache del día actual PRIMERO
    if (this.tweetsEnviadosHoy.has(hashCombinado)) {
      const tweetEnviado = this.tweetsEnviadosHoy.get(hashCombinado);
      return {
        yaEnviado: true,
        registro: tweetEnviado,
        tiempoTranscurrido: Date.now() - tweetEnviado.timestamp
      };
    }
    
    // Buscar en archivos de días anteriores (últimos 7 días)
    const registroAnterior = this.buscarEnArchivosAnteriores(hashCombinado, textoLimpio);
    if (registroAnterior) {
      return {
        yaEnviado: true,
        registro: registroAnterior,
        tiempoTranscurrido: Date.now() - registroAnterior.timestamp
      };
    }
    
    return {
      yaEnviado: false,
      registro: null
    };
  }

  buscarEnArchivosAnteriores(hashCombinado, textoLimpio) {
    const hace7Dias = Date.now() - (7 * 24 * 60 * 60 * 1000);
    
    try {
      if (!fs.existsSync(this.carpetaRegistros)) return null;
      
      const archivos = fs.readdirSync(this.carpetaRegistros)
        .filter(archivo => archivo.startsWith('enviados-') && archivo.endsWith('.json'))
        .sort()
        .reverse(); // Más recientes primero
      
      for (const archivo of archivos.slice(0, 7)) { // Solo últimos 7 archivos
        try {
          const rutaArchivo = path.join(this.carpetaRegistros, archivo);
          const stats = fs.statSync(rutaArchivo);
          
          // Saltar archivos muy antiguos
          if (stats.mtime.getTime() < hace7Dias) continue;
          
          const data = fs.readFileSync(rutaArchivo, 'utf8');
          const registros = JSON.parse(data);
          
          // Buscar por hash combinado O similitud de texto
          for (const registro of registros) {
            if (registro.firmas?.hashCombinado === hashCombinado) {
              return registro;
            }
            
            // Buscar por similitud alta de texto como fallback
            if (registro.tweet?.textoLimpio) {
              const similitud = this.calcularSimilitudTexto(textoLimpio, registro.tweet.textoLimpio);
              if (similitud > 95) { // Muy alta similitud
                return registro;
              }
            }
          }
        } catch (error) {
          // Archivo corrupto o error, continuar con el siguiente
          continue;
        }
      }
    } catch (error) {
      console.error('❌ Error buscando en archivos anteriores:', error.message);
    }
    
    return null;
  }

  guardarRegistroEnArchivo(registro) {
    try {
      let registros = [];
      
      // Cargar registros existentes del día
      if (fs.existsSync(this.archivoRegistroHoy)) {
        const data = fs.readFileSync(this.archivoRegistroHoy, 'utf8');
        registros = JSON.parse(data);
      }
      
      // Agregar nuevo registro
      registros.push(registro);
      
      // Guardar archivo actualizado
      fs.writeFileSync(this.archivoRegistroHoy, JSON.stringify(registros, null, 2));
      
    } catch (error) {
      console.error('❌ Error guardando registro de enviado:', error.message);
    }
  }

  // Obtener estadísticas de tweets enviados
  obtenerEstadisticasEnviados() {
    const totalHoy = this.tweetsEnviadosHoy.size;
    
    const porMedio = {};
    const porTipo = {};
    
    for (const [hash, registro] of this.tweetsEnviadosHoy.entries()) {
      // Contar por medio
      const medio = registro.tweet.usuario;
      porMedio[medio] = (porMedio[medio] || 0) + 1;
      
      // Contar por tipo
      const tipo = registro.meta.tipoMedia;
      porTipo[tipo] = (porTipo[tipo] || 0) + 1;
    }
    
    return {
      totalHoy,
      porMedio,
      porTipo,
      fechaActual: new Date().toLocaleDateString('es-MX')
    };
  }

  // Obtener lista de tweets enviados hoy para revisión
  obtenerTweetsEnviadosHoy() {
    const tweets = Array.from(this.tweetsEnviadosHoy.values())
      .sort((a, b) => b.timestamp - a.timestamp) // Más recientes primero
      .slice(0, 20); // Últimos 20
    
    return tweets.map(registro => ({
      id: registro.id,
      hora: registro.hora,
      usuario: registro.tweet.usuario,
      tema: registro.meta.tema,
      tipo: registro.meta.tipoMedia,
      columna: registro.meta.columna,
      texto: registro.tweet.texto.substring(0, 100) + (registro.tweet.texto.length > 100 ? '...' : '')
    }));
  }

  // Funciones auxiliares (copiadas del DetectorDuplicados para consistencia)
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
    const matches = mediaUrl.match(/[A-Za-z0-9_-]{15,}/g);
    if (matches) {
      ids.push(...matches);
    }
    return ids;
  }

  extraerTema(texto) {
    const palabras = texto.split(' ').filter(p => p.length > 3);
    return palabras.slice(0, Math.min(5, palabras.length)).join(' ') || 'Tema no identificado';
  }

  calcularSimilitudTexto(texto1, texto2) {
    if (texto1 === texto2) return 100;
    
    const palabras1 = new Set(texto1.split(' '));
    const palabras2 = new Set(texto2.split(' '));
    
    const interseccion = new Set([...palabras1].filter(x => palabras2.has(x)));
    const union = new Set([...palabras1, ...palabras2]);
    
    return (interseccion.size / union.size) * 100;
  }

  // Limpieza semanal de archivos antiguos
  limpiezaSemanal() {
    const ahora = new Date();
    if (ahora.getDay() === 1) { // Lunes
      console.log('🧹 Limpiando registros de tweets enviados antiguos...');
      
      const hace14Dias = Date.now() - (14 * 24 * 60 * 60 * 1000); // Mantener 2 semanas
      
      try {
        if (fs.existsSync(this.carpetaRegistros)) {
          const archivos = fs.readdirSync(this.carpetaRegistros);
          let archivosEliminados = 0;
          
          archivos.forEach(archivo => {
            const rutaArchivo = path.join(this.carpetaRegistros, archivo);
            const stats = fs.statSync(rutaArchivo);
            
            if (stats.mtime.getTime() < hace14Dias) {
              fs.unlinkSync(rutaArchivo);
              archivosEliminados++;
            }
          });
          
          if (archivosEliminados > 0) {
            console.log(`🗑️ Eliminados ${archivosEliminados} archivos de registros antiguos`);
          }
        }
      } catch (error) {
        console.error('❌ Error en limpieza semanal de registros:', error.message);
      }
    }
  }
}

export default RegistroEnviados;