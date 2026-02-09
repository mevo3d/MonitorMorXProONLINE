#!/usr/bin/env node
// dashboard/server.js - Monitor X Morelos - Dashboard Web
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import DatabaseConnection from '../database/connection.js';

class DashboardServer {
  constructor() {
    this.app = express();
    this.port = process.env.DASHBOARD_PORT || 3000;
    this.host = process.env.DASHBOARD_HOST || 'localhost';
    this.db = new DatabaseConnection();

    this.configurarMiddleware();
    this.configurarRutas();
  }

  configurarMiddleware() {
    // Seguridad
    this.app.use(helmet({
      contentSecurityPolicy: false,
    }));

    // CORS
    this.app.use(cors({
      origin: process.env.DASHBOARD_ORIGIN || '*',
      credentials: true
    }));

    // Logging
    this.app.use(morgan('combined'));

    // Body parser
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Servir archivos estáticos
    this.app.use(express.static(path.join(__dirname, 'public')));
  }

  configurarRutas() {
    // API Routes
    this.app.get('/api/health', this.healthCheck.bind(this));
    this.app.get('/api/status', this.getStatus.bind(this));
    this.app.get('/api/publicaciones', this.getPublicaciones.bind(this));
    this.app.get('/api/estadisticas', this.getEstadisticas.bind(this));
    this.app.get('/api/metricas', this.getMetricas.bind(this));
    this.app.get('/api/keywords', this.getKeywords.bind(this));

    // Servir página principal
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    // Catch all para SPA - usando middleware
    this.app.use((req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });
  }

