import { describe, test, expect } from 'bun:test';
import { activeThreadsFeed, selectThreadsMessages, threadsPrompt, DEFAULT_THREADS_CONFIG, normalizeThreadsConfig } from './model';
import { emptyAo3Information } from './ao3';
import { renderBlocks } from './prompt';
import type { ThreadsRound } from './types';

const path = Array.from({length:12}, (_,i) => ({ id:String(i+1), content:`Turn ${i+1}`, excludedFromPrompt:i===3 }));
const round = (id:string): ThreadsRound => ({ id, chatId:'chat', createdAt:1, revision:1, label:`Episode ${id}`,
	messages:[{id,index:0,role:'assistant',content:`Story ${id}`,speaker:'Narrator'}], activeVersionId:`v${id}`,
	versions:[{id:`v${id}`,createdAt:1,feed:{title:`Feed ${id}`,post:{username:'reader',body:`Reaction ${id}`,score:10},comments:[]}}] });
describe('Threads selections and prompt boundaries', () => {
	test('sparse selection stays chronological, includes hidden turns and never fills gaps', () => {
		expect(selectThreadsMessages(path,['12','4','1','8'],new Set()).map(m=>m.id)).toEqual(['1','4','8','12']);
		expect(selectThreadsMessages(path,['4'],new Set())[0].excludedFromPrompt).toBe(true);
	});
	test('rejects missing, repeated, empty and already-used messages', () => {
		for (const ids of [[],['1','1'],['gone'],['2']]) expect(()=>selectThreadsMessages(path,ids,new Set(['2']))).toThrow();
	});
	test('story context and audience continuity have independent windows, including zero', async () => {
		const previous = [round('1'),round('2'),round('3')];
		const input = {messages:round('4').messages,label:'Newest',previous,notes:'Remember the running joke',ao3:emptyAo3Information(),instructions:'Discuss only',config:{previousRounds:1,fandomThreads:2}};
		const prompt = await threadsPrompt(input);
		expect(prompt).toContain('Story 3'); expect(prompt).not.toContain('Story 2');
		expect(prompt).toContain('Reaction 2'); expect(prompt).not.toContain('Reaction 1');
		expect(prompt).toContain('Story 4'); expect(prompt).toContain('Remember the running joke');
		const noContext = await threadsPrompt({...input,config:{previousRounds:0,fandomThreads:0}});
		expect(noContext).not.toContain('# PREVIOUS CONTEXT'); expect(noContext).not.toContain('# FANDOM CONTINUITY');
		expect(noContext).toContain('Story 4');
	});
	test('only the active feed version reaches audience continuity', async () => {
		const r = round('1');
		r.versions.push({id:'alternate',createdAt:2,feed:{...r.versions[0].feed,post:{username:'new',body:'A new theory',score:1}}});
		r.activeVersionId = 'alternate'; expect(activeThreadsFeed(r).post.body).toBe('A new theory');
		const prompt = await threadsPrompt({messages:round('2').messages,label:'Next',previous:[r],notes:'',ao3:emptyAo3Information(),instructions:'Discuss',config:DEFAULT_THREADS_CONFIG});
		expect(prompt).toContain('A new theory'); expect(prompt).not.toContain('Reaction 1');
	});
	test('normalizes imported limits', () => {
		expect(normalizeThreadsConfig({previousRounds:-5,fandomThreads:Infinity})).toMatchObject({previousRounds:0,fandomThreads:3});
		expect(normalizeThreadsConfig({previousRounds:100,fandomThreads:1.9})).toMatchObject({previousRounds:50,fandomThreads:1});
	});
	test('token budgets retain newest whole source messages and full active feeds, with framing included', async () => {
		const older=round('old'), latest=round('new');
		latest.messages.push({...latest.messages[0],id:'new-b',index:1,content:'Newest source'});
		const sourceText=`[#2 · Narrator]\nNewest source`;
		const storyBudget=renderBlocks([{label:latest.label,content:sourceText}]).length;
		const {serializeFeedForContinuity}=await import('./feed');
		const fandomBudget=renderBlocks([{label:latest.label,content:serializeFeedForContinuity(activeThreadsFeed(latest))}]).length;
		const recent=round('current').messages;recent[0].content='CURRENT SCENE '.repeat(100);
		const prompt=await threadsPrompt({messages:recent,label:'Now',previous:[older,latest],notes:'Keep notes',ao3:emptyAo3Information(),instructions:'Discuss',
			config:{previousMode:'tokens',previousTokens:storyBudget,fandomMode:'tokens',fandomTokens:fandomBudget},countTokens:text=>text.length});
		expect(prompt).toContain(sourceText);expect(prompt).not.toContain('Story new');expect(prompt).not.toContain('Story old');
		expect(prompt).toContain('Reaction new');expect(prompt).not.toContain('Reaction old');
		expect(prompt).toContain(recent[0].content.trim());expect(prompt).toContain('Keep notes');
	});
	test('tiny and zero token budgets omit whole blocks rather than truncate them', async () => {
		const input={messages:round('current').messages,label:'Now',previous:[round('old')],notes:'',ao3:emptyAo3Information(),instructions:'Discuss',config:{previousMode:'tokens' as const,previousTokens:1,fandomMode:'tokens' as const,fandomTokens:1},countTokens:(text:string)=>text.length};
		const prompt=await threadsPrompt(input);expect(prompt).not.toContain('# PREVIOUS CONTEXT');expect(prompt).not.toContain('# FANDOM CONTINUITY');expect(prompt).toContain('Story current');
		const zero=await threadsPrompt({...input,config:{...input.config,previousTokens:0,fandomTokens:0},countTokens:()=>{throw new Error('A zero budget must not count');}});
		expect(zero).toContain('Story current');
	});
	test('old settings keep count mode, modes retain inactive values, malformed budgets are normalized', () => {
		expect(normalizeThreadsConfig({previousRounds:7,fandomThreads:4})).toEqual({...DEFAULT_THREADS_CONFIG,previousRounds:7,fandomThreads:4});
		expect(normalizeThreadsConfig({previousMode:'tokens',previousRounds:7,previousTokens:100.9,fandomTokens:-3})).toMatchObject({previousMode:'tokens',previousRounds:7,previousTokens:100,fandomTokens:0});
		expect(normalizeThreadsConfig({previousTokens:Infinity,fandomTokens:9000000})).toMatchObject({previousTokens:8000,fandomTokens:2000000});
	});

});
