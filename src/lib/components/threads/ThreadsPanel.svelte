<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import PillRow from '$lib/components/ui/PillRow.svelte';
	import ExpandableTextarea from '$lib/components/ui/ExpandableTextarea.svelte';
	import Toggle from '$lib/components/ui/Toggle.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import { chatStore } from '$lib/stores/chat.svelte';
	import { uiStore } from '$lib/stores/ui.svelte';
	import { featurePromptsStore } from '$lib/stores/featurePrompts.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { copyText } from '$lib/utils/clipboard';
	import { threadsStore as store } from '$lib/threads/store.svelte';
	import { threadsConfigStore } from '$lib/threads/config.svelte';
	import { activeThreadsFeed } from '$shared/threads/model';
	import { serializeFeedAsPlainText } from '$shared/threads/feed';
	import { AO3_RATINGS, AO3_WARNINGS, AO3_CATEGORIES, AO3_TEXT_FIELDS, type Ao3Information } from '$shared/threads/ao3';
	import type { ThreadsRound } from '$shared/threads/types';
	import ThreadsComment from './ThreadsComment.svelte';
	import ThreadsAuthor from './ThreadsAuthor.svelte';
	import ThreadsEngagement from './ThreadsEngagement.svelte';
	import type { ThreadsComment as Comment } from '$shared/threads/types';
	function totalComments(comments: Comment[]): number { return comments.reduce((n, c) => n + 1 + totalComments(c.replies), 0); }

	let removing = $state<ThreadsRound | null>(null);
	let notesOpen = $state(false);
	let ao3Open = $state(false);
	let touch: { id: string; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null = null;
	let suppressedClick: string | null = null;
	let suppressTimer: ReturnType<typeof setTimeout> | null = null;
	const selected = $derived(new Set(store.selected));
	const currentRoundIds = $derived(new Set(store.previousRounds.map(r => r.id)));
	const storyRoundCount = $derived(Math.min(store.previousRounds.length,threadsConfigStore.value.previousRounds));
	const fandomThreadCount = $derived(Math.min(store.previousRounds.length,threadsConfigStore.value.fandomThreads));
	const chatId = $derived(chatStore.activeChatId);
	$effect(() => { const id = chatId; untrack(() => { void store.load(id); }); });
	function settings() { uiStore.gotoSettingsPage('engines'); uiStore.settingsEngineId = 'threads'; uiStore.openSettings(); }
	function ao3(patch: Partial<Ao3Information>) { store.updateNotes({ ao3: { ...store.ao3, ...patch } }); }
	function clearTouch() {
		if (touch) clearTimeout(touch.timer);
		touch = null;
		if (suppressedClick) { if (suppressTimer) clearTimeout(suppressTimer); suppressTimer = setTimeout(() => suppressedClick = null, 500); }
	}
	function startTouch(event: PointerEvent, id: string) {
		if (event.pointerType !== 'touch' || store.busy) return;
		clearTouch();
		touch = { id, x: event.clientX, y: event.clientY, timer: setTimeout(() => {
			store.toggle(id, true); suppressedClick = id;
		}, 550) };
	}
	function moveTouch(event: PointerEvent) { if (touch && Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > 8) clearTouch(); }
	function select(event: MouseEvent, id: string) {
		if (suppressedClick === id) { suppressedClick = null; return; }
		store.toggle(id, event.shiftKey);
	}
	onDestroy(() => { clearTouch(); if (suppressTimer) clearTimeout(suppressTimer); void store.flushNotes().catch(() => {}); });
	async function copy(round: ThreadsRound) {
		try { await copyText(serializeFeedAsPlainText(activeThreadsFeed(round))); toastStore.success('Thread copied.'); }
		catch (error) { toastStore.failed('copy the thread', error); }
	}
	function swipe(round: ThreadsRound, direction: -1 | 1) {
		const index = round.versions.findIndex(v => v.id === round.activeVersionId), next = round.versions[index + direction];
		if (next) void store.chooseVersion(round, next.id);
		else if (direction === 1) void store.generate(round);
	}
</script>

<div class="threads-panel">
	<header class="overlay-header overlay-header--stacked">
		<div class="heading"><h2 class="overlay-title">Threads</h2><button class="icon-btn" title="Threads settings" aria-label="Threads settings" onclick={settings}><Icon name="settings" class="w-4 h-4" /></button></div>
		<div class="overlay-crumb"><span class="overlay-subject">{chatStore.activeChat?.title ?? 'No chat open'}</span></div>
	</header>
	<div class="threads-body panel-scroll">
		{#if !chatId}
			<EmptyState icon="threads" size="sm">Open a chat to make threads.</EmptyState>
		{:else}
			<div class="tabs"><PillRow options={[{value:'feed',label:'Feed'}, {value:'make',label:'Make'}]} current={store.tab} onpick={(value) => store.tab = value as 'feed' | 'make'} label="Threads view" /></div>
			{#if store.error}<div class="error" role="alert">{store.error}{#if !store.loaded}<Button variant="secondary" size="sm" onclick={() => store.load(chatId)}>Retry loading</Button>{/if}</div>{/if}
			{#if store.pending}
				<div class="status" role="status"><span>Thread generated. Save it without making another model call.</span><div class="actions"><Button size="sm" onclick={() => store.saveResult()} disabled={store.busy}>Retry saving</Button><Button variant="ghost" size="sm" disabled={store.busy} onclick={() => {store.pending = null; store.error = '';}}>Discard result</Button></div></div>
			{/if}
			{#if store.busy}<div class="status" role="status"><span>{store.phase === 'generating' ? 'Generating thread…' : 'Saving thread…'}</span>{#if store.phase === 'generating'}<Button variant="secondary" size="sm" onclick={() => store.cancel()}>Cancel</Button>{/if}</div>{/if}
			{#if !store.loaded && !store.error}<p class="muted">Loading threads…</p>
			{:else if store.loaded && store.tab === 'feed'}
				{#if !store.rounds.length}
					<EmptyState icon="threads" title="No threads yet">Select a scene in Make to hear from its fictional audience.
						{#snippet actions()}<Button size="sm" onclick={() => store.tab = 'make'}>Make a thread</Button>{/snippet}
					</EmptyState>
				{:else}
					{#each [...store.rounds].reverse() as round (round.id)}
						{@const feed = activeThreadsFeed(round)}
						{@const versionIndex = round.versions.findIndex(v => v.id === round.activeVersionId)}
						<article class="feed-card">
							<div class="round-info"><span>{round.label || `Thread ${store.rounds.indexOf(round) + 1}`} · {round.messages.length} {round.messages.length === 1 ? 'message' : 'messages'}</span>{#if !currentRoundIds.has(round.id)}<span title="Its full scene is not on the current branch.">Outside this branch</span>{/if}<time datetime={new Date(round.createdAt).toISOString()}>{new Date(round.createdAt).toLocaleDateString()}</time></div>
							<section class="feed-post">
								<ThreadsAuthor username={feed.post.username} op />
								<h3 class="post-title">{feed.title}</h3>
								<p class="post">{feed.post.body}</p>
								<ThreadsEngagement score={feed.post.score} commentCount={totalComments(feed.comments)} />
							</section>
							<div class="comments">{#each feed.comments as comment}<ThreadsComment {comment} />{/each}</div>
							<div class="feed-actions">
								<div class="actions"><button class="icon-btn" aria-label="Copy thread" title="Copy thread" onclick={() => copy(round)}><Icon name="copy" class="w-4 h-4" /></button><button class="icon-btn" disabled={store.busy || !!store.pending || !featurePromptsStore.threadsEnabled || !currentRoundIds.has(round.id)} aria-label="Generate another version" title="Generate another version" onclick={() => store.generate(round)}><Icon name="refresh" class="w-4 h-4" /></button><button class="icon-btn" disabled={store.busy} aria-label="Delete thread" title="Delete thread" onclick={() => removing = round}><Icon name="trash" class="w-4 h-4" /></button></div>
								<div class="actions"><button class="icon-btn" disabled={store.busy || versionIndex === 0} aria-label="Previous thread version" onclick={() => swipe(round,-1)}><Icon name="chevronLeft" class="w-4 h-4" /></button><span class="version">{versionIndex + 1} / {round.versions.length}</span><button class="icon-btn" disabled={store.busy || !!store.pending || (versionIndex === round.versions.length - 1 && (!featurePromptsStore.threadsEnabled || !currentRoundIds.has(round.id)))} aria-label={versionIndex === round.versions.length - 1 ? 'Generate another thread version' : 'Next thread version'} onclick={() => swipe(round,1)}><Icon name="chevronRight" class="w-4 h-4" /></button></div>
							</div>
						</article>
					{/each}
				{/if}
			{:else if store.loaded}
				<section class="make-card">
					<h3>Select a scene</h3>
					<p class="muted">Tap messages to select individually. Shift-click or hold another message to select a range.</p>
					<div class="context">
						<span>Previous context</span><strong>{threadsConfigStore.value.previousMode === 'tokens' ? `${threadsConfigStore.value.previousTokens.toLocaleString()} token budget` : `${storyRoundCount} ${storyRoundCount === 1 ? 'round' : 'rounds'}`}</strong>
						<span>Fandom continuity</span><strong>{threadsConfigStore.value.fandomMode === 'tokens' ? `${threadsConfigStore.value.fandomTokens.toLocaleString()} token budget` : `${fandomThreadCount} ${fandomThreadCount === 1 ? 'thread' : 'threads'}`}</strong>
						<span>Recent context</span><strong>{store.selectedCount} selected</strong>
					</div>
					<label class="field-label" for="threads-label">Episode / chapter <span class="muted">(optional)</span></label>
					<input id="threads-label" class="input-base field" maxlength="200" value={store.label} disabled={store.busy} oninput={(e) => store.label = e.currentTarget.value} />
					<details class="notes-section" bind:open={ao3Open}><summary><Icon name="chevronDown" class="section-chevron w-3.5 h-3.5" aria-hidden="true" /><Icon name="ao3" class="w-4 h-4 shrink-0" aria-hidden="true" /><span>AO3 information</span><span class="section-rule" aria-hidden="true"></span></summary>
						{#if ao3Open}
						<div class="ao3-fields"><Toggle checked={store.ao3.enabled} onchange={(enabled) => ao3({enabled})} label="Use AO3 information" />
							<label class="field-label" for="threads-rating">Rating</label><select id="threads-rating" class="input-base field" value={store.ao3.rating ?? ''} onchange={(e) => ao3({rating: e.currentTarget.value as Ao3Information['rating'] || null})}><option value="">None</option>{#each AO3_RATINGS as rating}<option value={rating}>{rating}</option>{/each}</select>
							<label class="field-label" for="threads-warning">Archive warnings</label><select id="threads-warning" class="input-base field" value={store.ao3.archiveWarnings[0] ?? ''} onchange={(e) => ao3({archiveWarnings: e.currentTarget.value ? [e.currentTarget.value as Ao3Information['archiveWarnings'][number]] : []})}><option value="">None</option>{#each AO3_WARNINGS as warning}<option value={warning}>{warning}</option>{/each}</select>
							<fieldset><legend>Categories</legend><div class="categories">{#each AO3_CATEGORIES as category}<label class="check-row"><input type="checkbox" checked={store.ao3.categories.includes(category)} onchange={(e) => ao3({categories:e.currentTarget.checked ? [...store.ao3.categories,category] : store.ao3.categories.filter(v => v !== category)})} />{category}</label>{/each}</div></fieldset>
							{#each AO3_TEXT_FIELDS as [key,label]}
								<label class="field-label" for={`threads-ao3-${key}`}>{label}</label>
								{#if key === 'summary'}<ExpandableTextarea id={`threads-ao3-${key}`} value={store.ao3[key]} onValueChange={(value) => ao3({[key]:value})} dialogTitle="AO3 summary" rows={3} class="input-base threads-textarea" />{:else}<input id={`threads-ao3-${key}`} class="input-base field" value={store.ao3[key]} oninput={(e) => ao3({[key]:e.currentTarget.value})} />{/if}
							{/each}
						</div>
						{/if}
					</details>
					<details class="notes-section" bind:open={notesOpen}><summary><Icon name="chevronDown" class="section-chevron w-3.5 h-3.5" aria-hidden="true" /><Icon name="users" class="w-3.5 h-3.5 shrink-0" aria-hidden="true" /><span>Fandom Notes</span><span class="section-rule" aria-hidden="true"></span></summary>{#if notesOpen}<label class="sr-only" for="threads-notes">Fandom Notes</label><ExpandableTextarea id="threads-notes" class="input-base threads-textarea" value={store.notes} onValueChange={(notes) => store.updateNotes({notes})} dialogTitle="Fandom Notes" placeholder="Reader expectations, recurring jokes, ships…" rows={4} />{/if}</details>
					{#if store.notesError}<div class="error" role="alert">{store.notesError}<Button variant="secondary" size="sm" onclick={() => store.flushNotes().catch(() => {})}>Retry saving notes</Button></div>{/if}
					{#if !featurePromptsStore.threadsEnabled}<p class="muted">Enable Threads in <button class="text-link" onclick={settings}>Settings → Engines</button> to generate.</p>{/if}
					<div class="message-list" aria-label="Unused messages">
						{#each store.available as message (message.id)}
							<button class="message-row" class:is-selected={selected.has(message.id)} aria-pressed={selected.has(message.id)} disabled={store.busy} onclick={(event) => select(event,message.id)} onpointerdown={(event) => startTouch(event,message.id)} onpointermove={moveTouch} onpointerup={clearTouch} onpointercancel={clearTouch} oncontextmenu={(event) => event.preventDefault()}>
								<span class="check" aria-hidden="true">{#if selected.has(message.id)}<Icon name="check" class="w-3 h-3" />{/if}</span><span class="message-number">#{message.index + 1}</span>
								<span class="message-text"><span class="message-role">{message.role}{#if message.excludedFromPrompt}<span role="img" aria-label="Hidden message" title="Hidden message"><Icon name="eyeOff" class="w-3.5 h-3.5" aria-hidden="true" /></span>{/if}</span><span class="message-preview">{message.content || '(empty message)'}</span></span>
							</button>
						{:else}<p class="muted empty-list">{store.path.length ? 'All messages have been used. Continue the story to select a new scene.' : 'This chat has no messages yet.'}</p>{/each}
					</div>
					<div class="make-actions"><span class="muted">{store.selectedCount} selected</span><Button variant="ghost" size="sm" disabled={store.busy || !store.selected.length} onclick={() => store.clearSelection()}>Clear</Button><Button size="sm" disabled={store.busy || !!store.pending || !store.selectedCount || !featurePromptsStore.threadsEnabled} onclick={() => store.generate()}>Generate thread</Button></div>
				</section>
			{/if}
		{/if}
	</div>
</div>
<ConfirmDialog open={removing !== null} title="Delete thread?" message={`Delete “${removing ? activeThreadsFeed(removing).title : ''}” and all its versions? Its source messages will become available in Make again.`} confirmLabel="Delete thread" variant="danger" destructive onConfirm={() => { const round = removing; removing = null; if (round) void store.remove(round); }} onCancel={() => removing = null} />

<style>
	.threads-panel { font-family:var(--font-ui); display:flex; flex-direction:column; height:100%; min-height:0; }
	.heading { display:grid; grid-template-columns:2rem minmax(0,1fr) 2rem; align-items:center; width:100%; }
	.heading h2 { grid-column:2; text-align:center; }
	.heading > button { grid-column:3; justify-self:end; }
	.threads-body { flex:1; min-height:0; padding:1rem; }
	.tabs { display:flex; justify-content:center; margin-bottom:1.2rem; }
	.feed-card, .make-card { padding:1rem; border:1px solid var(--color-border-subtle); border-radius:var(--radius-lg); background:var(--color-bg-secondary); min-width:0; }
	.feed-card { padding:0; overflow:hidden; }
	.feed-post { padding:1rem; border-bottom:1px solid var(--color-border-subtle); }
	.feed-card + .feed-card { margin-top:1rem; }
	h3 { font-size:1rem; font-weight:650; overflow-wrap:anywhere; }
	.make-card > h3 { font-size:.8rem; text-transform:uppercase; letter-spacing:.06em; margin-bottom:.5rem; }
	.round-info { display:flex; flex-wrap:wrap; align-items:baseline; justify-content:space-between; gap:.5rem; padding:.6rem 1rem; border-bottom:1px solid var(--color-border-subtle); font-size:.67rem; color:var(--color-text-muted); overflow-wrap:anywhere; background:color-mix(in srgb,var(--color-bg-tertiary) 40%,transparent); }
	.post-title { margin:.65rem 0 .5rem; font-size:1.04rem; font-weight:700; line-height:1.35; }
	.post { white-space:pre-wrap; overflow-wrap:anywhere; font-size:.84rem; line-height:1.65; }
	.comments { min-width:0; }
	.feed-actions, .actions, .make-actions { display:flex; align-items:center; gap:.3rem; }
	.feed-actions { justify-content:space-between; flex-wrap:wrap; border-top:1px solid var(--color-border-subtle); padding:.55rem .75rem; background:color-mix(in srgb,var(--color-bg-tertiary) 40%,transparent); }
	.icon-btn { display:inline-flex; align-items:center; justify-content:center; width:2rem; height:2rem; border-radius:var(--radius-md); color:var(--color-text-secondary); flex-shrink:0; }
	.icon-btn:hover { background:var(--color-bg-tertiary); color:var(--color-text-primary); }
	.icon-btn:disabled { opacity:.35; cursor:default; }
	.version { font-size:.72rem; color:var(--color-text-muted); font-variant-numeric:tabular-nums; }
	.muted { font-size:.77rem; line-height:1.6; color:var(--color-text-muted); }
	.context { display:grid; grid-template-columns:1fr auto; gap:.5rem; margin:1rem 0; padding:.8rem; border:1px solid var(--color-border-subtle); border-radius:var(--radius-md); font-size:.72rem; }
	.context > span { color:var(--color-text-muted); }
	.context strong { color:var(--color-accent); font-weight:500; }
	.field-label { display:block; margin-bottom:.35rem; color:var(--color-text-secondary); font-size:.75rem; }
	.field { width:100%; min-width:0; padding:.55rem .65rem; font-size:.8rem; }
	.notes-section { margin:1.25rem 0; }
	.notes-section summary { display:flex; align-items:center; gap:.375rem; padding:.125rem 0; list-style:none; cursor:pointer; font-size:.75rem; color:var(--color-accent); font-weight:600; text-transform:uppercase; letter-spacing:.025em; }
	.notes-section summary::-webkit-details-marker { display:none; }
	.notes-section summary :global(.section-chevron) { flex-shrink:0; transform:rotate(-90deg); transition:transform 150ms; }
	.notes-section[open] summary :global(.section-chevron) { transform:rotate(0); }
	.section-rule { flex:1; min-width:.5rem; border-top:1px solid color-mix(in srgb,var(--color-border-subtle) 70%,transparent); margin-left:.25rem; }
	.notes-section[open] summary { margin-bottom:.8rem; }
	.threads-panel :global(.threads-textarea) { width:100%; min-height:6rem; padding:.65rem; font-size:.8rem; line-height:1.6; }
	.ao3-fields { display:flex; flex-direction:column; gap:.4rem; }
	.ao3-fields .field-label { margin-top:.5rem; margin-bottom:0; }
	fieldset { border:0; min-width:0; margin-top:.5rem; }
	legend { font-size:.74rem; color:var(--color-text-secondary); margin-bottom:.4rem; }
	.check-row { display:flex; align-items:center; gap:.4rem; font-size:.73rem; color:var(--color-text-secondary); padding:.25rem 0; }
	.check-row input { accent-color:var(--color-accent); }
	.categories { display:flex; flex-wrap:wrap; gap:.8rem; }
	.message-list { display:flex; flex-direction:column; gap:.4rem; margin-top:1rem; max-height:52vh; overflow-y:auto; overscroll-behavior:contain; }
	.message-row { display:flex; align-items:center; gap:.65rem; width:100%; text-align:left; padding:.7rem; border:1px solid var(--color-border-subtle); border-radius:var(--radius-md); touch-action:pan-y; min-width:0; }
	.message-row:hover { background:var(--color-bg-tertiary); }
	.message-row.is-selected { border-color:var(--color-accent); background:color-mix(in srgb,var(--color-accent) 8%,var(--color-bg-secondary)); }
	.message-row:disabled { opacity:.6; }
	.check { width:1rem; height:1rem; display:flex; align-items:center; justify-content:center; border:1px solid var(--color-border); border-radius:3px; flex-shrink:0; color:var(--color-accent); }
	.message-number { font-size:.72rem; color:var(--color-text-muted); flex-shrink:0; font-variant-numeric:tabular-nums; }
	.message-text { display:flex; flex-direction:column; gap:.25rem; min-width:0; }
	.message-role { display:flex; align-items:center; gap:.35rem; font-size:.64rem; color:var(--color-text-muted); }
	.message-preview { font-size:.77rem; line-height:1.5; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; line-clamp:2; -webkit-box-orient:vertical; overflow-wrap:anywhere; }
	.make-actions { flex-wrap:wrap; justify-content:flex-end; gap:.5rem; margin-top:1rem; }
	.make-actions > span { margin-right:auto; }
	.empty-list { padding:1rem 0; }
	.error, .status { padding:.75rem; margin-bottom:1rem; border-radius:var(--radius-md); font-size:.78rem; overflow-wrap:anywhere; }
	.error { color:var(--color-error); border:1px solid color-mix(in srgb,var(--color-error) 40%,transparent); display:flex; flex-direction:column; gap:.6rem; }
	.status { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:.7rem; background:var(--color-bg-tertiary); color:var(--color-text-secondary); }
	.text-link { color:var(--color-accent); text-decoration:underline; }
	@media(max-width:480px) { .threads-body { padding:.75rem; } .make-card { padding:.85rem; } .feed-post { padding:.85rem .75rem; } .round-info { padding:.55rem .75rem; } .message-row { gap:.45rem; padding:.65rem .5rem; } }
</style>
