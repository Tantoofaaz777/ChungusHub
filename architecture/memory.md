# Retired automatic memory: data compatibility

The former automatic extractor/promoter has been removed. The active flow is described in
[manual-memory.md](manual-memory.md): users generate and save chapters, arcs and volumes.

## Removed runtime

The old store, extraction/promotion engine, recall builder, database adapter, configuration,
prompt templates, domain types, coverage/impact calculations and automatic-engine tests are gone.
The client proxy and server RPC allowlists no longer expose `memGetState`, `memListEpisodes`,
`memSetState`, `memApplyBatch`, `memApplyPromotion`, `memReapEpisodes`, `memUpdateEpisodeContent`
or `memReset`. Old callers receive Unknown db method and cannot mutate legacy rows.

Message edits and generation no longer call automatic upkeep or stub invalidation functions.
The dead rebuild-warning UI has been removed. Current saved summaries are evaluated by
`resolveScenes`, and ordinary source edits/deletions keep their existing review behavior.
`memoryExtract`, `memoryPromote` and `memoryDefaults` are ignored when loading settings and
are omitted on the next normal settings write. Chapter/arc/volume templates, the generation
switch and previous-summary context remain independent and unchanged.

The recognized `{{memory}}` macro remains a legacy placeholder so old presets resolve it
without sending a literal unknown macro. Runtime no longer generates an episode recall block;
manual summaries replace their source messages directly.

## Historical data retained

No migration drops `memory_state` or `memory_episodes`, and no existing rows are purged.
`serverDb.importLegacyScenes` reads them on the first `getMemoryScenes` call for each chat,
creates chapters, and records completion in `memory_scene_migrations`. Disabled, stale or
malformed memories preserve their text and are marked for review. The original rows remain.

Duplication with memory preserves historical state and episodes, remaps message IDs and copies
current manual scenes. A duplicate without memory omits both. Existing backup/restore machinery
continues to carry the database, including historical rows, so older backups can still be opened
and converted. `getChatMemoryFootprint` retains its legacy fallback for chats not yet converted.

Legacy conversion/duplication tests seed historical SQL rows directly through test-only helpers;
they do not recreate the retired engine or reopen its RPCs. Retirement tests check rejection by
the RPC allowlist, preservation/conversion of old rows and inactivity of automatic model work.
