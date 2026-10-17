/** Adapted from Tantoofaaz777/Threadverse (20ee3ca), AGPL-3.0; see architecture/threads.md. */
import { describe, test, expect } from 'bun:test';
import { buildThreadsPrompt, groupConsecutiveStoryRanges, installmentOrRoundLabel, selectNewestLabeledBlocksByTokenBudget, selectPreviousContextByTokenBudget } from './prompt';
import { parseGeneratedThreadsFeed, parseThreadsFeed, serializeFeedAsPlainText, serializeFeedForContinuity } from './feed';
describe('Threads feed and context', () => {
  test('builds story and fandom blocks in chronological order', () => {
    const prompt = buildThreadsPrompt({
      previousRanges: [
        { label: 'RANGE A', content: 'A' },
        { label: 'RANGE B', content: 'B' },
      ],
      recentRange: { label: 'RANGE C', content: 'C' },
      fandomContinuity: [
        { label: 'THREAD A', content: 'TA' },
        { label: 'THREAD B', content: 'TB' },
      ],
      fandomNotes: 'Remember the running joke.',
      instructions: 'Instructions',
    })

    const markers = [
      'RANGE A',
      'RANGE B',
      'RANGE C',
      'THREAD A',
      'THREAD B',
      'FANDOM NOTES',
      'Remember the running joke.',
      'INSTRUCTIONS',
    ]
    const positions = markers.map((marker) => prompt.indexOf(marker))
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  test('groups consecutive ranges under their literal installment label', () => {
    const grouped = groupConsecutiveStoryRanges([
      { label: 'ZETA - S01E03', content: 'Scene A' },
      { label: 'ZETA - S01E03', content: 'Scene B' },
      { label: 'ZETA - S01E04', content: 'Scene C' },
      { label: 'ZETA - S01E03', content: 'Scene D' },
    ])

    expect(grouped).toEqual([
      { label: 'ZETA - S01E03', content: 'Scene A\n\nScene B' },
      { label: 'ZETA - S01E04', content: 'Scene C' },
      { label: 'ZETA - S01E03', content: 'Scene D' },
    ])

    const prompt = buildThreadsPrompt({
      previousRanges: grouped.slice(0, 2),
      recentRange: { label: 'ZETA - S01E05', content: 'Current scene' },
      fandomContinuity: [],
      instructions: 'Discuss it.',
    })
    expect(prompt).toContain(
      '## ZETA - S01E03\nScene A\n\nScene B\n\n## ZETA - S01E04\nScene C',
    )
    expect(prompt).toContain('# RECENT CONTEXT\n\n## ZETA - S01E05\nCurrent scene')
  })

  test('keeps the newest whole messages within the Previous Context token budget', async () => {
    const countMessagesAsTokens = async (text: string) => text.match(/message/g)?.length ?? 0
    const selected = await selectPreviousContextByTokenBudget([
      { label: 'CHAPTER 1', messages: ['old message 1', 'old message 2'] },
      { label: 'CHAPTER 2', messages: ['new message 1', 'new message 2'] },
    ], 3, countMessagesAsTokens)

    expect(selected).toEqual([
      { label: 'CHAPTER 1', content: 'old message 2' },
      { label: 'CHAPTER 2', content: 'new message 1\n\nnew message 2' },
    ])
    expect(await selectPreviousContextByTokenBudget([
      { label: 'CHAPTER 1', messages: ['one message'] },
    ], 0, countMessagesAsTokens)).toEqual([])
  })

  test('keeps only the newest whole fandom threads within its token budget', async () => {
    const countThreadsAsTokens = async (text: string) => text.match(/thread/g)?.length ?? 0
    const threads = [
      { roundId: 'round-1', label: 'CHAPTER 1', content: 'old thread' },
      { roundId: 'round-2', label: 'CHAPTER 2', content: 'middle thread' },
      { roundId: 'round-3', label: 'CHAPTER 3', content: 'new thread' },
    ]

    expect(await selectNewestLabeledBlocksByTokenBudget(
      threads,
      2,
      countThreadsAsTokens,
    )).toEqual(threads.slice(-2))
    expect(await selectNewestLabeledBlocksByTokenBudget(
      threads,
      0,
      countThreadsAsTokens,
    )).toEqual([])
  })

  test('uses only installment labels in fandom continuity with a legacy round fallback', () => {
    expect(installmentOrRoundLabel('ZETA - S01E03', 4)).toBe('ZETA - S01E03')
    expect(installmentOrRoundLabel('', 4)).toBe('ROUND 4')
    expect(installmentOrRoundLabel('ZETA - S01E03', 4)).not.toContain('FANDOM THREAD')
  })

  test('omits the fandom notes block completely when notes are empty', () => {
    const prompt = buildThreadsPrompt({
      previousRanges: [],
      recentRange: { label: 'CURRENT RANGE', content: 'Story' },
      fandomContinuity: [],
      fandomNotes: '   ',
      instructions: 'Discuss the story.',
    })

    expect(prompt).not.toContain('# PREVIOUS CONTEXT')
    expect(prompt).not.toContain('# FANDOM CONTINUITY')
    expect(prompt).not.toContain('# FANDOM NOTES')
    expect(prompt).toContain('# RECENT CONTEXT')
  })

  test('asks the model for separate verbose conversation groups', () => {
    const prompt = buildThreadsPrompt({
      previousRanges: [],
      recentRange: { label: 'ROUND 1', content: 'Story' },
      fandomContinuity: [],
      instructions: 'Discuss the story.',
    })
    const outputFormat = prompt.slice(prompt.indexOf('# OUTPUT FORMAT'))

    expect(outputFormat).toContain('"title"')
    expect(outputFormat).toContain('"username"')
    expect(outputFormat).toContain('"body"')
    expect(outputFormat).toContain('"score"')
    expect(outputFormat).toContain('"conversations"')
    expect(outputFormat).toContain('"root"')
    expect(outputFormat).toContain('"replies"')
    expect(outputFormat).toContain('"parent_id"')
    expect(outputFormat).toContain('Each item in conversations is one separate top-level Reddit conversation')
    expect(outputFormat).toContain('At least 35% of all comments must be replies')
    expect(outputFormat).toContain('create at least 3 separate top-level conversations')
    expect(outputFormat).not.toContain('"subreddit"')
    expect(outputFormat).not.toContain('"flair"')
    expect(outputFormat).not.toContain('"timestamp"')
  })

  test('reconstructs verbose conversation groups into separate reply trees', () => {
    const feed = parseGeneratedThreadsFeed(JSON.stringify({
      title: 'Grouped discussion',
      post: { username: 'OP', body: 'Opening', score: 100 },
      conversations: [
        {
          root: { id: 'c1', username: 'root-a', body: 'Root A', score: 50 },
          replies: [
            { id: 'c1-r1', parent_id: 'c1', username: 'reply-a', body: 'Reply A', score: 30 },
            { id: 'c1-r2', parent_id: 'c1-r1', username: 'nested-a', body: 'Nested A', score: 20 },
          ],
        },
        {
          root: { id: 'c2', username: 'root-b', body: 'Root B', score: 45 },
          replies: [
            { id: 'c2-r1', parent_id: 'c2', username: 'reply-b', body: 'Reply B', score: 25 },
          ],
        },
        {
          root: { id: 'c3', username: 'root-c', body: 'Root C', score: 40 },
          replies: [
            { id: 'c3-r1', parent_id: 'c3', username: 'reply-c', body: 'Reply C', score: 15 },
          ],
        },
      ],
    }))

    expect(feed.comments.map((comment) => comment.username)).toEqual(['root-a', 'root-b', 'root-c'])
    expect(feed.comments[0].replies[0].username).toBe('reply-a')
    expect(feed.comments[0].replies[0].replies[0].username).toBe('nested-a')
    expect(feed.comments[1].replies[0].username).toBe('reply-b')
    expect(feed.comments[2].replies[0].username).toBe('reply-c')
  })

  test('repairs an invalid conversation parent back to its local root', () => {
    const feed = parseGeneratedThreadsFeed(JSON.stringify({
      title: 'Repaired discussion',
      post: { username: 'OP', body: 'Opening', score: 100 },
      conversations: [
        {
          root: { id: 'c1', username: 'root-a', body: 'Root A', score: 50 },
          replies: [{ id: 'c1-r1', parent_id: 'not-in-this-conversation', username: 'reply-a', body: 'Reply A', score: 30 }],
        },
        {
          root: { id: 'c2', username: 'root-b', body: 'Root B', score: 45 },
          replies: [{ id: 'c2-r1', parent_id: 'c2', username: 'reply-b', body: 'Reply B', score: 25 }],
        },
        {
          root: { id: 'c3', username: 'root-c', body: 'Root C', score: 40 },
          replies: [{ id: 'c3-r1', parent_id: 'c3', username: 'reply-c', body: 'Reply C', score: 15 }],
        },
      ],
    }))

    expect(feed.comments[0].replies[0].username).toBe('reply-a')
  })

  test('accepts a large discussion with seven substantial top-level conversations', () => {
    const conversations = Array.from({ length: 7 }, (_, conversationIndex) => {
      const rootId = `c${conversationIndex + 1}`
      return {
        root: {
          id: rootId,
          username: `root-${conversationIndex + 1}`,
          body: `Root ${conversationIndex + 1}`,
          score: 20,
        },
        replies: Array.from({ length: 5 }, (_, replyIndex) => ({
          id: `${rootId}-r${replyIndex + 1}`,
          parent_id: rootId,
          username: `reply-${conversationIndex + 1}-${replyIndex + 1}`,
          body: `Reply ${replyIndex + 1}`,
          score: 10,
        })),
      }
    })

    const feed = parseGeneratedThreadsFeed(JSON.stringify({
      title: 'Large discussion',
      post: { username: 'OP', body: 'Opening', score: 100 },
      conversations,
    }))

    expect(feed.comments).toHaveLength(7)
    expect(feed.comments.reduce((total, comment) => total + comment.replies.length, 0)).toBe(35)
  })

  test('rejects a long discussion with fewer than three top-level conversations', () => {
    const conversations = Array.from({ length: 2 }, (_, conversationIndex) => {
      const rootId = `c${conversationIndex + 1}`
      return {
        root: {
          id: rootId,
          username: `root-${conversationIndex + 1}`,
          body: `Root ${conversationIndex + 1}`,
          score: 20,
        },
        replies: Array.from({ length: 4 }, (_, replyIndex) => ({
          id: `${rootId}-r${replyIndex + 1}`,
          parent_id: rootId,
          username: `reply-${conversationIndex + 1}-${replyIndex + 1}`,
          body: `Reply ${replyIndex + 1}`,
          score: 10,
        })),
      }
    })

    expect(() => parseGeneratedThreadsFeed(JSON.stringify({
      title: 'Too few roots',
      post: { username: 'OP', body: 'Opening', score: 100 },
      conversations,
    }))).toThrow('at least 3 are required')
  })

  test('parses fenced JSON and common author/content aliases', () => {
    const feed = parseThreadsFeed(`Here is the result:\n\`\`\`json
      {"subreddit":"legacy","title":"Episode discussion","post":{"author":"OP","content":"Opening","upvotes":12,"flair":"Old"},"comments":[{"id":"old-id","author":"viewer","text":"Theory","timestamp":"1h","replies":[]}]}
    \`\`\``)
    expect(feed.post.username).toBe('OP')
    expect(feed.post.score).toBe(12)
    expect(feed.comments[0].username).toBe('viewer')
    expect(feed).not.toHaveProperty('subreddit')
    expect(feed.post).not.toHaveProperty('flair')
    expect(feed.comments[0]).not.toHaveProperty('id')
  })

  test('reconstructs positional parent indexes into the exact reply tree', () => {
    const feed = parseGeneratedThreadsFeed(JSON.stringify({
      title: 'Episode discussion',
      post: { username: 'OP', body: 'Opening', score: 100 },
      comments: [
        [0, 'root-a', 'Root A', 50],
        [1, 'reply-a', 'Reply to A', 30],
        [2, 'reply-a-2', 'Reply to the reply', 20],
        [0, 'root-b', 'Root B', 45],
        [4, 'reply-b', 'Reply to B', 25],
        [0, 'root-c', 'Root C', 40],
        ['6', 'reply-c', 'Reply to C', 15],
      ],
    }))

    expect(feed.comments.map((comment) => comment.username)).toEqual(['root-a', 'root-b', 'root-c'])
    expect(feed.comments[0].replies[0].username).toBe('reply-a')
    expect(feed.comments[0].replies[0].replies[0].username).toBe('reply-a-2')
    expect(feed.comments[1].replies[0].username).toBe('reply-b')
    expect(feed.comments[2].replies[0].username).toBe('reply-c')
  })

  test('keeps old zero-based parent rows compatible', () => {
    const feed = parseThreadsFeed(JSON.stringify({
      title: 'Legacy indexes',
      post: { username: 'OP', body: 'Opening', score: 10 },
      comments: [
        [-1, 'root', 'Root', 3],
        [0, 'reply', 'Reply', 2],
        [1, 'nested', 'Nested reply', 1],
      ],
    }))

    expect(feed.comments[0].replies[0].username).toBe('reply')
    expect(feed.comments[0].replies[0].replies[0].username).toBe('nested')
  })

  test('repairs the mixed one-based format produced with the old root marker', () => {
    const feed = parseGeneratedThreadsFeed(JSON.stringify({
      title: 'Mixed indexes',
      post: { username: 'OP', body: 'Opening', score: 10 },
      comments: [
        [-1, 'root-a', 'Root A', 6],
        [1, 'reply-a', 'Reply A', 5],
        [-1, 'root-b', 'Root B', 4],
        [3, 'reply-b', 'Reply B', 3],
        [-1, 'root-c', 'Root C', 2],
        [5, 'reply-c', 'Reply C', 1],
      ],
    }))

    expect(feed.comments.map((comment) => comment.username)).toEqual(['root-a', 'root-b', 'root-c'])
    expect(feed.comments.map((comment) => comment.replies[0]?.username)).toEqual([
      'reply-a',
      'reply-b',
      'reply-c',
    ])
  })

  test('rejects a generated discussion that is too flat', () => {
    const positionalComments = Array.from({ length: 10 }, (_, index) => [
      -1,
      `user-${index}`,
      `Comment ${index}`,
      index,
    ])

    expect(() => parseGeneratedThreadsFeed(JSON.stringify({
      title: 'Flat discussion',
      post: { username: 'OP', body: 'Opening', score: 10 },
      comments: positionalComments,
    }))).toThrow('flat discussion')

    const legacyComments = Array.from({ length: 10 }, (_, index) => ({
      username: `legacy-${index}`,
      body: `Comment ${index}`,
      score: index,
    }))
    expect(() => parseGeneratedThreadsFeed(JSON.stringify({
      title: 'Flat legacy discussion',
      post: { username: 'OP', body: 'Opening', score: 10 },
      comments: legacyComments,
    }))).toThrow('flat discussion')
  })

  test('requires replies across separate top-level conversations', () => {
    expect(() => parseGeneratedThreadsFeed(JSON.stringify({
      title: 'Single branch',
      post: { username: 'OP', body: 'Opening', score: 10 },
      comments: [
        [-1, 'root', 'Root', 10],
        [0, 'reply-1', 'Reply 1', 9],
        [1, 'reply-2', 'Reply 2', 8],
        [2, 'reply-3', 'Reply 3', 7],
        [3, 'reply-4', 'Reply 4', 6],
        [4, 'reply-5', 'Reply 5', 5],
      ],
    }))).toThrow('at least 3 are required')
  })

  test('reconstructs positional comments that appear before their parent', () => {
    const feed = parseThreadsFeed(JSON.stringify({
      title: 'Out-of-order parent',
      post: { username: 'OP', body: 'Opening', score: 10 },
      comments: [
        [0, 'root-a', 'Root A', 4],
        [4, 'reply-b', 'Reply before root B', 3],
        [0, 'root-c', 'Root C', 2],
        [0, 'root-b', 'Root B', 1],
      ],
    }))

    expect(feed.comments.map((comment) => comment.username)).toEqual(['root-a', 'root-c', 'root-b'])
    expect(feed.comments[2].replies[0].username).toBe('reply-b')
  })

  test('repairs a self parent marker as a top-level comment', () => {
    const feed = parseThreadsFeed(JSON.stringify({
      title: 'Self root marker',
      post: { username: 'OP', body: 'Opening', score: 10 },
      comments: [
        [0, 'root-a', 'Root A', 3],
        [2, 'root-b', 'Root B', 2],
        [2, 'reply-b', 'Reply to B', 1],
      ],
    }))

    expect(feed.comments.map((comment) => comment.username)).toEqual(['root-a', 'root-b'])
    expect(feed.comments[1].replies[0].username).toBe('reply-b')
  })

  test('rejects nonexistent parent rows and parent cycles', () => {
    expect(() => parseThreadsFeed(JSON.stringify({
      title: 'Missing parent',
      post: { username: 'OP', body: 'Opening', score: 10 },
      comments: [
        [0, 'root', 'Root', 2],
        [99, 'reply', 'Impossible reply', 1],
      ],
    }))).toThrow('invalid parent index (99)')

    expect(() => parseThreadsFeed(JSON.stringify({
      title: 'Parent cycle',
      post: { username: 'OP', body: 'Opening', score: 10 },
      comments: [
        [0, 'root', 'Root', 3],
        [3, 'cycle-a', 'Cycle A', 2],
        [2, 'cycle-b', 'Cycle B', 1],
      ],
    }))).toThrow('parent cycle')
  })

  test('serializes compact fandom continuity text with scores in reading order', () => {
    const feed = parseThreadsFeed(JSON.stringify({
      title: 'Discussion',
      post: { username: 'OP', body: 'Opening', score: 10 },
      comments: [
        { username: 'root', body: 'Root', score: 5 },
        { username: 'parent', body: 'Parent', score: 4, replies: [
          { username: 'reply', body: 'Reply', score: 2 },
        ] },
      ],
    }))
    const serialized = serializeFeedForContinuity(feed)
    expect(serialized).toBe(
      'Discussion\n\nOP [10]:\nOpening\n\nroot [5]:\nRoot\n\nparent [4]:\nParent\n\nreply [2]:\nReply',
    )
    expect(serialized).not.toContain('"username"')
  })

  test('serializes a feed as clean text in reading order', () => {
    const feed = parseThreadsFeed(JSON.stringify({
      title: 'Episode discussion',
      post: { username: 'OP', body: 'Opening post', score: 10 },
      comments: [
        { username: 'root', body: 'Root comment', score: 5, replies: [
          { username: 'reply', body: 'Nested reply', score: 2 },
        ] },
        { username: 'second', body: 'Second comment', score: 1 },
      ],
    }))

    expect(serializeFeedAsPlainText(feed)).toBe(
      'Episode discussion\n\nOP:\nOpening post\n\nroot:\nRoot comment\n\nreply:\nNested reply\n\nsecond:\nSecond comment',
    )
  })

  test('rejects a response without the required feed shape', () => {
    expect(() => parseThreadsFeed('{"title":"Missing fields"}')).toThrow()
  })
});
