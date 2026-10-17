import { afterAll, beforeEach, describe, test, expect, mock } from 'bun:test';
import { emptyAo3Information } from '$shared/threads/ao3';
import type { SaveThreadsRound, ThreadsData, ThreadsRound, ThreadsFeed } from '$shared/threads/types';
import { DEFAULT_THREADS_CONFIG } from '$shared/threads/model';
const identity = <T>(value:T)=>value;
(globalThis as any).$state = Object.assign(identity,{raw:identity,snapshot:structuredClone});
(globalThis as any).$derived = Object.assign(identity,{by:(fn:()=>unknown)=>fn()});
const realDb={...await import('$lib/services/database')};
const realChat={...await import('$lib/stores/chat.svelte')};
const realLlm={...await import('$lib/services/llm/provider')};
const realTokenizer={...await import('$lib/tokenizer')};
afterAll(()=>{
	mock.module('$lib/services/database',()=>realDb);mock.module('$lib/stores/chat.svelte',()=>realChat);
	mock.module('$lib/services/llm/provider',()=>realLlm);mock.module('$lib/tokenizer',()=>realTokenizer);
});
let reads: {chatId:string; resolve:(data:ThreadsData)=>void}[]=[];
let calls: {messages:{content:string}[]; signal:AbortSignal; resolve:(result:{content:string})=>void}[]=[];
let saved:SaveThreadsRound[]=[], failSave=false;
let notesGate: Promise<void> | null = null;
let tokenCalls: { text:string; model:string }[]=[];
const path=Array.from({length:5},(_,i)=>({id:String(i+1),parentId:i ? String(i) : null,role:'assistant',content:`Turn ${i+1}`,excludedFromPrompt:i===1}));
const fakeChat:any={activeChat:{id:'a'},currentChatState:{chat:{id:'a'},activePath:path,allMessages:path}};
const empty=():ThreadsData=>({rounds:[],notes:'',ao3:emptyAo3Information()});
const feed:ThreadsFeed={title:'Discussion',post:{username:'op',body:'A question',score:1},comments:[{username:'reader',body:'A theory',score:2,replies:[{username:'other',body:'Agreed',score:1,replies:[]}]}]};
mock.module('$lib/services/database',()=>({...realDb,db:{
	getThreadsData:(chatId:string)=>new Promise(resolve=>reads.push({chatId,resolve})),
	updateThreadsNotes:async()=>{ await notesGate; },
	saveThreadsRound:async(input:SaveThreadsRound):Promise<ThreadsRound>=>{saved.push(input);if(failSave)throw new Error('Disconnected');return {...input,revision:1,createdAt:1,activeVersionId:'v1',versions:[{id:'v1',createdAt:1,feed:input.feed}]};}
}}));
mock.module('$lib/stores/chat.svelte',()=>({...realChat,chatStore:fakeChat}));
mock.module('$lib/services/llm/provider',()=>({...realLlm,llmService:{modelFor:()=> 'test',getPromptTokenBudget:()=>100000,complete:(_target:unknown,options:any)=>new Promise(resolve=>calls.push({...options,resolve}))}}));
mock.module('$lib/tokenizer',()=>({...realTokenizer,countTokens:(text:string,model:string)=>{tokenCalls.push({text,model});return 100;}}));
const {ThreadsStore}=await import('./store.svelte');
const {threadsConfigStore}=await import('./config.svelte');
let store:InstanceType<typeof ThreadsStore>;
beforeEach(()=>{reads=[];calls=[];saved=[];failSave=false;notesGate=null;tokenCalls=[];threadsConfigStore.value={...DEFAULT_THREADS_CONFIG};fakeChat.activeChat={id:'a'};fakeChat.currentChatState={chat:{id:'a'},activePath:path,allMessages:path};store=new ThreadsStore();});
async function open() {const p=store.load('a');reads.shift()!.resolve(empty());await p;}
async function start() {store.selected=['5','2'];const p=store.generate();for(let i=0;i<100 && !calls.length;i++) await Promise.resolve();return {p};}
function previous():ThreadsRound {return {id:'previous',chatId:'a',label:'Prior scene',revision:1,createdAt:1,messages:[{...path[0],role:'assistant',index:0,speaker:'Narrator'}],activeVersionId:'v1',versions:[{id:'v1',createdAt:1,feed}]};}
describe('Threads generation lifecycle',()=>{
	test('late loads cannot replace the next chat',async()=>{
		const a=store.load('a'),b=store.load('b');reads[1].resolve({...empty(),notes:'B'});await b;reads[0].resolve({...empty(),notes:'A'});await a;
		expect(store.chatId).toBe('b');expect(store.notes).toBe('B');
	});
	test('saving the old chat’s notes cannot suppress loading the next chat’s metadata',async()=>{
		await open();let release!:()=>void;notesGate=new Promise<void>(resolve=>release=resolve);
		store.updateNotes({notes:'A note'});const writing=store.flushNotes();
		const next=store.load('b');reads.shift()!.resolve({...empty(),notes:'B note',ao3:{...emptyAo3Information(),title:'B title'}});await next;
		expect(store.notes).toBe('B note');expect(store.ao3.title).toBe('B title');release();await writing;
	});
	test('returning to a chat during a slow notes save keeps its local edits visible',async()=>{
		await open();let release!:()=>void;notesGate=new Promise<void>(resolve=>release=resolve);
		store.updateNotes({notes:'Latest local note'});const writing=store.flushNotes();
		const b=store.load('b');reads.shift()!.resolve(empty());await b;
		const a=store.load('a');reads.shift()!.resolve({...empty(),notes:'Older stored note'});await a;
		expect(store.notes).toBe('Latest local note');release();await writing;
	});
	test('sparse and hidden selections reach the model and save, unused gaps do not',async()=>{
		await open();const {p}=await start();expect(calls).toHaveLength(1);
		const prompt=calls[0].messages[0].content;expect(prompt).toContain('Turn 2');expect(prompt).toContain('Turn 5');expect(prompt).not.toContain('Turn 3');
		calls[0].resolve({content:JSON.stringify(feed)});await p;
		expect(saved[0].messages.map(m=>m.id)).toEqual(['2','5']);expect(store.rounds).toHaveLength(1);expect(store.selected).toEqual([]);expect(store.tab).toBe('feed');
	});
	test('invalid JSON consumes no messages and preserves selection',async()=>{
		await open();const {p}=await start();calls[0].resolve({content:'not json'});await p;
		expect(saved).toHaveLength(0);expect(store.usedIds.size).toBe(0);expect(store.selected).toEqual(['5','2']);expect(store.error).toContain('JSON');
	});
	test('token continuity uses the engine model and captures the branch at generation time',async()=>{
		await open();store.rounds=[previous()];threadsConfigStore.value={...DEFAULT_THREADS_CONFIG,previousMode:'tokens',fandomMode:'tokens',previousTokens:150,fandomTokens:150};
		const {p}=await start();expect(calls).toHaveLength(1);expect(tokenCalls.length).toBeGreaterThan(2);expect(tokenCalls.every(c=>c.model==='test')).toBe(true);
		expect(calls[0].messages[0].content).toContain('# PREVIOUS CONTEXT');expect(calls[0].messages[0].content).toContain('# FANDOM CONTINUITY');
		calls[0].resolve({content:JSON.stringify(feed)});await p;expect(saved[0].branchLeafId).toBe('5');
	});
	test('cancelling during token-budget assembly never starts a model call',async()=>{
		await open();store.rounds=[previous()];store.selected=['2','5'];threadsConfigStore.value={...DEFAULT_THREADS_CONFIG,previousMode:'tokens'};
		const p=store.generate();for(let i=0;i<100 && !tokenCalls.length;i++)await Promise.resolve();
		expect(tokenCalls.length).toBeGreaterThan(0);store.cancel();await p;expect(calls).toHaveLength(0);expect(saved).toHaveLength(0);
	});
	test('partial scenes on another continuation do not hide shared turns, but a prefix-only overlap is rejected before billing',async()=>{
		await open();const old=previous();old.messages.push({...old.messages[0],id:'old-end'});
		store.rounds=[old];fakeChat.currentChatState.allMessages=[...path,{id:'old-end',parentId:'2'}];
		expect(store.available.some(m=>m.id==='1')).toBe(true);store.selected=['1'];await store.generate();
		expect(calls).toHaveLength(0);expect(store.error).toContain('overlap');
	});
	test('save failures retain the valid feed and retry without another generation',async()=>{
		await open();failSave=true;const {p}=await start();calls[0].resolve({content:JSON.stringify(feed)});await p;
		expect(store.pending).not.toBeNull();expect(store.error).toBe('Disconnected');
		failSave=false;await store.saveResult();expect(calls).toHaveLength(1);expect(saved[0].id).toBe(saved[1].id);expect(store.rounds).toHaveLength(1);expect(store.pending).toBeNull();
	});
	test('cancellation and chat changes ignore even a late successful completion',async()=>{
		for(const switchChat of [false,true]){
			await open();const {p}=await start();const call=calls.at(-1)!;
			if(switchChat){fakeChat.activeChat={id:'b'};fakeChat.currentChatState={chat:{id:'b'},activePath:[]};const next=store.load('b');reads.shift()!.resolve(empty());await next;}else store.cancel();
			expect(call.signal.aborted).toBe(true);call.resolve({content:JSON.stringify(feed)});await p;expect(saved).toHaveLength(0);expect(store.phase).toBe('idle');
			fakeChat.activeChat={id:'a'};fakeChat.currentChatState={chat:{id:'a'},activePath:path,allMessages:path};
		}
	});
});
