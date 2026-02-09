# 🍪 Guía de Configuración de Cookies para X (Twitter)

## ¿Por qué necesitas cookies?

Twitter/X requiere autenticación para acceder a contenido. Como NO usamos la API oficial (es muy costosa), usamos Playwright para simular un navegador real.

## 📋 Método Recomendado: Generación Local + Despliegue en Servidor

### Paso 1: Preparar entorno local

```bash
# En tu máquina local (Windows/Mac/Linux)
cd monitor-legislativo
npm install
```

### Paso 2: Configurar para login visual

Edita `.env`:

```env
HEADLESS=false
```

### Paso 3: Ejecutar y escanear QR

```bash
npm start
```

Se abrirá una ventana de Chrome. **NO cierres la ventana**.

1. Espera a que aparezca la página de X/Twitter
2. Escanea el QR code con tu teléfono
   - Abre X en tu móvil
   - Ve a **Settings > Privacy and Security > QR Code**
   - Escanea el código en pantalla
3. Espera a que la página se recargue y muestre el timeline

### Paso 4: Verificar que se crearon las cookies

Deberías ver un archivo nuevo: `config/cookies.json`

```bash
# Verificar que existe
ls -la config/cookies.json

# Ver contenido (opcional)
cat config/cookies.json | head -20
```

El archivo debería verse así:

```json
[
  {
    "name": "auth_token",
    "value": "f4154...cadena larga...",
    "domain": ".x.com",
    "path": "/",
    "expires": 1735689600,
    "httpOnly": true,
    "secure": true,
    "sameSite": "no_restriction"
  },
  // ... más cookies ...
]
```

### Paso 5: Subir cookies al servidor

```bash
# Desde tu máquina local
scp config/cookies.json root@tu-ip-servidor:/var/www/monitor-legislativo/config/

# O si usas clave SSH específica
scp -i ~/.ssh/tu-clave.pem config/cookies.json root@tu-ip-servidor:/var/www/monitor-legislativo/config/
```

### Paso 6: Configurar servidor para headless

En el servidor, edita `.env`:

```bash
ssh root@tu-ip-servidor
cd /var/www/monitor-legislativo
nano .env
```

Asegúrate que diga:

```env
HEADLESS=true
```

### Paso 7: Reiniciar servicio en servidor

```bash
pm2 restart monitor-legislativo
pm2 logs monitor-legislativo
```

Deberías ver:

```
[INFO] ✅ Cookies cargadas
[INFO] ✅ Sesión de X activa
```

## 🔧 Método Alternativo: VNC en Servidor

Si NO tienes acceso a una máquina local:

### Instalar entorno gráfico ligero

```bash
# En el servidor Ubuntu
apt-get update
apt-get install -y xfce4 xfce4-goodies
apt-get install -y x11vnc tightvncserver
```

### Iniciar servidor VNC

```bash
# Primera vez te pedirá contraseña
vncserver :1 -geometry 1920x1080 -depth 24
```

### Conectar desde tu máquina

1. **Instalar VNC Viewer**:
   - Windows: [RealVNC Viewer](https://www.realvnc.com/en/connect/download/viewer/)
   - Mac: [Chicken of the VNC](https://sourceforge.net/projects/cotvnc/)

2. **Conectarse**:
   - Host: `tu-ip-servidor:5901`
   - Password: La que configuraste

3. **Dentro de VNC, abrir terminal**:

```bash
cd /var/www/monitor-legislativo
HEADLESS=false npm start
```

4. **Seguir pasos normales de escaneo de QR**

5. **Copiar cookies generadas a ubicación correcta**:

```bash
mkdir -p config
# Asumiendo que se generaron en home
cp ~/.config/.../cookies.json /var/www/monitor-legislativo/config/
```

## 🔒 Seguridad de las Cookies

### NUNCA commits cookies.json

El archivo `.gitignore` YA incluye `config/cookies.json`, pero verifica:

```bash
cat .gitignore | grep cookies
```

Debería mostrar:

```
config/cookies.json
```

### Permisos de archivo

```bash
# En el servidor, restringir acceso
chmod 600 config/cookies.json
chown root:root config/cookies.json
```

### Rotación de cookies

Las cookies de X expiran. **Renueva cada 2-4 semanas**:

1. Repite el proceso de generación local
2. Sube nuevas cookies al servidor
3. Reinicia servicio

```bash
scp config/cookies.json root@servidor:/var/www/monitor-legislativo/config/
ssh root@servidor "pm2 restart monitor-legislativo"
```

## ❓ Troubleshooting

### Error: "Sesión de X expirada"

**Causa**: Cookies vencidas o inválidas

**Solución**:
1. Generar nuevas cookies siguiendo esta guía
2. Subir al servidor
3. Reiniciar servicio

### Error: "No se puede cargar cookies.json"

**Causa**: Archivo no existe o permisos incorrectos

**Solución**:
```bash
# Verificar que existe
ls -la config/cookies.json

# Si no existe, crear directorio
mkdir -p config

# Verificar permisos
chmod 644 config/cookies.json
```

### El sistema funciona local pero no en servidor

**Causa**: HEADLESS=false en servidor

**Solución**:
```bash
# En servidor
nano .env
# Asegurarse que HEADLESS=true

pm2 restart monitor-legislativo
```

### VNC muy lento

**Solución**: Usar **método recomendado** (generación local)

El entorno gráfico en servidor consume muchos recursos y es lento por la red.

## ✅ Verificación

Después de configurar las cookies, verifica que todo funciona:

```bash
# En servidor
pm2 logs monitor-legislativo | grep "Sesión"
```

Deberías ver:

```
✅ Sesión de X activa
```

Y NO:

```
❌ No hay sesión activa en X
```

---

**¿Problemas?** Revisa los logs completos:

```bash
pm2 logs monitor-legislativo --lines 50
```

O el archivo de logs:

```bash
tail -n 50 logs/combined-$(date +%Y-%m-%d).log
```
