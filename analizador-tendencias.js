import fs from 'fs';
import path from 'path';
import https from 'https';
import querystring from 'querystring';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// OpenAI se importará dinámicamente solo si está disponible
let OpenAI = null;

class AnalizadorTendenciasLegislativo {
  constructor() {
    this.temasDelDia = new Map();
    this.tweetsDelDia = [];
    this.estadisticasDiarias = {
      fecha: new Date().toISOString().split('T')[0],
      totalTweets: 0,
      totalDuplicados: 0,
      temasContados: {},
      categorias: {
        legislativo: 0,
        politico: 0,
        presupuesto: 0,
        urgente: 0
      },
      diputados: new Map(),
      comisiones: new Map(),
      tiposIniciativas: new Map(),
      partidosPoliticos: new Map(),
      horas: {}
    };
    
    this.dirLogs = path.join(__dirname, 'logs');
    this.dirResumenes = path.join(__dirname, 'resumenes');
    
    this.crearDirectorios();
    this.initializeOpenAI();
    
    // Programar reset diario a las 23:59
    this.programarResetDiario();
    
    // Programar resumen diario a las 10:00 PM
    this.programarResumenDiario();
    
    // Programar resumen semanal los viernes a las 11:00 PM
    this.programarResumenSemanal();
  }

  async initializeOpenAI() {
    try {
      if (process.env.OPENAI_API_KEY && !OpenAI) {
        OpenAI = (await import('openai')).default;
      }
      
      if (process.env.OPENAI_API_KEY && OpenAI) {
        this.openai = new OpenAI({
          apiKey: process.env.OPENAI_API_KEY
        });
      }
    } catch (error) {
      console.log('⚠️ OpenAI no está instalado, se continuará sin análisis IA');
    }
  }
  
  crearDirectorios() {
    if (!fs.existsSync(this.dirLogs)) {
      fs.mkdirSync(this.dirLogs, { recursive: true });
    }
    if (!fs.existsSync(this.dirResumenes)) {
      fs.mkdirSync(this.dirResumenes, { recursive: true });
    }
  }
  
  // Agregar tweet y analizar temas legislativos
  agregarTweet(tweet, esDuplicado = false) {
    const ahora = new Date();
    const hora = ahora.getHours();
    
    // Guardar tweet completo
    this.tweetsDelDia.push({
      ...tweet,
      esDuplicado,
      timestamp: ahora.toISOString()
    });
    
    // Actualizar estadísticas generales
    this.estadisticasDiarias.totalTweets++;
    if (esDuplicado) {
      this.estadisticasDiarias.totalDuplicados++;
    }
    
    // Actualizar estadísticas por hora
    this.estadisticasDiarias.horas[hora] = (this.estadisticasDiarias.horas[hora] || 0) + 1;
    
    // Actualizar categorías legislativas
    if (tweet.categorias && tweet.categorias.length > 0) {
      tweet.categorias.forEach(cat => {
        const catNombre = cat.nombre || cat;
        if (this.estadisticasDiarias.categorias[catNombre] !== undefined) {
          this.estadisticasDiarias.categorias[catNombre]++;
        }
      });
    }
    
    // Extraer y contar temas del texto
    const texto = tweet.texto || '';
    const palabras = texto.toLowerCase().split(/\s+/);
    
    // Buscar diputados (incluidos apodos)
    const diputados = [
      'jazmin solano', 'presidenta del congreso', 'presidenta mesa directiva',
      'rafa reyes', 'rafael reyes', 'andy gordillo', 'andrea gordillo',
      'chino livera', 'alberto sanchez', 'guille maya', 'guillermo maya',
      'diputado', 'diputada', 'legislador', 'legisladora',
      'coordinador parlamentario', 'coordinadora parlamentaria'
    ];
    
    diputados.forEach(dip => {
      if (texto.toLowerCase().includes(dip)) {
        const count = this.estadisticasDiarias.diputados.get(dip) || 0;
        this.estadisticasDiarias.diputados.set(dip, count + 1);
      }
    });
    
    // Buscar tipos de iniciativas legislativas
    const tiposIniciativas = [
      'iniciativa', 'dictamen', 'reforma', 'punto de acuerdo',
      'exhorto', 'decreto', 'minuta', 'proposicion',
      'comparecencia', 'glosa', 'informe', 'presupuesto',
      'ley de ingresos', 'cuenta publica', 'auditoria'
    ];
    
    tiposIniciativas.forEach(tipo => {
      if (texto.toLowerCase().includes(tipo)) {
        const count = this.estadisticasDiarias.tiposIniciativas.get(tipo) || 0;
        this.estadisticasDiarias.tiposIniciativas.set(tipo, count + 1);
      }
    });
    
    // Buscar comisiones legislativas
    const comisiones = [
      'comision de hacienda', 'comision de justicia', 'comision de salud',
      'comision de educacion', 'comision de seguridad', 'comision de genero',
      'comision de derechos humanos', 'comision de medio ambiente',
      'comision de turismo', 'comision de desarrollo', 'junta politica',
      'mesa directiva', 'conferencia parlamentaria'
    ];
    
    comisiones.forEach(comision => {
      if (texto.toLowerCase().includes(comision)) {
        const count = this.estadisticasDiarias.comisiones.get(comision) || 0;
        this.estadisticasDiarias.comisiones.set(comision, count + 1);
      }
    });
    
    // Buscar partidos políticos
    const partidos = [
      'morena', 'pan', 'pri', 'pvem', 'pt', 'mc', 'prd',
      'nueva alianza', 'encuentro social', 'partido verde',
      'movimiento ciudadano', 'accion nacional', 'revolucionario institucional'
    ];
    
    partidos.forEach(partido => {
      if (texto.toLowerCase().includes(partido)) {
        const count = this.estadisticasDiarias.partidosPoliticos.get(partido) || 0;
        this.estadisticasDiarias.partidosPoliticos.set(partido, count + 1);
      }
    });
    
    // Contar palabras relevantes (3+ caracteres)
    palabras.forEach(palabra => {
      if (palabra.length > 3 && !this.esPalabraComun(palabra)) {
        this.temasDelDia.set(palabra, (this.temasDelDia.get(palabra) || 0) + 1);
        this.estadisticasDiarias.temasContados[palabra] = 
          (this.estadisticasDiarias.temasContados[palabra] || 0) + 1;
      }
    });
  }
  
