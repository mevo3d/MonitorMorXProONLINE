# Monitor Legislativo Morelos v3.0

Sistema de monitoreo legislativo optimizado para servidor 24/7 con Playwright headless y notificaciones por Telegram.

## 🎯 Características

- ✅ **Monitor de X (Twitter) sin API costosa** - Usa Playwright headless
- ✅ **Filtrado por palabras clave** - Diputados, Congreso de Morelos, LVI Legislatura
- ✅ **Descarga automática de media** - Imágenes y videos
- ✅ **Notificaciones por Telegram** - Alertas en tiempo real
- ✅ **Sistema anti-duplicados** - SHA256 hash
- ✅ **Logs estructurados** - Winston con rotación automática
- ✅ **Health checks** - Endpoint de monitoreo
- ✅ **Auto-restart** - PM2 para máxima estabilidad
- ✅ **Optimizado para servidor** - Sin GUI, sin WhatsApp

## 📋 Requisitos

- **Servidor**: Ubuntu 22.04 LTS (DigitalOcean recomendado)
- **Node.js**: v20 LTS
- **RAM**: Mínimo 2GB (recomendado 4GB)
- **Almacenamiento**: 20GB+ para media
- **Cuenta de X (Twitter)**: Con sesión activa

## 🚀 Instalación Rápida

### Opción 1: Script Automatizado (Recomendado)

```bash
# Clonar o subir archivos al servidor
cd /var/www/monitor-legislativo

# Ejecutar script de despliegue
chmod +x deploy-digitalocean.sh
./deploy-digitalocean.sh
```

### Opción 2: Manual

```bash
# 1. Actualizar sistema
apt-get update && apt-get upgrade -y

# 2. Instalar Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# 3. Instalar PM2
npm install -g pm2
pm2 startup systemd

# 4. Clonar proyecto (o copiar archivos)
cd /var/www
git clone <tu-repo> monitor-legislativo
cd monitor-legislativo

# 5. Instalar dependencias
npm install

# 6. Instalar Playwright browsers
npx playwright install chromium
npx playwright install-deps chromium

# 7. Configurar variables de entorno
cp .env.example .env
nano .env  # Editar con tus credenciales

# 8. Crear directorios
mkdir -p logs media/2025/img media/2025/video config

# 9. Iniciar con PM2
pm2 start ecosystem.config.js --env production
pm2 save
```

## ⚙️ Configuración

### Archivo .env

```env
# Entorno
NODE_ENV=production
PORT=3000

# Telegram (OBLIGATORIO)
TELEGRAM_TOKEN=8012798475:AAGGEjHCREePpVai8lsEpwrGUJ2a3QmV6Pk
TELEGRAM_CHAT_ID=1479701420

# X (Twitter)
X_TARGET_ACCOUNT=MediosMorelos

# Monitorización
MONITOR_INTERVAL_MINUTES=5
SCROLL_TWEETS_PER_CYCLE=20
HEADLESS=true

# Logging
LOG_LEVEL=info
LOGS_PATH=./logs
MEDIA_BASE_PATH=./media
```

### Archivo keywords.json

Edita `keywords.json` con tus palabras clave:

```json
{
  "palabras_clave": [
    "Congreso de Morelos",
    "LVI Legislatura",
    "Isaac Pimentel"
  ],
  "configuracion": {
    "version": "3.0",
    "ultima_actualizacion": "2025-01-20"
  }
}
```

## 🔐 Configuración de Cookies de X (IMPORTANTE)

Como el sistema usa Playwright sin API de Twitter, necesitas autenticarte manualmente **una sola vez**:

### Método 1: Localmente (Recomendado)

1. **En tu máquina local** con GUI:

```bash
# Clonar el proyecto
git clone <tu-repo>
cd monitor-legislativo
npm install

# Modificar .env temporalmente
HEADLESS=false  # Cambiar a false

# Ejecutar
npm start
```

2. Se abrirá Chromium. Escanea el QR de X con tu teléfono.

3. Una vez logueado, el sistema creará `config/cookies.json`.

4. **Copia `config/cookies.json` al servidor**:

```bash
scp config/cookies.json root@tu-servidor:/var/www/monitor-legislativo/config/
```

5. En el servidor, verifica que `HEADLESS=true` en `.env`.

6. Reinicia el servicio:

```bash
pm2 restart monitor-legislativo
```

### Método 2: VNC (Alternativa)

Si no tienes acceso local, usa VNC en el servidor:

