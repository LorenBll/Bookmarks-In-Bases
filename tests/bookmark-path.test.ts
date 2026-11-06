import { describe, expect, it } from 'vitest'
import { buildBookmarkPath } from '../src/bookmarks'

describe('buildBookmarkPath', () => {
  it('builds a top-level bookmark path', () => {
    const r = buildBookmarkPath([], 'Note')
    expect(r).toEqual({ fullPath: 'Note', folder: null, finalTitle: 'Note' })
  })

  it('joins groups with a slash', () => {
    const r = buildBookmarkPath(['Work', 'Projects'], 'Plan')
    expect(r).toEqual({ fullPath: 'Work/Projects/Plan', folder: 'Projects', finalTitle: 'Plan' })
  })

  it('escapes slashes inside titles with //', () => {
    const r = buildBookmarkPath(['A/B'], 'C/D')
    expect(r).toEqual({ fullPath: 'A//B/C//D', folder: 'A//B', finalTitle: 'C//D' })
  })

  it('handles a single group', () => {
    const r = buildBookmarkPath(['G'], 'T')
    expect(r).toEqual({ fullPath: 'G/T', folder: 'G', finalTitle: 'T' })
  })
})