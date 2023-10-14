export class DocumentTrace {
  constructor(
    public file: string,
    public trace: Array<string | number> = [],
  ) {}

  append(...args: Array<Array<string | number> | string | number>): DocumentTrace {
    return new DocumentTrace(this.file, [...this.trace, ...args.flat(1)])
  }

  toString(): string {
    return String(this.file) + (this.trace.length ? "/#" + this.trace.map(encodeURIComponent).join("/") : "")
  }
}
