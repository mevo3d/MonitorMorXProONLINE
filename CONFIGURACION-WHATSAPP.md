# 📱 CONFIGURACIÓN DE WHATSAPP

## 📋 Archivo de configuración: `config-whatsapp.json`

Este archivo te permite personalizar cómo se comporta la ventana de WhatsApp Web.

### ⚙️ **Configuración de Ventana**

```json
{
  "ventana": {
    "ancho": 1280,              // Ancho de la ventana en píxeles
    "alto": 800,                // Alto de la ventana en píxeles  
    "posicion_x": 100,          // Posición horizontal (píxeles desde el borde izquierdo)
    "posicion_y": 100,          // Posición vertical (píxeles desde el borde superior)
    "pantalla_completa": false, // true = pantalla completa, false = ventana normal
    "permitir_minimizar": true  // Permite que funcione minimizada
  }
}
```

### 🔧 **Configuración de Comportamiento**

```json
{
  "comportamiento": {
    "traer_al_frente_en_error": false,    // Si traer ventana al frente cuando hay errores
    "funcionar_en_segundo_plano": true,   // Permite funcionar en segundo plano/minimizada
    "verificar_responsividad": true       // Verificar que la página responda
  }
}
```

## 📐 **Tamaños de Ventana Recomendados**

### 🖥️ **Monitor Grande (1920x1080 o mayor)**
```json
"ancho": 1280,
"alto": 800,
"posicion_x": 100,
"posicion_y": 100
```

### 💻 **Laptop Estándar (1366x768)**
```json
"ancho": 1024,
"alto": 700,
"posicion_x": 50,
"posicion_y": 50
```

### 📱 **Pantalla Pequeña (1280x720)**
```json
"ancho": 900,
"alto": 600,
"posicion_x": 50,
"posicion_y": 50
```

### 🖥️ **Monitor Ultrawide**
```json
"ancho": 1400,
"alto": 900,
"posicion_x": 200,
"posicion_y": 100
```

## ✅ **¿Funciona minimizada?**

**SÍ**, WhatsApp puede funcionar minimizada cuando:

- `"permitir_minimizar": true`
- `"funcionar_en_segundo_plano": true` 
- `"traer_al_frente_en_error": false`

### ⚡ **Rendimiento Optimizado**

La configuración por defecto está optimizada para:
- ✅ Funcionar minimizada
- ✅ Bajo consumo de recursos
- ✅ No interrumpir tu trabajo
- ✅ Envío confiable de mensajes

### 🚨 **Si tienes problemas:**

1. **Videos no se envían**: Cambia `"traer_al_frente_en_error": true`
2. **Ventana muy grande**: Reduce `ancho` y `alto`
3. **Se abre fuera de pantalla**: Ajusta `posicion_x` y `posicion_y`

## 📝 **Ejemplo de configuración completa:**

```json
{
  "ventana": {
    "ancho": 1280,
    "alto": 800,
    "posicion_x": 100,
    "posicion_y": 100,
    "pantalla_completa": false,
    "permitir_minimizar": true
  },
  "comportamiento": {
    "traer_al_frente_en_error": false,
    "funcionar_en_segundo_plano": true,
    "verificar_responsividad": true
  }
}
```

## 🔄 **Cómo aplicar cambios:**

1. Edita el archivo `config-whatsapp.json`
2. Guarda los cambios
3. Reinicia el monitor: `node index.js`
4. La nueva configuración se aplicará automáticamente

**¡WhatsApp ahora funcionará como lo prefieras!** 📱✨