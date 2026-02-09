// src/index.js - Orquestador Principal del Sistema
import dotenv from 'dotenv';
dotenv.config();

import xMonitor from './services/x-monitor.js';
import telegramNotifier from './services/telegram-notifier.js';
import { logger } from './utils/logger.js';
import { createServer } from 'http';

class MonitorOrchestrator {
  constructor() {
    this.isRunning = false;
    this.services = {
      xMonitor: xMonitor,
      telegramNotifier: telegramNotifier
    };

    // Health check server
    this.healthCheckPort = parseInt(process.env.HEALTH_CHECK_PORT) || 3000;

    logger.info('🎼 Monitor Orchestrator inicializado');
  }

  /**
   * Inicia el health check server para monitoreo
   */
  startHealthCheckServer() {
    const server = createServer((req, res) => {
      if (req.url === (process.env.HEALTH_CHECK_ENDPOINT || '/health')) {
        const health = {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          services: {
            xMonitor: this.services.xMonitor.getStats(),
            telegramNotifier: this.services.telegramNotifier.getStats()
          }
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(health, null, 2));
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    server.listen(this.healthCheckPort, () => {
      logger.info(`🏥 Health check server en puerto ${this.healthCheckPort}`);
    });

    return server;
  }

  /**
   * Inicia todos los servicios
   */
  async start() {
    try {
      this.isRunning = true;
      logger.info('🚀 Iniciando Monitor Legislativo Morelos v3.0...\n');

      // Iniciar Telegram Notifier (sin polling, solo para enviar)
      await this.services.telegramNotifier.start();

      // Iniciar Health Check Server
      this.healthServer = this.startHealthCheckServer();

      // Esperar un momento antes de iniciar X Monitor
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Iniciar X Monitor en background
      // Este servicio corre en su propio ciclo
      this.services.xMonitor.start().catch(error => {
        logger.error('❌ Error fatal en X Monitor:', error);
        this.shutdown();
      });

      // Programar reportes de estado cada hora
      this.statusReportInterval = setInterval(() => {
        if (this.isRunning) {
          this.services.telegramNotifier.sendStatus(
            this.services.xMonitor.getStats(),
            {} // deduplicator stats
          );
        }
      }, 60 * 60 * 1000); // Cada hora

      logger.info('\n✅ Todos los servicios iniciados correctamente\n');
      logger.info('📊 Sistema activo y monitoreando...');
      logger.info(`   ➤ Objetivo: @${process.env.X_TARGET_ACCOUNT || 'MediosMorelos'}`);
      logger.info(`   ➤ Intervalo: ${process.env.MONITOR_INTERVAL_MINUTES || 5} minutos`);
      logger.info(`   ➤ Health check: http://localhost:${this.healthCheckPort}/health\n`);

    } catch (error) {
      logger.error('❌ Error iniciando servicios:', error);
      throw error;
    }
  }

  /**
   * Detiene todos los servicios graceful shutdown
   */
  async shutdown() {
    if (!this.isRunning) return;

    logger.info('\n🛑 Iniciando shutdown graceful...');

    this.isRunning = false;

    // Limpiar intervalo de reportes
    if (this.statusReportInterval) {
      clearInterval(this.statusReportInterval);
    }

    // Detener X Monitor
    try {
      await this.services.xMonitor.stop();
    } catch (error) {
      logger.error('❌ Error deteniendo X Monitor:', error);
    }

    // Detener Telegram Notifier
    try {
      await this.services.telegramNotifier.stop();
    } catch (error) {
      logger.error('❌ Error deteniendo Telegram Notifier:', error);
    }

    // Cerrar health check server
    if (this.healthServer) {
      this.healthServer.close();
    }

    logger.info('✅ Shutdown completado\n');
    process.exit(0);
  }

  /**
   * Maneja señales del sistema para shutdown graceful
   */
  setupSignalHandlers() {
    process.on('SIGINT', () => {
      logger.info('⚠️ SIGINT recibido');
      this.shutdown();
    });

    process.on('SIGTERM', () => {
      logger.info('⚠️ SIGTERM recibido');
      this.shutdown();
    });

    // Manejar excepciones no capturadas
    process.on('uncaughtException', (error) => {
      logger.error('❌ Uncaught Exception:', error);
      this.shutdown();
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('❌ Unhandled Rejection:', reason);
      this.shutdown();
    });
  }
}

// Iniciar sistema
const orchestrator = new MonitorOrchestrator();
orchestrator.setupSignalHandlers();

// Iniciar servicios
orchestrator.start().catch(error => {
  logger.error('❌ Error fatal iniciando sistema:', error);
  process.exit(1);
});

export default orchestrator;
