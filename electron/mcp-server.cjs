#!/usr/bin/env node
'use strict';
// Motion Studio MCP server: stdio JSON-RPC, restricted to one configured project JSON.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');
const args = process.argv.slice(2);
let configured = process.env.MOTION_STUDIO_PROJECT;
for (let i = 0; i < args.length; i++) if (args[i] === '--project' && args[i + 1]) configured = args[++i];
if (!configured || !path.isAbsolute(configured) || !/\.(motion\.json|json)$/i.test(configured)) {
  process.stderr.write('Set MOTION_STUDIO_PROJECT or pass --project with an absolute .motion.json/.json path.\n');
  process.exit(2);
}
const file = path.resolve(configured);
const maxBytes = 20 * 1024 * 1024;
const fail = (ok, message) => { if (!ok) throw new Error(message); };
const num = (v, n, min, max) => { fail(typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max, n + ' must be a number from ' + min + ' to ' + max); return v; };
const str = (v, n, max = 160) => { fail(typeof v === 'string' && v.trim().length > 0 && v.length <= max, n + ' must be a non-empty string of at most ' + max + ' characters'); return v.trim(); };
const emptyProject = () => ({ schemaVersion: 1, name: 'Untitled Composition', width: 1920, height: 1080, fps: 30, duration: 12, layers: [] });
function validate(p) {
  fail(p && typeof p === 'object' && !Array.isArray(p), 'Project must be an object');
  fail(p.schemaVersion === undefined || p.schemaVersion === 1, 'Unsupported project schema version: ' + p.schemaVersion);
  str(p.name, 'project name', 200); num(p.width, 'width', 16, 16384); num(p.height, 'height', 16, 16384);
  num(p.fps, 'fps', 1, 240); num(p.duration, 'duration', .1, 86400);
  fail(Array.isArray(p.layers) && p.layers.length <= 10000, 'layers must be an array of at most 10,000 items');
  const ids = new Set();
  const numeric = (v) => typeof v === 'number' && Number.isFinite(v);
  for (const l of p.layers) {
    fail(l && typeof l === 'object' && !Array.isArray(l) && typeof l.id === 'string' && l.id.length > 0 && l.id.length <= 160, 'Invalid layer ID');
    fail(!ids.has(l.id), 'Duplicate layer id: ' + l.id); ids.add(l.id);
    fail(['text','shape','image','video','audio'].includes(l.kind), 'Invalid layer kind: ' + l.id);
    fail(typeof l.name === 'string' && l.name.trim().length > 0 && l.name.length <= 200, 'Invalid layer name: ' + l.id);
    fail(typeof l.visible === 'boolean' && typeof l.locked === 'boolean', 'Layer visibility and lock state must be boolean: ' + l.id);
    for (const key of ['start','duration','x','y','scale','rotation','opacity']) fail(numeric(l[key]), 'Invalid numeric layer property ' + key + ': ' + l.id);
    fail(l.start >= 0 && l.duration > 0 && l.scale > 0 && l.opacity >= 0 && l.opacity <= 100, 'Layer transform or timing out of range: ' + l.id);
    fail(l.start <= p.duration, 'Layer starts after composition duration: ' + l.id);
    fail(typeof l.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(l.color), 'Invalid layer color: ' + l.id);
    if (l.volume !== undefined) fail(numeric(l.volume) && l.volume >= 0 && l.volume <= 100, 'Invalid layer volume: ' + l.id);
    if (l.muted !== undefined) fail(typeof l.muted === 'boolean', 'Invalid layer mute state: ' + l.id);
    if (l.audioFadeIn !== undefined) num(l.audioFadeIn, 'audio fade-in', 0, 30);
    if (l.audioFadeOut !== undefined) num(l.audioFadeOut, 'audio fade-out', 0, 30);
    for (const key of ['transitionIn','transitionOut']) if (l[key] !== undefined) {
      const t = l[key]; fail(t && typeof t === 'object' && !Array.isArray(t) && ['none','fade','wipe-left','wipe-right','zoom'].includes(t.type), 'Invalid '+key+' type: '+l.id);
      num(t.duration, key+' duration', 0, 30);
    }
    if (l.mask !== undefined) fail(l.mask && typeof l.mask === 'object' && !Array.isArray(l.mask) && ['none','rectangle','ellipse'].includes(l.mask.type) && numeric(l.mask.inset) && l.mask.inset >= 0 && l.mask.inset <= 45, 'Invalid mask: '+l.id);
    if (l.colorGrade !== undefined) {
      const g = l.colorGrade; fail(g && typeof g === 'object' && !Array.isArray(g), 'Invalid color grade: '+l.id);
      for (const [key,min,max] of [['exposure',-4,4],['contrast',0,200],['saturation',0,200],['temperature',-100,100],['tint',-100,100]]) num(g[key], 'colorGrade.'+key, min, max);
    }
    if (l.effects !== undefined) {
      const limits = { blur:40, brightness:300, contrast:300, saturate:300, grayscale:100, sepia:100, 'hue-rotate':360, 'drop-shadow':50 };
      fail(Array.isArray(l.effects) && l.effects.length <= 64, 'Invalid effects: ' + l.id);
      const effectIds = new Set();
      for (const effect of l.effects) {
        fail(effect && typeof effect.id === 'string' && effect.id.length > 0 && !effectIds.has(effect.id), 'Invalid or duplicate effect ID: ' + l.id);
        effectIds.add(effect.id);
        fail(Object.hasOwn(limits,effect.type) && typeof effect.enabled === 'boolean' && numeric(effect.value) && effect.value >= 0 && effect.value <= limits[effect.type], 'Invalid effect value: ' + l.id);
      }
    }
    fail(Array.isArray(l.keyframes) && l.keyframes.length <= 10000, 'Invalid keyframes: ' + l.id);
    for (const k of l.keyframes || []) {
      fail(k && numeric(k.time) && k.time >= 0 && k.time <= p.duration, 'Invalid keyframe time: ' + l.id);
      for (const key of ['x','y','scale','rotation','opacity']) fail(numeric(k[key]), 'Invalid keyframe property ' + key + ': ' + l.id);
      fail(k.scale > 0 && k.opacity >= 0 && k.opacity <= 100, 'Keyframe transform out of range: ' + l.id);
      if (k.easing !== undefined) fail(['linear','ease-in','ease-out','ease-in-out','hold'].includes(k.easing), 'Invalid keyframe easing: ' + l.id);
    }
  }
}
async function read() {
  let b; try { b = await fs.readFile(file); } catch (e) { if (e.code === 'ENOENT') return emptyProject(); throw e; }
  fail(b.length <= maxBytes, 'Project exceeds 20 MB safety limit');
  let p; try { p = JSON.parse(b.toString('utf8')); } catch { throw new Error('Project file is invalid JSON'); }
  validate(p); return p.schemaVersion === undefined ? { ...p, schemaVersion: 1 } : p;
}
async function write(p) {
  validate(p); const data = JSON.stringify({ ...p, schemaVersion: 1, updatedAt: new Date().toISOString() }, null, 2) + '\n';
  fail(Buffer.byteLength(data) <= maxBytes, 'Project exceeds 20 MB safety limit');
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = file + '.tmp-' + process.pid + '-' + crypto.randomBytes(3).toString('hex');
  try { await fs.writeFile(temp, data, { flag: 'wx', encoding: 'utf8' }); await fs.rename(temp, file); }
  catch (e) { await fs.rm(temp, { force: true }).catch(() => {}); throw e; }
}
function layer(p, id) { const l = p.layers.find(x => x.id === id); fail(l, 'Layer not found: ' + id); return l; }
const tools = [
 { name:'project.get_summary', description:'Read composition metadata and layer counts.', inputSchema:{type:'object',properties:{},additionalProperties:false} },
 { name:'project.validate', description:'Validate project dimensions, layer types and unique IDs.', inputSchema:{type:'object',properties:{},additionalProperties:false} },
 { name:'layers.list', description:'List layers and their editable properties; optionally include keyframes.', inputSchema:{type:'object',properties:{includeKeyframes:{type:'boolean'}},additionalProperties:false} },
 { name:'layers.create', description:'Create a layer. Writes the configured project file.', inputSchema:{type:'object',required:['kind','name'],properties:{kind:{type:'string',enum:['text','shape','image','video','audio']},name:{type:'string',minLength:1,maxLength:160},text:{type:'string',maxLength:10000},color:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'},start:{type:'number',minimum:0},duration:{type:'number',exclusiveMinimum:0},x:{type:'number'},y:{type:'number'}},additionalProperties:false} },
 { name:'layers.update', description:'Update allowed properties of an existing layer. Locked layers require unlockFirst=true.', inputSchema:{type:'object',required:['id','patch'],properties:{id:{type:'string'},unlockFirst:{type:'boolean'},patch:{type:'object',properties:{name:{type:'string',maxLength:160},color:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'},visible:{type:'boolean'},locked:{type:'boolean'},start:{type:'number',minimum:0},duration:{type:'number',exclusiveMinimum:0},x:{type:'number'},y:{type:'number'},scale:{type:'number',exclusiveMinimum:0,maximum:1000},rotation:{type:'number'},opacity:{type:'number',minimum:0,maximum:100},volume:{type:'number',minimum:0,maximum:100},muted:{type:'boolean'},audioFadeIn:{type:'number',minimum:0,maximum:30},audioFadeOut:{type:'number',minimum:0,maximum:30},text:{type:'string',maxLength:10000},transitionIn:{type:'object',required:['type','duration'],properties:{type:{type:'string',enum:['none','fade','wipe-left','wipe-right','zoom']},duration:{type:'number',minimum:0,maximum:30}},additionalProperties:false},transitionOut:{type:'object',required:['type','duration'],properties:{type:{type:'string',enum:['none','fade','wipe-left','wipe-right','zoom']},duration:{type:'number',minimum:0,maximum:30}},additionalProperties:false},mask:{type:'object',required:['type','inset'],properties:{type:{type:'string',enum:['none','rectangle','ellipse']},inset:{type:'number',minimum:0,maximum:45}},additionalProperties:false},colorGrade:{type:'object',required:['exposure','contrast','saturation','temperature','tint'],properties:{exposure:{type:'number',minimum:-4,maximum:4},contrast:{type:'number',minimum:0,maximum:200},saturation:{type:'number',minimum:0,maximum:200},temperature:{type:'number',minimum:-100,maximum:100},tint:{type:'number',minimum:-100,maximum:100}},additionalProperties:false}},additionalProperties:false}},additionalProperties:false} },
 { name:'layers.set_effects', description:'Replace the editable effect stack on an unlocked layer.', inputSchema:{type:'object',required:['id','effects'],properties:{id:{type:'string'},effects:{type:'array',maxItems:64,items:{type:'object',required:['type','value'],properties:{id:{type:'string',maxLength:160},type:{type:'string',enum:['blur','brightness','contrast','saturate','grayscale','sepia','hue-rotate','drop-shadow']},enabled:{type:'boolean'},value:{type:'number',minimum:0}},additionalProperties:false}}},additionalProperties:false} },
 { name:'layers.delete', description:'Destructively delete one layer; requires explicit confirm=true and layer must be unlocked.', inputSchema:{type:'object',required:['id','confirm'],properties:{id:{type:'string'},confirm:{type:'boolean',const:true}},additionalProperties:false} },
 { name:'layers.add_keyframe', description:'Add or replace an animated transform keyframe, including its outgoing easing curve.', inputSchema:{type:'object',required:['id','time'],properties:{id:{type:'string'},time:{type:'number',minimum:0},x:{type:'number'},y:{type:'number'},scale:{type:'number',exclusiveMinimum:0},rotation:{type:'number'},opacity:{type:'number',minimum:0,maximum:100},easing:{type:'string',enum:['linear','ease-in','ease-out','ease-in-out','hold']}},additionalProperties:false} },
 { name:'layers.duplicate', description:'Duplicate an existing unlocked or locked layer with a new ID and optional offset.', inputSchema:{type:'object',required:['id'],properties:{id:{type:'string'},name:{type:'string',maxLength:160},offsetX:{type:'number'},offsetY:{type:'number'},offsetTime:{type:'number',minimum:0}},additionalProperties:false} },
 { name:'layers.reorder', description:'Move a layer to a new zero-based stack index.', inputSchema:{type:'object',required:['id','index'],properties:{id:{type:'string'},index:{type:'integer',minimum:0,maximum:9999}},additionalProperties:false} },
 { name:'project.update_settings', description:'Update project name, width, height, fps or duration.', inputSchema:{type:'object',properties:{name:{type:'string',maxLength:200},width:{type:'number',minimum:16,maximum:16384},height:{type:'number',minimum:16,maximum:16384},fps:{type:'number',minimum:1,maximum:240},duration:{type:'number',exclusiveMinimum:0,maximum:86400}},additionalProperties:false} }
];
async function callTool(name, a) {
  const p = await read(); let changed = false, value;
  switch (name) {
    case 'project.get_summary': {
      const counts = {}; for (const l of p.layers) counts[l.kind] = (counts[l.kind] || 0) + 1;
      value = { projectPath:file, name:p.name, width:p.width, height:p.height, fps:p.fps, duration:p.duration, layerCount:p.layers.length, layersByKind:counts }; break;
    }
    case 'project.validate': validate(p); value = { valid:true, layerCount:p.layers.length, message:'Project structure and layer IDs are valid' }; break;
    case 'layers.list':
      value = p.layers.map(l => { const x = { ...l }; if (!a.includeKeyframes) delete x.keyframes; return x; }); break;
    case 'layers.create': {
      const kind = a.kind; fail(['text','shape','image','video','audio'].includes(kind), 'Unsupported layer kind');
      const l = { id:'agent_' + crypto.randomBytes(6).toString('hex'), name:str(a.name,'name'), kind, color:a.color || '#a78bfa', visible:true, locked:false, start:a.start === undefined ? 0 : num(a.start,'start',0,p.duration), duration:a.duration === undefined ? 8 : num(a.duration,'duration',.01,86400), x:a.x === undefined ? 0 : num(a.x,'x',-100000,100000), y:a.y === undefined ? 0 : num(a.y,'y',-100000,100000), scale:1, rotation:0, opacity:100, volume:100, muted:false, effects:[], keyframes:[{time:a.start === undefined ? 0 : a.start,x:a.x === undefined ? 0 : a.x,y:a.y === undefined ? 0 : a.y,scale:1,rotation:0,opacity:100}] };
      if (a.color !== undefined) fail(/^#[0-9a-fA-F]{6}$/.test(a.color), 'Invalid hex color');
      if (a.text !== undefined) l.text = str(a.text,'text',10000); else if (kind === 'text') l.text = 'New text';
      p.layers.push(l); value = l; changed = true; break;
    }
    case 'layers.update': {
      const l = layer(p,str(a.id,'id',100)); fail(a.patch && typeof a.patch === 'object' && !Array.isArray(a.patch), 'patch must be an object');
      const allowed = new Set(['name','color','visible','locked','start','duration','x','y','scale','rotation','opacity','volume','muted','audioFadeIn','audioFadeOut','text','transitionIn','transitionOut','mask','colorGrade']);
      const entries = Object.entries(a.patch); fail(entries.length > 0, 'patch cannot be empty');
      if (l.locked && !a.unlockFirst && !(entries.length === 1 && a.patch.locked === false)) throw new Error('Layer is locked; unlock it first or pass unlockFirst=true to edit it');
      for (const [k,v] of entries) {
        fail(allowed.has(k), 'Property not allowed: ' + k);
        if (k === 'name') l.name = str(v,k);
        else if (k === 'text') l.text = str(v,k,10000);
        else if (k === 'color') { fail(typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v), 'Invalid color'); l.color = v; }
        else if (k === 'visible' || k === 'locked') { fail(typeof v === 'boolean', k + ' must be boolean'); l[k] = v; }
        else if (k === 'start') l.start = num(v,k,0,p.duration);
        else if (k === 'duration') l.duration = num(v,k,.01,86400);
        else if (k === 'x' || k === 'y') l[k] = num(v,k,-100000,100000);
        else if (k === 'scale') l.scale = num(v,k,.001,1000);
        else if (k === 'rotation') l.rotation = num(v,k,-360000,360000);
        else if (k === 'opacity') l.opacity = num(v,k,0,100);
        else if (k === 'volume') l.volume = num(v,k,0,100);
        else if (k === 'muted') { fail(typeof v === 'boolean', 'muted must be boolean'); l.muted = v; }
        else if (k === 'audioFadeIn' || k === 'audioFadeOut') l[k] = num(v,k,0,30);
        else if (k === 'transitionIn' || k === 'transitionOut') { fail(v && typeof v === 'object' && !Array.isArray(v) && ['none','fade','wipe-left','wipe-right','zoom'].includes(v.type), 'Invalid transition'); num(v.duration,'transition duration',0,Math.min(30,l.duration)); l[k] = { type:v.type, duration:v.duration }; }
        else if (k === 'mask') { fail(v && typeof v === 'object' && !Array.isArray(v) && ['none','rectangle','ellipse'].includes(v.type), 'Invalid mask type'); l.mask = { type:v.type, inset:num(v.inset,'mask inset',0,45) }; }
        else if (k === 'colorGrade') { fail(v && typeof v === 'object' && !Array.isArray(v), 'Invalid color grade'); l.colorGrade = { exposure:num(v.exposure,'exposure',-4,4), contrast:num(v.contrast,'contrast',0,200), saturation:num(v.saturation,'saturation',0,200), temperature:num(v.temperature,'temperature',-100,100), tint:num(v.tint,'tint',-100,100) }; }
      }
      if (a.unlockFirst && a.patch.locked === undefined) l.locked = false;
      changed = true; value = l; break;
    }
    case 'layers.set_effects': {
      const l = layer(p,str(a.id,'id',100)); fail(!l.locked, 'Unlock layer before editing effects');
      fail(Array.isArray(a.effects) && a.effects.length <= 64, 'effects must be an array of at most 64 items');
      const limits = { blur:40, brightness:300, contrast:300, saturate:300, grayscale:100, sepia:100, 'hue-rotate':360, 'drop-shadow':50 };
      const effectIds = new Set();
      l.effects = a.effects.map(e => {
        fail(e && typeof e === 'object' && !Array.isArray(e), 'Invalid effect entry');
        fail(Object.hasOwn(limits,e.type), 'Unsupported effect type: ' + e.type);
        const value = num(e.value,'effect value',0,limits[e.type]);
        const id = e.id === undefined ? 'effect_' + crypto.randomBytes(5).toString('hex') : str(e.id,'effect id',160);
        fail(!effectIds.has(id), 'Duplicate effect ID: ' + id); effectIds.add(id);
        return { id, type:e.type, enabled:e.enabled === undefined ? true : (fail(typeof e.enabled === 'boolean','enabled must be boolean'),e.enabled), value };
      });
      changed = true; value = l.effects; break;
    }
    case 'layers.delete': {
      fail(a.confirm === true, 'Deletion requires confirm=true'); const l = layer(p,str(a.id,'id',100)); fail(!l.locked, 'Unlock layer before deleting');
      p.layers = p.layers.filter(x => x.id !== l.id); value = {deleted:true,id:l.id,name:l.name}; changed = true; break;
    }
    case 'layers.add_keyframe': {
      const l = layer(p,str(a.id,'id',100)); fail(!l.locked, 'Unlock layer before adding keyframes');
      const t = num(a.time,'time',0,p.duration); const frames = Array.isArray(l.keyframes) ? l.keyframes : [];
      const old = frames.find(k => k.time === t) || {x:l.x||0,y:l.y||0,scale:l.scale||1,rotation:l.rotation||0,opacity:l.opacity??100};
      const k = {time:t,x:old.x,y:old.y,scale:old.scale,rotation:old.rotation,opacity:old.opacity,...(old.easing ? {easing:old.easing} : {})};
      for (const prop of ['x','y','scale','rotation','opacity']) if (a[prop] !== undefined) k[prop] = num(a[prop],prop,prop==='scale'?.001:prop==='opacity'?0:-360000,prop==='scale'?1000:prop==='opacity'?100:360000);
      if (a.easing !== undefined) { fail(['linear','ease-in','ease-out','ease-in-out','hold'].includes(a.easing), 'Invalid easing'); k.easing = a.easing; }
      l.keyframes = [...frames.filter(f => f.time !== t),k].sort((x,y)=>x.time-y.time); value = k; changed = true; break;
    }
    case 'layers.duplicate': {
      const source = layer(p,str(a.id,'id',100));
      const copy = JSON.parse(JSON.stringify(source));
      copy.id = 'agent_' + crypto.randomBytes(6).toString('hex');
      copy.name = a.name === undefined ? str(source.name + ' copy','name',160) : str(a.name,'name',160);
      copy.locked = false;
      copy.x = num(source.x + (a.offsetX === undefined ? 24 : num(a.offsetX,'offsetX',-100000,100000)),'x',-100000,100000);
      copy.y = num(source.y + (a.offsetY === undefined ? 24 : num(a.offsetY,'offsetY',-100000,100000)),'y',-100000,100000);
      if (a.offsetTime !== undefined) {
        const offset = num(a.offsetTime,'offsetTime',0,p.duration);
        copy.start = Math.min(p.duration, source.start + offset);
        copy.keyframes = (copy.keyframes || []).map(k => ({...k,time:Math.min(p.duration,k.time+offset)}));
      }
      p.layers.push(copy); value = copy; changed = true; break;
    }
    case 'layers.reorder': {
      const l = layer(p,str(a.id,'id',100));
      fail(Number.isInteger(a.index), 'index must be an integer');
      const index = num(a.index,'index',0,Math.max(0,p.layers.length-1));
      p.layers = p.layers.filter(x => x.id !== l.id);
      p.layers.splice(index,0,l);
      value = {id:l.id,index:p.layers.findIndex(x => x.id === l.id),layerCount:p.layers.length}; changed = true; break;
    }
    case 'project.update_settings': {
      fail(Object.keys(a).length > 0, 'Provide at least one setting');
      for (const [k,v] of Object.entries(a)) {
        if (k === 'name') p.name = str(v,k,200);
        else if (k === 'width') p.width = num(v,k,16,16384);
        else if (k === 'height') p.height = num(v,k,16,16384);
        else if (k === 'fps') p.fps = num(v,k,1,240);
        else if (k === 'duration') p.duration = num(v,k,.1,86400);
        else throw new Error('Unsupported setting: ' + k);
      }
      value = {name:p.name,width:p.width,height:p.height,fps:p.fps,duration:p.duration}; changed = true; break;
    }
    default: throw new Error('Unknown tool: ' + name);
  }
  if (changed) await write(p);
  return {projectPath:file,changed,result:value};
}
function reply(id,result) { process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result}) + '\n'); }
function error(id,code,message) { process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,error:{code,message}}) + '\n'); }
async function handle(m) {
  if (!m || m.jsonrpc !== '2.0' || typeof m.method !== 'string' || m.method.startsWith('notifications/')) return;
  if (m.id === undefined) return;
  try {
    let result;
    switch (m.method) {
      case 'initialize': result = {protocolVersion:m.params?.protocolVersion || '2024-11-05',capabilities:{tools:{listChanged:false},resources:{subscribe:false,listChanged:false},prompts:{listChanged:false}},serverInfo:{name:'motion-studio-mcp',version:'0.5.0'},instructions:'Tools modify one explicitly configured saved Motion Studio project. Inspect and validate before editing. Layer deletion requires confirm=true. This server does not render video.'}; break;
      case 'ping': result = {}; break;
      case 'tools/list': result = {tools}; break;
      case 'tools/call': {
        try { const out = await callTool(m.params?.name,m.params?.arguments || {}); result = {content:[{type:'text',text:JSON.stringify(out,null,2)}],structuredContent:out,isError:false}; }
        catch (e) { result = {content:[{type:'text',text:e.message || 'Tool failed'}],isError:true}; }
        break;
      }
      case 'resources/list': result = {resources:[{uri:'motion-studio://project',name:'Motion Studio project',description:'Configured project data, read-only resource',mimeType:'application/json'}]}; break;
      case 'resources/read': {
        fail(m.params?.uri === 'motion-studio://project','Unknown resource URI'); const p = await read();
        result = {contents:[{uri:'motion-studio://project',mimeType:'application/json',text:JSON.stringify({projectPath:file,...p},null,2)}]}; break;
      }
      case 'prompts/list': result = {prompts:[{name:'create_motion_sequence',description:'Create a project-aware motion sequence through the available tools.',arguments:[{name:'goal',description:'Animation goal and style',required:true}]}]}; break;
      case 'prompts/get': fail(m.params?.name === 'create_motion_sequence','Unknown prompt'); result = {description:'Motion design workflow',messages:[{role:'user',content:{type:'text',text:'Build this motion sequence in the configured Motion Studio project: ' + str(m.params?.arguments?.goal || 'Create a polished short motion sequence','goal',2000) + '. Inspect and validate first, plan layer hierarchy and timing, make small edits, validate again, and report exact changes. Do not claim rendering or video export.'}}]}; break;
      default: error(m.id,-32601,'Method not found: ' + m.method); return;
    }
    reply(m.id,result);
  } catch (e) { error(m.id,-32000,e.message || 'Request failed'); }
}
const rl = readline.createInterface({input:process.stdin,crlfDelay:Infinity});
// Serialize requests so concurrent agent calls cannot overwrite each other's project edits.
let requestQueue = Promise.resolve();
rl.on('line',line=>{
  if (!line.trim()) return;
  let message;
  try { message = JSON.parse(line); }
  catch { process.stderr.write('Ignored malformed JSON-RPC line\n'); return; }
  requestQueue = requestQueue.then(() => handle(message)).catch(error => { process.stderr.write('MCP request queue error: ' + error.message + '\n'); });
});
rl.on('close',()=>{ void requestQueue.finally(()=>process.exit(0)); });
