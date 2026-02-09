#!/bin/bash
# deploy-digitalocean.sh - Script de despliegue para DigitalOcean Ubuntu 22.04

set -e  # Exit on error

echo "🚀 Iniciando despliegue de Monitor Legislativo v3.0"
echo "=================================================="

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Funciones de utilidad
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Verificar que estamos en Ubuntu 22.04
if [ ! -f /etc/os-release ]; then
    log_error "No se puede detectar el sistema operativo"
    exit 1
fi

source /etc/os-release
if [[ "$ID" != "ubuntu" ]] || [[ "$VERSION_ID" != "22.04" ]]; then
    log_warn "Este script está optimizado para Ubuntu 22.04"
    log_warn "Tu sistema: $ID $VERSION_ID"
    read -p "¿Continuar? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# 1. Actualizar sistema
log_info "Actualizando paquetes del sistema..."
apt-get update -y
apt-get upgrade -y

# 2. Instalar dependencias básicas
log_info "Instalando dependencias básicas..."
apt-get install -y \
    curl \
    wget \
    git \
    build-essential \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpangocairo-1.0-0 \
    libpango-1.0-0 \
    libxshmfence1 \
    libatspi2.0-0 \
    libu2f-udev \
    libvulkan1 \
    libdbus-1-3 \
    ca-certificates \
    gnupg \
    lsb-release

# 3. Instalar Node.js 20 LTS
log_info "Instalando Node.js 20 LTS..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
    log_info "Node.js $(node --version) instalado"
else
    log_info "Node.js $(node --version) ya está instalado"
fi

# 4. Instalar PM2 globalmente
log_info "Instalando PM2..."
npm install -g pm2

# Configurar PM2 para iniciar en boot
pm2 startup systemd -u root --hp /root

# 5. Crear directorio del proyecto
PROJECT_DIR="/var/www/monitor-legislativo"
log_info "Creando directorio del proyecto: $PROJECT_DIR"
mkdir -p $PROJECT_DIR
cd $PROJECT_DIR

# 6. Clonar repositorio (o copiar archivos)
if [ -d ".git" ]; then
    log_info "Repositorio ya clonado, pulling latest..."
    git pull
else
    read -p "Ingresa la URL del repositorio Git (o presiona Enter para saltar): " GIT_REPO
    if [ ! -z "$GIT_REPO" ]; then
        git clone $GIT_REPO .
    else
        log_warn "Saltando clonación de Git. Asegúrate de copiar los archivos manualmente."
    fi
fi

# 7. Instalar dependencias de Node.js
log_info "Instalando dependencias de Node.js..."
npm install

# 8. Instalar Playwright browsers
log_info "Instalando Playwright browsers..."
npx playwright install chromium
npx playwright install-deps chromium

# 9. Crear estructura de directorios
log_info "Creando estructura de directorios..."
mkdir -p logs
mkdir -p media/2025/img
mkdir -p media/2025/video
mkdir -p config

# 10. Configurar variables de entorno
if [ ! -f ".env" ]; then
    log_info "Creando archivo .env desde .env.example..."
    if [ -f ".env.example" ]; then
        cp .env.example .env
        log_warn "⚠️ IMPORTANTE: Edita .env con tus credenciales:"
        log_warn "   - TELEGRAM_TOKEN"
        log_warn "   - TELEGRAM_CHAT_ID"
        log_warn "   - X_USERNAME y X_PASSWORD (opcional)"
        log_warn "   - DB_PASSWORD (si usas PostgreSQL)"
        echo ""
        read -p "¿Quieres editar .env ahora? (y/n) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            nano .env || vi .env
        fi
    else
        log_error "No se encontró .env.example"
        exit 1
    fi
else
    log_info "Archivo .env ya existe"
fi

# 11. Configurar firewall
log_info "Configurando firewall..."
if command -v ufw &> /dev/null; then
    ufw allow 22/tcp    # SSH
    ufw allow 3000/tcp  # Health check
    ufw --force enable
    log_info "Firewall configurado"
else
    log_warn "UFW no está instalado, saltando configuración de firewall"
fi

# 12. Verificar instalación
log_info "Verificando instalación..."
node --version
npm --version
pm2 --version

# 13. Iniciar servicios
log_info "Iniciando servicios con PM2..."
pm2 start ecosystem.config.js --env production
pm2 save

# 14. Mostrar estado
echo ""
log_info "🎉 Despliegue completado!"
echo ""
pm2 status
echo ""
log_info "📊 Comandos útiles:"
echo "   pm2 logs                    - Ver logs"
echo "   pm2 monit                   - Monitoreo en tiempo real"
echo "   pm2 restart monitor-legislativo   - Reiniciar servicio"
echo "   pm2 stop monitor-legislativo      - Detener servicio"
echo "   pm2 reload monitor-legislativo    - Recargar sin downtime"
echo ""
log_warn "⚠️ IMPORTANTE: Debes escanear el QR de X manualmente la primera vez"
log_warn "   Si estás en un servidor sin GUI, necesitarás:"
log_warn "   1. Correr el sistema localmente con headless: false"
log_warn "   2. Escanear el QR code"
log_warn "   3. Copiar el archivo config/cookies.json al servidor"
echo ""
log_info "Health check: http://$(hostname -I | awk '{print $1}'):3000/health"
