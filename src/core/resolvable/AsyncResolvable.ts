import { IResolvable, Token } from "cdktf"
import { Construct } from "constructs"

import { App, AppLifeCycle } from "../App"

/**
 * AsyncResolvable is a helper class for constructing
 * IResolvable objects with async implementation and
 * a reference to a value which will be resolved
 * during async tree resolution process.
 */
export class AsyncResolvable<T = unknown> implements IResolvable {
  public creationStack = []

  private resolved: boolean = false
  private ref?: T
  public readonly addr: string

  constructor(
    public readonly scope: Construct,
    public readonly name: string,
    public readonly resolver: () => Promise<T>,
    public readonly stage: AppLifeCycle = AppLifeCycle.construction,
  ) {
    this.addr = `${scope.node.path},stage=${stage},name=${name}`
    App.getAppFromContext(scope).addResolvable(this)
  }

  public resolve(): T {
    if (!this.resolved) {
      throw new Error(`the resolver '${this.addr}' was not resolved`)
    }
    return this.ref as T
  }

  public async resolveAsync(): Promise<T> {
    if (!this.resolved) {
      this.ref = await this.resolver()
      this.resolved = true
    }
    return this.ref as T
  }

  public asString(): string {
    return Token.asString(this)
  }

  public asStringMap(): { [key: string]: string } {
    return Token.asStringMap(this)
  }
}
