import { describe, test, expect } from 'bun:test';
import { inheritThreadsRounds } from './inheritance';
import { threadsOnPath, threadsSelectionOverlaps } from './model';
import type { ThreadsRound } from './types';

const makeRound = (id:string, ids:string[]):ThreadsRound => ({id,chatId:'original',label:id,createdAt:10,revision:4,
	messages:ids.map((id,index)=>({id,index,role:'assistant',speaker:'Narrator',content:`Snapshot ${id}`})),
	versions:['a','b'].map(v=>({id:`${id}-${v}`,createdAt:12,feed:{title:`${id}-${v}`,post:{username:'reader',body:'Post',score:1},comments:[{username:'viewer',body:'Comment',score:2,replies:[]}]}})),activeVersionId:`${id}-a`});
describe('Threads inheritance',()=>{
	test('a prefix inherits only complete sparse scenes with new round and version identities',()=>{
		const rounds=[makeRound('complete',['1','3']),makeRound('partial',['2','5'])];
		let id=0;const copied=inheritThreadsRounds(rounds,'copy',new Map([['1','new-1'],['2','new-2'],['3','new-3']]),()=>`id-${++id}`);
		expect(copied).toHaveLength(1);expect(copied[0].chatId).toBe('copy');expect(copied[0].revision).toBe(1);
		expect(copied[0].messages.map(m=>m.id)).toEqual(['new-1','new-3']);expect(copied[0].versions[0].id).toBe(copied[0].activeVersionId);
		expect(copied[0].versions[1].id).not.toBe(rounds[0].versions[1].id);expect(copied[0].createdAt).toBe(rounds[0].createdAt);
		copied[0].versions[0].feed.comments[0].body='Changed';expect(rounds[0].versions[0].feed.comments[0].body).toBe('Comment');
	});
	test('a fork of a copy remaps again without linking back to original rows',()=>{
		let id=0;const factory=()=>`fresh-${++id}`;
		const first=inheritThreadsRounds([makeRound('r',['1','2'])],'b',new Map([['1','b1'],['2','b2']]),factory);
		const second=inheritThreadsRounds(first,'c',new Map([['b1','c1'],['b2','c2']]),factory);
		expect(second[0].messages.map(m=>m.id)).toEqual(['c1','c2']);expect(second[0].activeVersionId).not.toBe(first[0].activeVersionId);
	});
	test('branch continuity inherits the common prefix and excludes partial or foreign scenes',()=>{
		const rounds=[makeRound('common',['1','2']),makeRound('old',['3','4']),makeRound('partial',['2','4']),makeRound('new',['x'])];
		expect(threadsOnPath(rounds,[{id:'1'},{id:'2'},{id:'x'}]).map(r=>r.id)).toEqual(['common','new']);
	});
	test('shared-prefix overlaps are allowed only when both scenes contain divergent branch turns',()=>{
		const old=makeRound('old',['1','3']), all=[{id:'1',parentId:null},{id:'2',parentId:'1'},{id:'3',parentId:'2'},{id:'x',parentId:'2'}];
		const fork=[all[0],all[1],all[3]];
		expect(threadsSelectionOverlaps([old],[{id:'1'},{id:'x'}],fork,all)).toBe(false);
		expect(threadsSelectionOverlaps([old],[{id:'1'}],fork,all)).toBe(true);
		expect(threadsSelectionOverlaps([old],[{id:'1'}],all.slice(0,3),all)).toBe(true);
	});
});
