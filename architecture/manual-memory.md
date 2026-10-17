# Manual chapter memory

The live Chat Memory flow uses `scene-store.svelte.ts` and `shared/memory-scenes.ts`.
It no longer runs extraction/compaction after turns, and does not depend on lorebooks,
keywords, a verbatim tail or the `{{memory}}` macro. The old pipeline and its stored tables
remain for compatibility; its panel is unmounted and its store is no longer used by runtime consumers.

1. Use ↓ (start) and ↑ (end) directly in each message’s actions. Either endpoint can be marked first.
   Chat actions → Select chapter range also opens this selection mode.
2. Mark both boundaries on the same message for a single turn. Adjust either arrow to change the range;
   crossing the other boundary clears it. The selected range is highlighted, with Generate chapter and Cancel above.
3. Generate, review/edit, then Save chapter. Cancel never changes the prompt.
4. The saved chapter replaces that contiguous range at its original chronological position.
   Original rows, attachments and branches remain saved and visible with the hidden-message dim.
5. Review/edit or regenerate from Memory or the chapter marker above the selected messages. Regeneration
   stays in the draft until saved. Removing a summary restores its original messages.

Generation uses the Memory engine's routed connection and generation settings. Switching that
engine off prevents model calls; saved summaries continue to apply. Manual summaries can still be
written in the review dialog. The model receives selected visible text with resolved character/persona
names. Images are not sent to the summarizer in this first flow; the summary replaces those turns'
images too, so relevant visual facts should be added during review.

The default memory prompt requests a JSON object with two non-empty strings, `title` and `content`.
Generation reads both into the review draft; only those fields are consumed, and nothing is saved
until Save chapter. JSON fences and a leading explanation are tolerated through the shared JSON
extractor. Invalid structured output shows an error without overwriting the previous draft fields.
Custom prompts remain unchanged: plain-text responses still fill content and keep the draft title.

Prompt assembly substitutes scenes before regex transforms, lorebook scanning, last-turn macros,
Impersonate and token counting. Summaries count in Memory, originals leave Chat. They are fixed
context cost when budgeting; raw history is trimmed first and over-budget remains visible if the
summaries alone cannot fit. A custom preset must still inject history to use scene memory through
its structural history placeholder. Legacy `{{memory}}` placeholders are empty in the new flow.

Source fingerprints include role, text, attachments and hidden status. Changed or deleted sources,
gaps, overlaps, and explicit migration flags make a summary need review: its text remains saved,
but originals return to the prompt. Summaries on other branches do not replace that branch's turns.
Range membership and fingerprints are verified again inside the save transaction; revisions protect
against conflicting edits/deletes from other devices. No model call writes persistent memory itself.

Migration 47 adds `memory_scenes` and a per-chat migration marker. On first access, old episodes
are copied once into scenes, without model calls and without deleting legacy data. Disabled or stale
legacy memory is marked for review. Overlapping legacy ranges are conservatively held for review.
Chat duplication remaps scene source ids, preserves text needing review, and can omit memory.
Deletion of a chat cascades to its scenes and migration marker. Backups include the new SQL tables.


The Memory panel groups saved items under **Chapters**, leaving room for future compaction levels.
Each chapter preview starts collapsed and expands through its native disclosure header (tap/click or
keyboard). Its token count measures saved text with the chat model's encoding, recalculating only
when that text or model changes. The prompt also includes a small chapter/title wrapper, so this text
count is not the entire Memory prompt bucket. Existing storage/API names remain compatible.
Old generated titles `Scene N–M` display as `Chapter N–M`; custom titles and stored rows are preserved.

Only the last message on the active path can show response swipes, and only when it is an assistant
message included in the prompt and outside any active chapter. Hiding that last message does not
move its swipe bar to an earlier turn. Keyboard arrows and `/swipe` obey the same rule. Saved
alternatives remain stored; a later visible assistant reply can have swipes normally. Initial opening
scene generation in an empty chat and the separate Replace action retain their existing behavior.


Memory has three manual levels: Chapters summarize message ranges, Arcs summarize selected
consecutive Chapters, and Volumes summarize selected consecutive Arcs. The chat's Memory panel
has a section for each level; Create arc / Create volume open a centered source picker. Select at
least two valid unconsumed sources, then generate with the Memory connection or write manually.
All levels use the same title/content JSON reader, review dialog, collapsed preview and token count.
Each has its own editable prompt in Settings → Engines → Chat Memory. Nothing runs automatically.

A saved parent replaces its children at their original chronological position. Covered children remain
stored as Compacted; only the highest valid summary enters history, so there is no double injection.
Removing a parent restores its source summaries, not a second copy of raw messages. Underlying
message rows remain untouched. Active parent coverage also suppresses response swipes.

Migration 48 adds a level and child references to memory_scenes; existing rows default to Chapters.
Parents capture ordered child ids/revisions and the full underlying message range/signatures. The
resolver validates Chapters, then Arcs, then Volumes. Changes/deletions to messages or child
summaries invalidate dependent parents recursively without deleting saved text. Remaining valid
summaries and raw turns fill the history. The save transaction verifies levels, contiguous ranges,
child revisions, overlaps and optimistic revisions; changing a saved item's level is refused.
Chat duplication remaps both message references and the complete child graph. Stale dependencies
remain stale even though copied summary revisions restart at one. Database snapshots include the
new columns through the existing schema and migration path.

The retained Memory panel renders a prefix of 50 cards independently for chapters, arcs and volumes. A per-section IntersectionObserver rooted in the panel scroller appends another 50 within 200px of the viewport; each section also has a manual Load more button. Observers disconnect while hidden, saving, loading or unmounted, and queued callbacks cannot expand a detached list. Loaded prefixes and expanded cards survive panel toggles for the same chat; the workspace chat key resets them on chat changes. This limits presentation only: resolution, compaction candidates, source coverage and prompt assembly retain every saved scene. Collapsed card previews do not mount their summary text; expanding mounts it on demand. Token counts still appear in card headings and reuse their content/model cache.
