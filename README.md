# English Helper

WhatsApp bot that monitors your conversations and automatically corrects grammar mistakes in real time using an LLM. Includes a web dashboard to configure and monitor activity.

## How it works

The bot connects to WhatsApp Web, watches messages from a specific contact, detects the target language, and replies with a correction if an error is found above the configured severity threshold.

## Stack

- [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) — WhatsApp Web automation
- Express + Socket.io — dashboard and real-time updates
- Anthropic / OpenAI / custom LLM provider

## Quick start with Docker

```bash
# 1. Copy and edit the config
cp config.example.json config.json

# 2. Start
docker compose up -d

# 3. Scan the QR code to link WhatsApp
docker compose logs -f
```

The dashboard will be available at `http://localhost:3000`.

## Configuration

Edit `config.json` (or use the dashboard):

| Field | Description |
|---|---|
| `targetPhone` | Phone number to monitor (with country code, digits only) |
| `provider` | `anthropic`, `openai`, or `custom` |
| `apiKey` | API key for the chosen provider |
| `apiBaseUrl` | Base URL for `custom` providers |
| `model` | Model name (e.g. `claude-sonnet-4-6`) |
| `targetLanguage` | Language to monitor and correct |
| `explanationLanguage` | Language used in the correction replies |
| `tolerancePercent` | Minimum error severity (0–100) to trigger a correction |
| `acknowledgeCorrect` | Send a confirmation when the message has no errors |
| `enabled` | Enable or disable the bot |
| `serverPort` | Dashboard port (default `3000`) |

## Data persistence

| Path | What it stores |
|---|---|
| `./config.json` | Bot configuration (host-mounted) |
| `wwebjs_auth` (Docker volume) | WhatsApp session — survives restarts |

## Development

```bash
npm install
cp config.example.json config.json
node src/server.js
```