  esPalabraComun(palabra) {
    const palabrasComunes = [
      'para', 'este', 'esta', 'como', 'pero', 'sobre', 'entre',
      'desde', 'hasta', 'durante', 'mediante', 'tras', 'ante',
      'bajo', 'hacia', 'según', 'sino', 'también', 'después'
    ];
    return palabrasComunes.includes(palabra);
  }
  
  // Obtener top temas del día
  obtenerTopTemas(limite = 10) {
    return Array.from(this.temasDelDia.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limite)
      .map(([tema, cantidad]) => ({ tema, cantidad }));
  }
  
  // Programar reset diario
  programarResetDiario() {
    const ahora = new Date();
    const finDelDia = new Date();
    finDelDia.setHours(23, 59, 0, 0);
    
    if (ahora > finDelDia) {
      finDelDia.setDate(finDelDia.getDate() + 1);
    }
    
    const tiempoHastaReset = finDelDia - ahora;
    
    setTimeout(() => {
      this.resetDiario();
      setInterval(() => {
        this.resetDiario();
      }, 24 * 60 * 60 * 1000);
    }, tiempoHastaReset);
    
    console.log(`⏰ Reset diario programado para: ${finDelDia.toLocaleString('es-MX')}`);
  }
  
  // Programar resumen diario a las 10:00 PM
  programarResumenDiario() {
    const ahora = new Date();
    const horaResumen = new Date();
    horaResumen.setHours(22, 0, 0, 0); // 10:00 PM - LEGISLATIVO PRIMERO
    
    if (ahora > horaResumen) {
      horaResumen.setDate(horaResumen.getDate() + 1);
    }
    
    const tiempoHastaResumen = horaResumen - ahora;
    
    setTimeout(() => {
      this.enviarResumenDiario();
      setInterval(() => {
        this.enviarResumenDiario();
      }, 24 * 60 * 60 * 1000);
    }, tiempoHastaResumen);
    
    console.log(`🗳️ Resumen legislativo diario programado para: ${horaResumen.toLocaleString('es-MX')}`);
  }
  
