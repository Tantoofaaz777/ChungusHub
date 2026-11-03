# Swipe and branch separation

Status: stage 3 implemented: storage, API and presentation distinguish versions from independent
chats. Schema migration 52 converts legacy forests before the server accepts requests, using
the stage 1 planner. Inspection, search, bookmarks, deletion and recovery use exact versions.

## Domain contract

A **turn** is one position in a chat's linear conversation. A **swipe** is an alternative
version of one assistant turn. A **branch** is an independent chat containing a copy of the
selected history through a chosen turn. A swipe has no children, continuation or chat of its
own. Continuing different versions creates different chats.

The destination model is:

```text
chat
  messages: ordered turns (id, chat_id, position, role, selected_variant_id)
    message_variants: versions (id, message_id, content, version-specific metadata)

branch: another chat with independent turn and variant IDs
```

`selected_variant_id` must belong to its turn. Each turn has at least one variant; only
assistant turns can have multiple variants. A chat has one ordered sequence, with unique
positions. Parent links and `sibling_index` are legacy provenance, not destination topology.
The last turn identifies the conversation endpoint; selecting a variant never changes it.

All version-specific data stays with the variant: content, reasoning, images, persona
attribution, edit timestamps, prompt visibility, bookmarks, model/provider, token counts,
generation timings and lorebook traces. In particular, visibility and bookmarks cannot be
flattened onto the turn: legacy alternatives can have different values. Legacy branch labels,
sprite labels, raw unknown fields and tree coordinates remain in migration provenance.

| Action | Required behavior |
| --- | --- |
| Add swipe | Add a version to the last assistant turn, preserving its identity and all existing versions. |
| Select swipe | Change only that turn's selected variant. Never walk descendants or switch chats. |
| Send | Append a new turn using the selected history. Previous variant selections become fixed context for that chat. |
| Branch | Copy the selected prefix, including the endpoint, into an independent chat. An edited endpoint changes only the copy. |
| Edit / Continue | Modify the selected variant under the existing edit/review rules. Continue remains limited to the last assistant turn. |
| Regenerate | Replace the last response's snapshotted versions only after a successful, nonempty generation. On a last user turn, append its response. |
| Delete variant | Remove only that version; deleting the last remaining version requires the separate delete-turn action. |
| Delete turn | Operate on the sequence, with an explicit choice of retaining or deleting later turns. The number of swipes is not a branch restriction. |

Swipe selection and generation remain limited to the actual last assistant turn, included in
the prompt, outside active memory coverage and while mutations are idle. Root greetings are
versions of the opening assistant turn; generating another uses the Opening Scene engine.
Older versions remain available for inspection/search. Using another old version as context
starts a branch through that version; it cannot silently rewrite an existing continuation.

The branch action copies the selected version at every position through the endpoint.
It does not import unselected variants. Full-chat duplication is a different action and copies
all variants. The source chat stays unchanged in both cases.

## Generation and concurrent devices

The overloaded regeneration action `'branch'` has been replaced by an explicit variant
operation, separate from `branchChat`. Mutations address a turn and, where relevant, a variant.
Generation captures the chat endpoint, selected variant and revision, plus the exact variant
IDs a replacement may delete. A commit validates ownership and context in one transaction.

Adding a swipe can save a completed variant without selecting it if another device has since
changed the selection. Replacing variants must reject a changed context without deleting any
of the old versions. If the chat was continued or the target turn removed, the result must
not change historical selections or delete later turns; the server returns a conflict and
preserves the completed output for recovery. Cancellation, failure and empty replacement
leave the saved versions intact. Variants created after the snapshot are never removed by
that replacement. The generation continues to be owned and committed by the server.

## Context, navigation and references

- Prompts resolve exactly one selected variant per turn. Only its reasoning and lorebook
  trace contribute to that conversation. Turn numbering and retention depth count turns.
- Memory and Threads sources identify `(turn_id, variant_id)` and retain their existing
  content signature/snapshot checks. A source from another version is a different-version
  source, even though it occupies the same turn. Content/visibility edits still trigger the
  existing review behavior. Changing IDs must not make an outdated summary appear valid.
- Search and bookmarks distinguish the selected conversation, another version in this chat,
  and another chat. A result on an old variant can be inspected without selecting it as
  context; continuing from it uses Branch.
- Deletion confirmations count turns and versions separately. Another version does not count
  as a branch. File cleanup checks every surviving variant owner, including copied chats.
- Chat lists show turn counts; an optional version count is separate. Switching versions does
  not add a turn. Root/canon markers and legacy labels are preserved as compatibility metadata,
  not exposed as hidden routes through a message tree.

## Legacy migration policy

The old format has no reliable swipe/fork discriminator. Same parent, same role, same text,
creation order, generation metadata and an absent branch label do not prove swipe origin.
The default policy is conservative: preserve uncertain alternatives as separate chats and
report them. It can produce more chats than the original UI showed; it never silently joins
histories. Folding confirmed swipes requires explicit classification backed by provenance
outside the tree shape. The planner accepts that classification as `ConfirmedSwipeGroup`;
this stage does not supply a heuristic or a classification UI.

