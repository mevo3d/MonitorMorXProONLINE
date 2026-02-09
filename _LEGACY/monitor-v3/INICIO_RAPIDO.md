# 🎯 GUÍA DE INICIO RÁPIDO - Monitor Legislativo v3.0

## ✅ Sistema Completamente Refactorizado

He creado desde cero una versión **optimizada para servidor 24/7** que:

✅ **Usa Playwright headless** (sin GUI, funciona en servidor)
✅ **NO usa API de Twitter** (ahorra $100+/mes)
✅ **Solo Telegram** (WhatsApp eliminado)
✅ **Auto-restart con PM2** (máxima estabilidad)
✅ **Logs profesionales** (Winston + rotación)
✅ **Health checks** (monitoreo fácil)

---

## 📁 Ubicación

Todos los archivos están en:
```
c:\Users\BALERION\proyectos-automatizacion\Monitor-LegislativoMor\monitor-v3\
```

---

## 🚀 Pasos para Empezar

### 1️⃣ Requisitos Previos

Para servidor **DigitalOcean Ubuntu 22.04**:
- 2GB RAM mínimo (4GB recomendado)
- 20GB almacenamiento
- Node.js 20 LTS
- IP dedicada ($5/mes extra)

### 2️⃣ Generar Cookies de X (LOCALMENTE)

**EN TU MÁQUINA LOCAL** (con GUI):

```bash
cd c:\Users\BALERION\proyectos-automatizacion\Monitor-LegislativoMor\monitor-v3
npm install
```

Edita `.env`:
```
HEADLESS=false
```

Ejecuta:
```bash
npm start
```

Se abrirá Chrome. **Escanea el QR** de X con tu teléfono.

### 3️⃣ Subir a DigitalOcean

Opción A - **Subir archivos manualmente**:
```bash
# Comprimir carpeta
zip -r monitor-v3.zip monitor-v3/

# Subir al servidor
scp monitor-v3.zip root@tu-ip:/var/www/

# En servidor, descomprimir
cd /var/www
unzip monitor-v3.zip
mv monitor-v3 monitor-legislativo
cd monitor-legislativo
```

Opción B - **Usar Git** (recomendado):
```bash
# Crear repo en GitHub
git init
git add .
git commit -m "Initial commit v3.0"
git remote add origin <tu-repo-url>
git push -u origin main

# En servidor clonar
git clone <tu-repo-url> /var/www/monitor-legislativo
```

### 4️⃣ Ejecutar Script de Deploy

```bash
chmod +x deploy-digitalocean.sh
./deploy-digitalocean.sh
```

Este script instala:
- ✅ Node.js 20
- ✅ PM2
- ✅ Playwright Chromium
- ✅ Dependencias del sistema
- ✅ Configura firewall
- ✅ Inicia el servicio

### 5️⃣ Configurar Variables de Entorno

```bash
nano .env
```

**IMPORTANTE - Completa estos valores**:

```env
TELEGRAM_TOKEN=8012798475:AAGGEjHCREePpVai8lsEpwrGUJ2a3QmV6Pk
TELEGRAM_CHAT_ID=1479701420
X_TARGET_ACCOUNT=MediosMorelos
HEADLESS=true
```

### 6️⃣ Copiar Cookies al Servidor

**Desde tu máquina local**:
```bash
scp config/cookies.json root@tu-ip-servidor:/var/www/monitor-legislativo/config/
```

### 7️⃣ Iniciar Servicio

```bash
pm2 start ecosystem.config.js --env production
pm2 save
```

---

## 📊 Verificar Funcionamiento

### Check 1: Ver PM2 status
```bash
pm2 status
```

Debería mostrar:
```
┌────┬─────────────────────┬─────────────┬─────────┐
│ id │ name                │ status      │ cpu     │
├────┼─────────────────────┼─────────────┼─────────┤
│ 0  │ monitor-legislativo  │ online      │ 5%      │
└────┴─────────────────────┴─────────────┴─────────┘
```

### Check 2: Ver logs
```bash
pm2 logs monitor-legislativo
```

Deberías ver:
```
✅ Sesión de X activa
🚀 Iniciando monitoreo cada 5 minutos...
```

### Check 3: Health check
```bash
curl http://localhost:3000/health
```

---

## 🔑 Credenciales Reutilizables

Ya están configuradas en `.env`:

✅ **Telegram Token**: 8012798475:AAGGEjHCREePpVai8lsEpwrGUJ2a3QmV6Pk
✅ **Telegram Chat ID**: 1479701420
✅ **OpenAI API Key**: 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

