/** Adapted from Tantoofaaz777/Threadverse (20ee3ca), AGPL-3.0. See architecture/threads.md. */
import { serializeAo3Information, type Ao3Information } from './ao3'

export interface StoryRange {
  label: string
  content: string
}

export interface FandomThread {
  label: string
  content: string
}

export interface ThreadsPromptInput {
  previousRanges: StoryRange[]
  recentRange: StoryRange
  fandomContinuity: FandomThread[]
  fandomNotes?: string
  ao3Information?: Ao3Information
  instructions: string
}

function renderBlocks(items: StoryRange[]): string {
  if (items.length === 0) return ''

  return items
    .map((item) => `## ${item.label}\n${item.content.trim()}`)
    .join('\n\n')
}

export function groupConsecutiveStoryRanges(items: StoryRange[]): StoryRange[] {
  const grouped: StoryRange[] = []
  for (const item of items) {
    const previous = grouped.at(-1)
    if (previous?.label === item.label) {
      previous.content = `${previous.content.trim()}\n\n${item.content.trim()}`
    } else {
      grouped.push({ ...item })
    }
  }
  return grouped
}

export function installmentOrRoundLabel(installmentLabel: string, sequence: number): string {
  return installmentLabel || `ROUND ${sequence}`
}

export function buildThreadsPrompt(input: ThreadsPromptInput): string {
  const fandomNotes = input.fandomNotes?.trim() ?? ''
  const ao3Information = serializeAo3Information(input.ao3Information)
  return [
    ...(input.previousRanges.length > 0
      ? ['# Previous context', renderBlocks(input.previousRanges)]
      : []),
    '# Recent context',
    renderBlocks([input.recentRange]),
    ...(ao3Information ? ['# AO3 information', ao3Information] : []),
    ...(input.fandomContinuity.length > 0
      ? ['# Fandom continuity', renderBlocks(input.fandomContinuity)]
      : []),
    ...(fandomNotes ? ['# Fandom notes', fandomNotes] : []),
    '# Instructions',
    input.instructions.trim(),
    '# Output format',
    `You must respond with ONLY valid JSON in this exact format:
{
  "title": "thread title",
  "post": { "username": "name", "body": "text", "score": 0 },
  "conversations": [
    {
      "root": { "id": "c1", "username": "root_a", "body": "independent top-level comment", "score": 120 },
      "replies": [
        { "id": "c1-r1", "parent_id": "c1", "username": "reply_a", "body": "direct reply to root_a", "score": 45 },
        { "id": "c1-r2", "parent_id": "c1-r1", "username": "root_a", "body": "nested reply to reply_a", "score": 31 }
      ]
    },
    {
      "root": { "id": "c2", "username": "root_b", "body": "another independent top-level comment", "score": 90 },
      "replies": [
        { "id": "c2-r1", "parent_id": "c2", "username": "reply_b", "body": "direct reply to root_b", "score": 28 }
      ]
    },
    {
      "root": { "id": "c3", "username": "root_c", "body": "another independent top-level comment", "score": 70 },
      "replies": [
        { "id": "c3-r1", "parent_id": "c3", "username": "reply_c", "body": "direct reply to root_c", "score": 19 }
      ]
    }
  ]
}
The example demonstrates structure only; scale the number of conversations and replies to the requested discussion size. Each item in conversations is one separate top-level Reddit conversation and contains exactly one root. Every reply must use parent_id equal to that conversation's root id or to the id of an earlier reply inside the SAME conversation. Never move a root into replies and never reference another conversation. At least 35% of all comments must be replies. With 6 or more comments, create at least 3 separate top-level conversations and give each of at least 3 conversations one or more replies. Do not put the entire discussion beneath one root.
Return ONLY the JSON. No explanations, no notes, no commentary.`,
  ].join('\n\n')
}
