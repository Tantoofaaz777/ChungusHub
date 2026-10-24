import { seedLegacyMemoryState, seedLegacyEpisode, readLegacyEpisodes } from './test-fixtures';
import { beforeAll, afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeDatabaseFixture } from './test-fixtures';
import { captureScene, resolveScenes, scenePath, sceneHistory, prepareCompaction, type CompactionLevel, type MemoryScene, type SceneMessage } from '../shared/memory-scenes';
let dir: string;
let db: typeof import('./db').serverDb;
beforeAll(async () => {
 dir = mkdtempSync(join(tmpdir(),'chungus-scenes-'));
 process.env.CHUNGUS_DATA_DIR = dir;
 db = (await import('./db')).serverDb;
 db.closeForTests();
});
afterAll(() => { db.closeForTests(); removeDatabaseFixture(dir, 'chungus-scenes-'); });
function fixture() {
 const chatId = crypto.randomUUID();
 db.insertChat({id:chatId,title:'Scene test',createdAt:1,updatedAt:1,rootMessageId:null,activeLeafId:null});
 const messages: (SceneMessage & {chatId:string;createdAt:number})[] = [];
 for (let i = 0; i < 5; i++) {
  const m = {id:crypto.randomUUID(),chatId,parentId:messages.at(-1)?.id ?? null,role:i % 2 ? 'user' as const : 'assistant' as const,content:`Turn ${i}`,createdAt:i+1};
  db.insertMessage(m); messages.push(m);
 }
 db.updateChat({id:chatId,rootMessageId:messages[0].id,activeLeafId:messages.at(-1)!.id});
 return {chatId,messages};
}
function save(chatId:string, messages:SceneMessage[], extra:Partial<MemoryScene> = {}) {
 return db.saveMemoryScene({chatId,title:'A scene',content:'A concise summary',source:captureScene(messages),...extra});
}
describe('scene memory persistence', () => {
 test('save and remove only affect summaries, and the RPC exposes the new methods', async () => {
  const {chatId,messages} = fixture();
  const before = db.getMessagesByChat(chatId);
  const saved = save(chatId,messages.slice(1,3));
  expect(db.getMemoryScenes(chatId)).toEqual([saved]);
  expect(db.getMessagesByChat(chatId)).toEqual(before);
  db.deleteMemoryScene(chatId,saved.id,saved.revision);
  expect(db.getMemoryScenes(chatId)).toEqual([]);
  expect(db.getMessagesByChat(chatId)).toEqual(before);
  const {ALLOWED_DB_METHODS} = await import('./db');
  for(const name of ['getMemoryScenes','saveMemoryScene','deleteMemoryScene']) expect(ALLOWED_DB_METHODS.has(name)).toBe(true);
 });
 test('overlap, repeated ids, gaps, foreign rows and stale source snapshots are rejected', () => {
  const {chatId,messages} = fixture();
  save(chatId,messages.slice(1,3));
  expect(() => save(chatId,messages.slice(2,4))).toThrow(/overlaps/);
  expect(() => save(chatId,[messages[3],messages[3]])).toThrow(/range changed/);
  expect(() => save(chatId,[messages[0],messages[3]])).toThrow(/range changed/);
  expect(() => save(chatId,[fixture().messages[0]])).toThrow(/deleted/);
  const stale = captureScene([messages[4]]);
  db.updateMessageContent(messages[4].id,'Changed while generating');
  expect(() => db.saveMemoryScene({chatId,title:'Stale',content:'Old summary',source:stale})).toThrow(/changed/);
  expect(db.getMemoryScenes(chatId)).toHaveLength(1);
 });
 test('revision checks prevent stale edits and deletes across devices', () => {
  const {chatId,messages} = fixture();
  const saved = save(chatId,messages.slice(1,3));
  const edited = db.saveMemoryScene({id:saved.id,chatId,title:saved.title,content:'Reviewed',source:saved.source,expectedRevision:1});
  expect(edited.revision).toBe(2);
  expect(() => db.saveMemoryScene({id:saved.id,chatId,title:saved.title,content:'Stale',source:saved.source,expectedRevision:1})).toThrow(/another device/);
  expect(() => db.deleteMemoryScene(chatId,saved.id,1)).toThrow(/changed/);
  expect(db.getMemoryScenes(chatId)[0].content).toBe('Reviewed');
 });
 test('editing, hiding and deleting sources preserves summary text for review', () => {
  for(const change of ['edit','hide','delete']) {
   const {chatId,messages} = fixture(); const saved = save(chatId,messages.slice(1,3));
   if(change === 'edit') db.updateMessageContent(messages[1].id,'Edited');
   if(change === 'hide') db.setMessageExcludedFromPrompt(messages[1].id,true);
   if(change === 'delete') db.deleteMessageOnly(messages[1].id);
   const all = db.getMessagesByChat(chatId) as SceneMessage[];
   const current = scenePath(all,messages.at(-1)!.id);
   expect(resolveScenes(db.getMemoryScenes(chatId),current,all)[0].status).toBe('review');
   expect(db.getMemoryScenes(chatId)[0].content).toBe(saved.content);
  }
 });
 test('copies source ids without losing validity, and story-only copies omit summaries', () => {
  const {chatId,messages} = fixture(); save(chatId,messages.slice(1,3));
  expect(db.getChatMemoryFootprint(chatId).episodes).toBe(1);
  const copyId = db.duplicateChat({chatId,title:'Copy',includeMemory:true});
  const scenes = db.getMemoryScenes(copyId);
  const all = db.getMessagesByChat(copyId) as SceneMessage[];
  const chat = db.getChat(copyId) as {activeLeafId:string};
  expect(scenes).toHaveLength(1);
  expect(scenes[0].source.every((s) => !messages.some((m) => m.id === s.id))).toBe(true);
  expect(resolveScenes(scenes,scenePath(all,chat.activeLeafId),all)[0].status).toBe('active');
  const bare = db.duplicateChat({chatId,title:'Bare',includeMemory:false});
  expect(db.getMemoryScenes(bare)).toEqual([]);
 });
 test('imports legacy text once, retaining old rows, and flags disabled memory for review', () => {
  for(const enabled of [true,false]) {
   const {chatId,messages} = fixture();
   seedLegacyMemoryState(db, chatId, {enabled});
   seedLegacyEpisode(db, chatId, {content:'Existing memory',sourceMessageIds:messages.slice(0,2).map((m) => m.id),anchorMessageId:messages[1].id});
   const scenes = db.getMemoryScenes(chatId);
   expect(scenes).toHaveLength(1);
   expect(scenes[0].content).toBe('Existing memory');
   expect(resolveScenes(scenes,messages)[0].status).toBe(enabled ? 'active' : 'review');
   expect(db.getMemoryScenes(chatId)).toEqual(scenes);
   expect(readLegacyEpisodes(db, chatId)).toHaveLength(1);
  }
 });
});


