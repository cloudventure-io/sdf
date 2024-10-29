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

    if (this.stage && this.stage == AppLifeCycle.generation && stage == AppLifeCycle.construction) {
      throw new Error(
        `AsyncResolvable at '${resolvable.addr}' with stage '${stage}' was submitted while being in future stage ${this.stage}`,
      )
    }

    let resolvables = this.resolvables.get(resolvable.scope)
    if (!resolvables) {
      resolvables = {
        construction: [],
        generation: [],
      }
      this.resolvables.set(resolvable.scope, resolvables)
    }

    resolvables[stage].push(resolvable)
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

    // construction is applied during depth first run
    if (state && stage === AppLifeCycle.construction) {
      activity += await this.resolveStage(state, stage)
    }

    // resolve children
    while ((await this.resolveChildren(c, stage)) > 0) {
      /* continue */
    }

    // generation is applied during breadth first run
    if (state && stage === AppLifeCycle.generation) {
      activity += await this.resolveStage(state, stage)
    }

    return activity
  }

  /** resolve all resolvables in the construct tree */
  public async resolve() {
    // resolve the construction stage
    while ((await this.visit(this.root, AppLifeCycle.construction)) > 0) {
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
