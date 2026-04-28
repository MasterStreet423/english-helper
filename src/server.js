const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const configManager = require('./config');
const WhatsAppClient = require('./whatsapp');
const { analyzeMessage } = require('./analyzer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// In-memory state
const recentCorrections = [];
const systemLogs = [];
const contextBuffer = new Map(); // chatId → string[]
const CONTEXT_SIZE = 6;
const MAX_LOG_LINES = 200;
const MAX_CORRECTIONS = 100;

let waClient = null;
let resolvedTargetId = null; // real chat ID (may be @lid format)
let cachedConfig = null;     // config cache, refreshed on /api/config POST

function getConfig() {
  if (!cachedConfig) cachedConfig = configManager.load();
  return cachedConfig;
}

// ── REST API ─────────────────────────────────────────────────────────────────

app.get('/api/config', (_, res) => res.json(getConfig()));

app.post('/api/config', async (req, res) => {
  const oldPhone = getConfig().targetPhone;
  const saved = configManager.save(req.body);
  cachedConfig = saved;
  if (saved.targetPhone !== oldPhone && waClient?.isConnected()) {
    resolvedTargetId = await waClient.resolvePhone(saved.targetPhone);
    pushLog(`[Server] Target re-resolved: ${resolvedTargetId || 'FAILED — check phone number'}`);
  }
  res.json({ ok: true, config: saved });
});

app.get('/api/corrections', (_, res) => res.json(recentCorrections));

app.get('/api/logs', (_, res) => res.json(systemLogs));

app.post('/api/restart', async (req, res) => {
  if (waClient) await waClient.destroy();
  startWhatsApp();
  res.json({ ok: true });
});

// ── Socket.io ─────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  socket.emit('config', getConfig());
  socket.emit('status', { connected: waClient?.isConnected() ?? false });
  socket.emit('logs', systemLogs);
  socket.emit('corrections', recentCorrections);
});

// ── WhatsApp ──────────────────────────────────────────────────────────────────

function startWhatsApp() {
  waClient = new WhatsAppClient({
    onQR: (dataUrl) => {
      io.emit('status', { connected: false, qr: dataUrl });
    },
    onReady: async () => {
      io.emit('status', { connected: true });
      pushLog('[Server] WhatsApp ready');
      const cfg = getConfig();
      if (cfg.targetPhone) {
        resolvedTargetId = await waClient.resolvePhone(cfg.targetPhone);
        pushLog(`[Server] Target resolved: ${resolvedTargetId || 'FAILED — check phone number'}`);
      }
    },
    onDisconnected: (reason) => {
      io.emit('status', { connected: false });
      pushLog(`[Server] Disconnected: ${reason}`);
    },
    onMessage: handleMessage,
    onLog: (line) => {
      pushLog(line);
    },
  });

  waClient.start();
}

async function handleMessage(message) {
  const config = getConfig();

  if (!config.enabled || !config.targetPhone || !config.apiKey) return;
  if (message.type !== 'chat') return;

  const body = (message.body || '').trim();
  if (!body || body.startsWith('>Teacher:')) return;

  // Fast check: compare chat ID before any async call
  const chatId = message.to && message.fromMe
    ? message.to
    : (message.from || '');
  const targetPhone = config.targetPhone.replace(/\D/g, '');
  const classicId = `${targetPhone}@c.us`;
  const quickMatch = chatId === (resolvedTargetId || classicId);
  if (!quickMatch) return;

  const chat = await message.getChat();
  if (chat.isGroup) return;
  const chatSerial = chat.id._serialized;
  if (chatSerial !== (resolvedTargetId || classicId)) return;

  // Maintain context buffer
  if (!contextBuffer.has(chatSerial)) contextBuffer.set(chatSerial, []);
  const ctx = contextBuffer.get(chatSerial);

  pushLog(`[Msg] ${message.fromMe ? 'Me' : 'Them'}: ${body}`);

  try {
    const result = await analyzeMessage(body, ctx.slice(-CONTEXT_SIZE), config);

    // Push current message to context after analysis
    ctx.push(body);
    if (ctx.length > CONTEXT_SIZE * 2) ctx.splice(0, CONTEXT_SIZE);

    if (!result.isTargetLanguage) return;

    const entry = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      from: message.fromMe ? 'me' : 'them',
      original: body,
      hasError: result.hasError,
      severity: result.severity,
      corrected: result.corrected,
      explanation: result.explanation,
      correctionSent: false,
    };

    if (result.hasError && result.severity >= config.tolerancePercent) {
      const reply = `>Teacher: _${result.corrected}_\n\n_${result.explanation}_`;
      await chat.sendMessage(reply);
      entry.correctionSent = true;
      pushLog(`[Teacher] Sent correction (severity ${result.severity})`);
    } else if (!result.hasError && config.acknowledgeCorrect) {
      await chat.sendMessage('>Teacher: ✓ That was correct!');
      pushLog('[Teacher] Acknowledged correct message');
    }

    recentCorrections.unshift(entry);
    if (recentCorrections.length > MAX_CORRECTIONS) recentCorrections.pop();
    io.emit('correction', entry);
  } catch (err) {
    pushLog(`[Error] ${err.message}`);
  }
}

function pushLog(line) {
  const entry = { t: new Date().toISOString(), msg: line };
  systemLogs.unshift(entry);
  if (systemLogs.length > MAX_LOG_LINES) systemLogs.pop();
  console.log(line);
  io.emit('log', entry);
}

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = getConfig().serverPort || 3000;

server.listen(PORT, () => {
  console.log(`\n🎓  English Helper`);
  console.log(`📡  Dashboard: http://localhost:${PORT}\n`);
  startWhatsApp();
});
