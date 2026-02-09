# ✅ CHECKLIST DE IMPLEMENTACIÓN - Monitor Legislativo v3.0

## 📋 Copia este checklist y marca cada paso al completarlo

---

## FASE 1: PREPARACIÓN LOCAL 🏠

### 1.1 Instalación
- [ ] Abrir terminal en `c:\Users\BALERION\proyectos-automatizacion\Monitor-LegislativoMor\monitor-v3`
- [ ] Ejecutar `npm install`
- [ ] Verificar que Node.js versión 20+ está instalado: `node --version`

### 1.2 Configuración
- [ ] Copiar `.env.example` a `.env`: `cp .env.example .env`
- [ ] Editar `.env` y verificar:
  - [ ] `TELEGRAM_TOKEN=8012798475:AAGGEjHCREePpVai8lsEpwrGUJ2a3QmV6Pk`
  - [ ] `TELEGRAM_CHAT_ID=1479701420`
  - [ ] `X_TARGET_ACCOUNT=MediosMorelos`
  - [ ] `HEADLESS=false` (importante: false para login inicial)

### 1.3 Keywords
- [ ] Verificar que `keywords.json` existe
- [ ] Revisar palabras clave (~100+ palabras)
- [ ] Agregar/quitar palabras si es necesario

### 1.4 Prueba Local
- [ ] Ejecutar: `npm start`
- [ ] Esperar a que se abra Chrome
- [ ] **NO cerrar la ventana de Chrome**

---

## FASE 2: GENERACIÓN DE COOKIES 🔐

### 2.1 Escaneo de QR
- [ ] Esperar a que cargue la página de X/Twitter
- [ ] Abrir X en tu teléfono
- [ ] Ir a **Settings > Privacy and Security > QR Code**
- [ ] Escanear el QR code en pantalla
- [ ] Esperar a que la página muestre el timeline

### 2.2 Verificación
- [ ] Ver que se creó `config/cookies.json`
- [ ] Verificar contenido: `cat config/cookies.json | head -20`
- [ ] Debe ver cookies con `name: "auth_token"`

### 2.3 Prueba con Cookies
- [ ] Presionar Ctrl+C para detener
- [ ] Editar `.env`: `HEADLESS=true`
- [ ] Ejecutar: `npm start`
- [ ] Ver en logs: `✅ Sesión de X activa`
- [ ] Si dice "Sesión expirada", repetir Fase 2

---

## FASE 3: DIGITALOCEAN SETUP ☁️

### 3.1 Crear Droplet
- [ ] Loguearse en DigitalOcean
- [ ] Crear nuevo Droplet:
  - [ ] Image: **Ubuntu 22.04 LTS**
  - [ ] Plan: **Basic - $12/mes** (2GB RAM, 1 CPU, 50GB SSD)
  - [ ] Region: **Más cercana a México** (ej: San Francisco)
  - [ ] Authentication: **SSH Key** (recomendado) o Password
- [ ] Esperar a que se cree (2-3 minutos)
- [ ] Copiar IP address del droplet

### 3.2 Conectar al Servidor
- [ ] Desde terminal local:
  ```bash
  ssh root@TU-IP-DROPLET
  ```
- [ ] O si usas clave SSH:
  ```bash
  ssh -i ~/.ssh/tu-clave.pem root@TU-IP-DROPLET
  ```

---

## FASE 4: DEPLOY EN SERVIDOR 🚀

### 4.1 Subir Archivos (Opción A: SCP)
- [ ] Desde tu máquina local:
  ```bash
  cd c:\Users\BALERION\proyectos-automatizacion\Monitor-LegislativoMor
  scp -r monitor-v3 root@TU-IP-DROPLET:/var/www/
  ```

**O subir con Git (Opción B - Recomendado)**
- [ ] Crear repo en GitHub
- [ ] Push código a GitHub
- [ ] En servidor:
  ```bash
  git clone TU-REPO-URL /var/www/monitor-legislativo
  ```

### 4.2 Ejecutar Script de Deploy
- [ ] En el servidor:
  ```bash
  cd /var/www/monitor-legislativo
  chmod +x deploy-digitalocean.sh
  ./deploy-digitalocean.sh
  ```

### 4.3 Verificar Instalación
- [ ] Ver que Node.js 20 está instalado: `node --version`
- [ ] Ver que PM2 está instalado: `pm2 --version`
- [ ] Ver que Playwright Chromium está instalado

### 4.4 Configurar .env en Servidor
- [ ] Editar `.env`: `nano .env`
- [ ] Verificar valores:
  ```env
  NODE_ENV=production
  HEADLESS=true  # IMPORTANTE: true en servidor
  TELEGRAM_TOKEN=8012798475:AAGGEjHCREePpVai8lsEpwrGUJ2a3QmV6Pk
  TELEGRAM_CHAT_ID=1479701420
  ```