[`planConversationMigration`](../shared/conversation-migration.ts) takes a complete snapshot
of one chat and returns source-row references, without opening storage or allocating IDs:

1. Validate chat ownership, unique message IDs, complete parent links, legal ordering, valid
   pointers and an acyclic forest. Invalid input produces an error and no partial plan.
2. Keep the original chat ID and exactly the active path as `primary`. A null selection stays
   empty; an interior selection stays at its prefix. Root/canon pointers never override it.
3. Preserve every other terminal path as an independent destination chat. Prefix turns are
   copied into each destination, with independent identities.
4. Group only explicitly confirmed assistant siblings into turn variants. Preserve their
   ordering by sibling index, timestamp, then ID. Mixed roles and cross-parent groups cannot
   be swipes. Duplicate/overlapping confirmations are rejected.
5. Absorb unplayed confirmed versions into their represented turn instead of creating a chat
   for each. If multiple versions have continuations, preserve every continuation as a
   separate chat, selecting the version it originally used. An actively selected unplayed
   version remains the primary endpoint even if an older version has a continuation.
6. Verify every original row appears as a variant in at least one destination. Report
   unclassified assistant sibling relationships; never discard them or guess their origin.

The planner is deterministic for a given snapshot/classification, does not mutate inputs and
uses iterative traversal. Its output size follows the histories it must preserve: shared
prefixes are repeated when divergent chats need independent copies. It is deliberately not
itself a database writer. The stage 2 executor calls it during conversion.

## Stage 2 implementation

[`conversation-storage.ts`](../server/conversation-storage.ts) owns the SQL schema, placement
snapshots, version selection and conversion. `messages` is the stable turn table. Its old
payload columns cache the selected version for existing prompt/retention readers; SQL triggers
keep those columns and `message_variants.payload_json` synchronized on edits. `parent_id`
projects only the preceding turn, so it never connects a version to a continuation.

Every migrated chat has `conversation_version = 2`, unique turn positions and a selected
variant belonging to each turn. Database guards reject forks inserted as turns, foreign
variant selection, removal of a still-selected version and multiple variants on user/system
turns. Variant payloads retain unknown legacy fields. The original forest and incompatible
memory/Threads records live in `conversation_archives`, linked through provenance and explicit
legacy-message-to-turn/version mappings. Explicit deletion removes the corresponding version
mappings and prunes archived copies of message text no surviving destination still owns.

The schema conversion and its migration checkpoint share a transaction. A failed conversion
rolls back the new DDL as well as the data. Opening a current-schema restored/imported database
also converts pending legacy chats. Server startup takes the existing pre-upgrade snapshot
before either path. Live RPC creation always creates format-2 chats; format-1 insertion is
retained only for internal legacy import/testing code.

The new API operations are `getConversationPlacement`, `appendConversationTurn`,
`seedConversationGreetings`, `selectMessageVariant`, `deleteMessageVariant`,
`getRecoveredGenerations` and `discardRecoveredGeneration`. Generation commits carry an
explicit `append`, `add_variant` or `replace_variants` placement, separate from `branchChat`.
Both RPC mutations and LLM requests require conversation protocol 2. Generation validates the
captured endpoint, selected version, revision and context fingerprint before calling the
provider and again at commit. Conflicting completed output is stored independently of prompt
logging in `conversation_generation_recovery`; no one-shot steering is consumed for it.

The selected projection and its nested versions share the existing message revision/delta
protocol. Changes to inactive versions invalidate their owning turn. Memory sources and
Threads snapshots now carry exact version identities; copied references are remapped along
with their turns. Backup reconciliation and image cleanup scan every version. Reasoning
retention counts turn positions and clears all versions at an expired position.

The following requirements also constrain future changes to conversion:

Before applying a plan, create the existing pre-upgrade backup and block concurrent writes
and generation against the database. Read and validate the complete snapshot under that
exclusion. Re-check the snapshot if a preview was produced earlier. An old preview cannot be
applied to newer rows. Add a versioned schema migration and an atomic conversion/checkpoint;
restarts must neither duplicate destination chats nor skip an incomplete conversion.

For each destination, build a mapping from legacy message ID to new `(turn_id, variant_id)`.
Prefix copies make this mapping destination-specific. Copy full original payloads; the
planner's narrow structural input is not an allow-list of fields to persist. Save provenance
for original chat/row IDs, tree coordinates, labels and pointers. Preserve the source chat's
metadata and use the existing explicit branch-copy rules for the additional chats, including
settings, character/version pin and chat-local state. Migration does not consume one-shot
steering notes or follow an external greeting update.

Remap bookmarks and attachments to their exact variant. Remap complete memory ranges and
Threads sources only into destinations containing the corresponding selected versions;
remap memory hierarchy and dependency IDs as well. Sources on unselected versions must be
preserved with their variant references and inactive/review status. Incomplete or invalid
coverage, old automatic-memory payloads and unknown data remain in a compatibility archive
with their original references. Do not silently drop them or promote them to active context.