**SOLO necesitas**:
1. Subir el proyecto a DigitalOcean
2. Generar cookies de X una vez
3. Ejecutar script de deploy

---

## 🎯 Palabras Clave Configuradas

El archivo `keywords.json` ya incluye **+100 palabras clave** para:
- ✅ Congreso de Morelos
- ✅ LVI Legislatura
- ✅ Diputados locales (todos los nombres)
- ✅ Partidos políticos
- ✅ Términos legislativos

---

## 📁 Estructura del Proyecto

```
monitor-v3/
├── src/
│   ├── index.js                   # Orquestador principal
│   ├── services/
│   │   ├── x-monitor.js          # Monitor X con Playwright headless
│   │   └── telegram-notifier.js  # Notificaciones Telegram
│   └── utils/
│       ├── logger.js             # Sistema de logging Winston
│       └── deduplicator.js       # Anti-duplicados SHA256
├── config/
│   └── cookies.json              # Cookies de X (GENERAR MANUALMENTE)
├── logs/                          # Logs rotativos automáticos
├── media/2025/
│   ├── img/                      # Imágenes descargadas
│   └── video/                    # Videos descargados
├── keywords.json                  # Palabras clave
├── .env                          # Variables de entorno
├── ecosystem.config.js           # PM2 config
├── deploy-digitalocean.sh        # Script de deploy automático
├── README.md                     # Documentación completa
└── COOKIES_X_INSTRUCCIONES.md    # Guía detallada de cookies
```

---

## 🔧 Comandos Útiles

### PM2 (Servidor)
```bash
pm2 status                    # Ver estado
pm2 logs                      # Ver logs en tiempo real
pm2 restart monitor-legislativo  # Reiniciar
pm2 stop monitor-legislativo     # Detener
pm2 monit                     # Monitoreo interactivo
```

### Logs
```bash
tail -f logs/combined-$(date +%Y-%m-%d).log
tail -f logs/tweets-$(date +%Y-%m-%d).log
tail -f logs/duplicates-$(date +%Y-%m-%d).log
```

### Debug
```bash
# Ver si X está funcionando
curl http://localhost:3000/health

# Ver errores recientes
pm2 logs monitor-legislativo --err --lines 50
```

---

## ⚠️ Problemas Comunes

### "Sesión de X expirada"
**Solución**: Regenerar cookies localmente y subir al servidor

```bash
# Local
HEADLESS=false npm start
# Escanear QR

# Subir
scp config/cookies.json root@servidor:/var/www/monitor-legislativo/config/

# Reiniciar
pm2 restart monitor-legislativo
```

### "Playwright no puede iniciar Chromium"
**Solución**:
```bash
npx playwright install chromium
npx playwright install-deps chromium
```

### "Mucho consumo de RAM"
**Solución**: Editar `ecosystem.config.js`
```javascript
max_memory_restart: '512M'  // Reducir de 1G
```

---

## 📈 Costos Estimados (DigitalOcean)

- Droplet 2GB RAM: **$12/mes**
- IP dedicada (opcional): **$5/mes**
- Storage extra 50GB: **$5/mes**
- **TOTAL**: ~$12-$22/mes

**Ahorro vs API Twitter**: ~$100/mes 💰

---

## 🎓 Próximos Pasos Opcionales

1. **Configurar dominio propio** ($10/año)
2. **Instalar PostgreSQL** para persistencia
3. **Configurar backups automáticos**
4. **Instalar certificado SSL** (LetsEncrypt gratis)
5. **Dashboard web** para monitoreo visual

---

## 📞 Ayuda

- **Documentación completa**: [README.md](README.md)
- **Guía de cookies**: [COOKIES_X_INSTRUCCIONES.md](COOKIES_X_INSTRUCCIONES.md)
- **Logs**: `/var/www/monitor-legislativo/logs/`

---

## ✅ Checklist Final

- [ ] Node.js 20 instalado en servidor
- [ ] PM2 instalado y configurado
- [ ] Playwright Chromium instalado
- [ ] `.env` configurado correctamente
- [ ] `keywords.json` verificado
- [ ] `config/cookies.json` generado y subido
- [ ] PM2 service iniciado y guardado
- [ ] Health check funcionando
- [ ] Telegram recibió mensaje de inicio

---

**¡Listo!** Tu sistema ahora corre 24/7 en DigitalOcean sin supervisión manual. 🎉

Las cookies de X duran 2-4 semanas. Regenera cuando veas "Sesión expirada" en los logs.
