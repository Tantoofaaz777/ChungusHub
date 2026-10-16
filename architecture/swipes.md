# Response swipes

The Story Map components, layout algorithm, comparison diff and map-only settings
have been removed. The `/map` and `/canon` commands and dedicated annotation writers
are retired too. Message trees, labels and canon pointers remain stored so existing
conversations keep their data and alternatives. Legacy label colors are still rendered in search.
Removing those storage fields or migrating branches into separate chats is a separate change.

The newest assistant response always shows its swipe pager. The left arrow is disabled
at the first version. The right arrow visits the next existing version, or generates a
new alternative at the end. Root greetings use the Opening Scene engine for generation,
so creating a root alternative still respects that engine's switch and connection.
Older messages show a pager when they already have alternatives; it navigates their
existing continuations without generating new ones. All navigation and generation
controls are disabled while the message store is busy.

Switching existing swipes uses the loaded message tree and paints immediately. Leaf
writes are serialized in click order; reads used by generation wait for those writes,
and load tickets prevent stale responses from moving the view back. Failed saves
reconcile against the server. The transcript indexes siblings once per tree update.

A new swipe or regeneration carries `ChatStream.replacingMessageId`: partial text and
reasoning replace the current bubble visually while the original row remains saved.
There is no extra streaming bubble below it. Continue still appends to the current
text, and a normal send still adds a separate response. Failed or uncommitted replacement
streams restore the original display when the stream closes.

Regenerate runs directly, with no replace/alternate dialog. It snapshots all siblings
at that point and sends their ids in `GenerationCommit.replaceMessageIds`. The old
responses stay intact while the request is being prepared and generated. On success,
the server inserts the reply and deletes those sibling subtrees in one transaction,
repairing tree pointers and writing tombstones for other devices. Image cleanup follows
the committed transaction. An alternative created after the snapshot is retained.

A canceled or empty replacement commits nothing, including when partial tokens have
arrived. A failed generation cannot remove old swipes. Replacement also completes if
the originating browser disappears; no client-side cleanup is needed.

The existing Chat Memory engine is unchanged in this phase. Manual scene summaries
inserted in place of source messages are planned separately.
