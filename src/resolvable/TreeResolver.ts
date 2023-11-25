import { AppLifeCycle } from "../App"
import { AsyncResolvable } from "./AsyncResolvable"

export interface TreeResolverNode {
  node: {
    children: Array<TreeResolverNode>
  }
}

type StageResolvables = { [k in AppLifeCycle]: Array<AsyncResolvable> }

export class TreeResolver {
  private resolvables = new WeakMap<TreeResolverNode, StageResolvables>()
  private stage?: AppLifeCycle

  constructor(private root: TreeResolverNode) {}

  public add(resolvable: AsyncResolvable): void {
    const stage: AppLifeCycle = resolvable.stage

    if (this.stage && this.stage == AppLifeCycle.generation && stage == AppLifeCycle.synthesis) {
      throw new Error(
        `AsyncResolvable at '${resolvable.addr}' with stage '${stage}' was submitted while being in future stage ${this.stage}`,
      )
    }

    let resolvables = this.resolvables.get(resolvable.scope)
    if (!resolvables) {
      resolvables = {
        synthesis: [],
        generation: [],
      }
      this.resolvables.set(resolvable.scope, resolvables)
    }

    if (this.stage) {
      // When stage is set, the resolvable resolution is in progress.
      // We need to add the resolvable to the front of the queue,
      // so that it is resolved as soon as possible after the current resolvable.
      resolvables[stage].unshift(resolvable)
    } else {
      resolvables[stage].push(resolvable)
    }
  }

  private async resolveStage(state: StageResolvables, stage: AppLifeCycle): Promise<number> {
    let activity = 0
    while (state[stage].length > 0) {
      const resolvable = state[stage].shift()
      if (!resolvable) {
        break
      }

      this.stage = resolvable.stage
      await resolvable.resolveAsync()
      activity++
    }
    return activity
  }

  private async resolveChildren(c: TreeResolverNode, stage: AppLifeCycle): Promise<number> {
    let activity = 0
    for (const child of c.node.children) {
      activity += await this.visit(child, stage)
    }
    return activity
  }

  private async visit(c: TreeResolverNode, stage: AppLifeCycle): Promise<number> {
    let activity = 0
    const state = this.resolvables.get(c)

    // synthesis is applied during top to bottom run
    if (state && stage === AppLifeCycle.synthesis) {
      activity += await this.resolveStage(state, stage)
    }

    // resolve all children
    while ((await this.resolveChildren(c, stage)) > 0) {
      /* continue */
    }

    // generation is applied during bottom to top run
    if (state && stage === AppLifeCycle.generation) {
      activity += await this.resolveStage(state, stage)
    }
    return activity
  }

  /** resolve all resolvables in the construct tree */
  public async resolve() {
    // resolve the synth stage
    while ((await this.visit(this.root, AppLifeCycle.synthesis)) > 0) {
      /* continue */
    }

    // resovle the generation stage
    while ((await this.visit(this.root, AppLifeCycle.generation)) > 0) {
      /* continue */
    }

    // reset the stage
    this.stage = undefined
  }
}
