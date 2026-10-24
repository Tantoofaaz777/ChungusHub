# Fork maintenance audit: 2026-10-24

Scope: tracked application source, route/worker/CLI entry points, static and literal dynamic imports, client/server RPC declarations, retired feature references and user-facing documentation. The initial graph examined 586 TypeScript/JavaScript/Svelte files, including tests and build scripts. A second graph distinguished runtime imports from type-only imports. Candidate findings were checked against actual consumers before changes. Generated builds, dependencies, attachments, backups and live user data were excluded from reference searches. This is a maintenance audit, not a complete security or runtime-performance assessment.

## Story Map

The map UI, minimap, inspector, comparison modal, layout helper and `/map` and `/canon` commands had already been removed in commit `a6304d7`. No live Story Map panel, route or command was found. The dedicated branch-label RPC writer was also already gone.

The README and public documentation still advertised the map and promised that regeneration never lost a version. Those descriptions were incorrect for this fork: swipes navigate alternatives in the transcript, branching creates an independent chat, and successful regeneration replaces the selected prior replies. These descriptions are corrected. A contract test now guards the retirement of map components, layout/diff helpers, commands and the dedicated branch-label writer.

Legacy `branch_label` and `canon_leaf_id` are intentionally retained. They are read from existing chats, preserved during duplication/backups and repaired during deletion; branch labels also remain visible in search. Message parent/child links and sibling indices support current swipes and branching. Removing these fields because their names once appeared in Story Map would remove valid data or break current navigation. No schema, migration or live data was changed.

## Confirmed unused modules removed

| Module | Finding |
| --- | --- |
| `components/memory/MemoryView.svelte` | Unmounted automatic-memory UI; the active panel uses `MemoryPanel.svelte` and the manual scene store. |
| `components/library/LibraryStatsBar.svelte` | No editor imports it; token counts now use explicit actions and current dialogs. |
| `components/ui/BrandGlyph.svelte` | Unused GitHub/Discord branding from retired community surfaces. |
| `stores/sidebar.svelte.ts` | Unused legacy collapsed-sidebar store; the current desktop rail is managed by the current layout/UI stores. |
| `types/index.ts` | Unused barrel; consumers import their type modules directly. |

Tests still exempted the unmounted memory UI and library statistics component from source contracts. Those exemptions were removed, and architecture notes were corrected to describe the active editors and manual memory surface.

## Unused helpers and imports

Removed unused helpers for backup marker paths, image existence checks, AO3-information presence, comma-formatted lorebook keys, preview truncation, the unused steering scope list, and the old bug-report URL builder/community links. Their removal does not remove backup markers, attachment loading, AO3 fields, keyword chips or steering scopes: each active feature has its own live implementation.

The old per-message sibling lookup/index/next/previous helpers had no production callers. The transcript already indexed siblings once per tree update. Its existing implementation is now the tested `groupSiblings` utility; navigation semantics and update frequency are unchanged. Tests exercise mixed roles, root alternatives, stable ordering and preservation of the input array through that actual production helper.

Compiler-assisted scans also found unused imports/types/constants in lorebook scanning, character export, message steering, editor highlighting, speech processing, the database and server startup. These were removed or marked as intentionally unused parameters. Public exports used internally or only to exercise a live implementation in tests were not classified as dead merely because they lacked external production imports.

## Fork identity and release checks

The update checker and active About/source/license links still targeted `patcireamo/ChungusHub`. Download, clone, issue and documentation navigation also sent fork users upstream. The runtime repository identity now lives in `shared/project.ts`, and active links/checks use `Tantoofaaz777/ChungusHub`. Tests verify the requested repository, release parsing, error handling and absence of workspace data in the check request.

The stable-server release checker remains separate from Android test APKs. A repository with Android prereleases but no stable server release returns a clear unavailable-comparison message rather than comparing against upstream or claiming to be current. This audit does not add automatic updates, a new APK update mechanism or a new release channel.

Documentation now directs users to this fork's source and Android releases. Original author and shipped preset credits remain intact. The security policy no longer presents the upstream author as the fork's private contact; no alternative private contact has been invented or enabled.

## Intentional legacy boundaries / follow-up candidates

