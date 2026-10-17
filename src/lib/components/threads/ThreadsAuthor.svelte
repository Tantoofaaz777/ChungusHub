<script lang="ts">
	/** Initial avatars follow Threadverse's author rows; see architecture/threads.md. */
	let { username, op = false }: { username: string; op?: boolean } = $props();
	const name = $derived(username.replace(/^u\//i, ''));
	const initials = $derived(name.split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0, 2).map(part => [...part][0]).join('').toUpperCase() || '?');
	const hue = $derived.by(() => {
		let hash = 0;
		for (const character of username) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
		return Math.abs(hash) % 360;
	});
</script>

<div class="author-row">
	<span class="avatar" style:--avatar-hue={hue} aria-hidden="true">{initials}</span>
	<span class="username" title={`u/${name}`}>u/{name}</span>
	{#if op}<span class="op" title="Original poster">OP</span>{/if}
</div>

<style>
	.author-row { display:flex; align-items:center; gap:.45rem; min-width:0; }
	.avatar { display:grid; place-items:center; width:1.5rem; height:1.5rem; flex-shrink:0; border-radius:50%; background:hsl(var(--avatar-hue) 45% 33%); color:#fff; font-size:.57rem; font-weight:750; line-height:1; }
	.username { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:.72rem; font-weight:650; color:var(--color-text-primary); }
	.op { flex-shrink:0; font-size:.61rem; font-weight:700; color:var(--color-accent); }
</style>
