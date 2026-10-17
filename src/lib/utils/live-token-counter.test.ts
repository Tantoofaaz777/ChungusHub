import { describe, expect, test } from 'bun:test';
import { LiveTokenCounter } from './live-token-counter';
import type { TaskScheduler } from './coalesced-task';
function fixture() {
	const jobs: (()=>void)[] = [], delays:number[]=[], counts:{text:string;model?:string}[]=[], values:number[]=[];
	const schedule:TaskScheduler=(run,delay)=>{ jobs.push(run);delays.push(delay);return ()=>{}; };
	const counter=new LiveTokenCounter((text,model)=>{counts.push({text,model});return text.length;},value=>values.push(value),schedule);
	return {counter,jobs,delays,counts,values};
}
describe('live token counter',()=>{
	test('rapid streaming input counts only the newest complete text at the 200ms deadline',()=>{
		const f=fixture();
		for(let i=1;i<=100;i++)f.counter.update({enabled:true,text:'x'.repeat(i),model:'assigned-model',streaming:true,identity:'generation'});
		expect(f.counts).toHaveLength(0);expect(f.delays).toEqual([200]);f.jobs[0]();
		expect(f.counts).toEqual([{text:'x'.repeat(100),model:'assigned-model'}]);expect(f.values.at(-1)).toBe(100);
	});
	test('settlement counts the final text immediately and makes a late estimate harmless',()=>{
		const f=fixture();f.counter.update({enabled:true,text:'partial',streaming:true,identity:'gen'});
		f.counter.update({enabled:true,text:'complete response',streaming:false});f.jobs[0]();
		expect(f.counts.map(c=>c.text)).toEqual(['complete response']);expect(f.values.at(-1)).toBe(17);
	});
	test('disabled counters cancel pending work and perform no tokenization',()=>{
		const f=fixture();f.counter.update({enabled:true,text:'reasoning',streaming:true,identity:'gen'});
		f.counter.update({enabled:false});f.jobs[0]();expect(f.counts).toHaveLength(0);expect(f.values.at(-1)).toBe(0);
	});
	test('a new stream resets the estimate and rejects callbacks from the previous stream',()=>{
		const f=fixture();f.counter.update({enabled:true,text:'old',streaming:true,identity:'old'});
		f.counter.update({enabled:true,text:'new response',streaming:true,identity:'new'});
		f.jobs[0]();expect(f.counts).toHaveLength(0);f.jobs[1]();expect(f.counts.map(c=>c.text)).toEqual(['new response']);
	});
	test('destroyed readouts never count or publish pending reasoning',()=>{
		const f=fixture();f.counter.update({enabled:true,text:'thinking',streaming:true,identity:'gen'});
		f.counter.dispose();f.jobs[0]();expect(f.counts).toHaveLength(0);expect(f.values).toEqual([0]);
	});
});
