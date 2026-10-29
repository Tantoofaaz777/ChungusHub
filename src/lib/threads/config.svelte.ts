import { readSetting, registerSettingsReload, BurstSettingWriter, reloadSettings } from '#lib/services/syncedSetting.ts';
import { DEFAULT_THREADS_CONFIG, normalizeThreadsConfig, type ThreadsConfig } from '#shared/threads/model.ts';
class ThreadsConfigStore {
	value = $state<ThreadsConfig>({ ...DEFAULT_THREADS_CONFIG });
	private writer = new BurstSettingWriter<ThreadsConfig>('threadsConfig');
	async initialize() {
		await this.reload();
		registerSettingsReload(() => this.reload());
	}
	private async reload() {
		await reloadSettings(['threadsConfig'], () => readSetting<ThreadsConfig | null>('threadsConfig', null), raw => {
			if (!this.writer.busy) this.value = normalizeThreadsConfig(raw);
		});
	}
	set<K extends keyof ThreadsConfig>(key: K, value: ThreadsConfig[K]) {
		this.value = normalizeThreadsConfig({ ...this.value, [key]: value });
		this.writer.write(this.value);
	}
}
export const threadsConfigStore = new ThreadsConfigStore();
