// ExportadorReportes.js - Sistema de generación y exportación de reportes
import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';

class ExportadorReportes {
  constructor() {
    this.carpetaReportes = './reportes';
    this.carpetaReportesDiarios = path.join(this.carpetaReportes, 'diarios');
    this.carpetaReportesSemanales = path.join(this.carpetaReportes, 'semanales');
    this.carpetaReportesMensuales = path.join(this.carpetaReportes, 'mensuales');
    
    this.inicializar();
  }

  inicializar() {
    // Crear carpetas si no existen
    [this.carpetaReportes, this.carpetaReportesDiarios, 
     this.carpetaReportesSemanales, this.carpetaReportesMensuales].forEach(carpeta => {
      if (!fs.existsSync(carpeta)) {
        fs.mkdirSync(carpeta, { recursive: true });
      }
    });
  }

  async generarReporteDiario(estadisticas, metricas, alertas) {
    const fecha = new Date().toISOString().split('T')[0];
    const nombreArchivo = `reporte-diario-${fecha}`;
    
    // Generar JSON
    const datosReporte = {
      fecha,
      tipo: 'diario',
      generadoEn: new Date().toISOString(),
      estadisticas: estadisticas.obtenerResumenDiario(),
      metricas: metricas.obtenerResumenMetricas(),
      alertas: alertas.obtenerResumenAlertas(),
      configuracion: {
        monitorActivo: true,
        palabrasClaveActivas: estadisticas.estadisticasHoy.palabrasClaveDetectadas ? 
          Object.keys(estadisticas.estadisticasHoy.palabrasClaveDetectadas).length : 0
      }
    };
    
    // Guardar JSON
    const rutaJSON = path.join(this.carpetaReportesDiarios, `${nombreArchivo}.json`);
    fs.writeFileSync(rutaJSON, JSON.stringify(datosReporte, null, 2));
    
    // Generar Excel
    await this.generarExcelDiario(datosReporte, nombreArchivo);
    
    // Generar HTML
    this.generarHTMLDiario(datosReporte, nombreArchivo);
    
    return {
      json: rutaJSON,
      excel: path.join(this.carpetaReportesDiarios, `${nombreArchivo}.xlsx`),
      html: path.join(this.carpetaReportesDiarios, `${nombreArchivo}.html`)
    };
  }

  async generarExcelDiario(datos, nombreArchivo) {
    const workbook = new ExcelJS.Workbook();
    
    // Hoja de resumen
    const hojaResumen = workbook.addWorksheet('Resumen');
    hojaResumen.columns = [
      { header: 'Métrica', key: 'metrica', width: 30 },
      { header: 'Valor', key: 'valor', width: 20 }
    ];
    
    hojaResumen.addRows([
      { metrica: 'Fecha', valor: datos.fecha },
      { metrica: 'Total de Tweets', valor: datos.estadisticas.totalTweets },
      { metrica: 'Total de Medios', valor: datos.estadisticas.totalMedios },
      { metrica: 'Alertas Generadas', valor: datos.alertas.total }
    ]);
    
    // Aplicar estilos
    hojaResumen.getRow(1).font = { bold: true };
    hojaResumen.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4A90E2' }
    };
    
    // Hoja de medios
    const hojaMedios = workbook.addWorksheet('Medios');
    hojaMedios.columns = [
      { header: 'Medio', key: 'nombre', width: 30 },
      { header: 'Tweets', key: 'tweets', width: 15 },
      { header: 'Porcentaje', key: 'porcentaje', width: 15 }
    ];
    
    if (datos.estadisticas.topMedios) {
      hojaMedios.addRows(datos.estadisticas.topMedios);
    }
    
    // Hoja de alertas
    const hojaAlertas = workbook.addWorksheet('Alertas');
    hojaAlertas.columns = [
      { header: 'Nivel', key: 'nivel', width: 20 },
      { header: 'Cantidad', key: 'cantidad', width: 15 }
    ];
    
    if (datos.alertas.porNivel) {
      Object.entries(datos.alertas.porNivel).forEach(([nivel, cantidad]) => {
        hojaAlertas.addRow({ nivel, cantidad });
      });
    }
    
