# 📋 INSTRUCCIONES PARA PROGRAMADOR DE TAREAS DE WINDOWS

## 🎯 Objetivo
Configurar el Monitor X Pro para que se ejecute automáticamente todos los días a las 00:00 hrs y se cierre automáticamente a las 23:59 hrs.

---

## 📝 PASOS PARA CONFIGURAR EL PROGRAMADOR DE TAREAS

### 1. 🔍 Abrir el Programador de Tareas
- Presiona `Win + R`
- Escribe: `taskschd.msc`
- Presiona Enter

### 2. 📁 Crear una nueva tarea
- En el panel derecho, haz clic en **"Crear tarea..."**
- NO uses "Crear tarea básica", usa "Crear tarea..."

### 3. ⚙️ Configurar la pestaña GENERAL
- **Nombre**: `Monitor X Pro - Diario`
- **Descripción**: `Monitoreo automático de X Pro con inicio y cierre programado`
- ✅ Marcar: **"Ejecutar tanto si el usuario inició sesión como si no"**
- ✅ Marcar: **"Ejecutar con los privilegios más altos"**
- En **"Configurar para"**: Seleccionar tu versión de Windows

### 4. 🕐 Configurar la pestaña DESENCADENADORES
- Haz clic en **"Nuevo..."**
- **Iniciar la tarea**: `Según una programación`
- **Configuración**: `Diariamente`
- **Iniciar**: `00:00:00` (medianoche)
- **Repetir cada**: Dejar en blanco
- ✅ Marcar: **"Habilitado"**
- Haz clic en **"Aceptar"**

### 5. 🚀 Configurar la pestaña ACCIONES
- Haz clic en **"Nueva..."**
- **Acción**: `Iniciar un programa`
- **Programa o script**: `C:\Users\BALERION\proyectos-automatizacion\playwright-proyecto\iniciar-monitor.bat`
- **Iniciar en**: `C:\Users\BALERION\proyectos-automatizacion\playwright-proyecto`
- Haz clic en **"Aceptar"**

### 6. 🔧 Configurar la pestaña CONDICIONES
- ❌ Desmarcar: **"Iniciar la tarea solo si el equipo se está alimentando con CA"**
- ❌ Desmarcar: **"Detener si el equipo cambia a alimentación por batería"**
- ✅ Marcar: **"Activar el equipo para ejecutar esta tarea"** (si quieres que despierte el PC)

### 7. ⚡ Configurar la pestaña CONFIGURACIÓN
- ✅ Marcar: **"Permitir ejecutar la tarea a petición"**
- ✅ Marcar: **"Ejecutar la tarea tan pronto como sea posible después de un inicio programado perdido"**
- ❌ Desmarcar: **"Detener la tarea si se ejecuta durante más de"**
- **Si la tarea en ejecución no finaliza cuando se solicita**: `No realizar ninguna acción`

### 8. ✅ Finalizar
- Haz clic en **"Aceptar"**
- Te pedirá las credenciales de usuario, ingresa tu usuario y contraseña de Windows

---

## 🧪 PROBAR LA CONFIGURACIÓN

### Prueba Manual:
1. En el Programador de Tareas, encuentra tu tarea "Monitor X Pro - Diario"
2. Haz clic derecho → **"Ejecutar"**
3. Verifica que el programa se inicie correctamente

### Verificar logs:
- Los logs aparecerán en la consola del Programador de Tareas
- También puedes revisar el historial en la pestaña "Historial"

---

## 🔄 FUNCIONAMIENTO AUTOMÁTICO

### ✅ **Lo que pasará automáticamente:**

1. **00:00 hrs** - El sistema se inicia automáticamente
2. **Todo el día** - Monitorea X Pro y envía notificaciones  
3. **23:59 hrs** - Envía estadísticas finales del día y se cierra automáticamente
4. **00:00 hrs del día siguiente** - Se inicia nuevamente

### 📊 **Reportes que recibirás:**

- **Al iniciar**: Mensaje de confirmación de inicio
- **Durante el día**: Notificaciones de tweets encontrados
- **Al cerrar (23:59)**: Reporte completo con estadísticas del día

---

## 🛠️ SOLUCIÓN DE PROBLEMAS

### ❌ **Si la tarea no se ejecuta:**
- Verifica que la ruta del archivo .bat sea correcta
- Asegúrate de que el usuario tenga permisos de ejecución
- Revisa el historial de la tarea para ver errores

### ❌ **Si hay errores de Node.js:**
- Verifica que Node.js esté instalado
- Asegúrate de que esté en el PATH del sistema
- Prueba ejecutar el .bat manualmente primero

### ❌ **Si no se cierra automáticamente:**
- El programa tiene un cierre automático programado interno
- Se cerrará a las 23:59 PM independientemente del Programador de Tareas

---

## 📁 ARCHIVOS CREADOS

- `iniciar-monitor.bat` - Script principal de inicio (Windows Batch)
- `iniciar-monitor.ps1` - Script alternativo (PowerShell)  
- `INSTRUCCIONES-PROGRAMADOR-TAREAS.md` - Este archivo de instrucciones

**¡El sistema está listo para funcionar 24/7 con reinicio automático diario!** 🚀