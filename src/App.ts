import { App as CdkTfApp, AppConfig as CdkTfAppConfig } from "cdktf"
import { Construct } from "constructs"
import { mkdir, writeFile } from "fs/promises"
import { join, resolve } from "path"

import { AsyncResolvable } from "./AsyncResolvable"
import { Stack, StackManifest } from "./Stack"

export interface AppOptions extends CdkTfAppConfig {
  argv?: Array<string>
  outdir: string
}

export interface AppManifest {
  stacks: Array<StackManifest>
}

export enum AppLifecycleStage {
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

type ConstructLifecycleResolvables = Record<AppLifecycleStage, Array<AsyncResolvable<unknown>>>

export class App extends CdkTfApp {
  private _workdir: string

  /** The working directory of SDF */
  get workdir(): string {
    return this._workdir
  }

  constructor({ outdir: outdir, ...options }: AppOptions) {
    super({
      ...options,
      outdir: resolve(outdir),
    })

    this.node.setContext(App.name, this)
    this._workdir = join(this.outdir, ".sdf")
  }

  public static getFromContext<T extends (new (...args: any[]) => any) | (abstract new (...args: any[]) => any)>(
    construct: Construct,
    type: T,
  ): InstanceType<T> {
    const value: any = construct.node.tryGetContext(type.name)
    if (!value) {
      throw new Error(`cannot find ${type.name} in context`)
    } else if (!(value instanceof type)) {
      throw new Error(`the value in context is not an instance of ${type.name} type`)
    }
    return value
  }

  static getAppFromContext(construct: Construct): App {
    return App.getFromContext(construct, App)
  }

  private resolvables = new WeakMap<Construct, ConstructLifecycleResolvables>()
  private appStage?: AppLifecycleStage

  public addResolvable<T>(resolvable: AsyncResolvable<T>): void {
    const stage: AppLifecycleStage = resolvable.stage

    if (this.appStage && this.appStage == AppLifecycleStage.generation && stage == AppLifecycleStage.synthesis) {
      throw new Error(
        `AsyncResolvable at '${resolvable.addr}' with stage '${stage}' was submitted while being in future stage ${this.appStage}`,
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

    if (this.appStage) {
      resolvables[stage].unshift(resolvable)
    } else {
      resolvables[stage].push(resolvable)
    }
  }

  /** resolve all resolvables in the construct tree */
  public async resolve() {
    const resolveState = async (state: ConstructLifecycleResolvables, stage: AppLifecycleStage): Promise<number> => {
      let count = 0
      while (state[stage].length > 0) {
        const resolvable = state[stage].shift()
        if (!resolvable) {
          break
        }

        this.appStage = resolvable.stage
        await resolvable.resolveAsync()
        count++
      }
      return count
    }

    const visit = async (c: Construct, stage: AppLifecycleStage): Promise<number> => {
      let count = 0
      const state = this.resolvables.get(c)

      // synth is applied from top to bottom
      if (state && stage === AppLifecycleStage.synthesis) {
        count += await resolveState(state, stage)
      }
      // visit child nodes
      for (const child of c.node.children) {
        count += await visit(child, stage)
      }
      // generation is applied from bottom to top
      if (state && stage === AppLifecycleStage.generation) {
        count += await resolveState(state, stage)
      }
      return count
    }

    // resolve the synth stage
    while ((await visit(this, AppLifecycleStage.synthesis)) > 0) {
      /* noop */
    }
    // resovle the generation stage
    while ((await visit(this, AppLifecycleStage.generation)) > 0) {
      /* noop */
    }
  }

  async synth(): Promise<void> {
    await mkdir(this.workdir, { recursive: true })

    await this.resolve()

    const stacks = this.node.findAll().filter<Stack>((construct): construct is Stack => construct instanceof Stack)

    const metadata: AppManifest = {
      stacks: stacks.map(stack => stack._getStackManifest()),
    }

    await writeFile(join(this.workdir, "sdf.manifest.json"), JSON.stringify(metadata, null, 2))

    super.synth()
  }
}