    // Guardar archivo
    const rutaExcel = path.join(this.carpetaReportesDiarios, `${nombreArchivo}.xlsx`);
    await workbook.xlsx.writeFile(rutaExcel);
  }

  generarHTMLDiario(datos, nombreArchivo) {
    const html = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Reporte Diario - ${datos.fecha}</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 20px;
            background-color: #f5f5f5;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background-color: white;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1, h2 {
            color: #333;
        }
        .metric-card {
            background-color: #f8f9fa;
            padding: 15px;
            margin: 10px 0;
            border-radius: 5px;
            border-left: 4px solid #4A90E2;
        }
        .metric-value {
            font-size: 24px;
            font-weight: bold;
            color: #4A90E2;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
        }
        th, td {
            padding: 10px;
            text-align: left;
            border-bottom: 1px solid #ddd;
        }
        th {
            background-color: #4A90E2;
            color: white;
        }
        .chart-container {
            margin: 20px 0;
            padding: 20px;
            background-color: #f8f9fa;
            border-radius: 5px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>📊 Reporte Diario de Monitoreo</h1>
        <p><strong>Fecha:</strong> ${datos.fecha}</p>
        <p><strong>Generado:</strong> ${new Date(datos.generadoEn).toLocaleString('es-MX')}</p>
        
        <h2>📈 Resumen General</h2>
        <div class="metric-card">
            <div>Total de Tweets</div>
            <div class="metric-value">${datos.estadisticas.totalTweets}</div>
        </div>
        
        <div class="metric-card">
            <div>Total de Medios</div>
            <div class="metric-value">${datos.estadisticas.totalMedios}</div>
        </div>
        
        <div class="metric-card">
            <div>Alertas Generadas</div>
            <div class="metric-value">${datos.alertas.total}</div>
        </div>
        
        <h2>🏆 Top Medios</h2>
        <table>
            <thead>
                <tr>
                    <th>Medio</th>
                    <th>Tweets</th>
                    <th>Porcentaje</th>
                </tr>
            </thead>
            <tbody>
                ${datos.estadisticas.topMedios ? datos.estadisticas.topMedios.map(medio => `
                <tr>
                    <td>${medio.nombre}</td>
                    <td>${medio.tweets}</td>
                    <td>${medio.porcentaje}%</td>
                </tr>
                `).join('') : '<tr><td colspan="3">Sin datos</td></tr>'}
            </tbody>
        </table>
        
        <h2>⏰ Horas Más Activas</h2>
        <div class="chart-container">
            ${datos.estadisticas.horasMasActivas ? datos.estadisticas.horasMasActivas.map(hora => `
            <div style="margin: 5px 0;">
                <strong>${hora.hora}:</strong> ${hora.tweets} tweets
            </div>
            `).join('') : 'Sin datos'}
        </div>
        
        <h2>🚨 Resumen de Alertas</h2>
        <table>
            <thead>
                <tr>
                    <th>Nivel</th>
                    <th>Cantidad</th>
                </tr>
            </thead>
            <tbody>
                ${datos.alertas.porNivel ? Object.entries(datos.alertas.porNivel).map(([nivel, cantidad]) => `
                <tr>
                    <td>${nivel}</td>
                    <td>${cantidad}</td>
                </tr>
                `).join('') : '<tr><td colspan="2">Sin alertas</td></tr>'}
            </tbody>
        </table>
    </div>
</body>
</html>
    `;
    
    const rutaHTML = path.join(this.carpetaReportesDiarios, `${nombreArchivo}.html`);
    fs.writeFileSync(rutaHTML, html);
  }

  async generarReporteSemanal(fechaInicio, fechaFin) {
    const reportesDiarios = [];
    const fecha = new Date(fechaInicio);
    
    // Recopilar datos de la semana
    while (fecha <= new Date(fechaFin)) {
      const fechaStr = fecha.toISOString().split('T')[0];
      const archivoReporte = path.join(this.carpetaReportesDiarios, `reporte-diario-${fechaStr}.json`);
      
      if (fs.existsSync(archivoReporte)) {
        const datos = JSON.parse(fs.readFileSync(archivoReporte, 'utf8'));
        reportesDiarios.push(datos);
      }
      
      fecha.setDate(fecha.getDate() + 1);
    }
    
    // Consolidar datos
    const datosSemanales = this.consolidarDatosSemanales(reportesDiarios);
    
    // Generar archivos
    const nombreArchivo = `reporte-semanal-${fechaInicio}`;
    const rutaJSON = path.join(this.carpetaReportesSemanales, `${nombreArchivo}.json`);
    
    fs.writeFileSync(rutaJSON, JSON.stringify(datosSemanales, null, 2));
    
    return {
      json: rutaJSON,
      datos: datosSemanales
    };
  }

  consolidarDatosSemanales(reportesDiarios) {
    const consolidado = {
      tipo: 'semanal',
      periodo: {
        inicio: reportesDiarios[0]?.fecha || '',
        fin: reportesDiarios[reportesDiarios.length - 1]?.fecha || ''
      },
      totalTweets: 0,
      promedioTweetsDiarios: 0,
      totalMediosUnicos: new Set(),
      totalAlertas: 0,
      tendencias: [],
      mediosTopSemana: {}
    };
    
    reportesDiarios.forEach(reporte => {
      consolidado.totalTweets += reporte.estadisticas.totalTweets;
      consolidado.totalAlertas += reporte.alertas.total;
      
      // Agregar medios únicos
      if (reporte.estadisticas.topMedios) {
        reporte.estadisticas.topMedios.forEach(medio => {
          consolidado.totalMediosUnicos.add(medio.nombre);
          
          if (!consolidado.mediosTopSemana[medio.nombre]) {
            consolidado.mediosTopSemana[medio.nombre] = 0;
          }
          consolidado.mediosTopSemana[medio.nombre] += medio.tweets;
        });
      }
      
      consolidado.tendencias.push({
        fecha: reporte.fecha,
        tweets: reporte.estadisticas.totalTweets
      });
    });
    
    consolidado.promedioTweetsDiarios = consolidado.totalTweets / reportesDiarios.length;
    consolidado.totalMediosUnicos = consolidado.totalMediosUnicos.size;
    
    return consolidado;
  }

  generarReporteTelegramExportacion(tipoReporte, rutasArchivos) {
    let mensaje = `📊 *REPORTE ${tipoReporte.toUpperCase()} GENERADO*\n`;
    mensaje += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    
    mensaje += `✅ Archivos generados:\n`;
    
    if (rutasArchivos.json) {
      mensaje += `• JSON: ${path.basename(rutasArchivos.json)}\n`;
    }
    if (rutasArchivos.excel) {
      mensaje += `• Excel: ${path.basename(rutasArchivos.excel)}\n`;
    }
    if (rutasArchivos.html) {
      mensaje += `• HTML: ${path.basename(rutasArchivos.html)}\n`;
    }
    
    mensaje += `\n📁 Ubicación: /reportes/${tipoReporte}s/\n`;
    mensaje += `\n💡 Los archivos están listos para descarga.`;
    
    return mensaje;
  }

  // Limpiar reportes antiguos (mantener últimos 90 días)
  limpiarReportesAntiguos() {
    const carpetas = [
      this.carpetaReportesDiarios,
      this.carpetaReportesSemanales,
      this.carpetaReportesMensuales
    ];
    
    const fechaLimite = new Date();
    fechaLimite.setDate(fechaLimite.getDate() - 90);
    
    carpetas.forEach(carpeta => {
      try {
        const archivos = fs.readdirSync(carpeta);
        
        archivos.forEach(archivo => {
          const rutaCompleta = path.join(carpeta, archivo);
          const stats = fs.statSync(rutaCompleta);
          
          if (stats.mtime < fechaLimite) {
            fs.unlinkSync(rutaCompleta);
            console.log(`📊 Eliminado reporte antiguo: ${archivo}`);
          }
        });
      } catch (error) {
        console.error(`Error limpiando reportes en ${carpeta}:`, error);
      }
    });
  }
}

export default ExportadorReportes;