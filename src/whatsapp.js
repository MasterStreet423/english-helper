const { Client, LocalAuth } = require('whatsapp-web.js');
const qrTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');

class WhatsAppClient {
  constructor({ onQR, onReady, onDisconnected, onMessage, onLog }) {
    this.onQR = onQR;
    this.onReady = onReady;
    this.onDisconnected = onDisconnected;
    this.onMessage = onMessage;
    this.onLog = onLog || (() => {});
    this.client = null;
    this.connected = false;
  }

  start() {
    this.log('Initializing WhatsApp client...');

    this.client = new Client({
      authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
        ],
      },
    });

    this.client.on('qr', async (qr) => {
      qrTerminal.generate(qr, { small: true });
      this.log('QR code generated — scan with WhatsApp to connect');
      try {
        const dataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
        this.onQR(dataUrl);
      } catch (err) {
        this.log(`QR image error: ${err.message}`);
      }
    });

    this.client.on('ready', () => {
      this.connected = true;
      this.log('WhatsApp connected and ready');
      this.onReady();
    });

    this.client.on('auth_failure', (msg) => {
      this.log(`Auth failure: ${msg}`);
    });

    this.client.on('disconnected', (reason) => {
      this.connected = false;
      this.log(`Disconnected: ${reason}`);
      this.onDisconnected(reason);
    });

    this.client.on('message_create', (msg) => this.onMessage(msg));

    this.client.initialize().catch((err) => {
      this.log(`Init error: ${err.message}`);
    });
  }

  isConnected() {
    return this.connected;
  }

  async resolvePhone(phone) {
    if (!this.client) return null;
    const digits = phone.replace(/\D/g, '');
    try {
      // Try getChatById first — returns the actual chat ID (may be @lid)
      const chat = await this.client.getChatById(`${digits}@c.us`);
      return chat.id._serialized;
    } catch (_) {}
    try {
      const contact = await this.client.getContactById(`${digits}@c.us`);
      return contact.id._serialized;
    } catch (_) {}
    return null;
  }

  async destroy() {
    if (this.client) {
      try { await this.client.destroy(); } catch (_) {}
      this.client = null;
      this.connected = false;
    }
  }

  log(msg) {
    const line = `[WhatsApp] ${msg}`;
    this.onLog(line);
  }
}

module.exports = WhatsAppClient;