  async resetDiario() {
    console.log('🔄 Ejecutando reset diario legislativo...');
    
    // Guardar datos finales del día
    this.guardarDatosDelDia();
    
    // Resetear variables
    this.temasDelDia.clear();
    this.tweetsDelDia = [];
    this.estadisticasDiarias = {
      fecha: new Date().toISOString().split('T')[0],
      totalTweets: 0,
      totalDuplicados: 0,
      temasContados: {},
      categorias: {
        legislativo: 0,
        politico: 0,
        presupuesto: 0,
        urgente: 0
      },
      diputados: new Map(),
      comisiones: new Map(),
      tiposIniciativas: new Map(),
      partidosPoliticos: new Map(),
      horas: {}
    };
    
    console.log('✅ Reset diario legislativo completado');
  }
  
  // Enviar resumen diario a las 10 PM
  async enviarResumenDiario() {
    console.log('🗳️ Generando y enviando resumen diario legislativo...');
    
    try {
      const fechaStr = new Date().toISOString().split('T')[0];
      const topTemas = this.obtenerTopTemas(15);
      
      const resumen = {
        fecha: fechaStr,
        totalTweets: this.estadisticasDiarias.totalTweets,
        totalDuplicados: this.estadisticasDiarias.totalDuplicados,
        topTemas,
        categorias: this.estadisticasDiarias.categorias,
        diputados: Array.from(this.estadisticasDiarias.diputados.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10),
        comisiones: Array.from(this.estadisticasDiarias.comisiones.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10),
        tiposIniciativas: Array.from(this.estadisticasDiarias.tiposIniciativas.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10),
        partidosPoliticos: Array.from(this.estadisticasDiarias.partidosPoliticos.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 7),
        horasPico: this.obtenerHorasPico()
      };
      
      // Si tenemos OpenAI configurado, generar análisis
      if (this.openai) {
        const analisisGPT = await this.generarAnalisisGPT(resumen, 'diario');
        resumen.analisisIA = analisisGPT;
      }
      
      // Guardar resumen
      const archivoResumen = path.join(this.dirResumenes, `resumen-legislativo-${fechaStr}.json`);
      fs.writeFileSync(archivoResumen, JSON.stringify(resumen, null, 2));
      
      // Enviar por Telegram y WhatsApp
      await this.enviarResumenDiarioPorTelegram(resumen);
      await this.enviarResumenDiarioPorWhatsApp(resumen);
      
      console.log(`🗳️ Resumen legislativo enviado: ${archivoResumen}`);
      return resumen;
      
    } catch (error) {
      console.error('❌ Error enviando resumen legislativo:', error.message);
      return null;
    }
  }
  
