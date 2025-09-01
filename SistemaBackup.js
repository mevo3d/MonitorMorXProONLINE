// SistemaBackup.js - Sistema de respaldo automático
import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

class SistemaBackup {
  constructor() {
    this.carpetaBackups = './backups';
    this.carpetaBackupsDiarios = path.join(this.carpetaBackups, 'diarios');
    this.carpetaBackupsSemanales = path.join(this.carpetaBackups, 'semanales');
    
    // Configuración de respaldo
    this.configuracion = {
      horaBackupDiario: '03:00', // 3 AM
      diaBackupSemanal: 0, // Domingo
      maxBackupsDiarios: 7,
      maxBackupsSemanales: 4,
      carpetasRespaldar: [
        './logs',
        './media',
        './reportes',
        './keywords.json',
        './processed.json',
        './.env'
      ]
    };
    
    this.backupEnProgreso = false;
    this.ultimoBackup = null;
    
    this.inicializar();
  }

  inicializar() {
    // Crear carpetas si no existen
    [this.carpetaBackups, this.carpetaBackupsDiarios, this.carpetaBackupsSemanales].forEach(carpeta => {
      if (!fs.existsSync(carpeta)) {
        fs.mkdirSync(carpeta, { recursive: true });
      }
    });
    
    // Cargar información del último backup
    this.cargarEstadoBackup();
  }

  cargarEstadoBackup() {
    const archivoEstado = path.join(this.carpetaBackups, 'estado-backup.json');
    if (fs.existsSync(archivoEstado)) {
      try {
        const estado = JSON.parse(fs.readFileSync(archivoEstado, 'utf8'));
        this.ultimoBackup = estado.ultimoBackup;
      } catch (error) {
        console.error('Error cargando estado de backup:', error);
      }
    }
  }

  guardarEstadoBackup() {
    const archivoEstado = path.join(this.carpetaBackups, 'estado-backup.json');
    const estado = {
      ultimoBackup: this.ultimoBackup,
      actualizadoEn: new Date().toISOString()
    };
    
    fs.writeFileSync(archivoEstado, JSON.stringify(estado, null, 2));
  }

  async realizarBackupDiario() {
    if (this.backupEnProgreso) {
      console.log('⏳ Backup ya en progreso, saltando...');
      return null;
    }
    
    this.backupEnProgreso = true;
    const fecha = new Date().toISOString().split('T')[0];
    const nombreBackup = `backup-diario-${fecha}`;
    const rutaBackup = path.join(this.carpetaBackupsDiarios, `${nombreBackup}.zip`);
    
    try {
      console.log('💾 Iniciando backup diario...');
      
      // Crear archivo ZIP
      await this.crearArchivoZip(rutaBackup, this.configuracion.carpetasRespaldar);
      
      // Actualizar estado
      this.ultimoBackup = {
        tipo: 'diario',
        fecha: new Date().toISOString(),
        archivo: rutaBackup,
        tamaño: this.obtenerTamañoArchivo(rutaBackup)
      };
      
      this.guardarEstadoBackup();
      
      // Limpiar backups antiguos
      await this.limpiarBackupsAntiguos();
      
      console.log(`✅ Backup diario completado: ${nombreBackup}.zip`);
      
      return {
        exito: true,
        archivo: rutaBackup,
        tamaño: this.ultimoBackup.tamaño
      };
      
    } catch (error) {
      console.error('❌ Error en backup diario:', error);
      return {
        exito: false,
        error: error.message
      };
    } finally {
      this.backupEnProgreso = false;
    }
  }

  async realizarBackupSemanal() {
    if (this.backupEnProgreso) {
      console.log('⏳ Backup ya en progreso, saltando...');
      return null;
    }
    
    this.backupEnProgreso = true;
    const fecha = new Date().toISOString().split('T')[0];
    const nombreBackup = `backup-semanal-${fecha}`;
    const rutaBackup = path.join(this.carpetaBackupsSemanales, `${nombreBackup}.zip`);
    
    try {
      console.log('💾 Iniciando backup semanal completo...');
      
      // Para el backup semanal, incluir más carpetas
      const carpetasCompletas = [
        ...this.configuracion.carpetasRespaldar,
        './backups/diarios',
        './sesion-x',
        './sesion-xpro'
      ];
      
      // Crear archivo ZIP
      await this.crearArchivoZip(rutaBackup, carpetasCompletas);
      
      // Crear backup adicional en Google Drive si está configurado
      await this.backupEnLaNube(rutaBackup);
      
      // Actualizar estado
      this.ultimoBackup = {
        tipo: 'semanal',
        fecha: new Date().toISOString(),
        archivo: rutaBackup,
        tamaño: this.obtenerTamañoArchivo(rutaBackup)
      };
      
      this.guardarEstadoBackup();
      
      console.log(`✅ Backup semanal completado: ${nombreBackup}.zip`);
      
      return {
        exito: true,
        archivo: rutaBackup,
        tamaño: this.ultimoBackup.tamaño
      };
      
    } catch (error) {
      console.error('❌ Error en backup semanal:', error);
      return {
        exito: false,
        error: error.message
      };
    } finally {
      this.backupEnProgreso = false;
    }
  }

