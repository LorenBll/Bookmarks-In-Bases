// Minimal Obsidian API stub for tests. Provides the classes/functions that the
// plugin's pure logic depends on, without the real host runtime.

export class TFile {
  path: string
  constructor(path = '') {
    this.path = path
  }
}

export class TFolder {}

export class App {
  vault = {
    getAbstractFileByPath: (p: string): unknown => null,
  }
}

export class Plugin {}

export class PluginSettingTab {}

export class Value {
  static type = 'value'
  toString(): string { return '' }
  isTruthy(): boolean { return true }
  equals(_other: unknown): boolean { return false }
  renderTo(_el: unknown, _ctx?: unknown): void {}
}

export class StringValue extends Value {
  constructor(public value: string = '') { super() }
  toString(): string { return this.value }
}

export class BooleanValue extends Value {
  constructor(public value: boolean = false) { super() }
  toString(): string { return String(this.value) }
}

export class NullValue extends Value {
  static value = new NullValue()
}

export class ListValue extends Value {
  constructor(public items: unknown[] = []) { super() }
}

export class FileValue extends Value {}