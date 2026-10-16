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
