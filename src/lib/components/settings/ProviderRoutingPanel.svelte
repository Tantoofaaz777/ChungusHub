<script lang="ts">
	import { untrack } from 'svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Icon from '#lib/components/ui/Icon.svelte';
	import InfoTip from '#lib/components/ui/InfoTip.svelte';
	import Select from '#lib/components/ui/Select.svelte';
	import Toggle from '#lib/components/ui/Toggle.svelte';
	import { llmService } from '#lib/services/llm/provider.ts';
	import { connectionStore } from '#lib/stores/connections.svelte.ts';
	import { failureText } from '#lib/stores/toast.svelte.ts';
	import { QUANTIZATION_LEVELS, isRoutingEmpty, type ModelEndpoint, type RoutingConfig } from '#lib/types/llm.ts';
	import { formatPricePerMillion, formatContext } from '#lib/utils/modelFormat.ts';
	import { toggleRow } from '#lib/actions/toggleRow.ts';

	interface Props {
		/** The connection whose OpenRouter routing (for its single model) is being edited. */
		connectionId: string;
	}

	let { connectionId }: Props = $props();

	const conn = $derived(connectionStore.get(connectionId));
	const model = $derived(conn?.model ?? '');

	type SortMode = NonNullable<RoutingConfig['sort']> | 'off';

	let loading = $state(false);
	let error = $state('');
	let endpoints = $state<ModelEndpoint[]>([]);

	// Editable routing state.
	let order = $state<string[]>([]); // selected provider tags, in priority order
	let ignore = $state<Set<string>>(new Set()); // hard deny-list
	let providerSearch = $state(''); // filter for the available-providers list
	let allowFallbacks = $state(true);
	let requireParameters = $state(false);
	let sort = $state<SortMode>('off');
	let maxPrompt = $state('');
	let maxCompletion = $state('');
	let quantizations = $state<Set<string>>(new Set());
	let dataDeny = $state(false);
	let zdr = $state(false);

	// Sampling-param names the request will actually carry for this model,
	// snapshotted on open. Drives the "honor my sampling settings" live filter.
	let genParamKeys = $state<string[]>([]);

	// The available-provider list is revealed on demand: most users pin nothing,
	// so keeping it folded away keeps the panel calm.
	let showAvailable = $state(false);
	// Browse-only ordering for that list: 'name' (A–Z) | 'cheap' | 'expensive'.
	// Independent of the routing `sort` below; it only helps the user scan.
	let availSort = $state('name');

	const SORTS: { mode: SortMode; label: string }[] = [
		{ mode: 'off', label: 'Off' },
		{ mode: 'price', label: 'Cheapest' },
		{ mode: 'throughput', label: 'Fastest' },
		{ mode: 'latency', label: 'Lowest latency' }
	];

	// One row per provider slug (endpoints can repeat a provider at different quants).
	interface ProviderRow {
		tag: string;
		providerName: string;
		price: number | undefined;
		promptPrice: number | undefined;
		contextLength: number | undefined;
		quants: string[];
		uptime: number | undefined;
		status: number | undefined;
		latencyP50: number | undefined;
		throughputP50: number | undefined;
		/** Union of the supported sampling params across this provider's endpoints. */
		params: Set<string>;
		/** True once any endpoint actually reported its supported params. */
		paramsKnown: boolean;
	}

	const providerRows = $derived.by<ProviderRow[]>(() => {
		const map = new Map<string, ProviderRow>();
		for (const e of endpoints) {
			const existing = map.get(e.tag);
			if (!existing) {
				map.set(e.tag, {
					tag: e.tag,
					providerName: e.providerName,
					price: e.pricing?.completion,
					promptPrice: e.pricing?.prompt,
					contextLength: e.contextLength,
					quants: e.quantization ? [e.quantization] : [],
					uptime: e.uptime,
					status: e.status,
					latencyP50: e.latencyP50,
					throughputP50: e.throughputP50,
					params: new Set(e.supportedParameters ?? []),
					paramsKnown: e.supportedParameters != null
				});
			} else {
				if (e.pricing?.completion != null)
					existing.price = Math.min(existing.price ?? Infinity, e.pricing.completion);
				if (e.pricing?.prompt != null)
					existing.promptPrice = Math.min(existing.promptPrice ?? Infinity, e.pricing.prompt);
				if (e.supportedParameters) {
					for (const p of e.supportedParameters) existing.params.add(p);
					existing.paramsKnown = true;
				}
				if (e.contextLength != null) existing.contextLength = Math.max(existing.contextLength ?? 0, e.contextLength);
				if (e.uptime != null) existing.uptime = Math.max(existing.uptime ?? 0, e.uptime);
				// status: keep the best (0 = ok beats a negative degraded/down value).
				if (e.status != null) existing.status = Math.max(existing.status ?? -Infinity, e.status);
				if (e.latencyP50 != null) existing.latencyP50 = Math.min(existing.latencyP50 ?? Infinity, e.latencyP50);
				if (e.throughputP50 != null) existing.throughputP50 = Math.max(existing.throughputP50 ?? 0, e.throughputP50);
				if (e.quantization && !existing.quants.includes(e.quantization)) existing.quants.push(e.quantization);
			}
		}
		return [...map.values()];
	});

	const selectedRows = $derived(
		order.map((tag) => providerRows.find((r) => r.tag === tag)).filter((r): r is ProviderRow => !!r)
	);
	const blockedRows = $derived(providerRows.filter((r) => ignore.has(r.tag)));
	const availableRows = $derived(providerRows.filter((r) => !order.includes(r.tag) && !ignore.has(r.tag)));

	/**
	 * Why the current routing filters would skip this provider, or null when it
	 * passes. Mirrors the routing the server hands OpenRouter, so the list reacts
	 * live as the user toggles price / quantization / require-parameters, all from
	 * the endpoint data we already hold. The privacy toggles (don't-store-data /
	 * ZDR) aren't mirrored: OpenRouter applies them at request time, and a request
	 * that can't satisfy them simply fails loudly.
	 */
	function disqualifyReason(r: ProviderRow): string | null {
		const maxC = parseFloat(maxCompletion);
		if (Number.isFinite(maxC) && r.price != null && r.price * 1_000_000 > maxC) return 'over max output $';
		const maxP = parseFloat(maxPrompt);
		if (Number.isFinite(maxP) && r.promptPrice != null && r.promptPrice * 1_000_000 > maxP) return 'over max input $';
		if (quantizations.size && r.quants.length && !r.quants.some((q) => quantizations.has(q))) return 'quantization';
		// Only judge param support when the provider actually reported it: an
		// unknown set must never silently hide a usable provider.
		if (requireParameters && r.paramsKnown && !genParamKeys.every((k) => r.params.has(k))) return 'drops a setting';
		return null;
	}

	/** Browse-only ordering for the available list (independent of routing `sort`). */
	function availComparator(a: ProviderRow, b: ProviderRow): number {
		if (availSort === 'cheap') return (a.price ?? Infinity) - (b.price ?? Infinity);
		if (availSort === 'expensive') return (b.price ?? -Infinity) - (a.price ?? -Infinity);
		return a.providerName.localeCompare(b.providerName); // 'name' → A–Z (default)
	}

	// Some models are served by 15+ providers: filter by name, sink the ones the
	// current filters exclude, then order by the chosen browse sort.
	const filteredAvailable = $derived.by(() => {
		const q = providerSearch.trim().toLowerCase();
		const list = q ? availableRows.filter((r) => r.providerName.toLowerCase().includes(q)) : [...availableRows];
		return list.sort((a, b) => {
			const da = disqualifyReason(a) ? 1 : 0;
			const db = disqualifyReason(b) ? 1 : 0;
			if (da !== db) return da - db; // qualifying providers first
			return availComparator(a, b);
		});
	});

	/** Whether any routing setting is active. Gates the Clear-all action. */
	const hasConfig = $derived(
		order.length > 0 ||
			ignore.size > 0 ||
			requireParameters ||
			sort !== 'off' ||
			Number.isFinite(parseFloat(maxPrompt)) ||
			Number.isFinite(parseFloat(maxCompletion)) ||
			quantizations.size > 0 ||
			dataDeny ||
			zdr
	);

	/** Health band from uptime + status: 'ok' | 'warn' | 'down' | null when no data. */
	function healthOf(r: ProviderRow): 'ok' | 'warn' | 'down' | null {
		if (r.status != null && r.status < 0) return 'down';
		if (r.uptime == null) return null;
		if (r.uptime >= 99) return 'ok';
		if (r.uptime >= 95) return 'warn';
		return 'down';
	}

	/** Latency (ms p50) → "120ms" / "1.4s". */
	function latencyLabel(ms: number | undefined): string | null {
		if (ms == null) return null;
		return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
	}

	/** Throughput (tokens/sec p50) → "48 tps". */
	function throughputLabel(tps: number | undefined): string | null {
		if (tps == null) return null;
		return `${Math.round(tps)} tps`;
	}

	let loadToken = 0;

	// (Re)hydrate endpoints + saved config ONLY when the target connection/model changes.
	// The hydration reads `conn.routing`, and our own auto-save writes it back, so the
	// read must be untracked, or every save would re-trigger hydration and flicker the
	// endpoint load forever. Depending on `connectionId` + `model` (value-stable across
	// our saves) is the whole trigger. `loading` is raised first so the auto-save effect
	// treats the hydration as a no-op and never writes the freshly-loaded values back.
	$effect(() => {
		connectionId;
		const m = model;
		if (!m) return;
		const token = ++loadToken;
		loading = true;
		untrack(() => {
			loadConfig();
			loadEndpoints(token);
		});
	});

	// Auto-save: persist the config whenever the editable state changes, so there's no
	// Save button. Debounced to coalesce rapid edits into one write, skipped while
	// hydrating, and it deliberately does NOT read `conn`: reading the connection it
	// writes would loop. The write is idempotent: it no-ops when the routing is unchanged.
	$effect(() => {
		const config = buildConfig();
		if (loading || !connectionId) return;
		const id = setTimeout(() => {
			const current = connectionStore.get(connectionId);
			if (!current) return;
			const next = isRoutingEmpty(config) ? null : config;
			if (JSON.stringify(current.routing ?? null) === JSON.stringify(next)) return;
			connectionStore.update(connectionId, { routing: next });
		}, 300);
		return () => clearTimeout(id);
	});

	function loadConfig(): void {
		const c = conn?.routing ?? null;
		providerSearch = '';
		showAvailable = false;
		availSort = 'name';
		order = c?.order ? [...c.order] : [];
		ignore = new Set(c?.ignore ?? []);
		allowFallbacks = c?.allowFallbacks !== false;
		requireParameters = !!c?.requireParameters;
		sort = c?.sort ?? 'off';
		maxPrompt = c?.maxPrice?.prompt != null ? String(c.maxPrice.prompt) : '';
		maxCompletion = c?.maxPrice?.completion != null ? String(c.maxPrice.completion) : '';
		quantizations = new Set(c?.quantizations ?? []);
		dataDeny = c?.dataCollection === 'deny';
		zdr = !!c?.zdr;
		genParamKeys = requestParamKeys();
	}

	/**
	 * The sampling params the request will actually carry for this model, the
	 * exact set `require_parameters` checks. Sourced from the real request builder
	 * (already filtered by model support) so it never diverges from what we send;
	 * max-tokens and service-tier are dropped since they aren't sampling knobs the
	 * endpoint capability list tracks.
	 */
	function requestParamKeys(): string[] {
		if (!conn) return [];
		return Object.keys(llmService.getGenerationParams(conn, conn.model)).filter(
			(k) => k !== 'max_tokens' && k !== 'max_completion_tokens' && k !== 'service_tier'
		);
	}

	async function loadEndpoints(token: number): Promise<void> {
		if (!conn) return;
		loading = true;
		error = '';
		try {
			const list = await llmService.fetchModelEndpoints(connectionId, conn.provider, conn.model);
			if (token !== loadToken) return;
			endpoints = list;
			if (list.length === 0) {
				error = 'No provider endpoints reported for this model';
			} else {
				// Drop stale pins/blocks for providers that no longer serve this model.
				// Gated on a successful, non-empty load so a fetch failure never wipes config.
				const known = new Set(list.map((e) => e.tag));
				order = order.filter((t) => known.has(t));
				if ([...ignore].some((t) => !known.has(t))) ignore = new Set([...ignore].filter((t) => known.has(t)));
			}
		} catch (e) {
			if (token !== loadToken) return;
			endpoints = [];
			error = failureText('load the provider endpoints', e);
		} finally {
			if (token === loadToken) loading = false;
		}
	}

	function addProvider(tag: string): void {
		if (!order.includes(tag)) order = [...order, tag];
		if (ignore.has(tag)) {
			const next = new Set(ignore);
			next.delete(tag);
			ignore = next;
		}
	}

	function removeProvider(tag: string): void {
		order = order.filter((t) => t !== tag);
	}

	function blockProvider(tag: string): void {
		order = order.filter((t) => t !== tag);
		const next = new Set(ignore);
		next.add(tag);
		ignore = next;
	}

	function unblockProvider(tag: string): void {
		const next = new Set(ignore);
		next.delete(tag);
		ignore = next;
	}

	function move(tag: string, dir: -1 | 1): void {
		const i = order.indexOf(tag);
		const j = i + dir;
		if (i === -1 || j < 0 || j >= order.length) return;
		const next = [...order];
		[next[i], next[j]] = [next[j], next[i]];
		order = next;
	}

	function toggleQuant(q: string): void {
		const next = new Set(quantizations);
		if (next.has(q)) next.delete(q);
		else next.add(q);
		quantizations = next;
	}

	function buildConfig(): RoutingConfig {
		const config: RoutingConfig = {};
		if (order.length) {
			config.order = [...order];
			if (!allowFallbacks) config.allowFallbacks = false;
		}
		if (ignore.size) config.ignore = [...ignore];
		if (requireParameters) config.requireParameters = true;
		if (sort !== 'off') config.sort = sort;
		const mp: { prompt?: number; completion?: number } = {};
		const p = parseFloat(maxPrompt);
		const c = parseFloat(maxCompletion);
		if (Number.isFinite(p)) mp.prompt = p;
		if (Number.isFinite(c)) mp.completion = c;
		if (mp.prompt != null || mp.completion != null) config.maxPrice = mp;
		if (quantizations.size) config.quantizations = [...quantizations];
		if (dataDeny) config.dataCollection = 'deny';
		if (zdr) config.zdr = true;
		return config;
	}

	function resetAll(): void {
		// The auto-save effect picks these up and clears the stored config.
		order = [];
		ignore = new Set();
		allowFallbacks = true;
		requireParameters = false;
		sort = 'off';
		maxPrompt = '';
		maxCompletion = '';
		quantizations = new Set();
		dataDeny = false;
		zdr = false;
		showAvailable = false;
	}

	/** Focus the provider filter the moment the available list is revealed. */
	function autofocus(node: HTMLInputElement): void {
		node.focus();
	}

	/** "$0.18" / "Free" / null: per-1M price for the inline chip; the /M unit lives in the tooltip. */
	function priceShort(perToken: number | undefined): string | null {
		const s = formatPricePerMillion(perToken);
		return s ? s.replace('/M', '') : null;
	}
