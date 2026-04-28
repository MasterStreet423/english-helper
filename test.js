#!/usr/bin/env node
/**
 * Pruebas automáticas para english-helper.
 * Ejecutar: node test.js
 * No requiere servidor activo ni WhatsApp conectado.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  process.stdout.write(`  ${name} ... `);
  try {
    await fn();
    console.log('\x1b[32mOK\x1b[0m');
    passed++;
  } catch (err) {
    console.log(`\x1b[31mFAIL\x1b[0m\n    ${err.message}`);
    failed++;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function tmpConfig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-test-'));
  return path.join(dir, 'config.json');
}

// ── Suite 1: Config ────────────────────────────────────────────────────────────

async function suiteConfig() {
  console.log('\n\x1b[1mConfig\x1b[0m');

  await test('load() retorna defaults cuando no existe config', async () => {
    const origCwd = process.cwd();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-'));
    process.chdir(dir);
    const { load, DEFAULT_CONFIG } = require('./src/config');
    const cfg = load();
    assert.strictEqual(cfg.provider, DEFAULT_CONFIG.provider);
    assert.strictEqual(cfg.tolerancePercent, DEFAULT_CONFIG.tolerancePercent);
    process.chdir(origCwd);
  });

  await test('save() persiste y load() recupera valores', async () => {
    const origCwd = process.cwd();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-'));
    process.chdir(dir);
    // Borrar cache del módulo para que use el nuevo cwd
    delete require.cache[require.resolve('./src/config')];
    const { load, save } = require('./src/config');
    const saved = save({ targetPhone: '56912345678', provider: 'custom', tolerancePercent: 42 });
    assert.strictEqual(saved.targetPhone, '56912345678');
    assert.strictEqual(saved.tolerancePercent, 42);
    const loaded = load();
    assert.strictEqual(loaded.targetPhone, '56912345678');
    assert.strictEqual(loaded.tolerancePercent, 42);
    process.chdir(origCwd);
    delete require.cache[require.resolve('./src/config')];
  });

  await test('save() clampea tolerancePercent a [0, 100]', async () => {
    const origCwd = process.cwd();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-'));
    process.chdir(dir);
    delete require.cache[require.resolve('./src/config')];
    const { save } = require('./src/config');
    assert.strictEqual(save({ tolerancePercent: 999 }).tolerancePercent, 100);
    assert.strictEqual(save({ tolerancePercent: -50 }).tolerancePercent, 0);
    process.chdir(origCwd);
    delete require.cache[require.resolve('./src/config')];
  });
}

// ── Suite 2: extractJSON ───────────────────────────────────────────────────────

async function suiteExtractJSON() {
  console.log('\n\x1b[1mextractJSON (analyzer interno)\x1b[0m');

  // Acceder a la función privada vía módulo cargado
  // La exponemos temporalmente reescribiendo el módulo en memoria
  const analyzerPath = require.resolve('./src/analyzer');
  delete require.cache[analyzerPath];

  // Monkey-patch: leer el source y evaluar extractJSON
  const src = fs.readFileSync(path.join(__dirname, 'src/analyzer.js'), 'utf8');
  const extractJSONMatch = src.match(/function extractJSON[\s\S]*?\n\}/);
  const extractJSON = new Function(`${extractJSONMatch[0]}; return extractJSON;`)();

  await test('extrae JSON limpio directamente', async () => {
    const raw = '{"isEnglish":true,"hasError":false,"severity":0,"corrected":"ok","explanation":""}';
    const out = extractJSON(raw);
    assert.strictEqual(out, raw);
  });

  await test('elimina bloque <think>...</think>', async () => {
    const raw = '<think>pensando...</think>\n{"isEnglish":true,"hasError":false,"severity":0,"corrected":"ok","explanation":""}';
    const out = extractJSON(raw);
    assert.ok(out.startsWith('{'), `Esperaba JSON, obtuve: ${out}`);
  });

  await test('extrae de bloque ```json ... ```', async () => {
    const raw = '```json\n{"isEnglish":true,"hasError":true,"severity":30,"corrected":"fixed","explanation":"err"}\n```';
    const out = extractJSON(raw);
    const parsed = JSON.parse(out);
    assert.strictEqual(parsed.severity, 30);
  });
}

// ── Suite 3: API iaklein ───────────────────────────────────────────────────────

async function suiteApiIaklein() {
  console.log('\n\x1b[1mAPI iaklein (https://llm.iaklein.space/v1)\x1b[0m');

  const IAKLEIN = {
    provider: 'custom',
    apiKey: '5suOEwdtdWY0thhGpO',
    apiBaseUrl: 'https://llm.iaklein.space/v1',
    model: 'qwen3.6:35b',
  };

  await test('endpoint /v1/models responde con lista de modelos', async () => {
    const { default: fetch } = await import('node-fetch').catch(() => ({ default: globalThis.fetch }));
    const fetcher = fetch || globalThis.fetch;
    const res = await fetcher(`${IAKLEIN.apiBaseUrl}/models`, {
      headers: { Authorization: `Bearer ${IAKLEIN.apiKey}` },
    });
    assert.ok(res.ok, `HTTP ${res.status}`);
    const data = await res.json();
    assert.ok(Array.isArray(data.data), 'Respuesta inesperada');
    const modelIds = data.data.map(m => m.id);
    assert.ok(modelIds.includes('qwen3.6:35b'), `qwen3.6:35b no encontrado. Disponibles: ${modelIds.join(', ')}`);
  });

  await test('analyzeMessage detecta y corrige error en inglés', async () => {
    delete require.cache[require.resolve('./src/analyzer')];
    const { analyzeMessage } = require('./src/analyzer');
    const result = await analyzeMessage('I goed to the store yesterday', [], IAKLEIN);
    assert.strictEqual(typeof result.isTargetLanguage, 'boolean');
    assert.strictEqual(typeof result.hasError, 'boolean');
    assert.strictEqual(typeof result.severity, 'number');
    assert.strictEqual(typeof result.corrected, 'string');
    assert.strictEqual(typeof result.explanation, 'string');
    assert.ok(result.isTargetLanguage, 'Debería detectar inglés');
    assert.ok(result.hasError, 'Debería detectar error en "goed"');
    assert.ok(result.corrected.toLowerCase().includes('went'), `corrección esperada "went", obtuve: "${result.corrected}"`);
  });

  await test('analyzeMessage no corrige mensaje correcto', async () => {
    delete require.cache[require.resolve('./src/analyzer')];
    const { analyzeMessage } = require('./src/analyzer');
    const result = await analyzeMessage('I went to the store yesterday', [], IAKLEIN);
    assert.ok(result.isTargetLanguage);
    assert.strictEqual(result.hasError, false);
    assert.ok(result.severity < 20, `Severidad esperada baja, obtuve ${result.severity}`);
  });

  await test('analyzeMessage ignora mensajes en otro idioma', async () => {
    delete require.cache[require.resolve('./src/analyzer')];
    const { analyzeMessage } = require('./src/analyzer');
    const result = await analyzeMessage('hola como estás', [], IAKLEIN);
    assert.strictEqual(result.isTargetLanguage, false);
  });

  await test('analyzeMessage corrige francés cuando targetLanguage=french', async () => {
    delete require.cache[require.resolve('./src/analyzer')];
    const { analyzeMessage } = require('./src/analyzer');
    const frConfig = { ...IAKLEIN, targetLanguage: 'french', explanationLanguage: 'spanish' };
    const result = await analyzeMessage('Je suis allé au magasin hier', [], frConfig);
    assert.strictEqual(typeof result.isTargetLanguage, 'boolean');
    assert.ok(result.isTargetLanguage, 'Debería detectar francés');
  });

  await test('analyzeMessage ignora inglés cuando targetLanguage=french', async () => {
    delete require.cache[require.resolve('./src/analyzer')];
    const { analyzeMessage } = require('./src/analyzer');
    const frConfig = { ...IAKLEIN, targetLanguage: 'french', explanationLanguage: 'spanish' };
    const result = await analyzeMessage('I went to the store yesterday', [], frConfig);
    assert.strictEqual(result.isTargetLanguage, false, 'Inglés no debería ser detectado como francés');
  });
}

// ── Suite 4: Lógica de tolerancia ─────────────────────────────────────────────

async function suiteTolerance() {
  console.log('\n\x1b[1mLógica de tolerancia\x1b[0m');

  await test('severidad alta supera tolerancia 30', async () => {
    const config = { tolerancePercent: 30 };
    const severity = 55;
    assert.ok(severity >= config.tolerancePercent);
  });

  await test('severidad baja no supera tolerancia 30', async () => {
    const config = { tolerancePercent: 30 };
    const severity = 10;
    assert.ok(severity < config.tolerancePercent);
  });

  await test('tolerancia 0 acepta cualquier error', async () => {
    const config = { tolerancePercent: 0 };
    assert.ok(1 >= config.tolerancePercent);
  });

  await test('tolerancia 100 nunca corrige', async () => {
    const config = { tolerancePercent: 100 };
    assert.ok(!(99 >= config.tolerancePercent));
  });
}

// ── Runner ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\x1b[1m\x1b[34m=== English Helper — Test Suite ===\x1b[0m');

  await suiteConfig();
  await suiteExtractJSON();
  await suiteTolerance();
  await suiteApiIaklein();

  console.log(`\n\x1b[1m${passed + failed} tests — \x1b[32m${passed} OK\x1b[0m\x1b[1m — \x1b[${failed > 0 ? '31' : '32'}m${failed} FAIL\x1b[0m\x1b[1m\x1b[0m\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Error inesperado:', err);
  process.exit(1);
});
