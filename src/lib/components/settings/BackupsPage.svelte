<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { slide } from 'svelte/transition';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import InfoTip from '$lib/components/ui/InfoTip.svelte';
	import PillRow from '$lib/components/ui/PillRow.svelte';
	import Spinner from '$lib/components/ui/Spinner.svelte';
	import Toggle from '$lib/components/ui/Toggle.svelte';
	import { holdMsForBlast } from '$lib/components/ui/HoldToConfirmButton.svelte';
	import { toggleRow } from '$lib/actions/toggleRow';
	import { backupStore } from '$lib/stores/backups.svelte';
	import { getBackupLoss } from '$lib/services/transport';
	import { toastStore, failureText } from '$lib/stores/toast.svelte';
	import { formatDate, formatRelativeTime } from '$lib/utils/date';
	import { bytes } from '$lib/utils/bytes';
	import { copyText } from '$lib/utils/clipboard';
	import {
		KEEP_SCHEDULED_RANGE,
		KEEP_UPGRADE_RANGE,
		type BackupInterval,
		type SnapshotManifest
	} from '$shared/backups';

	const INTERVALS = [
		{ value: '6', label: 'Every 6 hours' },
		{ value: '24', label: 'Once a day' },
		{ value: '168', label: 'Once a week' }
	];

	/** What each kind is called on a row, and the shade it wears. */
	const KIND_LABEL: Record<SnapshotManifest['kind'], string> = {
		manual: 'By hand',
		scheduled: 'Scheduled',
		preUpgrade: 'Before upgrade',
		preRestore: 'Before restore',
		imported: 'Imported'
	};

	let settings = $derived(backupStore.settings);
	let snapshots = $derived(backupStore.snapshots);
	let job = $derived(backupStore.job);
	let pendingRestoreId = $derived(backupStore.restorePending);

	let label = $state('');
	let busy = $state(false);
	let fileInput: HTMLInputElement;
	let importing = $state(false);
	let exportingId = $state<string | null>(null);
	let pageError = $state('');
	let operationBusy = $derived(busy || importing || exportingId !== null || !!job);

	// Selection is a mode rather than a permanent column: a row of checkboxes on every row
	// makes the common case (read the list, restore one) look like a form to fill in.
	let selecting = $state(false);
	let selected = $state<Set<string>>(new Set());

	let restoreTarget = $state<SnapshotManifest | null>(null);
	let restoreLoss = $state<{ chats: number; messages: number; characters: number } | null>(null);
	let deleteTarget = $state<SnapshotManifest | null>(null);
	let bulkDeleteOpen = $state(false);
	let cancelling = $state(false);

	onMount(() => {
		void backupStore.load().catch((error) => {
			pageError = failureText('load your backups', error);
		});
	});
	onDestroy(() => backupStore.close());

	// A claimed restore freezes the store, so a selection started before the claim landed
	// (possibly on another device) would be a mode full of buttons that can no longer act.
	$effect(() => {
		if (pendingRestoreId && selecting) {
			selecting = false;
			selected = new Set();
		}
	});

	function countLine(s: SnapshotManifest): string {
		const parts: string[] = [];
		if (s.summary.chats) parts.push(`${s.summary.chats} chat${s.summary.chats === 1 ? '' : 's'}`);
		if (s.summary.characters) {
			parts.push(`${s.summary.characters} character${s.summary.characters === 1 ? '' : 's'}`);
		}
		if (s.summary.images) parts.push(`${s.summary.images} image${s.summary.images === 1 ? '' : 's'}`);
		return parts.length ? parts.join(' · ') : 'Empty';
	}

	let totalLine = $derived(
		`${snapshots.length} snapshot${snapshots.length === 1 ? '' : 's'} · ${bytes(backupStore.totalBytes)} on disk`
	);

	/** A snapshot this build is too old to read. Shown as a disabled row rather than hidden:
	 *  it is real, it takes up disk, and pretending otherwise is worse than explaining. */
	function tooNew(s: SnapshotManifest): boolean {
		return backupStore.schemaVersion > 0 && s.schemaVersion > backupStore.schemaVersion;
	}

	async function runBackup(): Promise<void> {
		busy = true;
		pageError = '';
		try {
			await backupStore.snapshotNow(label.trim() || null);
			label = '';
		} catch (error) {
			pageError = failureText('start the backup', error);
		} finally {
			busy = false;
		}
	}

	async function exportBackup(snapshot: SnapshotManifest): Promise<void> {
		exportingId = snapshot.id;
		pageError = '';
		try {
			const download = await backupStore.exportPortable(snapshot.id);
			const link = document.createElement('a');
			link.href = download.url;
			link.download = download.filename;
			link.style.display = 'none';
			document.body.append(link);
			link.click();
			link.remove();
			toastStore.success('Backup download started');
		} catch (error) {
			pageError = failureText('export that backup', error);
		} finally {
			exportingId = null;
		}
	}

	async function importBackup(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		importing = true;
		pageError = '';
		try {
			const manifest = await backupStore.importPortable(file);
			toastStore.success(`Imported backup from ${formatDate(manifest.createdAt)}`);
		} catch (error) {
			pageError = failureText('import that backup', error);
		} finally {
			importing = false;
		}
	}

	function kindLine(snapshot: SnapshotManifest): string {
		if (snapshot.kind !== 'imported' || !snapshot.sourceKind) return KIND_LABEL[snapshot.kind];
		return `${KIND_LABEL.imported} · ${KIND_LABEL[snapshot.sourceKind]}`;
	}

	async function openRestore(s: SnapshotManifest): Promise<void> {
		restoreLoss = null;
		restoreTarget = s;
		try {
			const loss = await getBackupLoss(s.id);
			restoreLoss = { chats: loss.chats, messages: loss.messages, characters: loss.characters };
		} catch {
			// The dialog still opens: it can state the date and what restoring means without
			// the counts, and refusing to open would be a worse answer than an honest gap.
			restoreLoss = null;
		}
	}

	let restoreMessage = $derived.by(() => {
		if (!restoreTarget) return '';
		const when = `${formatDate(restoreTarget.createdAt)}, ${formatRelativeTime(restoreTarget.createdAt).toLowerCase()}`;
		const lost: string[] = [];
		if (restoreLoss) {
			if (restoreLoss.chats) lost.push(`${restoreLoss.chats} chat${restoreLoss.chats === 1 ? '' : 's'}`);
			if (restoreLoss.messages) {
				lost.push(`${restoreLoss.messages} message${restoreLoss.messages === 1 ? '' : 's'}`);
			}
			if (restoreLoss.characters) {
				lost.push(`${restoreLoss.characters} character${restoreLoss.characters === 1 ? '' : 's'}`);
			}
		}
		const loss = lost.length
			? `Everything made since then goes: ${lost.join(', ')}, along with any edits.`
			: 'Every change made since then goes, including edits.';
		// "Settings" is in the list on purpose: connections and every preference live in the
		// database, so they rewind with everything else. Only the password and the device
		// list sit outside the snapshot (architecture/backups.md), and only they may be
		// promised here.
		return `Your chats, characters, lorebooks, presets and settings go back to ${when}. ${loss} Your password and device list are left alone. ChungusHub then has to be closed and started again to apply it.`;
	});

	/** The hold is scaled by what is actually at stake, messages included: a restore that
	 *  costs "one chat" can cost every hour of writing inside it. */
	let restoreHold = $derived(
		holdMsForBlast(
			(restoreLoss?.chats ?? 0) + (restoreLoss?.messages ?? 0) + (restoreLoss?.characters ?? 0)
		)
	);

	async function confirmRestore(): Promise<void> {
		const target = restoreTarget;
		restoreTarget = null;
		if (!target) return;
		try {
			await backupStore.restore(target.id);
		} catch (error) {
			pageError = failureText('start the restore', error);
		}
	}

	async function cancelPending(): Promise<void> {
		cancelling = true;
		try {
			await backupStore.cancelPendingRestore();
		} catch (error) {
			toastStore.failed('cancel the restore', error);
		} finally {
			cancelling = false;
		}
	}

	async function confirmDelete(): Promise<void> {
		const target = deleteTarget;
		deleteTarget = null;
		if (!target) return;
		try {
			await backupStore.remove([target.id]);
		} catch (error) {
			toastStore.failed('delete that backup', error);
		}
	}

	async function confirmBulkDelete(): Promise<void> {
		bulkDeleteOpen = false;
		const ids = [...selected];
		if (!ids.length) return;
		try {
			const removed = await backupStore.remove(ids);
			selected = new Set();
			selecting = false;
			// The rows vanish, which the screen shows; the count is the part it does not.
			toastStore.success(`Deleted ${removed} backup${removed === 1 ? '' : 's'}`);
		} catch (error) {
			toastStore.failed('delete those backups', error);
		}
	}

	async function togglePin(s: SnapshotManifest): Promise<void> {
		try {
			await backupStore.setPinned(s.id, !s.pinned);
		} catch (error) {
			toastStore.failed(s.pinned ? 'unpin that backup' : 'pin that backup', error);
		}
	}

	function toggleSelected(id: string): void {
		const next = new Set(selected);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selected = next;
	}

	function selectAll(): void {
		selected = selected.size === snapshots.length ? new Set() : new Set(snapshots.map((s) => s.id));
	}

	async function copyLocation(): Promise<void> {
		try {
			await copyText(backupStore.location);
			toastStore.success('Copied the backup folder path');
		} catch (error) {
			toastStore.failed('copy the path', error);
		}
	}

	let bulkBlast = $derived(
		[...selected].reduce((sum, id) => {
			const s = snapshots.find((x) => x.id === id);
			return sum + (s ? s.summary.chats + s.summary.characters : 0);
		}, 0)
	);