### 4.5 Subir Cookies al Servidor
- [ ] Desde tu máquina local:
  ```bash
  scp config/cookies.json root@TU-IP-DROPLET:/var/www/monitor-legislativo/config/
  ```

- [ ] Verificar en servidor:
  ```bash
  ls -la /var/www/monitor-legislativo/config/cookies.json
  ```

### 4.6 Iniciar Servicio con PM2
- [ ] En servidor:
  ```bash
  cd /var/www/monitor-legislativo
  pm2 start ecosystem.config.js --env production
  pm2 save
  ```

---

## FASE 5: VERIFICACIÓN FINAL ✅

### 5.1 PM2 Status
- [ ] Ejecutar: `pm2 status`
- [ ] Debe ver: `monitor-legislativo  online  0`

### 5.2 Ver Logs
- [ ] Ejecutar: `pm2 logs monitor-legislativo`
- [ ] Debe ver:
  ```
  ✅ Cookies cargadas
  ✅ Sesión de X activa
  🚀 Iniciando monitoreo cada 5 minutos...
  ```

### 5.3 Health Check
- [ ] Ejecutar: `curl http://localhost:3000/health`
- [ ] Debe ver JSON con `"status": "healthy"`

### 5.4 Telegram Notification
- [ ] Verificar que tu bot de Telegram te envió mensaje:
  ```
  🚀 Monitor Legislativo Morelos v3.0
  Sistema iniciado correctamente
  ```

---

## FASE 6: MONITOREO CONTINUO 📊

### 6.1 Monitoreo Básico
- [ ] Agregar alias para facilitar comandos
- [ ] Configurar PM2 para monitoreo:
  ```bash
  pm2 install pm2-logrotate
  pm2 set pm2-logrotate:max_size 10M
  pm2 set pm2-logrotate:retain 7
  ```

### 6.2 Alertas (Opcional)
- [ ] Configurar PM2 para enviar alertas en fallos
- [ ] Configurar cron job para reiniciar semanalmente
- [ ] Configurar backup automático de logs

### 6.3 Mantenimiento de Cookies
- [ ] Agendar recordatorio cada 3 semanas
- [ ] Documentar proceso de regeneración de cookies
- [ ] Crear script automatizado para renovación

---

## TROUBLESHOOTING 🔧

### Si "Sesión de X expirada"
- [ ] Generar nuevas cookies localmente (Fase 2)
- [ ] Subir al servidor: `scp config/cookies.json ...`
- [ ] Reiniciar: `pm2 restart monitor-legislativo`

### Si "Playwright no puede iniciar"
- [ ] Ejecutar: `npx playwright install chromium`
- [ ] Ejecutar: `npx playwright install-deps chromium`

### Si "Mucho consumo de RAM"
- [ ] Editar `ecosystem.config.js`: `max_memory_restart: '512M'`
- [ ] Reiniciar: `pm2 restart monitor-legislativo`

### Si PM2 no reinicia en boot
- [ ] Ejecutar: `pm2 startup systemd`
- [ ] Ejecutar: `pm2 save`

---

## COSTOS MENSUALES 💰

- [ ] Droplet DigitalOcean: $12/mes
- [ ] IP Dedicada (opcional): $5/mes
- [ ] **TOTAL ESTIMADO**: $12-$17/mes

**Ahorrado vs API Twitter**: ~$95-$100/mes 🎉

---

## PRÓXIMOS PASOS OPCIONALES 📈

- [ ] Configurar dominio propio ($10/año)
- [ ] Instalar PostgreSQL para persistencia
- [ ] Configurar certificado SSL (LetsEncrypt gratis)
- [ ] Agregar dashboard web de monitoreo
- [ ] Configurar backups automáticos
- [ ] Configurar sistema de alertas por email

---

## ✨ MARCADO COMO COMPLETADO

Cuando termines todas las fases:
- [ ] **FASE 1: Preparación Local** - Completada
- [ ] **FASE 2: Generación de Cookies** - Completada
- [ ] **FASE 3: DigitalOcean Setup** - Completada
- [ ] **FASE 4: Deploy en Servidor** - Completada
- [ ] **FASE 5: Verificación Final** - Completada
- [ ] **FASE 6: Monitoreo Continuo** - Completada

🎉 **¡FELICIDADES! Tu sistema está funcionando 24/7 en DigitalOcean**

---

**Última actualización**: Enero 2025
**Tiempo estimado total**: 35-45 minutos
**Dificultad**: Media (conocimientos básicos de Linux/SSH)

¿Necesitas ayuda? Revisa:
- [INICIO_RAPIDO.md](INICIO_RAPIDO.md)
- [README.md](README.md)
- [COOKIES_X_INSTRUCCIONES.md](COOKIES_X_INSTRUCCIONES.md)
