#!/usr/bin/env node
// database/connection.js - Monitor X Morelos - Base de datos PostgreSQL
import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();

import pkg from 'pg';
const { Client, Pool } = pkg;

class DatabaseConnection {
  constructor() {
    this.pool = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;

    // Configuración de base de datos
    this.config = {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'monitor_x_morelos',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'password',
      max: 20, // máximo de conexiones en pool
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    };
  }

  async conectar() {
    try {
      console.log('🔌 Conectando a PostgreSQL...');

      this.pool = new Pool(this.config);

      // Probar conexión
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();

      this.isConnected = true;
      this.reconnectAttempts = 0;

      console.log('✅ Conexión a PostgreSQL establecida');
      await this.inicializarTablas();

      return true;

    } catch (error) {
      console.error('❌ Error conectando a PostgreSQL:', error.message);
      this.isConnected = false;
      return false;
    }
  }

  async inicializarTablas() {
    try {
      console.log('🗂️ Verificando/Creando tablas...');

      const client = await this.pool.connect();

      // Tabla de publicaciones
      await client.query(`
        CREATE TABLE IF NOT EXISTS publicaciones (
          id SERIAL PRIMARY KEY,
          id_unico VARCHAR(20) UNIQUE NOT NULL,
          plataforma VARCHAR(20) NOT NULL,
          tipo VARCHAR(20) NOT NULL,
          contenido TEXT NOT NULL,
          autor VARCHAR(200),
          url VARCHAR(500),
          fecha_publicacion TIMESTAMP DEFAULT NOW(),
          fecha_registro TIMESTAMP DEFAULT NOW(),
          palabras_clave TEXT[],
          categorias VARCHAR(100)[],
          sentimiento DECIMAL(3,2),
          urgencia VARCHAR(10) DEFAULT 'normal',
          media_urls TEXT[],
          metadata JSONB,
          procesado BOOLEAN DEFAULT FALSE,
          enviado_telegram BOOLEAN DEFAULT FALSE,
          enviado_whatsapp BOOLEAN DEFAULT FALSE
        );
      `);

      // Tabla de métricas
      await client.query(`
        CREATE TABLE IF NOT EXISTS metricas (
          id SERIAL PRIMARY KEY,
          fecha DATE NOT NULL,
          plataforma VARCHAR(20) NOT NULL,
          total_publicaciones INTEGER DEFAULT 0,
          publicaciones_procesadas INTEGER DEFAULT 0,
          palabras_clave_encontradas TEXT[],
          categorias_populares VARCHAR(100)[],
          sentimiento_promedio DECIMAL(3,2),
          activos_monitoreados TEXT[],
          creado TIMESTAMP DEFAULT NOW(),
          UNIQUE(fecha, plataforma)
        );
      `);

      // Tabla de errores
      await client.query(`
        CREATE TABLE IF NOT EXISTS errores (
          id SERIAL PRIMARY KEY,
          servicio VARCHAR(50) NOT NULL,
          tipo_error VARCHAR(100) NOT NULL,
          mensaje TEXT NOT NULL,
          stack TEXT,
          metadata JSONB,
          fecha TIMESTAMP DEFAULT NOW(),
          resuelto BOOLEAN DEFAULT FALSE
        );
      `);

      // Tabla de configuración
      await client.query(`
        CREATE TABLE IF NOT EXISTS configuracion (
          id SERIAL PRIMARY KEY,
          clave VARCHAR(100) UNIQUE NOT NULL,
          valor TEXT NOT NULL,
          descripcion TEXT,
          tipo VARCHAR(20) DEFAULT 'string',
          actualizado TIMESTAMP DEFAULT NOW()
        );
      `);

      // Índices para mejor rendimiento
      await client.query('CREATE INDEX IF NOT EXISTS idx_publicaciones_plataforma ON publicaciones(plataforma);');
      await client.query('CREATE INDEX IF NOT EXISTS idx_publicaciones_fecha ON publicaciones(fecha_publicacion);');
      await client.query('CREATE INDEX IF NOT EXISTS idx_publicaciones_urgencia ON publicaciones(urgencia);');
      await client.query('CREATE INDEX IF NOT EXISTS idx_publicaciones_categorias ON publicaciones USING GIN(categorias);');
      await client.query('CREATE INDEX IF NOT EXISTS idx_metricas_fecha ON metricas(fecha);');

      client.release();

      console.log('✅ Tablas verificadas/creadas correctamente');

      // Insertar configuración inicial si no existe
      await this.insertarConfiguracionInicial();

    } catch (error) {
      console.error('❌ Error inicializando tablas:', error.message);
      throw error;
    }
  }

  async insertarConfiguracionInicial() {
    const configInicial = [
      {
        clave: 'version_sistema',
        valor: '2.0.0',
        descripcion: 'Versión actual del sistema Monitor X Morelos',
        tipo: 'string'
      },
      {
        clave: 'palabras_clave',
        valor: JSON.stringify(fs.existsSync('keywords.json') ? JSON.parse(fs.readFileSync('keywords.json', 'utf8')).palabras || [] : []),
        descripcion: 'Lista de palabras clave para monitoreo',
        tipo: 'json'
      },
      {
        clave: 'umbrales_urgencia',
        valor: JSON.stringify({
          sentimiento: -0.7,
          palabras_criticas: ['emergencia', 'urgente', 'crítico', 'inmediato'],
          max_tiempo_viejo: 24 // horas
        }),
        descripcion: 'Umbrales para clasificar como urgente',
        tipo: 'json'
      }
    ];

    for (let config of configInicial) {
      try {
        await this.ejecutarQuery(`
          INSERT INTO configuracion (clave, valor, descripcion, tipo)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (clave) DO NOTHING
        `, [config.clave, config.valor, config.descripcion, config.tipo]);
      } catch (error) {
        console.error(`⚠️ Error insertando config ${config.clave}:`, error.message);
      }
    }
  }