- **Follow-up completed:** the automatic-memory runtime, prompt/default settings, no-op UI hooks, eight client/server RPCs and obsolete engine tests have been removed. The manual scene store now owns `SceneChatContext`. Historical SQL rows, duplication and one-time conversion remain, tested with direct historical fixtures rather than the retired API. See `memory.md` for the compatibility boundary.
- Sprite/gallery fields and message sprite labels are inactive legacy metadata. Character duplication, import/export and file cleanup still preserve or own those files. These are compatibility and ownership paths, not a live sprite/gallery feature, and were retained.
- Some generic client DB proxy methods have no current UI caller while their server implementations serve maintenance or legacy contracts. Lack of a UI caller alone is not evidence that deleting the underlying database operation is safe.
- The fork has no published alternative private security-reporting contact. The policy states that limit; the maintainer may choose a private reporting route separately.
- Retired feature names in migration history, compatibility documentation and retirement tests are intentional. Generic JavaScript `Map` usage is unrelated to Story Map.

## Swipe, deletion and message-fork follow-up

The audit traced the response pager, queued leaf writes, prompt preparation/revalidation,
server generation replacement transaction, splice/subtree deletion and independent chat
forking. Existing tests cover rapid navigation, stale refreshes, cancelled/empty/failed
replacement, preserving alternatives created after the request snapshot, tree-pointer repair,
copy boundaries, bookmark identity, memory/Threads inheritance and copy rollback.

Two deletion bugs were reproduced against the real database before fixing them. A remote
splice could leave the client using the deleted parent's old ID after successfully deleting
the target; a remote swipe selection could be overwritten using the client's older leaf.
Deletion now obtains the target, ancestry and leaf from the same fresh snapshot and reconciles
an already-deleted target without another mutation. Regression tests cover both delete modes,
off-path subtree/bookmark removal and refusing a splice that would merge branched replies.

A separate server test showed that a generation commit accepted a parent belonging to another
chat. The commit now validates both parent ID and destination chat before insertion. The test
verifies that rejection leaves both chats and the destination revision unchanged. Normal fork
copying already limits ancestry to the source chat and remaps every copied message ID; no
change to those copy semantics was needed. Public swipe documentation now matches the active
last-assistant-only pager and the retired-memory compatibility boundary.

## Synchronization follow-up

The cross-device audit traced scope batching, boot/reconnect listeners, settings reads/writes,
drafts, preset reloads, editor autosaves and chat-list publication. Deterministic deferred
responses reproduce the failure shapes without contacting a real server or editing user data.

- Settings writes now retain invocation order per key; direct reads wait for queued saves.
  Settings reloads reject responses overtaken by local changes or newer reads. Related
  connection/routing and palette/appearance snapshots publish atomically.
- Autosave flushes now include requests already in flight, and successive saves per row are
  serialized. Editor RPC payloads are captured at invocation, deletes follow earlier updates,
  and refreshes wait for active local writes. Input-history append/clear order is protected too.
- Library, lorebook and steering reloads preserve local edits, creations and deletions made
  during reads. Clock skew between devices no longer decides whether a remote book can load.
- Real chat-store regression tests demonstrated an older list removing a newer chat and
  closing a chat created/opened during that read. Read tickets and local-baseline reconciliation
  now protect both the list and the selected view.
- Startup hints are buffered until dependent stores initialize; reconnect still resyncs all
  scopes. Settings reload failures no longer prevent sibling reloaders from being attempted.

This is request-order and stale-publication protection, not an offline outbox or an automatic
merge/conflict UI. Concurrent edits of the same unversioned row or settings blob on separate
devices retain last-committed-write behavior. Manual memory/Threads revision guards remain.
See `client-data-layer.md` for the maintained contracts.

## Backup, restore and interchange follow-up

- Restore preflight now rejects missing/corrupt databases, unsupported actual migration
  versions, unfinished snapshots, unreadable directories, symbolic links and malformed
  preset JSON before removing live entries. A file-count mismatch catches files deleted
  after the snapshot was sealed. Source identifiers stay inside the backup
  store; invalid structured restore journals stop boot instead of silently being ignored.
- Shared copy batches wait for all active workers to settle after a failure. Cleanup and
  resumed restores cannot race a leftover copy from the failed batch.
- Snapshot image reconciliation now includes per-chat backgrounds in `chats.feature_state`.
  Tests upload both an attachment and a background between the file scan and SQLite copy.
- Portable exports reject unfinished snapshots, incomplete file inventories, missing databases and files outside the
  documented archive inventory. Existing ZIP import checks continue to reject invalid,
  duplicated or unsupported entries and stage imports without changing live data.
- Character imports validate exactly one active version before any write or portrait upload.
  Browser downloads retain Blob URLs for a grace period rather than revoking them in the
  same click handler. Native Android save/share behavior is unchanged.
