import { beforeAll, afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureScene, resolveScenes, scenePath, type MemoryScene, type SceneMessage } from '../shared/memory-scenes';
let dir: string;
let db: typeof import('./db').serverDb;
beforeAll(async () => {
 dir = mkdtempSync(join(tmpdir(),'chungus-scenes-'));
 process.env.CHUNGUS_DATA_DIR = dir;
 db = (await import('./db')).serverDb;
 db.closeForTests();
});
afterAll(() => { db.closeForTests(); rmSync(dir,{recursive:true,force:true}); });
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
   db.memSetState(chatId,{enabled});
   db.memApplyBatch(chatId,{supersedeEpisodeIds:[],episode:{content:'Existing memory',sourceMessageIds:messages.slice(0,2).map((m) => m.id),anchorMessageId:messages[1].id}});
   const scenes = db.getMemoryScenes(chatId);
   expect(scenes).toHaveLength(1);
   expect(scenes[0].content).toBe('Existing memory');
   expect(resolveScenes(scenes,messages)[0].status).toBe(enabled ? 'active' : 'review');
   expect(db.getMemoryScenes(chatId)).toEqual(scenes);
   expect(db.memListEpisodes(chatId)).toHaveLength(1);
  }
 });
});


test('malformed legacy source data preserves its text for review and does not block duplication', () => {
 const {chatId} = fixture();
 db.memSetState(chatId,{enabled:true});
 db.execute('INSERT INTO memory_episodes (id, chat_id, layer, content, source_message_ids, anchor_message_id, created_at) VALUES (?, ?, 0, ?, ?, NULL, 1)',[crypto.randomUUID(),chatId,'Preserve this memory','{invalid']);
 const scenes = db.getMemoryScenes(chatId);
 expect(scenes[0].content).toBe('Preserve this memory');
 expect(scenes[0].reviewReason).toBeTruthy();
 const copyId = db.duplicateChat({chatId,title:'Preserved',includeMemory:true});
 expect(db.getMemoryScenes(copyId)[0].content).toBe('Preserve this memory');
});
