const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(process.cwd(), 'config.json');

const DEFAULT_CONFIG = {
  targetPhone: '',
  provider: 'anthropic',   // 'anthropic' | 'openai' | 'custom'
  apiKey: '',
  apiBaseUrl: '',           // only for 'custom' provider
  model: 'claude-sonnet-4-6',
  targetLanguage: 'english',      // language to monitor and correct
  explanationLanguage: 'spanish', // language used in explanations
  tolerancePercent: 30,     // min severity (0-100) to trigger correction; 0=correct all, 100=never
  acknowledgeCorrect: false,
  enabled: true,
  serverPort: 3000,
};

function load() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
    }
  } catch (_) {}
  return { ...DEFAULT_CONFIG };
}

function save(config) {
  const merged = { ...DEFAULT_CONFIG, ...config };
  merged.tolerancePercent = Math.max(0, Math.min(100, Number(merged.tolerancePercent) || 0));
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
  return merged;
}

module.exports = { load, save, DEFAULT_CONFIG };
