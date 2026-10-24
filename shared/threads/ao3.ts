/** Adapted from Tantoofaaz777/Threadverse (20ee3ca), AGPL-3.0. See architecture/threads.md. */
export const AO3_RATINGS = [
  'Not Rated', 'General Audiences', 'Teen And Up Audiences', 'Mature', 'Explicit',
] as const

export const AO3_WARNINGS = [
  'Creator Chose Not To Use Archive Warnings',
  'No Archive Warnings Apply',
  'Graphic Depictions Of Violence',
  'Major Character Death',
  'Rape/Non-Con',
  'Underage Sex',
] as const

export const AO3_CATEGORIES = ['F/F', 'F/M', 'Gen', 'M/M', 'Multi', 'Other'] as const

export const AO3_TEXT_FIELDS = [
  ['title', 'Title'],
  ['summary', 'Summary'],
  ['fandom', 'Fandom'],
  ['relationships', 'Relationships'],
  ['characters', 'Characters'],
  ['additionalTags', 'Additional Tags'],
  ['language', 'Language'],
] as const

export interface Ao3Information {
  enabled: boolean
  rating: typeof AO3_RATINGS[number] | null
  archiveWarnings: Array<typeof AO3_WARNINGS[number]>
  categories: Array<typeof AO3_CATEGORIES[number]>
  title: string
  summary: string
  fandom: string
  relationships: string
  characters: string
  additionalTags: string
  language: string
}

export function emptyAo3Information(): Ao3Information {
  return {
    enabled: false, rating: null, archiveWarnings: [], categories: [],
    title: '', summary: '', fandom: '', relationships: '', characters: '', additionalTags: '', language: '',
  }
}

export function normalizeAo3Information(value: unknown): Ao3Information {
  const result = emptyAo3Information()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result
  const raw = value as Record<string, unknown>
  result.enabled = raw.enabled === true
  result.rating = AO3_RATINGS.find((rating) => rating === raw.rating) ?? null
  result.archiveWarnings = AO3_WARNINGS.filter((warning) => Array.isArray(raw.archiveWarnings) && raw.archiveWarnings.includes(warning))
  result.categories = AO3_CATEGORIES.filter((category) => Array.isArray(raw.categories) && raw.categories.includes(category))
  for (const [key] of AO3_TEXT_FIELDS) {
    if (typeof raw[key] === 'string') result[key] = raw[key]
  }
  return result
}

export function serializeAo3Information(value: Ao3Information | undefined): string {
  if (!value?.enabled) return ''
  const fields: Array<[string, string]> = [
    ['Rating', value.rating ?? ''],
    ['Archive Warnings', value.archiveWarnings.join(', ')],
    ['Category', value.categories.join(', ')],
    ...AO3_TEXT_FIELDS.map(([key, label]): [string, string] => [label, value[key]]),
  ]
  const content = fields.filter(([, text]) => text.trim()).map(([label, text]) => `${label}: ${text.trim()}`)
  if (!content.length) return ''
  return [
    ...content,
    'These are the work\'s published metadata and tags. Use them to inform reader expectations and speculation, without assuming tagged events have already happened in the story. Keep the existing discussion format.',
  ].join('\n')
}
