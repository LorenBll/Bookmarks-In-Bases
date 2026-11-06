import { describe, expect, it } from 'vitest'
import { App, TFile } from 'obsidian'
import { getFileFromFormulaContext, getFileFromValue } from '../src/bookmarks'

describe('getFileFromFormulaContext', () => {
  it('returns null for non-object input', () => {
    const app = new App()
    expect(getFileFromFormulaContext(app, null)).toBeNull()
    expect(getFileFromFormulaContext(app, 'x')).toBeNull()
    expect(getFileFromFormulaContext(app, 42)).toBeNull()
  })

  it('returns a direct TFile on ctx.file', () => {
    const app = new App()
    const f = new TFile('a.md')
    expect(getFileFromFormulaContext(app, { file: f })).toBe(f)
  })

  it('resolves a path string on ctx.file', () => {
    const app = new App()
    const f = new TFile('a.md')
    app.vault.getAbstractFileByPath = (p: string) => (p === 'a.md' ? f : null)
    expect(getFileFromFormulaContext(app, { file: { path: 'a.md' } })).toBe(f)
  })

  it('returns null when nothing matches', () => {
    const app = new App()
    expect(getFileFromFormulaContext(app, { foo: 'bar' })).toBeNull()
  })
})

describe('getFileFromValue', () => {
  it('returns null for falsy input', () => {
    const app = new App()
    expect(getFileFromValue(app, null)).toBeNull()
    expect(getFileFromValue(app, undefined)).toBeNull()
  })

  it('returns the value when it is a TFile', () => {
    const app = new App()
    const f = new TFile('a.md')
    expect(getFileFromValue(app, f)).toBe(f)
  })

  it('unwraps file/data/_file properties', () => {
    const app = new App()
    const f = new TFile('a.md')
    expect(getFileFromValue(app, { file: f })).toBe(f)
    expect(getFileFromValue(app, { data: f })).toBe(f)
    expect(getFileFromValue(app, { _file: f })).toBe(f)
  })

  it('resolves path strings', () => {
    const app = new App()
    const f = new TFile('a.md')
    app.vault.getAbstractFileByPath = (p: string) => (p === 'a.md' ? f : null)
    expect(getFileFromValue(app, { path: 'a.md' })).toBe(f)
  })
})