- A real-schema integration test compares every table across snapshot creation, streamed
  ZIP export/import and boot restore. Fixtures cover swipes, bookmarks, reasoning, chapters,
  arcs, volumes, Threads, outlets, steering, credentials, drafts, presets, images and fonts.
  Current security files remain untouched. Device-local settings, including TTS rules,
  remain outside server backups and keep their separate rule-file export/import.

Restore is resumable, not a multi-file atomic swap. A disk failure after replacement begins
can leave partial live entries; the restore journal remains for retry and the safety backup
remains available. Individual card imports use several writes rather than a server-wide
transaction; early validation prevents malformed version selections from causing a partial
import, but an unrelated later network failure can still require removing a partial entry.

## Prompt assembly follow-up

- New regressions reproduced history disappearing for case/space variants of
  `{{chatHistory}}`, example trimming being skipped for equivalent macro spellings, and
  premature or insufficient history trimming when identity macros changed text length or
  the preset repeated history. Detection and budgeting now follow the resolved messages.
- Repeated history tags retain their authored behavior (each injects the path); additional
  copies of depth steering/lore are also counted. Manual summaries remain protected.
- Fallback prompts use the selected tokenizer and report budget overflow and previous
  history/example trimming. Strict/semi-strict role conversion retains image attachments.
- Unknown Object-property names remain literal macros instead of inserting a native
  JavaScript function or failing pruning. Built-in casing stays tolerant; legacy flow and
  control keys retain their existing case-sensitive semantics.
- Inspected primary sends, regeneration/continuation, opening scenes, Impersonate, Threads
  and manual-memory generation. Their existing routing and independent-engine boundaries
  remain; Impersonate still bypasses roleplay preset controls, lorebooks and author notes.

The local token budget is still an estimate, not provider-exact image/framing accounting.
Lorebook probabilities roll once per assembly, so separate preview and send assemblies can
legitimately select different entries. This pass does not change either existing contract.

## Attachments and orphaned files follow-up

- A shared image-reference inventory now serves backups and file cleanup. Cleanup checks
  messages (attachments and inline links), character/persona rows, saved versions,
  lorebooks, settings, chat feature state, and committed/draft presets. JSON escapes are
  decoded, thumbnail references protect originals, and Windows case aliases share ownership.
- Chat deletion releases files only after row changes and after checking all surviving
  owners. Non-background image-release requests and lorebook-cover deletion use the same
  guard. Cleanup failures no longer turn an already-committed chat deletion into an error.
- Boot cleanup remains limited to `images/chat/`, with the existing one-hour age guard.
  It also removes old thumbnail-only leftovers. Unknown/malformed ownership data stops
  cleanup, links are skipped, and locked files are logged without preventing startup.
- Uploads read both payloads before creating files; failed writes discard only files created
  exclusively by that call. Concurrent human-name uploads cannot share a thumbnail across
  different extensions. Copy failures release the new copy; failed thumbnail decoding keeps
  the previous thumbnail. Stored-image paths are validated rather than rewritten.
- Bulk library deletion now obtains server acceptance before changing bindings or removing
  images, and publishes each successful deletion so later refusals remain truthful.
- Composer uploads are scoped to their original chat/lifetime. Navigation clears staged
  attachments from the new composer, late uploads are released, and a delayed send commit
  clears only its original draft. Already-staged images are not eagerly deleted on navigation:
  a held send may still commit them; unused ones remain eligible for the guarded boot sweep.

There is no new blanket deletion of character/persona/preset assets, backgrounds or fonts.
Some of those are independently browsable assets even without a current row reference;
abandoned uploads outside the chat category can still require targeted review. Backups are
separate stored copies/hardlinks and are not live references or cleanup targets.
Uploads and later owner-row writes are still separate operations: an interrupted owner
save can leave an unadopted non-chat asset, and a lost response is not proof that its row
failed to commit. Reference guards preserve committed owners rather than guessing.

The cleanup regression initially exposed cached filesystem roots shared across test files.
Its logged sweep removed exactly the two known disposable artifacts created by the scenario.
It now runs nine filesystem/database scenarios in a fresh child process with its own temporary
root. Other file tests continue to track and remove only their own uniquely named fixtures.

## Validation history

Initial maintenance audit:

