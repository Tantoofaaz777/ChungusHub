import { readSetting, registerSettingsReload, BurstSettingWriter } from '$lib/services/syncedSetting';
import { DEFAULT_THREADS_CONFIG, normalizeThreadsConfig, type ThreadsConfig } from '$shared/threads/model';
class ThreadsConfigStore {
	value = $state<ThreadsConfig>({ ...DEFAULT_THREADS_CONFIG });
	private writer = new BurstSettingWriter<ThreadsConfig>('threadsConfig');
	async initialize() {
		await this.reload();
		registerSettingsReload(() => this.reload());
	}
	private async reload() {
		const value = normalizeThreadsConfig(await readSetting<ThreadsConfig | null>('threadsConfig', null));
		if (!this.writer.busy) this.value = value;
	}
	set<K extends keyof ThreadsConfig>(key: K, value: ThreadsConfig[K]) {
		this.value = normalizeThreadsConfig({ ...this.value, [key]: value });
		this.writer.write(this.value);
	}
}
export const threadsConfigStore = new ThreadsConfigStore();