  // Enviar resumen diario por Telegram - Bot Monitor Morelos
  async enviarResumenDiarioPorTelegram(resumen) {
    try {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      const chatId = process.env.TELEGRAM_CHAT_ID;
      
      if (!botToken || !chatId) {
        console.error('❌ Token o Chat ID de Telegram no configurados para Monitor Legislativo');
        return;
      }
      
      let mensaje = `🗳️ RESUMEN DIARIO - CONGRESO DE MORELOS\n`;
      mensaje += `\n📅 Fecha: ${resumen.fecha}\n`;
      mensaje += `\n🏛️ ESTADÍSTICAS LEGISLATIVAS:`;
      mensaje += `\n• Total comunicados monitoreados: ${resumen.totalTweets}`;
      mensaje += `\n• Duplicados detectados: ${resumen.totalDuplicados}`;
      mensaje += `\n• Comunicados únicos: ${resumen.totalTweets - resumen.totalDuplicados}`;
      
      // Categorías legislativas
      mensaje += `\n\n📋 ACTIVIDAD POR CATEGORÍA:`;
      Object.entries(resumen.categorias).forEach(([cat, cantidad]) => {
        if (cantidad > 0) {
          const emoji = this.obtenerEmojiCategoria(cat);
          mensaje += `\n${emoji} ${cat.charAt(0).toUpperCase() + cat.slice(1)}: ${cantidad}`;
        }
      });
      
      // Tipos de iniciativas
      if (resumen.tiposIniciativas && resumen.tiposIniciativas.length > 0) {
        mensaje += `\n\n📜 ACTIVIDAD PARLAMENTARIA:`;
        resumen.tiposIniciativas.slice(0, 5).forEach(([tipo, cantidad], idx) => {
          mensaje += `\n${idx + 1}. ${tipo.charAt(0).toUpperCase() + tipo.slice(1)} (${cantidad})`;
        });
      }
      
      // Diputados activos (con apodos)
      if (resumen.diputados && resumen.diputados.length > 0) {
        mensaje += `\n\n👥 DIPUTADOS MÁS ACTIVOS:`;
        resumen.diputados.slice(0, 5).forEach(([dip, cantidad], idx) => {
          const nombreMostrar = this.formatearNombreDiputado(dip);
          mensaje += `\n${idx + 1}. ${nombreMostrar} (${cantidad} menciones)`;
        });
      }
      
      // Comisiones activas
      if (resumen.comisiones && resumen.comisiones.length > 0) {
        mensaje += `\n\n🏛️ COMISIONES ACTIVAS:`;
        resumen.comisiones.slice(0, 5).forEach(([com, cantidad], idx) => {
          mensaje += `\n${idx + 1}. ${com.toUpperCase()} (${cantidad})`;
        });
      }
      
      // Partidos políticos
      if (resumen.partidosPoliticos && resumen.partidosPoliticos.length > 0) {
        mensaje += `\n\n🎯 ACTIVIDAD POR PARTIDO:`;
        resumen.partidosPoliticos.forEach(([partido, cantidad], idx) => {
          mensaje += `\n${idx + 1}. ${partido.toUpperCase()} (${cantidad} menciones)`;
        });
      }
      
      // Top temas del día
      if (resumen.topTemas && resumen.topTemas.length > 0) {
        mensaje += `\n\n🔥 TOP 10 TEMAS LEGISLATIVOS:`;
        resumen.topTemas.slice(0, 10).forEach((tema, idx) => {
          mensaje += `\n${idx + 1}. ${tema.tema} (${tema.cantidad} menciones)`;
        });
      }
      
      // Horas pico
      if (resumen.horasPico && resumen.horasPico.length > 0) {
        mensaje += `\n\n⏰ HORARIOS DE MAYOR ACTIVIDAD:`;
        resumen.horasPico.forEach((hora, idx) => {
          mensaje += `\n${idx + 1}. ${hora.hora}:00 hrs (${hora.cantidad} comunicados)`;
        });
      }
      
      // Análisis IA si está disponible
      if (resumen.analisisIA) {
        mensaje += `\n\n🤖 ANÁLISIS LEGISLATIVO IA:\n${resumen.analisisIA}`;
      }
      
      mensaje += `\n\n📋 Resumen completo: resumenes/resumen-legislativo-${resumen.fecha}.json`;
      mensaje += `\n\n🕙 Próximo resumen: Mañana 10:00 PM`;
      mensaje += `\n\n🏛️ LVI Legislatura - Monitor Morelos`;
      
      const postData = querystring.stringify({
        chat_id: chatId,
        text: mensaje,
        parse_mode: 'HTML'
      });
      
      const options = {
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${botToken}/sendMessage`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData)
        }
      };
      
      return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => data += chunk);
          res.on('end', () => {
            if (res.statusCode === 200) {
              console.log('📲 Resumen legislativo enviado por Telegram');
              resolve(data);
            } else {
              console.error('❌ Error enviando resumen legislativo:', data);
              reject(new Error(data));
            }
          });
        });
        
        req.on('error', (error) => {
          console.error('❌ Error de conexión Telegram:', error.message);
          reject(error);
        });
        
        req.write(postData);
        req.end();
      });
      
    } catch (error) {
      console.error('❌ Error enviando resumen legislativo por Telegram:', error.message);
    }
  }
  
  // Enviar resumen por WhatsApp (solo Monitor Legislativo tiene WhatsApp)
  async enviarResumenDiarioPorWhatsApp(resumen) {
    try {
      // Verificar si WhatsApp está configurado
      if (!process.env.WHATSAPP_ENABLED || process.env.WHATSAPP_ENABLED !== 'true') {
        return;
      }
      
      // Formato más compacto para WhatsApp
      let mensaje = `🗳️ *RESUMEN DIARIO - CONGRESO MORELOS*\n`;
      mensaje += `📅 ${resumen.fecha}\n\n`;
      mensaje += `📊 *ESTADÍSTICAS:*\n`;
      mensaje += `• Comunicados: ${resumen.totalTweets}\n`;
      mensaje += `• Únicos: ${resumen.totalTweets - resumen.totalDuplicados}\n\n`;
      
      if (resumen.diputados && resumen.diputados.length > 0) {
        mensaje += `👥 *TOP DIPUTADOS:*\n`;
        resumen.diputados.slice(0, 3).forEach(([dip, cantidad], idx) => {
          const nombreMostrar = this.formatearNombreDiputado(dip);
          mensaje += `${idx + 1}. ${nombreMostrar} (${cantidad})\n`;
        });
      }
      
      mensaje += `\n🏛️ _LVI Legislatura_`;
      
      // Aquí iría la integración con la API de WhatsApp
      console.log('💬 Resumen preparado para WhatsApp (pendiente implementación)');
      
    } catch (error) {
      console.error('❌ Error enviando resumen por WhatsApp:', error.message);
    }
  }
  
  formatearNombreDiputado(nombre) {
    const apodos = {
      'rafa reyes': 'Rafa Reyes',
      'rafael reyes': 'Rafa Reyes',
      'andy gordillo': 'Andy Gordillo',
      'andrea gordillo': 'Andy Gordillo',
      'chino livera': 'Chino Livera',
      'alberto sanchez': 'Chino Livera',
      'guille maya': 'Guille Maya',
      'guillermo maya': 'Guille Maya',
      'jazmin solano': 'Dip. Jazmín Solano López (Presidenta)'
    };
    
    return apodos[nombre] || nombre.split(' ').map(p => 
      p.charAt(0).toUpperCase() + p.slice(1)
    ).join(' ');
  }
  
  obtenerEmojiCategoria(categoria) {
    const emojis = {
      legislativo: '🗳️',
      politico: '🎯',
      presupuesto: '💰',
      urgente: '🚨'
    };
    return emojis[categoria] || '📋';
  }
  
  // Programar resumen semanal (viernes 11:00 PM)
  programarResumenSemanal() {
    const ahora = new Date();
    const viernes = new Date();
    
    // Calcular próximo viernes
    const diasHastaViernes = (5 - viernes.getDay() + 7) % 7;
    if (diasHastaViernes === 0 && ahora.getHours() >= 23) {
      viernes.setDate(viernes.getDate() + 7);
    } else {
      viernes.setDate(viernes.getDate() + diasHastaViernes);
    }
    
    viernes.setHours(23, 0, 0, 0); // 11:00 PM - LEGISLATIVO PRIMERO
    
    const tiempoHastaViernes = viernes - ahora;
    
    setTimeout(() => {
      this.enviarResumenSemanalCompleto();
      setInterval(() => {
        this.enviarResumenSemanalCompleto();
      }, 7 * 24 * 60 * 60 * 1000);
    }, tiempoHastaViernes);
    
    console.log(`📅 Resumen semanal legislativo programado para: Viernes ${viernes.toLocaleString('es-MX')}`);
  }
  
  // Generar análisis con GPT adaptado para poder legislativo
  async generarAnalisisGPT(datos, tipo = 'diario') {
    if (!this.openai) return null;
    
    try {
      const prompt = tipo === 'diario' 
        ? `Analiza estos datos del Congreso de Morelos del ${datos.fecha}:
           - Total comunicados: ${datos.totalTweets} (${datos.totalDuplicados} duplicados)
           - Tipos de actividad: ${datos.tiposIniciativas.map(t => t[0]).slice(0, 5).join(', ')}
           - Diputados activos: ${datos.diputados.map(d => this.formatearNombreDiputado(d[0])).slice(0, 3).join(', ')}
           - Partidos mencionados: ${datos.partidosPoliticos.map(p => p[0]).join(', ')}
           
           Genera un análisis legislativo ejecutivo (máximo 3 párrafos) sobre:
           1. Las iniciativas y reformas más relevantes del día
           2. Dinámicas políticas y alianzas partidistas observadas
           3. Impacto potencial de las propuestas legislativas en la ciudadanía`
        : `Analiza estos datos semanales del Congreso de Morelos (${datos.fechaInicio} al ${datos.fechaFin}):
           - Total comunicados: ${datos.totalTweets} (promedio ${datos.promedioTweetsDiarios}/día)
           - Principal actividad legislativa de la semana
           - Evolución del trabajo parlamentario
           
           Genera un resumen ejecutivo legislativo (máximo 4 párrafos) sobre:
           1. Las principales iniciativas y reformas de la semana
           2. Tendencias en la agenda legislativa
           3. Balance del trabajo parlamentario y productividad
           4. Temas pendientes y perspectivas para la siguiente semana`;
      
      const completion = await this.openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "Eres un analista político especializado en el Poder Legislativo de Morelos. Tu análisis debe ser objetivo, enfocado en el impacto de las decisiones legislativas y la dinámica política del Congreso local."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 500
      });
      
      return completion.choices[0].message.content;
      
    } catch (error) {
      console.error('❌ Error generando análisis GPT legislativo:', error.message);
      return null;
    }
  }
  
  // Guardar datos del día
  guardarDatosDelDia() {
    const fecha = new Date().toISOString().split('T')[0];
    const archivo = path.join(this.dirLogs, `tendencias-legislativo-${fecha}.json`);
    
    const datos = {
      fecha,
      estadisticas: {
        ...this.estadisticasDiarias,
        diputados: Array.from(this.estadisticasDiarias.diputados.entries()),
        comisiones: Array.from(this.estadisticasDiarias.comisiones.entries()),
        tiposIniciativas: Array.from(this.estadisticasDiarias.tiposIniciativas.entries()),
        partidosPoliticos: Array.from(this.estadisticasDiarias.partidosPoliticos.entries())
      },
      topTemas: this.obtenerTopTemas(50),
      tweetsDelDia: this.tweetsDelDia.slice(-100)
    };
    
    fs.writeFileSync(archivo, JSON.stringify(datos, null, 2));
    console.log(`💾 Datos legislativos del día guardados: ${archivo}`);
  }
  
  // Obtener horas pico
  obtenerHorasPico() {
    const horasOrdenadas = Object.entries(this.estadisticasDiarias.horas)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([hora, cantidad]) => ({
        hora: parseInt(hora),
        cantidad
      }));
    
    return horasOrdenadas;
  }
  
  // Generar y enviar resumen semanal completo
  async enviarResumenSemanalCompleto() {
    console.log('🗳️ Generando resumen semanal legislativo...');
    
    try {
      const resumenSemanal = await this.generarResumenSemanal();
      if (resumenSemanal) {
        await this.enviarResumenSemanalPorTelegram(resumenSemanal);
        await this.enviarResumenSemanalPorWhatsApp(resumenSemanal);
      }
    } catch (error) {
      console.error('❌ Error en resumen semanal legislativo:', error.message);
    }
  }
  
  // Generar resumen semanal
  async generarResumenSemanal() {
    try {
      const fechaFin = new Date();
      const fechaInicio = new Date();
      fechaInicio.setDate(fechaInicio.getDate() - 7);
      
      // Recopilar datos de la semana
      const datosSemana = [];
      const temasSemanales = new Map();
      const diputadosSemanales = new Map();
      const comisionesSemanales = new Map();
      const tiposIniciativasSemanales = new Map();
      const partidosSemanales = new Map();
      let totalTweetsSemana = 0;
      let totalDuplicadosSemana = 0;
      const categoriasSemanales = {
        legislativo: 0,
        politico: 0,
        presupuesto: 0,
        urgente: 0
      };
      
      for (let i = 0; i < 7; i++) {
        const fecha = new Date(fechaInicio);
        fecha.setDate(fecha.getDate() + i);
        const fechaStr = fecha.toISOString().split('T')[0];
        const archivo = path.join(this.dirLogs, `tendencias-legislativo-${fechaStr}.json`);
        
        if (fs.existsSync(archivo)) {
          const datos = JSON.parse(fs.readFileSync(archivo, 'utf8'));
          datosSemana.push(datos);
          
          // Acumular datos
          if (datos.estadisticas) {
            totalTweetsSemana += datos.estadisticas.totalTweets || 0;
            totalDuplicadosSemana += datos.estadisticas.totalDuplicados || 0;
            
            // Categorías
            Object.entries(datos.estadisticas.categorias || {}).forEach(([cat, count]) => {
              categoriasSemanales[cat] = (categoriasSemanales[cat] || 0) + count;
            });
            
            // Diputados
            (datos.estadisticas.diputados || []).forEach(([dip, count]) => {
              diputadosSemanales.set(dip, (diputadosSemanales.get(dip) || 0) + count);
            });
            
            // Comisiones
            (datos.estadisticas.comisiones || []).forEach(([com, count]) => {
              comisionesSemanales.set(com, (comisionesSemanales.get(com) || 0) + count);
            });
            
            // Tipos de iniciativas
            (datos.estadisticas.tiposIniciativas || []).forEach(([tipo, count]) => {
              tiposIniciativasSemanales.set(tipo, (tiposIniciativasSemanales.get(tipo) || 0) + count);
            });
            
            // Partidos
            (datos.estadisticas.partidosPoliticos || []).forEach(([partido, count]) => {
              partidosSemanales.set(partido, (partidosSemanales.get(partido) || 0) + count);
            });
            
            // Temas
            if (datos.estadisticas.temasContados) {
              Object.entries(datos.estadisticas.temasContados).forEach(([tema, cantidad]) => {
                temasSemanales.set(tema, (temasSemanales.get(tema) || 0) + cantidad);
              });
            }
          }
        }
      }
      
      const resumenSemanal = {
        fechaInicio: fechaInicio.toISOString().split('T')[0],
        fechaFin: fechaFin.toISOString().split('T')[0],
        totalTweets: totalTweetsSemana,
        totalDuplicados: totalDuplicadosSemana,
        promedioTweetsDiarios: Math.round(totalTweetsSemana / 7),
        categorias: categoriasSemanales,
        diputados: Array.from(diputadosSemanales.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 15),
        comisiones: Array.from(comisionesSemanales.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10),
        tiposIniciativas: Array.from(tiposIniciativasSemanales.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 15),
        partidosPoliticos: Array.from(partidosSemanales.entries())
          .sort((a, b) => b[1] - a[1]),
        topTemas: Array.from(temasSemanales.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20)
          .map(([tema, cantidad]) => ({ tema, cantidad })),
        diasConDatos: datosSemana.length
      };
      
      // Generar análisis con GPT si está disponible
      if (this.openai) {
        const analisisGPT = await this.generarAnalisisGPT(resumenSemanal, 'semanal');
        resumenSemanal.analisisIA = analisisGPT;
      }
      
      // Guardar resumen semanal
      const archivoSemanal = path.join(this.dirResumenes, `resumen-semanal-legislativo-${fechaInicio.toISOString().split('T')[0]}.json`);
      fs.writeFileSync(archivoSemanal, JSON.stringify(resumenSemanal, null, 2));
      
      console.log(`🗳️ Resumen semanal legislativo generado: ${archivoSemanal}`);
      return resumenSemanal;
      
    } catch (error) {
      console.error('❌ Error generando resumen semanal legislativo:', error.message);
      return null;
    }
  }
  
  // Enviar resumen semanal por Telegram
  async enviarResumenSemanalPorTelegram(resumen) {
    try {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      const chatId = process.env.TELEGRAM_CHAT_ID;
      
      if (!botToken || !chatId) {
        console.error('❌ Token o Chat ID no configurados para Monitor Legislativo');
        return;
      }
      
      let mensaje = `🗳️ RESUMEN SEMANAL - CONGRESO DE MORELOS\n`;
      mensaje += `\n📅 Período: ${resumen.fechaInicio} al ${resumen.fechaFin}\n`;
      mensaje += `\n🏛️ ESTADÍSTICAS LEGISLATIVAS:`;
      mensaje += `\n• Total comunicados: ${resumen.totalTweets}`;
      mensaje += `\n• Duplicados: ${resumen.totalDuplicados}`;
      mensaje += `\n• Promedio diario: ${resumen.promedioTweetsDiarios} comunicados/día`;
      mensaje += `\n• Días con actividad: ${resumen.diasConDatos}/7`;
      
      // Resumen por categorías
      mensaje += `\n\n📋 ACTIVIDAD SEMANAL POR ÁREA:`;
      Object.entries(resumen.categorias).forEach(([cat, cantidad]) => {
        if (cantidad > 0) {
          const emoji = this.obtenerEmojiCategoria(cat);
          mensaje += `\n${emoji} ${cat.charAt(0).toUpperCase() + cat.slice(1)}: ${cantidad}`;
        }
      });
      
      // Top tipos de iniciativas
      if (resumen.tiposIniciativas && resumen.tiposIniciativas.length > 0) {
        mensaje += `\n\n📜 TOP 10 ACTIVIDAD PARLAMENTARIA:`;
        resumen.tiposIniciativas.slice(0, 10).forEach(([tipo, cantidad], idx) => {
          mensaje += `\n${idx + 1}. ${tipo.charAt(0).toUpperCase() + tipo.slice(1)} (${cantidad})`;
        });
      }
      
      // Top diputados semanales
      if (resumen.diputados && resumen.diputados.length > 0) {
        mensaje += `\n\n👥 DIPUTADOS MÁS ACTIVOS:`;
        resumen.diputados.slice(0, 10).forEach(([dip, cantidad], idx) => {
          const nombreMostrar = this.formatearNombreDiputado(dip);
          mensaje += `\n${idx + 1}. ${nombreMostrar} (${cantidad})`;
        });
      }
      
      // Partidos políticos
      if (resumen.partidosPoliticos && resumen.partidosPoliticos.length > 0) {
        mensaje += `\n\n🎯 ACTIVIDAD POR PARTIDO:`;
        resumen.partidosPoliticos.forEach(([partido, cantidad], idx) => {
          mensaje += `\n${idx + 1}. ${partido.toUpperCase()} (${cantidad})`;
        });
      }
      
      // Top temas semanales
      if (resumen.topTemas && resumen.topTemas.length > 0) {
        mensaje += `\n\n🔥 TOP 15 TEMAS LEGISLATIVOS:`;
        resumen.topTemas.slice(0, 15).forEach((tema, idx) => {
          mensaje += `\n${idx + 1}. ${tema.tema} (${tema.cantidad} menciones)`;
        });
      }
      
      // Análisis IA
      if (resumen.analisisIA) {
        mensaje += `\n\n🤖 ANÁLISIS SEMANAL LEGISLATIVO:\n${resumen.analisisIA}`;
      }
      
      mensaje += `\n\n📋 Resumen completo: resumenes/`;
      mensaje += `\n\n📅 Próximo resumen semanal: Viernes 11:00 PM`;
      mensaje += `\n\n🏛️ LVI Legislatura - Monitor Morelos`;
      
      const postData = querystring.stringify({
        chat_id: chatId,
        text: mensaje,
        parse_mode: 'HTML'
      });
      
      const options = {
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${botToken}/sendMessage`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData)
        }
      };
      
