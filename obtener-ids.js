import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';

const client = new Client({
    authStrategy: new LocalAuth()
});

client.on('qr', qr => {
    qrcode.generate(qr, {small: true});
    console.log('🔄 Escanea el código QR con WhatsApp');
});

client.on('ready', () => {
    console.log('✅ WhatsApp conectado!');
    console.log('📱 Envía un mensaje desde el grupo/contacto donde quieres recibir alertas');
});

client.on('message', async msg => {
    console.log(`📱 Mensaje de: ${msg.from}`);
    console.log(`👤 Nombre: ${msg._data.notifyName}`);
    console.log(`💬 Texto: ${msg.body}`);
    console.log('---');
});

client.initialize();