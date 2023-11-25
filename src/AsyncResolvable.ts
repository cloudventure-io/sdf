import { IResolvable, Token } from "cdktf"
import { Construct } from "constructs"

import { App } from "./App"

export enum AppLifeCycleStage {
  /**
   * The synthesis stage is dedicated for new construct creation.
   * This stage is applied from top to bottom walk over the construct tree.
   */
  synthesis = "synthesis",

  /**
   * The generation stage is dedicated for resource generation.
   * This stage is applied from bottom to top walk over the construct tree.
   */
  generation = "generation",
}

export const AppLifeCycleDefaultStage: AppLifeCycleStage = AppLifeCycleStage.synthesis
export const AppLifeCycleStageOrder = [AppLifeCycleStage.synthesis, AppLifeCycleStage.generation] as const

export interface ConstructResolvables {
  synthesis: Array<AsyncResolvable<unknown>>
  generation: Array<AsyncResolvable<unknown>>
}

/**
 * AsyncResolvable is a helper class for constructing
 * IResolvable objects with async implementation and
 * a reference to a value which will be resolved
 * during async tree resolution process.
 */
export class AsyncResolvable<T> implements IResolvable {
  public creationStack = []

  private static resolvables = new WeakMap<Construct, ConstructResolvables>()
  private static stages = new WeakMap<App, AppLifeCycleStage>()

  private static getConstructResolvables(scope: Construct): ConstructResolvables {
    let state = AsyncResolvable.resolvables.get(scope)
    if (!state) {
      state = {
        synthesis: [],
        generation: [],
      }
      AsyncResolvable.resolvables.set(scope, state)
    }
    return state
  }

  public static async resolveApp(app: App) {
    async function resolveState(state: ConstructResolvables, stage: AppLifeCycleStage): Promise<number> {
      let count = 0
      while (state[stage].length > 0) {
        const resolvable = state[stage].shift()
        if (!resolvable) {
          break
        }

        AsyncResolvable.stages.set(app, resolvable.stage)
        resolvable.ref = await resolvable.resolver()
        resolvable.resolved = true
        count++
      }
      return count
    }

    async function visit(c: Construct, stage: AppLifeCycleStage): Promise<number> {
      let count = 0
      const state = AsyncResolvable.resolvables.get(c)

      // synth is applied from top to bottom
      if (state && stage === AppLifeCycleStage.synthesis) {
        count += await resolveState(state, stage)
      }
      // visit child nodes
      for (const child of c.node.children) {
        count += await visit(child, stage)
      }
      // generation is applied from bottom to top
      if (state && stage === AppLifeCycleStage.generation) {
        count += await resolveState(state, stage)
      }
      return count
    }

    // resolve the synth stage
    while ((await visit(app, AppLifeCycleStage.synthesis)) > 0) {
      /* noop */
    }
    // resovle the generation stage
    while ((await visit(app, AppLifeCycleStage.generation)) > 0) {
      /* noop */
    }
  }

  private resolved: boolean = false
  private ref?: T
  public path: string

  constructor(
    scope: Construct,
    name: string,
    public resolver: () => Promise<T>,
    public stage: AppLifeCycleStage = AppLifeCycleDefaultStage,
  ) {
    this.path = `${scope.node.path}:${stage}:${name}`
    const scopeState = AsyncResolvable.getConstructResolvables(scope)
    const lastStage = AsyncResolvable.stages.get(App.getAppFromContext(scope))

    if (lastStage && AppLifeCycleStageOrder.indexOf(stage) < AppLifeCycleStageOrder.indexOf(lastStage)) {
      throw new Error(
        `AsyncResolvable '${this.path}' with stage '${stage}' was submitted while being in future stage ${lastStage}`,
      )
    }

    if (lastStage) {
      scopeState[stage].unshift(this)
    } else {
      scopeState[stage].push(this)
    }
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
