import { describe, expect, test } from 'bun:test';
import { chapterTitle, captureScene, resolveScenes, sceneHistory, scenePath, type MemoryScene, type SceneMessage } from './memory-scenes';
const path: SceneMessage[] = [
 { id:'a', parentId:null, role:'assistant', content:'Before' },
 { id:'b', parentId:'a', role:'user', content:'We visit the library.' },
 { id:'c', parentId:'b', role:'assistant', content:'We find a secret letter.' },
 { id:'d', parentId:'c', role:'user', content:'After' }
];
const scene = (range = path.slice(1,3), extra: Partial<MemoryScene> = {}): MemoryScene => ({
 id:'s', chatId:'chat', title:'The letter', content:'They found a letter in the library.', source:captureScene(range),
 createdAt:1, updatedAt:1, revision:1, reviewReason:null, ...extra
});
describe('manual scene replacement', () => {
 test('replaces a middle scene in place while preserving the original rows', () => {
  const original = JSON.stringify(path);
  const history = sceneHistory(path, [scene()]);
  expect(history.map((m) => m.id)).toEqual(['a','scene:s','d']);
  expect(history[1].role).toBe('system');
  expect(history[1].content).toContain('They found a letter');
  expect(JSON.stringify(path)).toBe(original);
  expect(sceneHistory(path, [])).toEqual(path);
 });
 test('single-turn scenes and adjacent ranges are independent', () => {
  const a = scene([path[1]]), b = scene([path[2]], { id:'other' });
  expect(resolveScenes([a,b],path).map((r) => r.status)).toEqual(['active','active']);
  expect(sceneHistory(path,[a,b]).map((m) => m.id)).toEqual(['a','scene:s','scene:other','d']);
 });
 test.each(['content', 'excludedFromPrompt', 'attachments'] as const)('a source %s change preserves the summary for review and restores source messages', (field) => {
  const changed = path.map((m) => ({...m}));
  if(field === 'content') changed[1].content = 'Changed';
  if(field === 'excludedFromPrompt') changed[1].excludedFromPrompt = true;
  if(field === 'attachments') changed[1].attachments = [{kind:'image',path:'new.png'}];
  expect(resolveScenes([scene()],changed)[0].status).toBe('review');
  expect(sceneHistory(changed,[scene()]).some((m) => m.memorySceneId)).toBe(false);
  expect(sceneHistory(changed,[scene()]).some((m) => m.id === 'c')).toBe(true);
 });
 test('deleted source and changed range do not hide remaining messages', () => {
  expect(resolveScenes([scene()],path.filter((m) => m.id !== 'b'))[0].status).toBe('review');
  const inserted: SceneMessage = {id:'new',parentId:'b',role:'user',content:'New turn'};
  expect(resolveScenes([scene()],[...path.slice(0,2),inserted,...path.slice(2)])[0].status).toBe('review');
 });
 test('another swipe does not receive the saved scene; the original swipe still does', () => {
  const swipe: SceneMessage = {...path[2],id:'swipe',content:'We find nothing.'};
  const all = [...path,swipe];
  const branch = scenePath(all,'swipe');
  expect(resolveScenes([scene()],branch,all)[0].status).toBe('other-branch');
  expect(sceneHistory(branch,[scene()])).toEqual(branch);
  expect(resolveScenes([scene()],path,all)[0].status).toBe('active');
 });
 test('overlaps and explicit migration review flags never suppress original messages', () => {
  const overlap = scene(path.slice(2),{id:'second'});
  expect(resolveScenes([scene(),overlap],path).every((r) => r.status === 'review')).toBe(true);
  expect(sceneHistory(path,[scene(),overlap])).toEqual(path);
  expect(sceneHistory(path,[scene(undefined,{reviewReason:'Review imported memory'})])).toEqual(path);
 });
 test('hidden turns are omitted, but visibility changes invalidate an existing scene', () => {
  const hidden = path.map((m) => m.id === 'b' ? {...m,excludedFromPrompt:true} : m);
  const saved = scene(hidden.slice(1,3));
  expect(sceneHistory(hidden,[saved]).map((m) => m.id)).toEqual(['a','scene:s','d']);
  expect(resolveScenes([saved],path)[0].status).toBe('review');
 });
});


test('chapter names preserve custom titles and old stored data while presenting generated scene titles consistently', () => {
 const old = scene(undefined,{title:'Scene 2–3'});
 expect(chapterTitle(old.title)).toBe('Chapter 2–3');
 expect(chapterTitle('Scene 2-3')).toBe('Chapter 2-3');
 expect(chapterTitle('The final scene')).toBe('The final scene');
 expect(chapterTitle('Scene 2–3: a custom title')).toBe('Scene 2–3: a custom title');
 expect(sceneHistory(path,[old])[1].content).toBe('[1st summary]\nThey found a letter in the library.\n[End of summary]');
 expect(old.title).toBe('Scene 2–3');
});

test('roleplay summaries use chronological ordinals without titles, including English ordinal exceptions', () => {
 const messages: SceneMessage[] = Array.from({ length: 31 }, (_, i) => ({
  id: `m${i}`, parentId: i ? `m${i - 1}` : null, role: 'assistant', content: `Message ${i}`
 }));
 const scenes = messages.map((message, i) => scene([message], { id: `s${i}`, title: `Private title ${i}`, content: `Summary body ${i}` }));
 const history = sceneHistory(messages, [...scenes].reverse());
 for (const [index, label] of [[0,'1st'],[1,'2nd'],[2,'3rd'],[3,'4th'],[10,'11th'],[11,'12th'],[12,'13th'],[20,'21st'],[21,'22nd'],[22,'23rd'],[30,'31st']] as const) {
  expect(history[index].content).toBe(`[${label} summary]\nSummary body ${index}\n[End of summary]`);
 }
 expect(history.every(message => message.role === 'system' && !message.content.includes('Private title'))).toBe(true);
 expect(scenes[0].title).toBe('Private title 0');
 // Memories needing review do not consume a number in the active context.
 const reviewed = scenes.map((saved, i) => i === 0 ? { ...saved, reviewReason: 'Review required' } : saved);
 expect(sceneHistory(messages, reviewed)[1].content).toStartWith('[1st summary]');
});
