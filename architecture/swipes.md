# Response swipes

Swipes are versions of one assistant turn. Branch creates an independent chat with the
selected history through a chosen turn. The storage, migration and wire contract is in
[swipe-branch-separation.md](swipe-branch-separation.md).

## Storage and API

`messages.id` is stable across swipe generation and selection. `message_variants` owns
version-specific content, reasoning, images, bookmarks, visibility and generation metadata.
The selected version is projected into the turn payload columns by database triggers.
Parent links project only the preceding turn; versions have no descendants.

The pager belongs to the actual last assistant turn, included in the prompt, outside active
memory coverage and while mutations are idle. The left arrow visits the preceding version.
The right arrow visits the next existing version or generates another at the end. Existing
selection uses `selectMessageVariant` with the turn revision and version ID. Generation
uses `add_variant`, which is distinct from `branchChat`. Root greetings use the same version
model; generating another opening still requires the Opening Scene engine.

A new swipe/regeneration carries `ChatStream.replacingMessageId`: partial text and reasoning
replace the current bubble visually while its saved version remains intact. Continue appends
to the selected version and checks its captured identity/revision before writing. A stale
continuation is recovered instead of overwriting a newly selected response.
Continue also captures the full selected transcript fingerprint. Context is checked after prompt
review, at the server's model-dispatch boundary and transactionally at save time, so an earlier
edit or visibility change cannot receive a continuation generated against the previous history.
Visibility writes carry the exact version and revision rather than resolving whichever version
is selected when the request arrives. Continue is server-owned: joining, timings, persistence
and steering consumption finish even if the page closes. It shares the per-chat generation
lock/status, supports stopping from a returning page, and replay never writes a second tail.

Regenerate snapshots the exact version IDs of the last response. Successful nonempty output
replaces those versions atomically, preserving the turn. Failed, canceled and empty
replacements remove nothing. A stopped new swipe with partial text can be saved as another
version. An endpoint/context change cannot rewrite historical selections or remove later
turns: completed conflicting output is saved for recovery. Commits remain server-owned and
outlive the originating socket. See [server-core.md](server-core.md).

## Inspection and recovery

`SwipeNavigator` selects only versions of its owning turn. Older versions remain readable
through the Versions action, inactive-version search hits and exact-version bookmarks.
`ResponseVersionsDialog` keeps inspection separate from context selection; continuing from an
old version uses Branch into an independent chat. Editor saves capture the opened version and
revision. Deleting a swipe removes only that version; deleting a turn removes all its versions,
with distinct turn/version counts in the confirmation.

Conflicting completed output is available from Chat actions > Recovered responses and a banner
when saved records exist. It can be read, copied (including reasoning) or explicitly discarded.
Inspecting/recovering never silently inserts text into a changed conversation.

## References and legacy data

Memory and Threads identify the exact turn/version pair they describe, so identical text in
another version does not silently inherit a saved summary or reaction. Manual summaries are
documented in [manual-memory.md](manual-memory.md).

Schema migration 52 preserves the active path in the original chat and converts divergent
legacy histories into independent chats. The old format cannot prove swipe origin from
sibling shape; ambiguous alternatives are kept separately and reported in provenance.
Explicitly confirmed assistant siblings can become versions, with every played continuation
still preserved in its own chat. Original metadata and incompatible references are archived.

The retired Story Map, comparison diff, `/map`, `/canon` and annotation writers remain absent.
Legacy labels/canon pointers are compatibility provenance rather than navigation controls.
The old forest methods remain only for internal legacy import/testing. Live UI navigation
reads turn variants, and the client persistence adapters use protocol 2.