```bash
# Instalar servidor VNC
apt-get install -y xfce4 xfce4-goodies x11vnc tightvncserver

# Iniciar VNC
vncserver :1

# Conectarte desde tu máquina con VNC viewer
# Luego ejecutar el sistema con HEADLESS=false
```

## 📊 Monitoreo

### Ver logs en tiempo real

```bash
pm2 logs monitor-legislativo

# O ver archivo de logs directamente
tail -f logs/combined-$(date +%Y-%m-%d).log
```

### Ver estadísticas

```bash
pm2 monit
```

### Health check endpoint

```bash
curl http://localhost:3000/health
```

Respuesta:

```json
{
  "status": "healthy",
  "timestamp": "2025-01-20T12:00:00.000Z",
  "uptime": 3600,
  "services": {
    "xMonitor": {
      "tweetsProcessed": 150,
      "tweetsMatched": 5,
      "duplicatesFound": 20
    },
    "telegramNotifier": {
      "mensajesEnviados": 5,
      "errores": 0
    }
  }
}
```

## 🛠️ Comandos PM2

```bash
# Iniciar
pm2 start ecosystem.config.js

# Detener
pm2 stop monitor-legislativo

# Reiniciar
pm2 restart monitor-legislativo

# Recargar (sin downtime)
pm2 reload monitor-legislativo

# Ver estado
pm2 status

# Ver logs
pm2 logs monitor-legislativo

# Monitoreo interactivo
pm2 monit

# Guardar configuración
pm2 save

# Eliminar
pm2 delete monitor-legislativo
```

## 📁 Estructura de Directorios

```
monitor-legislativo/
├── src/
│   ├── index.js                    # Orquestador principal
│   ├── services/
│   │   ├── x-monitor.js           # Monitor de X
│   │   └── telegram-notifier.js   # Notificaciones Telegram
│   └── utils/
│       ├── logger.js              # Sistema de logging
│       └── deduplicator.js        # Anti-duplicados
├── config/
│   └── cookies.json               # Cookies de X (IMPORTANTE)
├── logs/                           # Logs rotativos
├── media/
│   └── 2025/
│       ├── img/                   # Imágenes descargadas
│       └── video/                 # Videos descargados
├── keywords.json                   # Palabras clave
├── .env                            # Variables de entorno
├── ecosystem.config.js             # Configuración PM2
└── deploy-digitalocean.sh          # Script de despliegue
```

## 🔧 Solución de Problemas

### El sistema no inicia

1. Verifica que Node.js 20 esté instalado:
```bash
node --version  # Debe ser v20.x.x
```

2. Revisa los logs:
```bash
pm2 logs monitor-legislativo --lines 100
```

### Error de cookies de X

**Síntoma**: `Sesión de X expirada`

**Solución**:
1. Genera nuevas cookies localmente con `HEADLESS=false`
2. Copia `config/cookies.json` al servidor
3. Reinicia: `pm2 restart monitor-legislativo`

### Playwright no puede iniciar Chromium

**Síntoma**: `Executable doesn't exist`

**Solución**:
```bash
npx playwright install chromium
npx playwright install-deps chromium
```

### El sistema consume mucha RAM

**Solución**: Ajusta en `ecosystem.config.js`:
```javascript
max_memory_restart: '512M'  // Reducir de 1G
```

### Las cookies expiran frecuentemente

**Solución**:
1. Usa IP dedicada en DigitalOcean (más estable)
2. Evita cambiar de ubicación geográfica
3. Regenera cookies cada 2-4 semanas

## 📈 Optimizaciones

### Reducir consumo de recursos

1. **Reducir intervalo de monitoreo**:
```env
MONITOR_INTERVAL_MINUTES=10  # En lugar de 5
```

2. **Reducir scrolls por ciclo**:
```env
SCROLL_TWEETS_PER_CYCLE=10  # En lugar de 20
```

### Aumentar estabilidad

1. **Usar base de datos PostgreSQL** para persistencia:

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=monitor_legislativo
DB_USER=postgres
DB_PASSWORD=tu_password
```

2. **Configurar backups automáticos**:

```bash
# Agregar a crontab
0 2 * * * /var/www/monitor-legislativo/scripts/backup.sh
```

## 📞 Soporte

- **Issues**: GitHub Issues
- **Documentación**: README.md
- **Logs**: `logs/` directory

## 📄 Licencia

MIT License - Ver LICENSE para detalles

---

**Última actualización**: Enero 2025
**Versión**: 3.0.0
**Estado**: Production Ready ✅
