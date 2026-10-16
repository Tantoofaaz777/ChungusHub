# Message prompt visibility

Each message may carry `excludedFromPrompt`. The transcript's eye button toggles it
through `setMessageExcludedFromPrompt`, a message-scoped sync mutation. Migration 46
adds `excluded_from_prompt` with a default of zero, so existing chats keep their prompt
unchanged. Insertion and chat duplication preserve the flag; database backups include it.
The toggle changes neither content timestamps, parent links, active leaf nor swipes.

Prompt assembly filters excluded rows before prompt regex, history macros, last-turn
macros, lorebook scanning and token pricing. Images attached to excluded rows leave with
them. Live engine macro contexts and Impersonate history apply the same exclusion.
Continue is unavailable for an excluded reply; the user can include it again first.

Memory keeps hidden rows as tree links but skips them when constructing its active path.
Episodes covering hidden rows cannot be recalled and are reaped by normal maintenance;
new extraction batches contain only included messages. Restoring a hidden message makes
any summary that skipped over it non-contiguous, so it is also reconciled. An extraction
whose source was hidden while the model ran is discarded before committing.

The existing `archivedOpacity` preference also styles manually excluded messages. Its
control is now called **Hidden message fade** and remains available when Chat Memory is
off. Archived and manually excluded turns have distinct accessible labels and buttons;
hidden text remains editable and can be included again without recreating the message.
