#!/usr/bin/env node
// orchestrator.js - Monitor X Morelos v2.0
// Ejecuta todos los microservicios de monitoreo simultáneamente

import dotenv from 'dotenv';
dotenv.config();

import { spawn } from 'child_process';
import chalk from 'chalk';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuración de servicios
const services = [
  {
    name: 'X Monitor',
    script: 'services/x-monitor.js',
    color: chalk.blue,
    icon: '🐦',
    priority: 1
  },
  {
    name: 'Facebook Monitor',
    script: 'services/facebook-monitor.js',
    color: chalk.cyan,
    icon: '📘',
    priority: 2
  },
  {
    name: 'YouTube Monitor',
    script: 'services/youtube-monitor.js',
    color: chalk.red,
    icon: '📺',
    priority: 3
  },
  {
    name: 'RSS Monitor',
    script: 'services/rss-monitor.js',
    color: chalk.green,
    icon: '📰',
    priority: 4
  },
  {
    name: 'Telegram Notifier',
    script: 'services/telegram-notifier.js',
    color: chalk.magenta,
    icon: '📱',
    priority: 5
  },
  {
    name: 'Dashboard Web',
    script: 'dashboard/server.js',
    color: chalk.yellow,
    icon: '🌐',
    priority: 6
  }
];

class ServiceManager {
  constructor() {
    this.processes = new Map();
    this.restartCount = new Map();
    this.maxRestarts = 3;
    this.isShuttingDown = false;
  }

  startService(service) {
    console.log(`${service.icon} ${service.color('Iniciando:')} ${service.name}`);

    const childProcess = spawn('node', [path.join(__dirname, service.script)], {
      stdio: 'pipe',
      env: { ...process.env }
    });

    // Manejar salida de datos
    childProcess.stdout.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        console.log(`${service.icon} ${service.color(service.name + ':')} ${output}`);
      }
    });

    childProcess.stderr.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        console.error(`${service.icon} ${chalk.red(service.name + ' ERROR:')} ${output}`);
      }
    });

    // Manejar cierre del proceso
    childProcess.on('close', (code) => {
      const restartCount = this.restartCount.get(service.name) || 0;

      if (!this.isShuttingDown && restartCount < this.maxRestarts) {
        console.log(`${service.icon} ${chalk.yellow(`Servicio ${service.name} se cerró (código: ${code}). Reiniciando... (${restartCount + 1}/${this.maxRestarts})`)}`);
        this.restartCount.set(service.name, restartCount + 1);

        setTimeout(() => {
          this.startService(service);
        }, 5000); // Esperar 5 segundos antes de reiniciar
      } else if (restartCount >= this.maxRestarts) {
        console.error(`${service.icon} ${chalk.red(`Servicio ${service.name} falló demasiadas veces. Deteniendo.`)}`);
      } else {
        console.log(`${service.icon} ${chalk.gray(`Servicio ${service.name} se cerró correctamente (código: ${code})`)}`);
      }

      this.processes.delete(service.name);
    });

    childProcess.on('error', (error) => {
      console.error(`${service.icon} ${chalk.red(`Error en ${service.name}:`)} ${error.message}`);
    });

    this.processes.set(service.name, childProcess);
    this.restartCount.set(service.name, 0);
  }

  startAll() {
    console.log(chalk.bold.cyan('\n🚀 Monitor X Morelos v2.0 - Iniciando todos los servicios\n'));

    // Ordenar por prioridad y comenzar
    services.sort((a, b) => a.priority - b.priority);

    services.forEach((service, index) => {
      setTimeout(() => {
        this.startService(service);
      }, index * 2000); // Iniciar cada servicio con 2 segundos de diferencia
    });
  }

  async stopAll() {
    console.log(chalk.bold.yellow('\n🛑 Deteniendo todos los servicios...'));
    this.isShuttingDown = true;

    const stopPromises = [];

    for (const [name, process] of this.processes) {
      console.log(`⏹️ Deteniendo: ${name}`);

      stopPromises.push(new Promise((resolve) => {
        process.on('close', resolve);
        process.kill('SIGTERM');

        // Forzar cierre después de 10 segundos
        setTimeout(() => {
          process.kill('SIGKILL');
          resolve();
        }, 10000);
      }));
    }

    await Promise.all(stopPromises);
    console.log(chalk.bold.green('\n✅ Todos los servicios detenidos correctamente\n'));
    process.exit(0);
  }
}

// Manejar señales del sistema
const manager = new ServiceManager();

process.on('SIGINT', async () => {
  await manager.stopAll();
});

process.on('SIGTERM', async () => {
  await manager.stopAll();
});

// Iniciar todos los servicios
manager.startAll();

// Mensaje inicial
console.log(chalk.bold.green('\n📊 Monitor X Morelos v2.0 - Sistema de Monitoreo Multiplataforma'));
console.log(chalk.cyan('   ➤ X (Twitter) • Facebook • YouTube • RSS Feeds • Dashboard Web'));
console.log(chalk.gray('   ➤ Presiona Ctrl+C para detener todos los servicios\n'));