      return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => data += chunk);
          res.on('end', () => {
            if (res.statusCode === 200) {
              console.log('📲 Resumen semanal legislativo enviado');
              resolve(data);
            } else {
              console.error('❌ Error enviando resumen semanal:', data);
              reject(new Error(data));
            }
          });
        });
        
        req.on('error', (error) => {
          console.error('❌ Error de conexión:', error.message);
          reject(error);
        });
        
        req.write(postData);
        req.end();
      });
      
    } catch (error) {
      console.error('❌ Error enviando resumen semanal legislativo:', error.message);
    }
  }
  
  // Enviar resumen semanal por WhatsApp
  async enviarResumenSemanalPorWhatsApp(resumen) {
    try {
      if (!process.env.WHATSAPP_ENABLED || process.env.WHATSAPP_ENABLED !== 'true') {
        return;
      }
      
      let mensaje = `🗳️ *RESUMEN SEMANAL CONGRESO*\n`;
      mensaje += `📅 ${resumen.fechaInicio} al ${resumen.fechaFin}\n\n`;
      mensaje += `📊 *Total:* ${resumen.totalTweets} comunicados\n`;
      mensaje += `📈 *Promedio:* ${resumen.promedioTweetsDiarios}/día\n\n`;
      
      mensaje += `🎯 *TOP PARTIDOS:*\n`;
      resumen.partidosPoliticos.slice(0, 3).forEach(([partido, cantidad], idx) => {
        mensaje += `${idx + 1}. ${partido.toUpperCase()} (${cantidad})\n`;
      });
      
      mensaje += `\n👥 *TOP DIPUTADOS:*\n`;
      resumen.diputados.slice(0, 3).forEach(([dip, cantidad], idx) => {
        const nombreMostrar = this.formatearNombreDiputado(dip);
        mensaje += `${idx + 1}. ${nombreMostrar} (${cantidad})\n`;
      });
      
      mensaje += `\n🏛️ _LVI Legislatura_`;
      
      console.log('💬 Resumen semanal preparado para WhatsApp');
      
    } catch (error) {
      console.error('❌ Error enviando resumen semanal por WhatsApp:', error.message);
    }
  }
}

export default AnalizadorTendenciasLegislativo;