test('malformed legacy source data preserves its text for review and does not block duplication', () => {
 const {chatId} = fixture();
 seedLegacyMemoryState(db, chatId, {enabled:true});
 db.execute('INSERT INTO memory_episodes (id, chat_id, layer, content, source_message_ids, anchor_message_id, created_at) VALUES (?, ?, 0, ?, ?, NULL, 1)',[crypto.randomUUID(),chatId,'Preserve this memory','{invalid']);
 const scenes = db.getMemoryScenes(chatId);
 expect(scenes[0].content).toBe('Preserve this memory');
 expect(scenes[0].reviewReason).toBeTruthy();
 const copyId = db.duplicateChat({chatId,title:'Preserved',includeMemory:true});
 expect(db.getMemoryScenes(copyId)[0].content).toBe('Preserve this memory');
});

function hierarchyFixture() {
 const {chatId, messages} = fixture();
 const chapters = messages.slice(0,4).map((m,i) => save(chatId,[m],{title:`Chapter ${i+1}`}));
 const compact = (level:CompactionLevel, selected:MemoryScene[], extra:Partial<MemoryScene> = {}) => db.saveMemoryScene({chatId,level,title:`A ${level}`,content:`${level} summary`,
  ...prepareCompaction(level,selected.map(s => s.id),db.getMemoryScenes(chatId),messages),...extra});
 const arcs = [compact('arc',chapters.slice(0,2)),compact('arc',chapters.slice(2))];
 const volume = compact('volume',arcs);
 return {chatId,messages,chapters,arcs,volume,compact};
}