- `bun run check`: passed, with zero Svelte errors or warnings and a successful server type check.
- Complete test suite on CI's Bun 1.3.9: **2,129 passed, zero failed**, 9,057 assertions across 146 files. Active manual-memory/swipe tests and cross-boundary contracts are included.
- `bun run build`: passed. Existing application-chunk budget/fallback-page notices remain outside this cleanup.
- Additional compiler diagnostics for unused TypeScript locals/parameters: no remaining findings in the audited application/server modules.
- `git diff --check`: passed. The Story Map retirement test accepts an empty directory left by an older checkout and checks for actual code files instead.

Automatic-memory retirement follow-up:

- `bun run check`: passed with zero Svelte errors or warnings and a successful server type check.
- Complete test suite on CI's Bun 1.3.9: **2,048 passed, zero failed**, 6,669 assertions across 145 files. The lower count reflects removal of obsolete automatic-engine tests and addition of retirement coverage; no active tests were skipped to achieve this result.
- Legacy conversion and duplication tests still cover enabled/disabled historical memories, source-ID remapping, higher-layer rows, stale/malformed sources and copies without memory. Removed RPCs must reject with the specific unknown-method error.
- Runtime import and additional unused-local/parameter scans find no remaining automatic-memory modules or unused declarations in the audited TypeScript modules.
- `bun run build` and `git diff --check`: passed. Existing application-chunk budget/fallback-page notices remain.

Swipe/deletion/fork follow-up:

- Complete test suite on CI's Bun 1.3.9: **2,057 passed, zero failed**, 6,690 assertions across 145 files. Nine regression/boundary cases were added.
- `bun run check`: passed with zero Svelte errors or warnings and a successful server type check.
- `bun run build` and `git diff --check`: passed; existing chunk-budget and fallback-page notices remain. This follow-up used automated store/database tests and code inspection, without a physical-device UI session.

Synchronization follow-up:

- Complete suite on CI's Bun 1.3.9: **2,091 passed, zero failed**, 6,751 assertions across 150 files. This includes 34 added regression/boundary cases for ordered writes, delayed responses, editor refreshes, clock skew, startup hints and chat-list races.
- `bun run check`: passed with zero Svelte errors or warnings and a successful server type check.
- Existing reconnect/liveness, generation survival, draft ordering and preset-refresh tests remain in the full suite. No physical-device UI session was performed.
- `bun run build` and `git diff --check`: passed. Existing chunk-budget/fallback-page notices remain.

Android native code is unchanged; this pass needs a server/frontend update, not a new native APK. No live user data or schema was changed. No commits, pushes or releases are part of this audit request.

Backup/restore/interchange follow-up:

- Final complete suite on CI's Bun 1.3.9: **2,113 passed, zero failed**, 6,846 assertions
  across 153 files. The final focused backup/import/download run passed **75 tests** with
  212 assertions across eight files.
- `bun run check`: passed with zero Svelte errors or warnings and a successful server type
  check. Server type checking was repeated successfully after the final inventory guards.
- `bun run build`: passed. Existing application chunk-budget/fallback-page notices remain.
- `git diff --check`: passed. All database/file tests used disposable fixtures; no physical
  Android or browser download session was performed in this audit.

Prompt-assembly follow-up:

- Complete suite on CI's Bun 1.3.9: **2,129 passed, zero failed**, 6,897 assertions across
  154 files. Final focused verification passed **300 tests**, 999 assertions across 14
  files; that run also includes the two subsequent fallback-encoding/depth-lore cases.
- `bun run check`: passed with zero Svelte errors or warnings and a successful server type
  check. `bun run build` and `git diff --check` passed; existing chunk-budget/fallback-page
  notices remain.
- Controlled pure/VM/store tests cover prompt contents and engine separation. No live model
  requests, production chat writes, physical-device sessions, commits or pushes were used.

Attachment/file-lifecycle follow-up:

- Final complete suite on CI's Bun 1.3.9: **2,141 passed, zero failed**, 6,928 assertions
  across 156 files. The isolated cleanup child additionally executes nine ownership,
  corruption, thumbnail and host-case scenarios against its own temporary database/files.
- Real composer functions are exercised in a VM for uploads completing after navigation
  or teardown, staged-image isolation and delayed send receipts. Upload/thumbnail and
  refused bulk-delete regressions pass too.
- `bun run check`: passed with zero Svelte errors/warnings and a successful server type
  check. Server types were rechecked after the last file-reference changes.
- `bun run build` and `git diff --check`: passed. Existing chunk-budget/fallback notices
  remain. No production cleanup request, physical-device session, commit or push was made.
