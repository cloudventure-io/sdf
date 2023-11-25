import { IResolvable, Token } from "cdktf"
import { Construct } from "constructs"

import { App } from "./App"

class BucketsOfResolvables<Buckets extends readonly [...Array<string>]> {
  private bucketsMap: Record<string, Array<AsyncResolvable<unknown>>>

  constructor(public buckets: Buckets) {
    this.bucketsMap = Object.fromEntries(buckets.map(bucket => [bucket, []]))
  }

  public push(item: AsyncResolvable<unknown>, bucket: string): number {
    return this.bucketsMap[bucket].push(item)
  }

  public prepend(b: BucketsOfResolvables<Buckets>) {
    this.bucketsMap = Object.fromEntries(
      Object.entries(this.bucketsMap).map(([bucket, entries]) => [bucket, [...b.bucketsMap[bucket], ...entries]]),
    )
  }

  public shift(): AsyncResolvable<unknown> | undefined {
    for (const bucket of this.buckets) {
      if (this.bucketsMap[bucket].length > 0) {
        return this.bucketsMap[bucket].shift()
      }
    }
  }

  public values(): Array<AsyncResolvable<unknown>> {
    return this.buckets.map(bucket => this.bucketsMap[bucket]).flat(1)
  }

  public reset() {
    Object.values(this.bucketsMap).map(b => (b.length = 0))
  }

  get length(): number {
    return this.buckets.map(bucket => this.bucketsMap[bucket].length).reduce((acc, len) => acc + len, 0)
  }
}

export enum ResolvableStage {
  init = "init",
  synth = "synth",
  generation = "generation",
}

export const ResolvableStageDefault: ResolvableStage = ResolvableStage.synth
export const ResolvableStageOrder = [ResolvableStage.init, ResolvableStage.synth, ResolvableStage.generation] as const

// export const ResolvableStages = ["init", "synth", "generation"] as const

export interface AppAsyncResolvableState {
  primaryBuffer: BucketsOfResolvables<typeof ResolvableStageOrder>
  contextBuffer: BucketsOfResolvables<typeof ResolvableStageOrder>
  stage?: ResolvableStage
}

/**
 * AsyncResolvable is a helper class for constructing
 * IResolvable objects with async implementation and
 * a reference to a value which will be resolved
 * during async synth process.
 */
export class AsyncResolvable<T> implements IResolvable {
  public creationStack = []

  private static states = new WeakMap<App, AppAsyncResolvableState>()

  private static getAppState(ctx: App | Construct): AppAsyncResolvableState {
    const app = ctx instanceof App ? ctx : App.getAppFromContext(ctx)
    let state = this.states.get(app)
    if (!state) {
      state = {
        primaryBuffer: new BucketsOfResolvables(ResolvableStageOrder),
        contextBuffer: new BucketsOfResolvables(ResolvableStageOrder),
      } satisfies AppAsyncResolvableState
      this.states.set(app, state)
    }
    return state
  }

  public static async resolveApp(app: App) {
    const state = AsyncResolvable.getAppState(app)

    while (state.primaryBuffer.length > 0) {
      const resolvable = state.primaryBuffer.shift()
      if (!resolvable) {
        break
      }

      state.stage = resolvable.stage
      resolvable.ref = await resolvable.resolver()
      resolvable.resolved = true

      if (state.contextBuffer.length > 0) {
        state.primaryBuffer.prepend(state.contextBuffer)
        state.contextBuffer.reset()
      }
    }
  }

  private resolved: boolean = false
  private ref?: T
  public path: string

  constructor(
    scope: Construct,
    name: string,
    public resolver: () => Promise<T>,
    public stage: ResolvableStage = ResolvableStageDefault,
  ) {
    this.path = `${scope.node.path}:${stage}:${name}`
    const state = AsyncResolvable.getAppState(scope)

    if (state.stage && ResolvableStageOrder.indexOf(stage) < ResolvableStageOrder.indexOf(state.stage)) {
      throw new Error(
        `AsyncResolvable '${this.path}' with stage '${stage}' was submitted while being in future stage ${state.stage}`,
      )
    }

    const target = state.stage ? state.contextBuffer : state.primaryBuffer
    target.push(this, stage)
  }

  public resolve(): T {
    if (!this.resolved) {
      throw new Error(`the resolver '${this.path}' was not resolved`)
    }
    return this.ref as T
  }

  public asString(): string {
    return Token.asString(this)
  }
}