describe('arc and volume persistence', () => {
 test('stores all three levels and replaces their source range only once', () => {
  const {chatId,messages,volume} = hierarchyFixture();
  const rows = db.getMemoryScenes(chatId);
  expect(rows).toHaveLength(7);
  expect(rows.find(s => s.id === volume.id)?.children).toHaveLength(2);
  expect(sceneHistory(messages,rows).map(m => m.id)).toEqual([`scene:${volume.id}`,messages[4].id]);
  expect(db.getMessagesByChat(chatId)).toHaveLength(5);
 });
 test('edits to covered chapters require review of their arc and volume, preserving all text', () => {
  const {chatId,messages,chapters,arcs,volume} = hierarchyFixture();
  const c = chapters[0];
  db.saveMemoryScene({...c, content:'Revised chapter',expectedRevision:c.revision});
  const rows = db.getMemoryScenes(chatId), states = resolveScenes(rows,messages);
  expect(states.find(r => r.scene.id === arcs[0].id)?.status).toBe('review');
  expect(states.find(r => r.scene.id === volume.id)?.status).toBe('review');
  expect(rows.find(s => s.id === volume.id)?.content).toBe(volume.content);
  expect(sceneHistory(messages,rows).map(m => m.id)).toEqual([`scene:${c.id}`,`scene:${chapters[1].id}`,`scene:${arcs[1].id}`,messages[4].id]);
 });
 test('removing a parent restores its sources without deleting any child memory', () => {
  const {chatId,messages,arcs,volume} = hierarchyFixture();
  db.deleteMemoryScene(chatId,volume.id,volume.revision);
  expect(db.getMemoryScenes(chatId)).toHaveLength(6);
  expect(sceneHistory(messages,db.getMemoryScenes(chatId)).map(m => m.id)).toEqual([`scene:${arcs[0].id}`,`scene:${arcs[1].id}`,messages[4].id]);
 });
 test('stale child revisions, malformed hierarchy and second parents are refused transactionally', () => {
  const {chatId,messages,chapters,arcs,volume} = hierarchyFixture();
  const original = db.getMemoryScenes(chatId);
  expect(() => db.saveMemoryScene({...arcs[0],id:undefined,expectedRevision:undefined})).toThrow('overlaps');
  expect(() => db.saveMemoryScene({...volume,id:undefined,children:chapters.slice(0,2).map(c => ({id:c.id,revision:c.revision}))})).toThrow('source memory');
  expect(() => db.saveMemoryScene({...arcs[0],expectedRevision:arcs[0].revision,children:arcs[0].children!.map(c => ({...c,revision:99}))})).toThrow('source memory');
  expect(() => db.saveMemoryScene({...chapters[0],level:'volume',expectedRevision:chapters[0].revision})).toThrow('level');
  expect(db.getMemoryScenes(chatId)).toEqual(original);
  expect(sceneHistory(messages,original)[0].id).toBe(`scene:${volume.id}`);
 });
 test('chat duplication remaps message and child ids throughout the hierarchy', () => {
  const {chatId} = hierarchyFixture();
  const original = db.getMemoryScenes(chatId);
  const copyId = db.duplicateChat({chatId,title:'Hierarchy copy',includeMemory:true});
  const copies = db.getMemoryScenes(copyId);
  const all = db.getMessagesByChat(copyId) as SceneMessage[];
  const chat = db.getChat(copyId) as {activeLeafId:string};
  expect(copies).toHaveLength(7);
  expect(copies.every(s => !original.some(o => o.id === s.id))).toBe(true);
  expect(copies.every(s => (s.children ?? []).every(c => copies.some(other => other.id === c.id && other.revision === c.revision)))).toBe(true);
  expect(resolveScenes(copies,scenePath(all,chat.activeLeafId),all).filter(r => r.status === 'active').map(r => r.scene.level)).toEqual(['volume']);
 });
 test('duplication keeps stale parents stale even though copied revisions restart at one', () => {
  const {chatId,chapters} = hierarchyFixture();
  db.saveMemoryScene({...chapters[0],content:'Edited later',expectedRevision:1});
  const copyId = db.duplicateChat({chatId,title:'Stale hierarchy copy',includeMemory:true});
  const copies = db.getMemoryScenes(copyId);
  const all = db.getMessagesByChat(copyId) as SceneMessage[];
  const chat = db.getChat(copyId) as {activeLeafId:string};
  const states = resolveScenes(copies,scenePath(all,chat.activeLeafId),all);
  expect(states.find(r => r.scene.level === 'volume')?.status).toBe('review');
  expect(states.filter(r => r.scene.level === 'arc' && r.status === 'review')).toHaveLength(1);
 });
 test('old chapter rows receive the chapter level and no child references', () => {
  const {chatId,messages} = fixture();
  const c = save(chatId,messages.slice(0,2));
  expect(db.getMemoryScenes(chatId)[0].level).toBe('chapter');
  expect(c.children).toEqual([]);
 });
});
