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
    const saved = JSON.parse(await fs.readFile(projectPath, 'utf8'));
    assert.equal(saved.layers[0].text, 'Hello from MCP');
  } finally {
    child.stdin.end();
    child.kill();
    lines.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