  async healthCheck(req, res) {
    try {
      const dbConnected = await this.db.verificarConexion();

      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        database: dbConnected ? 'connected' : 'disconnected',
        version: '2.0.0'
      });
    } catch (error) {
      res.status(500).json({
        status: 'error',
        message: error.message
      });
    }
  }

  async getStatus(req, res) {
    try {
      const stats = await this.getStatsFromDatabase();

      res.json({
        status: 'online',
        timestamp: new Date().toISOString(),
        services: {
          x_monitor: 'active',
          facebook_monitor: 'starting',
          youtube_monitor: 'starting',
          rss_monitor: 'starting',
          telegram_notifier: 'active'
        },
        statistics: stats
      });
    } catch (error) {
      res.status(500).json({
        status: 'error',
        message: error.message
      });
    }
  }

  async getPublicaciones(req, res) {
    try {
      const limit = parseInt(req.query.limit) || 20;
      const offset = parseInt(req.query.offset) || 0;
      const plataforma = req.query.plataforma;
      const categoria = req.query.categoria;
      const urgencia = req.query.urgencia;

      const filtros = {};
      if (plataforma) filtros.plataforma = plataforma;
      if (categoria) filtros.categoria = categoria;
      if (urgencia) filtros.urgencia = urgencia;

      const publicaciones = await this.db.obtenerPublicaciones(limit, offset, filtros);

      res.json({
        success: true,
        data: publicaciones,
        pagination: {
          limit,
          offset,
          total: publicaciones.length
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  async getEstadisticas(req, res) {
    try {
      const stats = await this.getStatsFromDatabase();

      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  async getMetricas(req, res) {
    try {
      const dias = parseInt(req.query.dias) || 7;

      const query = `
        SELECT
          DATE(fecha) as fecha,
          plataforma,
          SUM(total_publicaciones) as publicaciones,
          SUM(publicaciones_procesadas) as procesadas,
          AVG(sentimiento_promedio) as sentimiento_promedio
        FROM metricas
        WHERE fecha >= CURRENT_DATE - INTERVAL '${dias} days'
        GROUP BY DATE(fecha), plataforma
        ORDER BY fecha DESC, plataforma
      `;

      const result = await this.db.ejecutarQuery(query);

      res.json({
        success: true,
        data: result.rows
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  async getKeywords(req, res) {
    try {
      const fs = await import('fs');
      const keywordsData = JSON.parse(fs.readFileSync('keywords.json', 'utf8'));

      res.json({
        success: true,
        data: {
          keywords: keywordsData.palabras || [],
          total: keywordsData.palabras?.length || 0,
          ultima_actualizacion: keywordsData.fecha_actualizacion
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  async getStatsFromDatabase() {
    try {
      const queries = [
        // Total de publicaciones por plataforma
        `
          SELECT plataforma, COUNT(*) as total
          FROM publicaciones
          WHERE fecha_publicacion >= CURRENT_DATE - INTERVAL '24 hours'
          GROUP BY plataforma
        `,
        // Publicaciones urgentes
        `
          SELECT COUNT(*) as urgentes
          FROM publicaciones
          WHERE urgencia = 'urgente' AND fecha_publicacion >= CURRENT_DATE - INTERVAL '24 hours'
        `,
        // Sentimiento promedio
        `
          SELECT
            AVG(CASE WHEN sentimiento IS NOT NULL THEN sentimiento ELSE 0 END) as promedio,
            COUNT(CASE WHEN sentimiento > 0.3 THEN 1 END) as positivos,
            COUNT(CASE WHEN sentimiento < -0.3 THEN 1 END) as negativos,
            COUNT(CASE WHEN sentimiento BETWEEN -0.3 AND 0.3 THEN 1 END) as neutros
          FROM publicaciones
          WHERE fecha_publicacion >= CURRENT_DATE - INTERVAL '24 hours'
          AND sentimiento IS NOT NULL
        `,
        // Categorías populares
        `
          SELECT unnest(categorias) as categoria, COUNT(*) as count
          FROM publicaciones
          WHERE fecha_publicacion >= CURRENT_DATE - INTERVAL '24 hours'
          AND categorias IS NOT NULL
          GROUP BY categoria
          ORDER BY count DESC
          LIMIT 10
        `
      ];

      const results = await Promise.all(
        queries.map(query => this.db.ejecutarQuery(query))
      );

      return {
        porPlataforma: results[0].rows,
        urgentes: parseInt(results[1].rows[0]?.urgentes) || 0,
        sentimiento: {
          promedio: parseFloat(results[2].rows[0]?.promedio) || 0,
          positivos: parseInt(results[2].rows[0]?.positivos) || 0,
          negativos: parseInt(results[2].rows[0]?.negativos) || 0,
          neutros: parseInt(results[2].rows[0]?.neutros) || 0
        },
        categorias: results[3].rows
      };
    } catch (error) {
      console.error('Error obteniendo estadísticas:', error.message);
      return {
        porPlataforma: [],
        urgentes: 0,
        sentimiento: { promedio: 0, positivos: 0, negativos: 0, neutros: 0 },
        categorias: []
      };
    }
  }

  async iniciar() {
    try {
      console.log('🌐 Iniciando Dashboard Web...');

      // Conectar a base de datos
      await this.db.conectar();

      // Crear directorio público si no existe
      const publicDir = path.join(__dirname, 'public');
      const fs = await import('fs');
      if (!fs.existsSync(publicDir)) {
        fs.mkdirSync(publicDir, { recursive: true });
        await this.crearArchivosEstaticos();
      }

      // Iniciar servidor
      this.server = this.app.listen(this.port, this.host, () => {
        console.log(`✅ Dashboard Web iniciado en http://${this.host}:${this.port}`);
      });

    } catch (error) {
      console.error('❌ Error iniciando Dashboard Web:', error.message);
      throw error;
    }
  }

  async crearArchivosEstaticos() {
    const fs = await import('fs');

    // Crear HTML principal
    const htmlContent = `<!DOCTYPE html>
<html lang="es-MX">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Monitor X Morelos - Dashboard</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; }
        .header { background: #1a237e; color: white; padding: 1rem 2rem; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .header h1 { font-size: 1.5rem; font-weight: 600; }
        .header .status { font-size: 0.9rem; opacity: 0.8; }
        .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem; margin-bottom: 2rem; }
        .card { background: white; border-radius: 8px; padding: 1.5rem; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        .card h3 { color: #333; margin-bottom: 1rem; font-size: 1.1rem; }
        .stat-value { font-size: 2rem; font-weight: bold; color: #1a237e; margin-bottom: 0.5rem; }
        .stat-label { color: #666; font-size: 0.9rem; }
        .service-status { display: flex; align-items: center; margin-bottom: 0.5rem; }
        .status-dot { width: 8px; height: 8px; border-radius: 50%; margin-right: 0.5rem; }
        .status-active { background: #4caf50; }
        .status-inactive { background: #f44336; }
        .status-warning { background: #ff9800; }
        .loading { text-align: center; padding: 2rem; color: #666; }
        .error { text-align: center; padding: 2rem; color: #f44336; }
        .refresh-btn { background: #1a237e; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; }
        .refresh-btn:hover { background: #303f9f; }
        #lastUpdate { font-size: 0.8rem; color: #666; margin-top: 1rem; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🚀 Monitor X Morelos v2.0</h1>
        <div class="status" id="systemStatus">Cargando estado del sistema...</div>
    </div>

    <div class="container">
        <div class="loading" id="loading">Cargando dashboard...</div>
        <div id="dashboard" style="display: none;">
            <div class="grid">
                <!-- Estadísticas Generales -->
                <div class="card">
                    <h3>📊 Publicaciones (24h)</h3>
                    <div class="stat-value" id="totalPublicaciones">-</div>
                    <div class="stat-label">Total monitoreadas</div>
                </div>

                <div class="card">
                    <h3>🚨 Alertas Urgentes</h3>
                    <div class="stat-value" id="alertasUrgentes">-</div>
                    <div class="stat-label">Necesitan atención</div>
                </div>

                <div class="card">
                    <h3>😊 Sentimiento General</h3>
                    <div class="stat-value" id="sentimientoGeneral">-</div>
                    <div class="stat-label">Promedio del día</div>
                </div>

                <div class="card">
                    <h3>🔑 Palabras Clave</h3>
                    <div class="stat-value" id="totalKeywords">-</div>
                    <div class="stat-label">Activas</div>
                </div>
            </div>

            <!-- Estado de Servicios -->
            <div class="card">
                <h3>🔧 Estado de Servicios</h3>
                <div id="serviciosStatus">
                    <div class="loading">Cargando estado de servicios...</div>
                </div>
            </div>

            <!-- Estadísticas por Plataforma -->
            <div class="card">
                <h3>📈 Actividad por Plataforma</h3>
                <div id="plataformaStats">
                    <div class="loading">Cargando estadísticas...</div>
                </div>
            </div>

            <div style="text-align: center;">
                <button class="refresh-btn" onclick="loadDashboard()">🔄 Actualizar</button>
                <div id="lastUpdate"></div>
            </div>
        </div>
    </div>

    <script>
        async function loadDashboard() {
            try {
                // Cargar estado general
                const statusResponse = await fetch('/api/status');
                const status = await statusResponse.json();

                // Cargar estadísticas
                const statsResponse = await fetch('/api/estadisticas');
                const stats = await statsResponse.data;

                // Cargar keywords
                const keywordsResponse = await fetch('/api/keywords');
                const keywords = await keywordsResponse.data;

                // Actualizar dashboard
                updateDashboard(status, stats, keywords);

                document.getElementById('loading').style.display = 'none';
                document.getElementById('dashboard').style.display = 'block';
                document.getElementById('lastUpdate').textContent = 'Última actualización: ' + new Date().toLocaleString('es-MX');

            } catch (error) {
                console.error('Error cargando dashboard:', error);
                document.getElementById('loading').innerHTML = '<div class="error">Error cargando el dashboard</div>';
            }
        }

        function updateDashboard(status, stats, keywords) {
            // Actualizar estado del sistema
            document.getElementById('systemStatus').textContent =
                status.status === 'online' ? '✅ Sistema en línea' : '❌ Sistema con problemas';

            // Actualizar estadísticas generales
            const totalPub = stats.porPlataforma.reduce((sum, p) => sum + parseInt(p.total), 0);
            document.getElementById('totalPublicaciones').textContent = totalPub;
            document.getElementById('alertasUrgentes').textContent = stats.urgentes;
            document.getElementById('sentimientoGeneral').textContent =
                stats.sentimiento.promedio.toFixed(2);
            document.getElementById('totalKeywords').textContent = keywords.total;

            // Actualizar estado de servicios
            const serviciosHtml = Object.entries(status.services).map(([service, estado]) => {
                const statusClass = estado === 'active' ? 'status-active' :
                                   estado === 'starting' ? 'status-warning' : 'status-inactive';
                const serviceNames = {
                    x_monitor: 'X Monitor',
                    facebook_monitor: 'Facebook Monitor',
                    youtube_monitor: 'YouTube Monitor',
                    rss_monitor: 'RSS Monitor',
                    telegram_notifier: 'Telegram Notifier'
                };
                return \`
                    <div class="service-status">
                        <div class="status-dot \${statusClass}"></div>
                        <span>\${serviceNames[service] || service}: \${estado}</span>
                    </div>
                \`;
            }).join('');
            document.getElementById('serviciosStatus').innerHTML = serviciosHtml;

            // Actualizar estadísticas por plataforma
            const plataformaStats = stats.porPlataforma.map(p => {
                const iconos = { x: '🐦', facebook: '📘', youtube: '📺', rss: '📰' };
                const icono = iconos[p.plataforma] || '📢';
                return \`
                    <div class="service-status">
                        <span>\${icono} \${p.plataforma.toUpperCase()}: <strong>\${p.total}</strong> publicaciones</span>
                    </div>
                \`;
            }).join('');
            document.getElementById('plataformaStats').innerHTML = plataformaStats || '<div class="loading">No hay actividad reciente</div>';
        }

        // Cargar dashboard al iniciar
        loadDashboard();

        // Auto-refrescar cada 30 segundos
        setInterval(loadDashboard, 30000);
    </script>
</body>
</html>`;

    fs.writeFileSync(path.join(__dirname, 'public', 'index.html'), htmlContent);
    console.log('✅ Archivos estáticos del dashboard creados');
  }

  async detener() {
    console.log('🛑 Deteniendo Dashboard Web...');

    if (this.server) {
      this.server.close(() => {
        console.log('✅ Dashboard Web detenido');
      });
    }

    if (this.db) {
      await this.db.desconectar();
    }
  }
}

// Iniciar el servidor
const dashboard = new DashboardServer();

// Manejar señales de cierre
process.on('SIGINT', async () => {
  await dashboard.detener();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await dashboard.detener();
  process.exit(0);
});

// Iniciar dashboard
dashboard.iniciar().catch(error => {
  console.error('❌ Error fatal en Dashboard Web:', error);
  process.exit(1);
});