  async ejecutarQuery(query, params = []) {
    if (!this.isConnected) {
      throw new Error('Base de datos no conectada');
    }

    const client = await this.pool.connect();

    try {
      const result = await client.query(query, params);
      return result;
    } finally {
      client.release();
    }
  }

  async insertarPublicacion(publicacion) {
    try {
      const query = `
        INSERT INTO publicaciones (
          id_unico, plataforma, tipo, contenido, autor, url,
          palabras_clave, categorias, media_urls, metadata
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
        )
        ON CONFLICT (id_unico) DO UPDATE SET
          contenido = EXCLUDED.contenido,
          fecha_registro = NOW()
        RETURNING id
      `;

      const result = await this.ejecutarQuery(query, [
        publicacion.idUnico,
        publicacion.plataforma,
        publicacion.tipo,
        publicacion.contenido,
        publicacion.autor || null,
        publicacion.url || null,
        publicacion.palabrasClave || [],
        publicacion.categorias || [],
        publicacion.mediaUrls || [],
        JSON.stringify(publicacion.metadata || {})
      ]);

      return result.rows[0].id;

    } catch (error) {
      console.error('❌ Error insertando publicación:', error.message);
      throw error;
    }
  }

  async obtenerPublicaciones(limit = 50, offset = 0, filtros = {}) {
    try {
      let query = `
        SELECT * FROM publicaciones
        WHERE 1=1
      `;
      const params = [];
      let paramIndex = 1;

      // Aplicar filtros
      if (filtros.plataforma) {
        query += ` AND plataforma = $${paramIndex++}`;
        params.push(filtros.plataforma);
      }

      if (filtros.categoria) {
        query += ` AND $${paramIndex} = ANY(categorias)`;
        params.push(filtros.categoria);
      }

      if (filtros.urgencia) {
        query += ` AND urgencia = $${paramIndex++}`;
        params.push(filtros.urgencia);
      }

      query += ` ORDER BY fecha_publicacion DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
      params.push(limit, offset);

      const result = await this.ejecutarQuery(query, params);
      return result.rows;

    } catch (error) {
      console.error('❌ Error obteniendo publicaciones:', error.message);
      throw error;
    }
  }

  async registrarMetricas(metricas) {
    try {
      const query = `
        INSERT INTO metricas (
          fecha, plataforma, total_publicaciones, publicaciones_procesadas,
          palabras_clave_encontradas, categorias_populares, sentimiento_promedio,
          activos_monitoreados
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8
        )
        ON CONFLICT (fecha, plataforma) DO UPDATE SET
          total_publicaciones = EXCLUDED.total_publicaciones,
          publicaciones_procesadas = EXCLUDED.publicaciones_procesadas,
          palabras_clave_encontradas = EXCLUDED.palabras_clave_encontradas,
          categorias_populares = EXCLUDED.categorias_populares,
          sentimiento_promedio = EXCLUDED.sentimiento_promedio,
          activos_monitoreados = EXCLUDED.activos_monitoreados
      `;

      await this.ejecutarQuery(query, [
        metricas.fecha,
        metricas.plataforma,
        metricas.totalPublicaciones,
        metricas.publicacionesProcesadas,
        metricas.palabrasClaveEncontradas,
        metricas.categoriasPopulares,
        metricas.sentimientoPromedio,
        metricas.activosMonitoreados
      ]);

    } catch (error) {
      console.error('❌ Error registrando métricas:', error.message);
      throw error;
    }
  }

  async registrarError(servicio, tipoError, mensaje, stack, metadata = {}) {
    try {
      const query = `
        INSERT INTO errores (servicio, tipo_error, mensaje, stack, metadata)
        VALUES ($1, $2, $3, $4, $5)
      `;

      await this.ejecutarQuery(query, [servicio, tipoError, mensaje, stack, JSON.stringify(metadata)]);

    } catch (error) {
      console.error('❌ Error registrando error en BD:', error.message);
    }
  }

  async verificarConexion() {
    try {
      if (!this.pool) return false;

      const client = await this.pool.connect();
      await client.query('SELECT 1');
      client.release();

      return true;

    } catch (error) {
      console.error('⚠️ Verificación de conexión fallida:', error.message);
      this.isConnected = false;
      return false;
    }
  }

  async reintentarConexion() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('❌ Máximo de intentos de reconexión alcanzados');
      return false;
    }

    this.reconnectAttempts++;
    console.log(`🔄 Reintentando conexión (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

    await new Promise(resolve => setTimeout(resolve, 5000));

    return await this.conectar();
  }

  async desconectar() {
    try {
      if (this.pool) {
        await this.pool.end();
        console.log('✅ Desconectado de PostgreSQL');
      }
    } catch (error) {
      console.error('❌ Error desconectando:', error.message);
    }
  }
}

export default DatabaseConnection;