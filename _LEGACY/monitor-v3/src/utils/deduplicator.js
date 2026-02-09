// src/utils/deduplicator.js - Sistema de detección de duplicados usando hash
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { duplicateLogger } from './logger.js';

class Deduplicator {
  constructor() {
    this.hashSet = new Set();
    this.maxCacheSize = 10000; // Máximo de hashes en memoria
    this.hashFilePath = path.join(process.env.LOGS_PATH || './logs', 'processed_hashes.txt');
    this.loadHashesFromFile();
  }

  /**
   * Genera hash SHA256 del contenido para detectar duplicados
   * @param {string} text - Texto del tweet
   * @param {string} author - Autor del tweet
   * @param {string[]} mediaUrls - URLs de media
   * @returns {string} Hash SHA256
   */
  generateHash(text, author, mediaUrls = []) {
    const content = `${text}|${author}|${mediaUrls.join('|')}`;
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Verifica si el contenido ya fue procesado
   * @param {string} hash - Hash a verificar
   * @returns {boolean} True si es duplicado
   */
  isDuplicate(hash) {
    return this.hashSet.has(hash);
  }

  /**
   * Agrega un hash al registro
   * @param {string} hash - Hash a registrar
   */
  addHash(hash) {
    if (this.hashSet.has(hash)) {
      return false;
    }

    this.hashSet.add(hash);

    // Limpiar cache si excede el tamaño máximo
    if (this.hashSet.size > this.maxCacheSize) {
      this.cleanup();
    }

    // Guardar en archivo de forma asíncrona
    this.appendHashToFile(hash);

    return true;
  }

  /**
   * Carga hashes desde archivo al iniciar
   */
  loadHashesFromFile() {
    try {
      if (fs.existsSync(this.hashFilePath)) {
        const content = fs.readFileSync(this.hashFilePath, 'utf8');
        const hashes = content.trim().split('\n').filter(h => h);
        this.hashSet = new Set(hashes);
        console.log(`✅ Cargados ${this.hashSet.size} hashes desde archivo`);
      }
    } catch (error) {
      console.error('❌ Error cargando hashes:', error.message);
      this.hashSet = new Set();
    }
  }

  /**
   * Agrega hash al archivo de forma asíncrona
   * @param {string} hash - Hash a agregar
   */
  appendHashToFile(hash) {
    try {
      fs.appendFileSync(this.hashFilePath, `${hash}\n`);
    } catch (error) {
      console.error('❌ Error guardando hash:', error.message);
    }
  }

  /**
   * Limpia hashes antiguos cuando excede el cache
   */
  cleanup() {
    const hashesArray = Array.from(this.hashSet);
    const keepHashes = hashesArray.slice(-Math.floor(this.maxCacheSize * 0.8));
    this.hashSet = new Set(keepHashes);

    // Reescribir archivo con hashes actuales
    try {
      fs.writeFileSync(this.hashFilePath, Array.from(this.hashSet).join('\n') + '\n');
      console.log(`🧹 Limpieza de cache: ${this.hashSet.size} hashes retenidos`);
    } catch (error) {
      console.error('❌ Error en limpieza:', error.message);
    }
  }

  /**
   * Procesa un tweet y verifica si es duplicado
   * @param {Object} tweet - Objeto del tweet
   * @returns {Object} { isDuplicate: boolean, hash: string }
   */
  processTweet(tweet) {
    const { text, author, mediaUrls } = tweet;
    const hash = this.generateHash(text, author, mediaUrls);

    if (this.isDuplicate(hash)) {
      duplicateLogger.info('Duplicado detectado', {
        hash,
        text: text.substring(0, 100),
        author,
        timestamp: new Date().toISOString()
      });

      return {
        isDuplicate: true,
        hash,
        wasNew: false
      };
    }

    this.addHash(hash);

    return {
      isDuplicate: false,
      hash,
      wasNew: true
    };
  }

  /**
   * Obtiene estadísticas del deduplicador
   * @returns {Object} Estadísticas
   */
  getStats() {
    return {
      totalHashes: this.hashSet.size,
      maxCacheSize: this.maxCacheSize,
      usagePercentage: ((this.hashSet.size / this.maxCacheSize) * 100).toFixed(2)
    };
  }
}

export default new Deduplicator();
