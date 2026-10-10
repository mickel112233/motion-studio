const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

test('MCP server initializes and safely edits a configured project', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'motion-studio-mcp-'));
  const projectPath = path.join(dir, 'test.motion.json');
  const serverPath = path.join(__dirname, 'mcp-server.cjs');
  const child = spawn(process.execPath, [serverPath, '--project', projectPath], { stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  const pending = [];
  const waiting = [];
  lines.on('line', line => {
    let value; try { value = JSON.parse(line); } catch { return; }
    const index = waiting.findIndex(item => item.id === value.id);
    if (index >= 0) waiting.splice(index, 1)[0].resolve(value);
    else pending.push(value);
  });
  const request = (id, method, params = {}) => new Promise((resolve, reject) => {
    const existing = pending.findIndex(item => item.id === id);
    if (existing >= 0) return resolve(pending.splice(existing, 1)[0]);
    const timer = setTimeout(() => { const i = waiting.findIndex(item => item.id === id); if (i >= 0) waiting.splice(i, 1); reject(new Error('MCP request timed out: ' + method)); }, 3000);
    waiting.push({ id, resolve: value => { clearTimeout(timer); resolve(value); } });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  try {
    const init = await request(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'mcp-test', version: '1.0' } });
    assert.equal(init.result.serverInfo.name, 'motion-studio-mcp');
    const listed = await request(2, 'tools/list');
    assert.ok(listed.result.tools.some(tool => tool.name === 'layers.create'));
    const created = await request(3, 'tools/call', { name: 'layers.create', arguments: { kind: 'text', name: 'Agent headline', text: 'Hello from MCP' } });
    assert.equal(created.result.isError, false);
    assert.equal(created.result.structuredContent.result.name, 'Agent headline');
    const summary = await request(4, 'tools/call', { name: 'project.get_summary', arguments: {} });
    assert.equal(summary.result.structuredContent.result.layerCount, 1);
    const layerId = created.result.structuredContent.result.id;
    const keyed = await request(5, 'tools/call', { name: 'layers.add_keyframe', arguments: { id: layerId, time: 4, x: 120, easing: 'ease-in' } });
    assert.equal(keyed.result.isError, false);
    assert.equal(keyed.result.structuredContent.result.easing, 'ease-in');
    const effects = await request(9, 'tools/call', { name: 'layers.set_effects', arguments: { id: layerId, effects: [{ type: 'blur', value: 6 }, { type: 'brightness', value: 115 }] } });
    assert.equal(effects.result.isError, false);
    assert.equal(effects.result.structuredContent.result.length, 2);
    const lock = await request(10, 'tools/call', { name: 'layers.update', arguments: { id: layerId, patch: { locked: true } } });
    assert.equal(lock.result.isError, false);
    const blocked = await request(11, 'tools/call', { name: 'layers.update', arguments: { id: layerId, patch: { text: 'must not apply' } } });
    assert.equal(blocked.result.isError, true);
    const unlock = await request(12, 'tools/call', { name: 'layers.update', arguments: { id: layerId, patch: { locked: false } } });
    assert.equal(unlock.result.isError, false);
    const duplicated = await request(6, 'tools/call', { name: 'layers.duplicate', arguments: { id: layerId, offsetX: 30 } });
    assert.equal(duplicated.result.isError, false);
    const duplicateId = duplicated.result.structuredContent.result.id;
    assert.notEqual(duplicateId, layerId);
    const reordered = await request(7, 'tools/call', { name: 'layers.reorder', arguments: { id: duplicateId, index: 0 } });
    assert.equal(reordered.result.structuredContent.result.index, 0);
    const deleted = await request(8, 'tools/call', { name: 'layers.delete', arguments: { id: duplicateId, confirm: true } });
    assert.equal(deleted.result.structuredContent.result.deleted, true);
    const saved = JSON.parse(await fs.readFile(projectPath, 'utf8'));
    assert.equal(saved.layers.length, 1);
    assert.equal(saved.layers[0].text, 'Hello from MCP');
    assert.equal(saved.layers[0].keyframes.find(frame => frame.time === 4).easing, 'ease-in');
    assert.equal(saved.layers[0].effects.length, 2);
  } finally {
    child.stdin.end();
    child.kill();
    lines.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
