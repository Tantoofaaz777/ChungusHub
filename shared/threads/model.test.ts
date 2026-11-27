import { describe, test, expect } from 'bun:test';
import { activeThreadsFeed, selectThreadsMessages, threadsPrompt, DEFAULT_THREADS_CONFIG, normalizeThreadsConfig } from './model';
import { emptyAo3Information } from './ao3';
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
	test('story context and audience continuity have independent windows, including zero', () => {
		const previous = [round('1'),round('2'),round('3')];
		const input = {messages:round('4').messages,label:'Newest',previous,notes:'Remember the running joke',ao3:emptyAo3Information(),instructions:'Discuss only',config:{previousRounds:1,fandomThreads:2}};
		const prompt = threadsPrompt(input);
		expect(prompt).toContain('Story 3'); expect(prompt).not.toContain('Story 2');
		expect(prompt).toContain('Reaction 2'); expect(prompt).not.toContain('Reaction 1');
		expect(prompt).toContain('Story 4'); expect(prompt).toContain('Remember the running joke');
		const noContext = threadsPrompt({...input,config:{previousRounds:0,fandomThreads:0}});
		expect(noContext).not.toContain('# Previous context'); expect(noContext).not.toContain('# Fandom continuity');
		expect(noContext).toContain('Story 4');
	});
	test('summary mode counts the current scene and retains cached summaries independently from fandom', () => {
		const previous = [{ ...round('1'), summary: 'First recap' }, round('2'), round('3')];
		const input = { messages: round('4').messages, label: 'Newest', previous, notes: '', ao3: emptyAo3Information(), instructions: 'Discuss',
			config: { previousRounds: 3, summarizeOlderRounds: true, fandomThreads: 1 } };
		const enabled = threadsPrompt(input);
		expect(enabled).toContain('## Episode 1\nSummary:\nFirst recap\n\n## Episode 2\nStory 2');
		expect(enabled).toContain('Reaction 3');
		expect(enabled).not.toContain('Story 1');
		expect(enabled).not.toContain('Reaction 2');
		const disabled = threadsPrompt({ ...input, config: { ...input.config, summarizeOlderRounds: false } });
		expect(disabled).toContain('## Episode 1\nStory 1');
		expect(disabled).not.toContain('First recap');
	});
	test('story sections have episode headings and only message content separated by blank lines', () => {
		const old=round('old');
		old.messages.push({...old.messages[0],id:'reply',role:'user',speaker:'Private persona name',index:25,content:'Old user reply'});
		const current=round('current').messages;
		current.push({...current[0],id:'current-reply',role:'user',speaker:'Private persona name',index:42,content:'Current user reply'});
		const prompt=threadsPrompt({messages:current,label:'Private scene label',previous:[old],notes:'',ao3:emptyAo3Information(),instructions:'Discuss',config:{previousRounds:1,fandomThreads:0}});
		expect(prompt.split('\n\n# Instructions')[0]).toBe('# Previous context\n\n## Episode old\nStory old\n\nOld user reply\n\n# Recent context\n\n## Private scene label\nStory current\n\nCurrent user reply');
	});
	test('only the active feed version reaches audience continuity', () => {
		const r = round('1');
		r.versions.push({id:'alternate',createdAt:2,feed:{...r.versions[0].feed,post:{username:'new',body:'A new theory',score:1}}});
		r.activeVersionId = 'alternate'; expect(activeThreadsFeed(r).post.body).toBe('A new theory');
		const prompt = threadsPrompt({messages:round('2').messages,label:'Next',previous:[r],notes:'',ao3:emptyAo3Information(),instructions:'Discuss',config:DEFAULT_THREADS_CONFIG});
		expect(prompt).toContain('A new theory'); expect(prompt).not.toContain('Reaction 1');
	});
	test('groups matching consecutive episode titles', () => {
		const previous=[round('1'),round('2'),round('3')];
		previous[0].label=previous[1].label='Chapter 1'; previous[2].label='Chapter 2';
		const prompt=threadsPrompt({messages:round('4').messages,label:'Chapter 3',previous,notes:'',ao3:emptyAo3Information(),instructions:'Discuss',config:{previousRounds:3,fandomThreads:0}});
		expect(prompt.split('\n\n# Instructions')[0]).toBe('# Previous context\n\n## Chapter 1\nStory 1\n\nStory 2\n\n## Chapter 2\nStory 3\n\n# Recent context\n\n## Chapter 3\nStory 4');
	});
	test('uses the original untitled range and round fallbacks rather than generated feed titles', () => {
		const old=round('old');old.label='';
		const prompt=threadsPrompt({messages:round('new').messages,label:'',previous:[old],notes:'',ao3:emptyAo3Information(),instructions:'Discuss',config:DEFAULT_THREADS_CONFIG});
		expect(prompt).toContain('# Previous context\n\n## ROUND 1\nStory old');
		expect(prompt).toContain('# Recent context\n\n## CURRENT RANGE\nStory new');
		expect(prompt).toContain('# Fandom continuity\n\n## ROUND 1\n');
		expect(prompt).not.toContain('## Feed old');
	});
	test('normalizes imported limits', () => {
		expect(normalizeThreadsConfig({previousRounds:-5,fandomThreads:Infinity})).toMatchObject({previousRounds:0,fandomThreads:3});
		expect(normalizeThreadsConfig({previousRounds:100,fandomThreads:1.9})).toMatchObject({previousRounds:50,fandomThreads:1});
	});
	test('old token-mode settings use the stored round and feed counts', () => {
		const legacy = { previousMode: 'tokens', previousTokens: 0, previousRounds: 1, fandomMode: 'tokens', fandomTokens: 0, fandomThreads: 0 };
		expect(normalizeThreadsConfig(legacy)).toEqual({ ...DEFAULT_THREADS_CONFIG, previousRounds: 1, fandomThreads: 0 });
		const prompt = threadsPrompt({ messages: round('3').messages, label: 'Now', previous: [round('1'), round('2')], notes: '', ao3: emptyAo3Information(), instructions: 'Discuss', config: legacy });
		expect(prompt).toContain('## Episode 2\nStory 2');
		expect(prompt).not.toContain('Story 1');
		expect(prompt).not.toContain('# Fandom continuity');
		expect(normalizeThreadsConfig(null)).toEqual(DEFAULT_THREADS_CONFIG);
	});

});