Before retiring the legacy tables, verify row/payload coverage, selected histories, reference
ownership, context eligibility and image references, and exercise backup/export round trips.
Sync revisions and RPC payloads must move to the new model together; clients speaking the old
tree protocol must be rejected before mutation. Legacy backups must enter through the same
conversion policy. No old rows or files may be removed before those checks and commit succeed.

## Stage 3 presentation

`SwipeNavigator` reads only the owning turn's versions through `messageStore.navigateSwipe`.
The transcript detects a selected-version change even when the endpoint turn ID is unchanged,
so its existing scroll/pinning behavior still applies. Legacy sibling walkers remain isolated
to internal format-1 compatibility and fixtures.

`ResponseVersionsDialog` is a read-only inspector until an explicit action is taken. Its local
pager never writes selection. Historical versions can be copied, bookmarked or used as the
exact endpoint of an independent Branch chat. Selection and single-swipe deletion retain the
actual-last-assistant, prompt-inclusion and memory-coverage guards. Deleting a turn counts all
its versions, and confirmation holds scale on that full count.

Find in chat keeps rendered matches in the selected transcript and lists inactive-version
matches by turn/version identity. Bookmarks enumerate every marked version separately. Opening
an inactive match or bookmark opens the inspector without navigating or changing context.
Bookmark and editor writes carry `(chatId, messageId, variantId, expectedRevision)`; a remote
selection cannot redirect an open editor's save to a different version. Bookmark metadata does
not invalidate an otherwise unchanged prepared send or append generation.

Prompt visibility also carries the exact version identity and turn revision. Modern chats
reject writes without that identity or with a stale revision; a remote swipe cannot redirect
a visibility click to another version. The acknowledgement still returns the canonical delta.

Continue captures a `ContinuationContext` containing the chat/turn/version, target revision
and the complete selected transcript fingerprint. Its placement must match the fresh snapshot
revision before prompt assembly. The same server validator runs after review, on the WebSocket
before the provider starts, and inside the final write transaction. Earlier content/visibility
changes and a moved endpoint reject stale work; a completed continuation is saved for recovery
without overwriting the response or consuming one-shot steering. Earlier bookmarks leave the
fingerprint unchanged. Missing/malformed continuation context is refused before model dispatch.

Continue now carries a `ContinuationCommit` with the as-sent anchor and resolved one-shot IDs.
The server captures the base at dispatch, joins the generated tail, accumulates timings and
spends steering in the persistence transaction. It owns the chat generation lock and status,
so a returning page can discover/stop it; disconnects and replay cannot lose or append the
same tail twice. Cancellation retains nonempty partial output. Empty/restated output does
not change the turn or spend guidance. A failed steering write rolls back the text too.

Send releases the composer only after the user turn is persisted. Failed/conflicting appends
retain text and images. A delayed acknowledgement clears only the submitted draft version and
attachments, preserving new typing and uploads. Modern deletion adopts the server’s repaired
sequence and endpoint; client-side legacy forest re-homing never runs for a format-2 chat.
Even a lost deletion acknowledgement triggers a refresh of canonical state.

Completed output rejected by context checks broadcasts a messages sync hint and appears under
Chat actions > Recovered responses, with a banner when records exist. The reader can inspect
and copy both response and reasoning, then explicitly discard the saved record. It is never
automatically inserted into a changed context. Refresh/discard results are guarded against
out-of-order reads and chat switches; failed discards preserve their saved text.

## Verification

[`conversation-migration.test.ts`](../shared/conversation-migration.test.ts) exercises selected
histories, ambiguous siblings, confirmed greetings/swipes, nested divergences, continuations
on several versions, inactive and interior pointers, complete source coverage, deterministic
ordering, input preservation, invalid classifications, corrupt forests and long histories.
Run it with `bun test shared/conversation-migration.test.ts`. Type-check shared/server code
with `bunx tsc -p tsconfig.server.json`. No browser is required.

[`conversation-storage.test.ts`](../server/conversation-storage.test.ts) exercises real SQLite
conversion/checkpoints/rollback, stable turn identities, ownership constraints, concurrent
selection and generation, durable conflict recovery, exact memory references, independent
copies, version image inventories, retention and SQLite snapshot round trips.
[`generationSurvival.test.ts`](../server/generationSurvival.test.ts) additionally checks the
versioned HTTP/WebSocket boundary and server-owned commits using a scripted local endpoint.

`response-versions.test.ts` covers inspection identity, inactive search, exact bookmarks,
deletion counts and swipe scroll classification. `recoveredGenerations.test.ts` covers stale
reads, failed refresh/discard and navigation during writes; `recovered-generation.test.ts`
covers response/continuation payload readers. Storage tests include exact-version edit/bookmark
concurrency, metadata-safe sends and version counts. The WebSocket test also checks recovery
discovery, its saved payload and the absence of an incorrect transcript commit. No browser tests.

`continuation-context.test.ts` additionally covers context capture/review races, navigation,
cancellation and carrying the same context through dispatch and persistence. Storage tests
exercise earlier content/visibility changes, harmless earlier bookmarks, stale/missing targets
and exact-version visibility. The WebSocket test proves stale/missing/malformed continuation
contexts never reach its scripted provider.