  crearArchivoZip(rutaDestino, carpetas) {
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(rutaDestino);
      const archive = archiver('zip', {
        zlib: { level: 9 } // Máxima compresión
      });
      
      output.on('close', () => {
        console.log(`📦 Archivo ZIP creado: ${archive.pointer()} bytes`);
        resolve();
      });
      
      archive.on('error', (err) => {
        reject(err);
      });
      
      archive.pipe(output);
      
      // Agregar carpetas y archivos al ZIP
      carpetas.forEach(carpeta => {
        if (fs.existsSync(carpeta)) {
          const stats = fs.statSync(carpeta);
          
          if (stats.isDirectory()) {
            archive.directory(carpeta, path.basename(carpeta));
          } else {
            archive.file(carpeta, { name: path.basename(carpeta) });
          }
        }
      });
      
      // Agregar información del backup
      const infoBackup = {
        fecha: new Date().toISOString(),
        version: '1.0',
        contenido: carpetas,
        sistema: 'Monitor X Pro Morelos'
      };
      
      archive.append(JSON.stringify(infoBackup, null, 2), { name: 'info-backup.json' });
      
      archive.finalize();
    });
  }

  async backupEnLaNube(rutaArchivo) {
    // Verificar si existe rclone instalado
    try {
      await execAsync('rclone version');
      
      // Si existe, copiar a Google Drive
      const nombreArchivo = path.basename(rutaArchivo);
      const comando = `rclone copy "${rutaArchivo}" "gdrive:Backups/MonitorMorelos/" --progress`;
      
      console.log('☁️ Subiendo backup a Google Drive...');
      await execAsync(comando);
      console.log('✅ Backup subido a la nube');
      
    } catch (error) {
      console.log('ℹ️ rclone no disponible, saltando backup en la nube');
    }
  }

  obtenerTamañoArchivo(ruta) {
    try {
      const stats = fs.statSync(ruta);
      const tamañoMB = (stats.size / (1024 * 1024)).toFixed(2);
      return `${tamañoMB} MB`;
    } catch (error) {
      return 'Desconocido';
    }
  }

  async limpiarBackupsAntiguos() {
    // Limpiar backups diarios
    await this.limpiarCarpetaBackups(
      this.carpetaBackupsDiarios, 
      this.configuracion.maxBackupsDiarios
    );
    
    // Limpiar backups semanales
    await this.limpiarCarpetaBackups(
      this.carpetaBackupsSemanales, 
      this.configuracion.maxBackupsSemanales
    );
  }

  async limpiarCarpetaBackups(carpeta, maxArchivos) {
    try {
      const archivos = fs.readdirSync(carpeta)
        .filter(archivo => archivo.endsWith('.zip'))
        .map(archivo => ({
          nombre: archivo,
          ruta: path.join(carpeta, archivo),
          fecha: fs.statSync(path.join(carpeta, archivo)).mtime
        }))
        .sort((a, b) => b.fecha - a.fecha); // Más recientes primero
      
      // Eliminar archivos excedentes
      if (archivos.length > maxArchivos) {
        const archivosEliminar = archivos.slice(maxArchivos);
        
        for (const archivo of archivosEliminar) {
          fs.unlinkSync(archivo.ruta);
          console.log(`🗑️ Eliminado backup antiguo: ${archivo.nombre}`);
        }
      }
    } catch (error) {
      console.error('Error limpiando backups:', error);
    }
  }

  async restaurarBackup(rutaBackup, carpetaDestino = './') {
    try {
      console.log('🔄 Iniciando restauración de backup...');
      
      // Verificar que el archivo existe
      if (!fs.existsSync(rutaBackup)) {
        throw new Error('Archivo de backup no encontrado');
      }
      
      // Crear carpeta temporal
      const carpetaTemporal = path.join(carpetaDestino, 'temp-restore-' + Date.now());
      fs.mkdirSync(carpetaTemporal, { recursive: true });
      
      // Extraer archivo
      await execAsync(`unzip -q "${rutaBackup}" -d "${carpetaTemporal}"`);
      
      console.log('✅ Backup restaurado en:', carpetaTemporal);
      console.log('ℹ️ Revisa los archivos y cópialos manualmente a su ubicación original');
      
      return {
        exito: true,
        carpetaTemporal
      };
      
    } catch (error) {
      console.error('❌ Error restaurando backup:', error);
      return {
        exito: false,
        error: error.message
      };
    }
  }

  obtenerListaBackups() {
    const backups = [];
    
    // Obtener backups diarios
    const diarios = fs.readdirSync(this.carpetaBackupsDiarios)
      .filter(archivo => archivo.endsWith('.zip'))
      .map(archivo => ({
        tipo: 'diario',
        nombre: archivo,
        ruta: path.join(this.carpetaBackupsDiarios, archivo),
        fecha: fs.statSync(path.join(this.carpetaBackupsDiarios, archivo)).mtime,
        tamaño: this.obtenerTamañoArchivo(path.join(this.carpetaBackupsDiarios, archivo))
      }));
    
    // Obtener backups semanales
    const semanales = fs.readdirSync(this.carpetaBackupsSemanales)
      .filter(archivo => archivo.endsWith('.zip'))
      .map(archivo => ({
        tipo: 'semanal',
        nombre: archivo,
        ruta: path.join(this.carpetaBackupsSemanales, archivo),
        fecha: fs.statSync(path.join(this.carpetaBackupsSemanales, archivo)).mtime,
        tamaño: this.obtenerTamañoArchivo(path.join(this.carpetaBackupsSemanales, archivo))
      }));
    
    return [...diarios, ...semanales].sort((a, b) => b.fecha - a.fecha);
  }

  generarReporteBackupTelegram() {
    const backups = this.obtenerListaBackups();
    
    let mensaje = `💾 *ESTADO DE BACKUPS*\n`;
    mensaje += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    
    if (this.ultimoBackup) {
      mensaje += `📅 *Último backup:*\n`;
      mensaje += `• Tipo: ${this.ultimoBackup.tipo}\n`;
      mensaje += `• Fecha: ${new Date(this.ultimoBackup.fecha).toLocaleString('es-MX')}\n`;
      mensaje += `• Tamaño: ${this.ultimoBackup.tamaño}\n\n`;
    }
    
    mensaje += `📦 *Backups disponibles:*\n`;
    mensaje += `• Diarios: ${backups.filter(b => b.tipo === 'diario').length}/${this.configuracion.maxBackupsDiarios}\n`;
    mensaje += `• Semanales: ${backups.filter(b => b.tipo === 'semanal').length}/${this.configuracion.maxBackupsSemanales}\n\n`;
    
    mensaje += `📊 *Últimos 5 backups:*\n`;
    backups.slice(0, 5).forEach(backup => {
      const fecha = new Date(backup.fecha).toLocaleDateString('es-MX');
      mensaje += `• ${backup.tipo === 'diario' ? '📅' : '📆'} ${fecha} (${backup.tamaño})\n`;
    });
    
    return mensaje;
  }

  // Programar backups automáticos
  programarBackupsAutomaticos() {
    // Backup diario a las 3 AM
    const ahora = new Date();
    const proximoBackup = new Date();
    proximoBackup.setHours(3, 0, 0, 0);
    
    if (proximoBackup <= ahora) {
      proximoBackup.setDate(proximoBackup.getDate() + 1);
    }
    
    const tiempoHastaBackup = proximoBackup - ahora;
    
    setTimeout(async () => {
      await this.realizarBackupDiario();
      
      // Programar el siguiente backup en 24 horas
      setInterval(async () => {
        await this.realizarBackupDiario();
      }, 24 * 60 * 60 * 1000);
      
    }, tiempoHastaBackup);
    
    console.log(`💾 Backup diario programado para: ${proximoBackup.toLocaleString('es-MX')}`);
  }
}

export default SistemaBackup;