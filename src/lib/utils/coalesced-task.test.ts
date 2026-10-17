import { describe, expect, test } from 'bun:test';
import { CoalescedTask, type TaskScheduler } from './coalesced-task';

function clock() {
	let now = 0, nextId = 0;
	const jobs = new Map<number, { at: number; run: () => void }>();
	const callbacks: (() => void)[] = [];
	const schedule: TaskScheduler = (run, delay) => {
		const id = ++nextId; jobs.set(id, { at: now + delay, run }); callbacks.push(run);
		return () => { jobs.delete(id); };
	};
	return { schedule, callbacks, advance(ms: number) {
		const end = now + ms;
		while (true) {
			const due = [...jobs].filter(([, job]) => job.at <= end).sort((a,b) => a[1].at - b[1].at)[0];
			if (!due) break;
			now = due[1].at; jobs.delete(due[0]); due[1].run();
		}
		now = end;
	} };
}
describe('coalesced display work', () => {
	test('100 chunks over 200ms publish four complete snapshots rather than 100 partial updates', () => {
		const time=clock(), task=new CoalescedTask(50,time.schedule), shown:string[]=[];
		let raw='';
		for(let i=0;i<100;i++){ raw+='x'; task.queue(()=>shown.push(raw)); time.advance(2); }
		expect(raw).toHaveLength(100);expect(shown.map(text=>text.length)).toEqual([25,50,75,100]);
	});
	test('flush publishes a short final tail immediately and invalidates an already queued callback', () => {
		const time=clock(), task=new CoalescedTask(50,time.schedule), shown:string[]=[];
		task.queue(()=>shown.push('partial response and reasoning'));task.flush();
		expect(shown).toEqual(['partial response and reasoning']);time.callbacks[0]();time.advance(100);
		expect(shown).toHaveLength(1);
	});
	test('cancel prevents old work from publishing into a new generation', () => {
		const time=clock(), task=new CoalescedTask(50,time.schedule), shown:string[]=[];
		task.queue(()=>shown.push('old'));const old=time.callbacks[0];task.cancel();
		task.queue(()=>shown.push('new'));old();time.advance(50);
		expect(shown).toEqual(['new']);
	});
	test('flush is safe when idle and can be followed by another scheduled update', () => {
		const time=clock(),task=new CoalescedTask(50,time.schedule);let calls=0;
		task.flush();task.queue(()=>calls++);task.flush();task.flush();task.queue(()=>calls++);time.advance(50);
		expect(calls).toBe(2);
	});
});