</script>

<!-- Rendered in place on the Connection → Model page (no dialog shell); this
     heading carries the identity the old dialog title held, plus the model. -->
<div class="routing">
	<div class="routing-head">
		<span class="card-title">Provider Routing</span>
		<span class="routing-model">{model}</span>
	</div>

		{#snippet provBadges(row: ProviderRow)}
			{@const h = healthOf(row)}
			{@const pin = priceShort(row.promptPrice)}
			{@const pout = priceShort(row.price)}
			<div class="prov-badges">
				{#if h}<span class="hdot hdot-{h}" title={h === 'ok' ? 'Healthy' : h === 'warn' ? 'Degraded' : 'Down / unstable'}></span>{/if}
				{#if pin || pout}
					<span class="badge badge-price" title="Price per 1M tokens (input · output)">
						{#if pin}<span class="badge-lbl">in</span>{pin}{/if}{#if pin && pout}<span class="badge-sep">·</span>{/if}{#if pout}<span class="badge-lbl">out</span>{pout}{/if}
					</span>
				{/if}
				{#if formatContext(row.contextLength)}<span class="badge"><span class="badge-lbl">ctx</span>{formatContext(row.contextLength)}</span>{/if}
				{#each row.quants as q (q)}<span class="badge badge-quant">{q}</span>{/each}
				{#if latencyLabel(row.latencyP50)}<span class="badge" title="Latency, time to first token (p50)"><span class="badge-lbl">lat</span>{latencyLabel(row.latencyP50)}</span>{/if}
				{#if throughputLabel(row.throughputP50)}<span class="badge" title="Throughput, p50">{throughputLabel(row.throughputP50)}</span>{/if}
				{#if row.uptime != null}<span class="badge" title="Uptime, last 30m"><span class="badge-lbl">up</span>{row.uptime.toFixed(1)}%</span>{/if}
			</div>
		{/snippet}

		{#if loading}
			<div class="status">Loading provider endpoints…</div>
		{:else}
			{#if error}
				<div class="status error">{error}</div>
			{/if}

			<!-- Providers -->
			<section class="card">
				<span class="card-title">Providers</span>

				<!-- Preferred -->
				<div class="block">
					<div class="block-head">
						<span class="section-label">Preferred</span>
						<InfoTip text="Tried top to bottom, in the order you set with the arrows. Empty lets OpenRouter choose." />
					</div>
					{#if selectedRows.length === 0}
						<div class="empty-pick">No providers pinned, so OpenRouter load-balances across all of them.</div>
					{:else}
						<ul class="picked">
							{#each selectedRows as row, i (row.tag)}
								{@const pinReason = disqualifyReason(row)}
								<li class="picked-row">
									<span class="rank">{i + 1}</span>
									<div class="prov-main">
										<span class="prov-name">
											{row.providerName}
											{#if pinReason}<span class="pin-warn" title="This pin conflicts with your current filters, so OpenRouter will skip it">⚠ {pinReason}</span>{/if}
										</span>
										{@render provBadges(row)}
									</div>
									<div class="row-actions">
										<button type="button" class="icon-act" disabled={i === 0} onclick={() => move(row.tag, -1)} title="Move up">
											<Icon name="chevronUp" class="w-4 h-4" />
										</button>
										<button type="button" class="icon-act" disabled={i === selectedRows.length - 1} onclick={() => move(row.tag, 1)} title="Move down">
											<Icon name="chevronDown" class="w-4 h-4" />
										</button>
										<button type="button" class="icon-act remove" onclick={() => removeProvider(row.tag)} title="Remove">
											<Icon name="close" class="w-4 h-4" />
										</button>
									</div>
								</li>
							{/each}
						</ul>
					{/if}
				</div>

				<!-- Add a provider: one disclosure toggle reveals the searchable list -->
				{#if availableRows.length > 0}
					<div class="block">
						<button
							type="button"
							class="add-toggle"
							onclick={() => (showAvailable = !showAvailable)}
							aria-expanded={showAvailable}
						>
							<Icon name="chevronRight" class="w-4 h-4 add-chev {showAvailable ? 'open' : ''}" strokeWidth={2} />
							<span class="add-toggle-label">Add a provider</span>
							<span class="add-toggle-count">{availableRows.length} available</span>
						</button>

						{#if showAvailable}
							<div class="avail-panel">
								{#if availableRows.length > 6}
									<div class="avail-toolbar">
										<div class="prov-search">
											<Icon name="search" class="prov-search-icon" />
											<input
												class="input-base prov-search-input"
												type="text"
												placeholder="Filter providers…"
												bind:value={providerSearch}
												autocomplete="off"
												spellcheck="false"
												use:autofocus
											/>
										</div>
										<Select variant="compact" bind:value={availSort} aria-label="Sort providers">
											<option value="name">A to Z</option>
											<option value="cheap">Cheapest</option>
											<option value="expensive">Most expensive</option>
										</Select>
									</div>
								{/if}
								{#if filteredAvailable.length === 0}
									<div class="empty-pick">No providers match “{providerSearch}”.</div>
								{:else}
									<ul class="available scrollable">
										{#each filteredAvailable as row (row.tag)}
											{@const reason = disqualifyReason(row)}
											<li class="avail-row" class:dim={!!reason}>
												<div class="prov-main">
													<span class="prov-name">{row.providerName}</span>
													{@render provBadges(row)}
												</div>
												<div class="avail-actions">
													{#if reason}
														<span class="excl-tag" title="Skipped by your current routing filters. Pin it to prefer it anyway">{reason}</span>
													{/if}
													<button type="button" class="add-btn" onclick={() => addProvider(row.tag)}>
														<Icon name="plus" class="w-3.5 h-3.5" strokeWidth={2} /> Add
													</button>
													<button type="button" class="block-btn" onclick={() => blockProvider(row.tag)} title="Never route to this provider">
														<Icon name="close" class="w-3.5 h-3.5" strokeWidth={2} />
													</button>
												</div>
											</li>
										{/each}
									</ul>
								{/if}
							</div>
						{/if}
					</div>
				{/if}

				<!-- Blocked -->
				{#if blockedRows.length > 0}
					<div class="block">
						<div class="block-head">
							<span class="section-label">Blocked</span>
							<InfoTip text="Never route to these, even as a fallback." />
						</div>
						<ul class="available">
							{#each blockedRows as row (row.tag)}
								<li class="avail-row blocked">
									<div class="prov-main">
										<span class="prov-name">{row.providerName}</span>
										{@render provBadges(row)}
									</div>
									<button type="button" class="add-btn" onclick={() => unblockProvider(row.tag)}>
										<Icon name="refresh" class="w-3.5 h-3.5" strokeWidth={2} /> Unblock
									</button>
								</li>
							{/each}
						</ul>
					</div>
				{/if}

				<!-- Fallbacks -->
				{#if order.length > 0}
					<div class="toggle-row" use:toggleRow>
						<div class="tr-text">
							<span class="toggle-label">Allow fallback to other providers</span>
							<span class="toggle-hint">Off = use only the pinned providers, fail if all are down.</span>
						</div>
						<Toggle checked={allowFallbacks} onchange={(v) => (allowFallbacks = v)} label="Allow fallback to other providers" />
					</div>
				{/if}
			</section>

			<!-- Routing -->
			<section class="card">
				<span class="card-title">Routing</span>

				<div class="toggle-row" use:toggleRow>
					<div class="tr-text">
						<span class="toggle-label">Only providers that honor my sampling settings</span>
						<span class="toggle-hint">Skip any provider that would silently drop temperature, top_p, etc.</span>
					</div>
					<Toggle checked={requireParameters} onchange={(v) => (requireParameters = v)} label="Only providers that honor my sampling settings" />
				</div>

				<!-- Auto sort -->
				<div class="block">
					<div class="block-head">
						<span class="section-label">Auto-pick by</span>
						<InfoTip text="Overrides your order and always routes to the cheapest, fastest or lowest-latency provider." />
					</div>
					<div class="segmented">
						{#each SORTS as s (s.mode)}
							<button type="button" class="seg" class:is-active-tint={sort === s.mode} onclick={() => (sort = s.mode)}>
								{s.label}
							</button>
						{/each}
					</div>
				</div>

				<!-- Max price -->
				<div class="block">
					<div class="block-head">
						<span class="section-label">Max price</span>
						<InfoTip text="Skip providers above this price, in USD per million tokens. Blank = no limit." />
					</div>
					<div class="price-inputs">
						<div class="price-field">
							<span class="price-label">Prompt $/M</span>
							<input type="number" min="0" step="0.01" placeholder="∞" bind:value={maxPrompt} class="input-base num" />
						</div>
						<div class="price-field">
							<span class="price-label">Completion $/M</span>
							<input type="number" min="0" step="0.01" placeholder="∞" bind:value={maxCompletion} class="input-base num" />
						</div>
					</div>
				</div>

				<!-- Quantization -->
				<div class="block">
					<div class="block-head">
						<span class="section-label">Quantization</span>
						<InfoTip text="Only route to providers serving these quantization levels. None selected = any." />
					</div>
					<div class="chips">
						{#each QUANTIZATION_LEVELS as q (q)}
							<button type="button" class="chip" class:is-active-tint={quantizations.has(q)} onclick={() => toggleQuant(q)}>
								{q}
							</button>
						{/each}
					</div>
				</div>
			</section>

			<!-- Privacy -->
			<section class="card">
				<span class="card-title">Privacy</span>
				<div class="toggle-row compact" use:toggleRow>
					<span class="toggle-label">Only providers that don't store data</span>
					<Toggle checked={dataDeny} onchange={(v) => (dataDeny = v)} label="Only providers that don't store data" />
				</div>
				<div class="toggle-row compact" use:toggleRow>
					<span class="toggle-label">Require zero-data-retention (ZDR) endpoints</span>
					<Toggle checked={zdr} onchange={(v) => (zdr = v)} label="Require zero-data-retention (ZDR) endpoints" />
				</div>
			</section>
		{/if}

		<div class="footer">
			<Button variant="ghost" size="sm" onclick={resetAll} disabled={!hasConfig}>Clear all routing</Button>
		</div>
</div>

<style>
	.routing {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	.routing-head {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		min-width: 0;
	}

	.routing-model {
		font-family: var(--font-mono);
		font-size: 0.72rem;
		color: var(--color-text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* section.card recipe (app.css) + a local column layout. */
	.card {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	.status {
		padding: 0.7rem;
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-bg-secondary) 70%, transparent);
		font-family: var(--font-ui);
		font-size: 0.8rem;
		color: var(--color-text-muted);
		text-align: center;
	}

	.status.error {
		color: var(--color-error);
		background: color-mix(in srgb, var(--color-error) 10%, transparent);
	}

	.block {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.block-head {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.empty-pick {
		padding: 0.6rem 0.7rem;
		border: 1px dashed color-mix(in srgb, var(--color-border) 70%, transparent);
		border-radius: var(--radius-md);
		font-family: var(--font-ui);
		font-size: 0.76rem;
		color: var(--color-text-muted);
	}

	.picked,
	.available {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.available.scrollable {
		max-height: 16rem;
		overflow-y: auto;
		padding-right: 0.2rem;
	}

	.avail-toolbar {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.prov-search {
		position: relative;
		display: flex;
		align-items: center;
		flex: 1;
		min-width: 0;
	}

	.prov-search :global(.prov-search-icon) {
		position: absolute;
		left: 0.6rem;
		width: 0.9rem;
		height: 0.9rem;
		color: var(--color-text-muted);
		pointer-events: none;
	}

	.prov-search-input {
		width: 100%;
		padding: 0.4rem 0.6rem 0.4rem 1.9rem;
		font-family: var(--font-ui);
		font-size: 0.78rem;
		color: var(--color-text-primary);
	}

	.picked-row,
	.avail-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.5rem 0.6rem;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 60%, transparent);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-bg-secondary) 60%, transparent);
	}

	.picked-row {
		background: color-mix(in srgb, var(--color-accent) 7%, transparent);
		border-color: color-mix(in srgb, var(--color-accent) 30%, transparent);
	}

	.rank {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.3rem;
		height: 1.3rem;
		border-radius: var(--radius-full);
		background: color-mix(in srgb, var(--color-accent) 18%, transparent);
		color: var(--color-accent);
		font-family: var(--font-mono);
		font-size: 0.72rem;
		font-weight: 700;
		flex-shrink: 0;
	}

	.prov-main {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
		flex: 1;
	}

	.prov-name {
		font-family: var(--font-ui);
		font-size: 0.82rem;
		color: var(--color-text-primary);
		font-weight: 500;
	}

	.prov-badges {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem;
	}

	.hdot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: var(--radius-full);
		flex-shrink: 0;
		margin-right: 0.1rem;
	}

	.hdot-ok {
		background: var(--color-success);
		box-shadow: 0 0 7px color-mix(in srgb, var(--color-success) 55%, transparent);
	}

	.hdot-warn {
		background: var(--color-warning);
		box-shadow: 0 0 7px color-mix(in srgb, var(--color-warning) 55%, transparent);
	}

	.hdot-down {
		background: var(--color-error);
		box-shadow: 0 0 7px color-mix(in srgb, var(--color-error) 55%, transparent);
	}

	.avail-actions {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		flex-shrink: 0;
	}

	.block-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.7rem;
		height: 1.7rem;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		transition: all 90ms ease;
	}

	.block-btn:hover {
		color: var(--color-error);
		background: color-mix(in srgb, var(--color-error) 12%, transparent);
	}

	.avail-row.blocked {
		opacity: 0.7;
		border-style: dashed;
	}

	.avail-row.dim {
		opacity: 0.5;
	}

	.excl-tag {
		font-family: var(--font-ui);
		font-size: 0.68rem;
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	.pin-warn {
		margin-left: 0.35rem;
		font-family: var(--font-ui);
		font-size: 0.68rem;
		font-weight: 500;
		color: var(--color-warning);
	}

	.avail-panel {
		padding: 0.6rem;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 55%, transparent);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-bg-tertiary) 28%, transparent);
	}

	.add-toggle {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		width: 100%;
		padding: 0.5rem 0.65rem;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 60%, transparent);
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 0.8rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 90ms ease;
	}

	.add-toggle:hover {
		color: var(--color-text-primary);
		border-color: color-mix(in srgb, var(--color-border) 85%, transparent);
		background: color-mix(in srgb, var(--color-bg-tertiary) 30%, transparent);
	}

	.add-toggle :global(.add-chev) {
		color: var(--color-text-muted);
		transition: transform 140ms ease;
	}

	.add-toggle :global(.add-chev.open) {
		transform: rotate(90deg);
	}

	.add-toggle-count {
		margin-left: auto;
		font-family: var(--font-mono);
		font-size: 0.7rem;
		color: var(--color-text-muted);
	}

	.badge {
		display: inline-flex;
		align-items: center;
		gap: 0.22rem;
		padding: 0.08rem 0.35rem;
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--color-bg-tertiary) 70%, transparent);
		color: var(--color-text-secondary);
		font-family: var(--font-mono);
		font-size: 0.64rem;
		font-weight: 500;
		white-space: nowrap;
	}

	/* Muted micro-label inside a badge ("in", "out", "ctx", "lat", "up"). */
	.badge-lbl {
		color: var(--color-text-muted);
		font-size: 0.58rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.badge-sep {
		color: var(--color-text-muted);
	}

	.badge-price {
		color: var(--color-text-secondary);
		background: color-mix(in srgb, var(--color-warning) 14%, transparent);
	}

	.badge-quant {
		text-transform: uppercase;
		letter-spacing: 0.02em;
	}

	.row-actions {
		display: flex;
		align-items: center;
		gap: 0.15rem;
		flex-shrink: 0;
	}

	.icon-act {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.6rem;
		height: 1.6rem;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		transition: all 90ms ease;
	}

	.icon-act:hover:not(:disabled) {
		color: var(--color-text-primary);
		background: color-mix(in srgb, var(--color-bg-tertiary) 70%, transparent);
	}

	.icon-act:disabled {
		opacity: 0.3;
		cursor: default;
	}

	.icon-act.remove:hover:not(:disabled) {
		color: var(--color-error);
		background: color-mix(in srgb, var(--color-error) 12%, transparent);
	}

	.add-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.3rem 0.6rem;
		border: 1px solid color-mix(in srgb, var(--color-border) 75%, transparent);
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 0.74rem;
		font-weight: 500;
		cursor: pointer;
		flex-shrink: 0;
		transition: all 90ms ease;
	}

	.add-btn:hover {
		color: var(--color-accent);
		border-color: color-mix(in srgb, var(--color-accent) 40%, transparent);
		background: color-mix(in srgb, var(--color-accent) 8%, transparent);
	}

	/* This panel's own dialect: rows here are outlined boxes, not bands on a card.
	   They already own their common region, so the shared recipe's edge-to-edge
	   bleed is cancelled: a negative margin would push the border out past the
	   container. The measure cap and the hover tint still apply. */
	.toggle-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		margin-inline: 0;
		padding: 0.6rem 0.7rem;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 60%, transparent);
		border-radius: var(--radius-md);
	}

	.toggle-row.compact {
		padding: 0.45rem 0.5rem;
		border: none;
	}

	.tr-text {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}

	.toggle-label {
		font-family: var(--font-ui);
		font-size: 0.8rem;
		color: var(--color-text-primary);
	}

	.toggle-hint {
		font-family: var(--font-ui);
		font-size: 0.72rem;
		color: var(--color-text-muted);
	}

	.segmented {
		display: flex;
		gap: 0.25rem;
		flex-wrap: wrap;
	}

	.seg {
		padding: 0.35rem 0.7rem;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 0.76rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 90ms ease;
	}

	.seg:hover {
		color: var(--color-text-primary);
	}

	/* Scoped active tint: the canonical .is-active-tint recipe is in a cascade layer,
	   so this unlayered scoped base would otherwise override it. Placed after :hover so
	   the active segment stays tinted while hovered. */
	.seg.is-active-tint {
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 13%, transparent);
		border-color: color-mix(in srgb, var(--color-accent) 33%, transparent);
	}

	.price-inputs {
		display: flex;
		gap: 0.6rem;
	}

	.price-field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		flex: 1;
	}

	.price-label {
		font-family: var(--font-ui);
		font-size: 0.72rem;
		color: var(--color-text-muted);
	}

	.num {
		padding: 0.45rem 0.6rem;
		font-family: var(--font-mono);
		font-size: 0.8rem;
		color: var(--color-text-primary);
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.chip {
		padding: 0.25rem 0.6rem;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
		border-radius: var(--radius-full);
		background: transparent;
		color: var(--color-text-secondary);
		font-family: var(--font-mono);
		font-size: 0.72rem;
		text-transform: uppercase;
		cursor: pointer;
		transition: all 90ms ease;
	}

	.chip:hover {
		color: var(--color-text-primary);
	}

	/* Scoped active tint, same cascade-layer note as .seg above. */
	.chip.is-active-tint {
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 13%, transparent);
		border-color: color-mix(in srgb, var(--color-accent) 33%, transparent);
	}

	.footer {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.6rem;
		padding-top: 0.4rem;
	}
</style>
