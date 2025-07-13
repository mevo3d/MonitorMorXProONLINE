# MonitorMorXPro 

Sistema de monitoreo automatizado de X Pro para medios de comunicación y actores políticos de Morelos con integración de WhatsApp y Telegram.

## 🚀 Características

- **📡 Monitoreo X Pro**: Supervisión automática de listas específicas de medios y políticos de Morelos
- **🔍 Filtrado Inteligente**: Sistema de palabras clave para contenido relevante del Congreso de Morelos
- **📱 Telegram Integration**: Control y notificaciones vía bot de Telegram
- **📞 WhatsApp Integration**: Envío automático de contenido vía WhatsApp Web
- **🎯 Detección de Duplicados**: Sistema avanzado para evitar contenido repetido
- **📊 Logging Detallado**: Registro completo de actividades en archivos de texto
- **💾 Descarga Automática**: Guardado de imágenes y videos de tweets relevantes

## 📋 Requisitos

- Node.js 18+
- Cuenta de X Pro con sesión activa
- Bot de Telegram
- Cuenta de WhatsApp (opcional)

## ⚙️ Instalación

1. **Clonar el repositorio**
```bash
git clone https://github.com/mevo3d/MonitorMorXPro.git
cd MonitorMorXPro
```

2. **Instalar dependencias**
```bash
npm install
```

3. **Configurar variables de entorno**
```bash
# Crear archivo .env con:
TELEGRAM_BOT_TOKEN=tu_token_aqui
TELEGRAM_CHAT_ID=tu_chat_id_aqui
WHATSAPP_CHAT_ID=tu_whatsapp_chat_id
```

4. **Configurar palabras clave**
Edita `keywords.json` con las palabras clave específicas para tu monitoreo.

## 🎮 Uso

### Inicio Rápido
```bash
npm start
# o
node index.js
```

### Scripts de Windows
```batch
# Inicio automático
iniciar-monitor.bat

# Inicio con PowerShell
iniciar-monitor.ps1
```

## 📝 Comandos de Telegram

### Control del Sistema
- `/keywords` - Ver palabras clave configuradas
- `/reload` - Recargar configuración de keywords.json
- `/add <palabra>` - Agregar nueva palabra clave
- `/remove <palabra>` - Remover palabra clave

### Gestión de Videos
- `/DVideo` - Reintentar descarga de videos fallidos
- `/VFallidos` - Ver lista de videos fallidos
- `/LimpiarFallidos` - Limpiar lista de fallidos

### Información de Duplicados
- `/duplicados` - Ver resumen de duplicados del día
- `/detalle_duplicados` - Ver detalles completos
- `/hash <código>` - Ver contenido específico por hash
- `/export_duplicados` - Exportar log completo

### Estado del Sistema
- `/whatsapp` - Ver estado de WhatsApp
- `/help` - Mostrar ayuda completa

## 📁 Estructura del Proyecto

```
MonitorMorXPro/
├── index.js                       # Archivo principal del sistema
├── WhatsApp.js                    # Módulo de WhatsApp
├── Telegram.js                    # Módulo de Telegram (legacy)
├── monitorXPro.js                 # Monitor específico de X Pro
├── login-check.js                 # Verificación de sesión
├── obtener-ids.js                 # Utilidad para obtener IDs
├── keywords.json                  # Configuración de palabras clave
├── config-whatsapp.json           # Configuración de WhatsApp
├── iniciar-monitor.bat            # Script de inicio Windows
├── guardian-whatsapp.ps1          # Guardian de WhatsApp
├── CONFIGURACION-WHATSAPP.md      # Documentación WhatsApp
├── INSTRUCCIONES-PROGRAMADOR-TAREAS.md # Guía de tareas programadas
└── media/2025/                    # Archivos descargados organizados por año
```

## 🔧 Configuración

### Palabras Clave (keywords.json)
```json
{
  "palabras_clave": [
    "Daniel Martínez Terrazas",
    "Andrea Valentina Gordillo", 
    "Sergio Omar Livera Chavarría",
    "Guillermina Maya Rendón",
    "Isaac Pimentel Mejía",
    "Congreso Morelos",
    "LVI Legislatura"
  ],
  "configuracion": {
    "version": "1.0",
    "ultima_actualizacion": "2025-01-13"
  }
}
```

### WhatsApp (config-whatsapp.json)
```json
{
  "ventana": {
    "ancho": 1280,
    "alto": 800,
    "pantalla_completa": false,
    "permitir_minimizar": true
  },
  "comportamiento": {
    "traer_al_frente_en_error": false,
    "funcionar_en_segundo_plano": true
  }
}
```

## 🎯 Enfoque Específico

### Área de Cobertura
- **Congreso de Morelos** - LVI Legislatura
- **Diputados Locales** - Todos los integrantes del congreso
- **Política Local** - Gobierno del Estado de Morelos
- **Medios Locales** - Comunicación regional

### Palabras Clave Predefinidas
El sistema incluye filtros específicos para:
- Nombres de diputados del Congreso de Morelos
- Instituciones gubernamentales locales  
- Términos políticos relevantes
- Eventos legislativos importantes

## 🔄 Funcionamiento

1. **Monitoreo Continuo**: El sistema verifica listas de X Pro cada pocos minutos
2. **Filtrado Inteligente**: Aplica palabras clave para identificar contenido relevante
3. **Detección de Duplicados**: Evita enviar el mismo contenido múltiples veces
4. **Descarga Automática**: Guarda imágenes y videos asociados
5. **Notificación Dual**: Envía alertas por Telegram y WhatsApp
6. **Logging Completo**: Registra toda la actividad en archivos organizados

## 📊 Sistema de Duplicados

### Características
- **Detección por Hash**: Cada contenido genera un hash único
- **Cache Inteligente**: Solo muestra la primera ocurrencia en consola
- **Logs Detallados**: Información completa guardada en archivos
- **Comandos de Consulta**: Acceso fácil vía Telegram a información específica

### Archivos de Log
- `duplicados_YYYY-MM-DD.txt` - Log diario de duplicados
- `contenido-enviado.json` - Base de datos de contenido procesado
- `media/2025/logs/urls_procesadas.txt` - URLs ya procesadas

## 🛠️ Troubleshooting

### Problemas Comunes

1. **WhatsApp no conecta**
   - Verificar que WhatsApp Web esté funcionando
   - Revisar configuración en `config-whatsapp.json`
   - Usar comando `/whatsapp` para diagnóstico

2. **X Pro no monitorea**
   - Verificar sesión activa en X Pro
   - Comprobar URLs de listas en el código
   - Revisar permisos de navegador

3. **Telegram no responde**
   - Verificar token del bot
   - Comprobar Chat ID
   - Revisar conexión a internet

## 📈 Optimizaciones

### Rendimiento
- Sistema de cache para evitar procesamiento duplicado
- Intervalos configurables de monitoreo
- Gestión eficiente de memoria con límites de cache

### Fiabilidad
- Auto-reconexión para WhatsApp
- Manejo robusto de errores
- Sistema de respaldo para videos fallidos
- Verificación automática de estado de ventanas

## 🤝 Contribuir

1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## 📄 Licencia

Este proyecto está bajo la Licencia MIT - ver el archivo [LICENSE](LICENSE) para detalles.

## 📞 Soporte

Para soporte técnico o consultas:
- Crear issue en GitHub
- Contacto: mevo@mevo.com.mx

---

**MonitorMorXPro** - Monitoreo inteligente para el Congreso de Morelos 🏛️