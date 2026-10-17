import { beforeAll, afterAll, describe, test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyAo3Information } from '../shared/threads/ao3';
import type { ThreadsFeed, ThreadsMessage } from '../shared/threads/types';

let dir:string, db: typeof import('./db').serverDb;
beforeAll(async()=>{dir=mkdtempSync(join(tmpdir(),'chungus-threads-'));process.env.CHUNGUS_DATA_DIR=dir;db=(await import('./db')).serverDb;db.closeForTests();});
afterAll(()=>{db.closeForTests();rmSync(dir,{recursive:true,force:true});});
const feed: ThreadsFeed = {title:'Library discussion',post:{username:'bookworm',body:'That door opening!',score:12},comments:[{username:'reader',body:'Who is there?',score:4,replies:[{username:'theorist',body:'Someone unexpected.',score:2,replies:[]}]}]};
function fixture() {
	const chatId=crypto.randomUUID();
	db.insertChat({id:chatId,title:'Threads test',createdAt:1,updatedAt:1,rootMessageId:null,activeLeafId:null});
	const messages:ThreadsMessage[]=[];
	for(let i=0;i<5;i++) {
		const m:ThreadsMessage={id:crypto.randomUUID(),role:i%2?'user':'assistant',index:i,content:`Turn ${i}`,speaker:i%2?'User':'Character'};
		db.insertMessage({...m,chatId,parentId:messages.at(-1)?.id??null,createdAt:i+1});messages.push(m);
	}
	db.updateChat({id:chatId,rootMessageId:messages[0].id,activeLeafId:messages.at(-1)!.id});
	return {chatId,messages};
}
function save(chatId:string,messages:ThreadsMessage[], id=crypto.randomUUID()) {return db.saveThreadsRound({id,chatId,label:'Chapter one',messages,feed});}
describe('Threads persistence',()=>{
	test('saves sparse and hidden messages without mutating the RP or its activity',()=>{
		const {chatId,messages}=fixture();db.setMessageExcludedFromPrompt(messages[2].id,true);
		const before=db.getMessagesByChat(chatId), chatBefore=db.getChat(chatId);
		const r=save(chatId,[messages[0],messages[2],messages[4]]);
		expect(r.messages.map(m=>m.id)).toEqual([messages[0].id,messages[2].id,messages[4].id]);
		expect(db.getThreadsData(chatId).rounds).toEqual([r]);
		expect(db.getMessagesByChat(chatId)).toEqual(before);expect(db.getChat(chatId)).toEqual(chatBefore);
		db.closeForTests();expect(db.getThreadsData(chatId).rounds[0]).toEqual(r);
	});
	test('prevents overlapping concurrent selections, but retrying the same save is idempotent',()=>{
		const {chatId,messages}=fixture(),id=crypto.randomUUID();
		const r=save(chatId,messages.slice(0,2),id);
		expect(save(chatId,messages.slice(0,2),id)).toEqual(r);
		expect(()=>save(chatId,messages.slice(1,3))).toThrow(/already used/);
		expect(save(chatId,messages.slice(2)).messages).toHaveLength(3);
	});
	test('rejects repeated, reordered, edited, deleted, foreign and cross-branch sources',()=>{
		const {chatId,messages:m}=fixture();
		expect(()=>save(chatId,[m[1],m[1]])).toThrow();
		expect(()=>save(chatId,[m[3],m[0]])).toThrow(/changed/);
		expect(()=>save(chatId,[fixture().messages[0]])).toThrow(/changed/);
		db.updateMessageContent(m[1].id,'Changed');expect(()=>save(chatId,[m[1]])).toThrow(/changed/);
		const alternate={...m[4],id:crypto.randomUUID(),chatId,parentId:m[3].id};db.insertMessage({...alternate,createdAt:10});
		expect(()=>save(chatId,[m[4],alternate])).toThrow(/changed/);
		db.deleteMessageOnly(m[2].id);expect(()=>save(chatId,[m[2]])).toThrow(/changed/);
		expect(db.getThreadsData(chatId).rounds).toHaveLength(0);
	});
	test('version changes check revisions, preserve snapshots and reject late generation after deletion',()=>{
		const {chatId,messages}=fixture(),r=save(chatId,messages);
		const versionId=crypto.randomUUID();const second=db.addThreadsVersion(chatId,r.id,1,versionId,{...feed,title:'Alternate theory'});
		expect(second.messages).toEqual(r.messages);expect(second.versions).toHaveLength(2);
		expect(db.addThreadsVersion(chatId,r.id,1,versionId,feed)).toEqual(second);
		expect(()=>db.setThreadsVersion(chatId,r.id,1,r.activeVersionId)).toThrow(/changed/);
		const selected=db.setThreadsVersion(chatId,r.id,2,r.activeVersionId);expect(selected.activeVersionId).toBe(r.activeVersionId);
		expect(()=>db.deleteThreadsRound(chatId,r.id,2)).toThrow(/changed/);
		db.deleteThreadsRound(chatId,r.id,3);
		expect(()=>db.addThreadsVersion(chatId,r.id,3,crypto.randomUUID(),feed)).toThrow(/removed/);
		expect(save(chatId,messages).messages).toHaveLength(5);
	});
	test('notes are isolated per chat, independent patches do not overwrite each other, chat deletion cascades',()=>{
		const {chatId,messages}=fixture(),other=fixture();
		db.updateThreadsNotes(chatId,{notes:'Recurring readers'});
		db.updateThreadsNotes(chatId,{ao3:{...emptyAo3Information(),enabled:true,relationships:'A/B'}});
		expect(db.getThreadsData(chatId).notes).toBe('Recurring readers');expect(db.getThreadsData(other.chatId).notes).toBe('');
		const r=save(chatId,messages);db.deleteThreadsRound(chatId,r.id,1);expect(db.getThreadsData(chatId).ao3.relationships).toBe('A/B');
		save(chatId,messages);db.deleteChat(chatId);
		expect(db.select<{n:number}[]>('SELECT COUNT(*) AS n FROM threads_rounds WHERE chat_id = ?',[chatId])[0].n).toBe(0);
		expect(db.select<{n:number}[]>('SELECT COUNT(*) AS n FROM threads_notes WHERE chat_id = ?',[chatId])[0].n).toBe(0);
	});
	test('new methods participate in the RPC and live sync',async()=>{
		const {ALLOWED_DB_METHODS,MUTATION_SCOPES}=await import('./db');
		for(const name of ['getThreadsData','saveThreadsRound','addThreadsVersion','setThreadsVersion','deleteThreadsRound','updateThreadsNotes']) expect(ALLOWED_DB_METHODS.has(name)).toBe(true);
		expect(MUTATION_SCOPES.saveThreadsRound).toBe('threads');
	});
	test('duplicates inherit complete scenes, versions, notes and AO3 independently of memory',()=>{
		const {chatId,messages}=fixture();
		const original=save(chatId,[messages[0],messages[2],messages[4]]);
		const version=db.addThreadsVersion(chatId,original.id,1,crypto.randomUUID(),{...feed,title:'Active alternate'});
		db.updateThreadsNotes(chatId,{notes:'A running joke',ao3:{...emptyAo3Information(),enabled:true,title:'The source story'}});
		db.updateMessageContent(messages[2].id,'Revised after the thread');
		const copyId=db.duplicateChat({chatId,title:'Threads copy',includeMemory:false}), copy=db.getThreadsData(copyId);
		expect(copy.rounds).toHaveLength(1);expect(copy.notes).toBe('A running joke');expect(copy.ao3.title).toBe('The source story');
		const inherited=copy.rounds[0], copiedMessages=db.getMessagesByChat(copyId) as {id:string}[];
		expect(inherited.id).not.toBe(original.id);expect(inherited.revision).toBe(1);expect(inherited.versions).toHaveLength(2);
		expect(inherited.versions.find(v=>v.id===inherited.activeVersionId)!.feed.title).toBe('Active alternate');
		expect(inherited.messages.every(m=>copiedMessages.some(c=>c.id===m.id))).toBe(true);
		expect(inherited.messages.some(m=>messages.some(original=>original.id===m.id))).toBe(false);
		expect(inherited.messages[1].content).toBe(messages[2].content);
		db.updateThreadsNotes(copyId,{notes:'Child joke'});db.deleteThreadsRound(copyId,inherited.id,1);
		expect(db.getThreadsData(chatId).notes).toBe('A running joke');expect(db.getThreadsData(chatId).rounds[0]).toEqual(version);
		const secondId=db.duplicateChat({chatId,title:'Another copy',includeMemory:true});expect(db.getThreadsData(secondId).rounds).toHaveLength(1);
	});
	test('forked continuations inherit common scenes and allow divergent scenes without double-counting a prefix',()=>{
		const {chatId,messages}=fixture();const common=save(chatId,[messages[0]]), old=save(chatId,[messages[1],messages[4]]);
		const fork={...messages[3],id:crypto.randomUUID(),content:'New branch',chatId,parentId:messages[2].id};db.insertMessage({...fork,createdAt:10});
		db.updateChatActiveLeaf(chatId,fork.id);
		expect(()=>save(chatId,[messages[1]])).toThrow(/already used/);
		const newScene=save(chatId,[messages[1],fork]);
		const {threadsOnPath}=require('../shared/threads/model');
		expect(threadsOnPath(db.getThreadsData(chatId).rounds,[...messages.slice(0,3),fork]).map((r:any)=>r.id)).toEqual([common.id,newScene.id]);
		expect(threadsOnPath(db.getThreadsData(chatId).rounds,messages).map((r:any)=>r.id)).toEqual([common.id,old.id]);
	});
	test('saving uses the captured branch even if another device changes the active leaf',()=>{
		const {chatId,messages}=fixture();
		const fork={...messages[4],id:crypto.randomUUID(),chatId,parentId:messages[3].id};db.insertMessage({...fork,createdAt:10});
		const saved=db.saveThreadsRound({id:crypto.randomUUID(),chatId,label:'Captured fork',messages:[messages[1],fork],feed,branchLeafId:fork.id});
		expect(saved.messages.at(-1)!.id).toBe(fork.id);
		expect(()=>db.saveThreadsRound({id:crypto.randomUUID(),chatId,label:'Wrong branch',messages:[messages[2],fork],feed,branchLeafId:messages[4].id})).toThrow(/changed/);
	});
	test('copies skip orphaned scenes without partially consuming their surviving sources',()=>{
		const {chatId,messages}=fixture();save(chatId,[messages[0],messages[4]]);db.deleteMessageOnly(messages[4].id);
		const copied=db.duplicateChat({chatId,title:'No orphan',includeMemory:false});expect(db.getThreadsData(copied).rounds).toEqual([]);
	});
});
