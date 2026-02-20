# 🏛️ MonitorMorXPro - ONLINE (Digital Ocean)

Sincronización de producción para el sistema de monitoreo automatizado de X Pro para medios de comunicación y actores políticos de Morelos. Esta instancia corre en un droplet de Digital Ocean y es la versión oficial de despliegue.

## 🚀 Características (Producción)

- **📡 Monitoreo X Pro**: Supervisión 24/7 de listas de X Pro para Morelos.
- **🔍 Inteligencia Legislativa**: Filtrado especializado en el Congreso de Morelos (LVI Legislatura).
- **📱 Alertas Multi-Canal**: Notificaciones inmediatas vía Telegram y WhatsApp.
- **💾 Gestión de Media**: Automatización de descarga de videos y fotos con respaldo en servidor (requiere ffmpeg).
- **📊 Persistencia**: Historial robusto de contenido enviado para evitar duplicidad.
- **⚙️ PM2 Management**: Gestión de procesos para garantizar uptime y reinicio automático.

## 📋 Infraestructura

- **Hosting**: Digital Ocean Droplet (Ubuntu 24.04).
- **Entorno**: Node.js 18+.
- **Proxy**: Nginx (Configurado como proxy inverso).
- **Procesos**: PM2 (monitor_api, monitor_x_v2).
- **Dependencias OS**: fmpeg (instalado para procesamiento de video).

## ⚙️ Sincronización Git

Este repositorio (MonitorMorXProONLINE) es independiente del desarrollo local. Los cambios aquí reflejan exactamente lo que está corriendo en el servidor.

**Para subir cambios desde el servidor:**
\\\ash
git add .
git commit -m \ Descripción del cambio\
git push origin master
\\\

## 📝 Comandos de Control (Vía Telegram)

- \/keywords\: Ver filtros activos.
- \/add <palabra>\: Agregar monitoreo en tiempo real.
- \/whatsapp\: Verificar estado de la conexión WhatsApp.
- \/help\: Lista completa de comandos.

## 📁 Estructura en Servidor

- \/root/MonitorMorXPro\: Directorio raíz de la aplicación.
- \/root/MonitorMorXPro/media\: Almacenamiento local de fotos y videos capturados.
- \rror.log\: Registro de eventos y depuración.

---

**MonitorMorXPro ONLINE** - Operado por [mevo3d](https://github.com/mevo3d) 🏛️
\n\n# Workflow Note\nModificado directamente desde el servidor para pruebas de flujo.