</script>

<div class="backups">
	{#if pendingRestoreId}
		<div class="pending">
			<Alert
				tone="warning"
				message="A restore is waiting. Close ChungusHub and start it again, and it puts your data back before anything else runs."
			/>
			<button type="button" class="link-btn pending-cancel" onclick={cancelPending} disabled={cancelling}>
				Cancel the restore
			</button>
		</div>
	{/if}
	{#if pageError}
		<Alert message={pageError} />
	{:else if backupStore.lastError}
		<Alert tone="warning" message={backupStore.lastError} />
	{/if}

	<section class="card" data-setting="automatic-backups">
		<div class="card-head">
			<span class="card-title">Automatic Backups</span>
			<InfoTip
				text="A snapshot of everything you have made: chats, characters, lorebooks, presets and their pictures. One is always taken before the app upgrades its database, whatever this is set to. Your password and device list are never included."
			/>
		</div>
		<div class="toggle-row" use:toggleRow>
			<span class="toggle-label">Back up on a schedule</span>
			<Toggle
				checked={settings.automatic}
				onchange={(v) => backupStore.setAutomatic(v)}
				label="Back up on a schedule"
			/>
		</div>

		{#if settings.automatic}
			<div class="sched" transition:slide={{ duration: 160 }}>
				<PillRow
					options={INTERVALS}
					current={String(settings.intervalHours)}
					onpick={(v) => backupStore.setInterval(Number(v) as BackupInterval)}
					label="How often"
				/>
				<div class="steppers">
					<label class="stepper">
						<span class="section-label">Keep the last</span>
						<input
							type="number"
							class="input-base stepper-input"
							min={KEEP_SCHEDULED_RANGE.min}
							max={KEEP_SCHEDULED_RANGE.max}
							value={settings.keepScheduled}
							onchange={(e) => backupStore.setKeepScheduled(Number(e.currentTarget.value))}
						/>
					</label>
					<label class="stepper">
						<span class="section-label">Before upgrades, keep</span>
						<input
							type="number"
							class="input-base stepper-input"
							min={KEEP_UPGRADE_RANGE.min}
							max={KEEP_UPGRADE_RANGE.max}
							value={settings.keepUpgrade}
							onchange={(e) => backupStore.setKeepUpgrade(Number(e.currentTarget.value))}
						/>
					</label>
				</div>
			</div>
		{/if}
	</section>

	<section class="card" data-setting="backup-history">
		<div class="card-head">
			<span class="card-title">History</span>
			{#if snapshots.length > 1 && !pendingRestoreId}
				<button type="button" class="link-btn head-action" onclick={() => { selecting = !selecting; selected = new Set(); }}>
					{selecting ? 'Done' : 'Select'}
				</button>
			{/if}
		</div>

		<div class="take">
			<input
				type="text"
				class="input-base note"
				bind:value={label}
				maxlength="60"
				placeholder="Optional note"
				disabled={operationBusy || !!pendingRestoreId}
			/>
			<Button size="sm" onclick={runBackup} disabled={operationBusy || !!pendingRestoreId}>
				Back up now
			</Button>
			<Button
				size="sm"
				variant="secondary"
				onclick={() => fileInput?.click()}
				disabled={operationBusy || !!pendingRestoreId}
			>
				<Icon name="upload" class="w-3.5 h-3.5" strokeWidth={1.75} />
				{importing ? 'Importing…' : 'Import backup'}
			</Button>
			<input
				bind:this={fileInput}
				type="file"
				class="hidden"
				accept=".zip,application/zip,application/x-zip-compressed"
				onchange={importBackup}
			/>
		</div>

		{#if job}
			<div class="job" transition:slide={{ duration: 160 }}>
				<Spinner size="sm" />
				<div class="job-text">
					<span class="job-phase">{job.phase}</span>
					{#if job.filesTotal > 0}
						<span class="job-count">{job.filesDone} of {job.filesTotal} files</span>
					{/if}
				</div>
			</div>
		{/if}

		{#if selecting && selected.size > 0}
			<div class="bulk" transition:slide={{ duration: 140 }}>
				<span class="bulk-count">{selected.size} selected</span>
				<div class="bulk-actions">
					<button type="button" class="link-btn" onclick={selectAll}>
						{selected.size === snapshots.length ? 'Clear' : 'All'}
					</button>
					<Button size="sm" variant="danger" onclick={() => (bulkDeleteOpen = true)}>Delete</Button>
				</div>
			</div>
		{/if}

		{#if !backupStore.loaded}
			<div class="loading"><Spinner size="sm" /></div>
		{:else if snapshots.length === 0}
			<EmptyState icon="archive" title="No backups yet" size="sm">
				One is taken before the app ever upgrades its database. Take one now if you are about
				to try something.
			</EmptyState>
		{:else}
			<ul class="list">
				{#each snapshots as s (s.id)}
					{@const stale = tooNew(s)}
					<li class="row" class:selected={selected.has(s.id)} class:stale>
						{#if selecting}
							<label class="pick">
								<input
									type="checkbox"
									checked={selected.has(s.id)}
									onchange={() => toggleSelected(s.id)}
								/>
								<span class="sr-only">Select the backup from {formatDate(s.createdAt)}</span>
							</label>
						{:else}
							<button
								type="button"
								class="pin"
								class:on={s.pinned}
								onclick={() => togglePin(s)}
								disabled={operationBusy || !!pendingRestoreId}
								title={s.pinned ? 'Pinned: never removed automatically' : 'Pin so it is never removed automatically'}
								aria-label={s.pinned ? 'Unpin this backup' : 'Pin this backup'}
								aria-pressed={s.pinned}
							>
								<Icon name="star" class="w-3.5 h-3.5" strokeWidth={1.75} />
							</button>
						{/if}

						<div class="body">
							<div class="line-1">
								<span class="when">{formatRelativeTime(s.createdAt)}</span>
								<span class="kind kind-{s.kind}">{kindLine(s)}</span>
							</div>
							<div class="line-2">
								<span>{formatDate(s.createdAt)}</span>
								<span class="dot">·</span>
								<span>{countLine(s)}</span>
								<span class="dot">·</span>
								<span>{bytes(s.bytes.logical)}</span>
							</div>
							{#if s.label}
								<div class="note-line">{s.label}</div>
							{/if}
							{#if stale}
								<div class="warn">Written by a newer version of ChungusHub. Update the app to restore it.</div>
							{:else if s.warnings.length}
								{#each s.warnings as warning}
									<div class="warn">{warning}</div>
								{/each}
							{/if}
						</div>

						{#if !selecting}
							<div class="actions">
								<button
									type="button"
									class="act"
									onclick={() => exportBackup(s)}
									disabled={operationBusy || !!pendingRestoreId}
									aria-label="Export this backup"
									title="Download a portable ChungusHub backup"
								>
									{#if exportingId === s.id}
										<Spinner size="sm" />
									{:else}
										<Icon name="download" class="w-3.5 h-3.5" strokeWidth={1.75} />
									{/if}
									<span class="act-label">{exportingId === s.id ? 'Preparing…' : 'Export'}</span>
								</button>
								<button
									type="button"
									class="act"
									onclick={() => openRestore(s)}
									disabled={stale || operationBusy || !!pendingRestoreId}
									title="Put your data back to this point"
								>
									<Icon name="refresh" class="w-3.5 h-3.5" strokeWidth={1.75} />
									<span class="act-label">Restore</span>
								</button>
								<button
									type="button"
									class="act danger"
									onclick={() => (deleteTarget = s)}
									disabled={operationBusy || !!pendingRestoreId}
									aria-label="Delete this backup"
									title="Delete this backup"
								>
									<Icon name="trash" class="w-3.5 h-3.5" strokeWidth={1.75} />
								</button>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		{#if backupStore.location}
			<div class="where">
				<span class="section-label">Kept in</span>
				<button type="button" class="path" onclick={copyLocation} title="Copy this path">
					<code>{backupStore.location}</code>
					<Icon name="copy" class="w-3 h-3" strokeWidth={1.75} />
				</button>
				<p class="where-note">
					{totalLine}. This folder holds your stories and your API keys, so treat it the way you
					treat the app itself. Exported archives contain the same private data, but not your password
					or device list.
				</p>
			</div>
		{/if}
	</section>
</div>

<ConfirmDialog
	open={!!restoreTarget}
	title="Restore this backup?"
	message={restoreMessage}
	confirmLabel="Restore"
	variant="danger"
	destructive
	holdMs={restoreHold}
	onConfirm={confirmRestore}
	onCancel={() => (restoreTarget = null)}
/>

<ConfirmDialog
	open={!!deleteTarget}
	title="Delete this backup?"
	message={deleteTarget
		? `The snapshot from ${formatDate(deleteTarget.createdAt)} goes for good. Your current data is not touched.`
		: ''}
	confirmLabel="Delete"
	variant="danger"
	destructive
	onConfirm={confirmDelete}
	onCancel={() => (deleteTarget = null)}
/>

<ConfirmDialog
	open={bulkDeleteOpen}
	title="Delete these backups?"
	message={`${selected.size} snapshot${selected.size === 1 ? '' : 's'} go for good. Your current data is not touched.`}
	confirmLabel="Delete"
	variant="danger"
	destructive
	holdMs={holdMsForBlast(bulkBlast)}
	onConfirm={confirmBulkDelete}
	onCancel={() => (bulkDeleteOpen = false)}
/>

<style>
	.backups {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		container-type: inline-size;
	}

	.toggle-label {
		font-family: var(--font-ui);
		font-size: 0.8rem;
		color: var(--color-text-primary);
	}

	.sched {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		margin-top: 0.8rem;
	}

	.steppers {
		display: flex;
		flex-wrap: wrap;
		gap: 0.9rem;
	}

	.stepper {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	/* Sizing only: chrome, hover and focus come from the shared .input-base, so these two
	   read as the same control every other settings page draws. */
	.stepper-input {
		width: 5rem;
		padding: 0.35rem 0.5rem;
		color: var(--color-text-primary);
		font-family: var(--font-ui);
		font-size: 0.82rem;
	}

	/* Rides the shared .link-btn; placement and size are the local part, exactly as the
	   other settings cards do it. */
	.head-action {
		margin-left: auto;
		font-size: 0.72rem;
	}

	.pending {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.35rem;
	}
	.pending-cancel {
		font-size: 0.74rem;
	}
	.pending-cancel:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.take {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		margin-top: 0.2rem;
	}

	.note {
		flex: 1;
		min-width: 0;
		padding: 0.4rem 0.6rem;
		color: var(--color-text-primary);
		font-family: var(--font-ui);
		font-size: 0.78rem;
	}

	.job {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin-top: 0.7rem;
		padding: 0.55rem 0.7rem;
		border-radius: 10px;
		background: var(--theme-bg-secondary);
		border: 1px solid var(--theme-border-raised);
	}
	.job-text {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
	}
	.job-phase {
		font-family: var(--font-ui);
		font-size: 0.78rem;
		color: var(--color-text-primary);
	}
	.job-count {
		font-family: var(--font-ui);
		font-size: 0.7rem;
		color: var(--color-text-secondary);
		font-variant-numeric: tabular-nums;
	}

	.bulk {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		margin-top: 0.7rem;
		padding: 0.45rem 0.7rem;
		border-radius: 10px;
		background: var(--theme-bg-secondary);
		border: 1px solid var(--theme-border-raised);
	}
	.bulk-count {
		font-family: var(--font-ui);
		font-size: 0.76rem;
		color: var(--color-text-primary);
	}
	.bulk-actions {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		/* The shared .link-btn inherits its size, so the All/Clear links take this one. */
		font-size: 0.74rem;
	}

	.loading {
		display: flex;
		justify-content: center;
		padding: 1.2rem 0;
	}

	.list {
		list-style: none;
		margin: 0.8rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.row {
		display: flex;
		align-items: flex-start;
		gap: 0.6rem;
		padding: 0.55rem 0.6rem;
		border-radius: 10px;
		border: 1px solid transparent;
		background: var(--theme-bg-secondary);
	}
	.row.selected {
		border-color: var(--theme-accent);
	}
	.row.stale {
		opacity: 0.7;
	}

	.pin,
	.pick {
		flex-shrink: 0;
		display: grid;
		place-items: center;
		width: 1.65rem;
		height: 1.65rem;
		border-radius: 7px;
		border: 0;
		background: none;
		cursor: pointer;
		color: var(--color-text-secondary);
	}
	.pin:hover:not(:disabled) {
		background: var(--theme-bg-tertiary);
		color: var(--color-text-primary);
	}
	.pin.on {
		color: var(--theme-accent);
	}
	.pin:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.line-1 {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		flex-wrap: wrap;
	}
	.when {
		font-family: var(--font-ui);
		font-size: 0.82rem;
		color: var(--color-text-primary);
	}
	.kind {
		font-family: var(--font-ui);
		font-size: 0.63rem;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		padding: 0.1rem 0.36rem;
		border-radius: 5px;
		background: var(--theme-bg-tertiary);
		color: var(--color-text-secondary);
	}
	.kind-preUpgrade,
	.kind-preRestore {
		color: var(--theme-accent);
	}

	.line-2 {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		flex-wrap: wrap;
		font-family: var(--font-ui);
		font-size: 0.7rem;
		color: var(--color-text-secondary);
	}
	.dot {
		opacity: 0.5;
	}

	.note-line {
		font-family: var(--font-ui);
		font-size: 0.72rem;
		color: var(--color-text-secondary);
		font-style: italic;
	}

	.warn {
		font-family: var(--font-ui);
		font-size: 0.7rem;
		line-height: 1.4;
		color: var(--color-warning);
	}

	.actions {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.act {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.32rem 0.5rem;
		border-radius: 7px;
		border: 1px solid var(--theme-border-raised);
		background: none;
		cursor: pointer;
		font-family: var(--font-ui);
		font-size: 0.72rem;
		color: var(--color-text-primary);
	}
	.act:hover:not(:disabled) {
		background: var(--theme-bg-tertiary);
	}
	.act:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.act.danger {
		color: var(--color-text-secondary);
		padding: 0.32rem 0.4rem;
	}
	.act.danger:hover:not(:disabled) {
		color: var(--color-error);
	}

	/* A docked panel is barely wider than a phone, so the row folds on its own width rather
	   than on the viewport's: the same panel is a 220px dock and a 1250px overlay. */
	@container (max-width: 26rem) {
		.act-label {
			display: none;
		}
		.act {
			padding: 0.32rem 0.42rem;
		}
		.take {
			flex-wrap: wrap;
		}
		.note {
			flex-basis: 100%;
		}
	}

	.where {
		margin-top: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.path {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.35rem 0.5rem;
		border-radius: 8px;
		border: 1px solid var(--theme-border-raised);
		background: var(--theme-input-bg);
		cursor: pointer;
		color: var(--color-text-secondary);
		text-align: left;
	}
	.path:hover {
		color: var(--color-text-primary);
	}
	.path code {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
		font-size: 0.7rem;
	}
	.where-note {
		margin: 0.15rem 0 0;
		font-family: var(--font-ui);
		font-size: 0.7rem;
		line-height: 1.5;
		color: var(--color-text-secondary);
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
</style>
