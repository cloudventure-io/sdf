import { App as CdkTfApp, AppConfig as CdkTfAppConfig } from "cdktf"
import { Construct } from "constructs"
import { mkdir, writeFile } from "fs/promises"
import { join, resolve } from "path"

import { Stack, StackManifest } from "./Stack"
import { AsyncResolvable } from "./resolvable/AsyncResolvable"
import { TreeResolver } from "./resolvable/TreeResolver"

export interface AppOptions extends CdkTfAppConfig {
  argv?: Array<string>
  outdir: string
}

export interface AppManifest {
  stacks: Array<StackManifest>
}

export enum AppLifeCycle {
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

export class App extends CdkTfApp {
  private treeResolver: TreeResolver
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
    this.treeResolver = new TreeResolver(this)
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

  public addResolvable(resolvable: AsyncResolvable) {
    this.treeResolver.add(resolvable)
  }

  async synth(): Promise<void> {
    await mkdir(this.workdir, { recursive: true })

    await this.treeResolver.resolve()

    const stacks = this.node.findAll().filter<Stack>((construct): construct is Stack => construct instanceof Stack)

    const metadata: AppManifest = {
      stacks: stacks.map(stack => stack._getStackManifest()),
    }

    await writeFile(join(this.workdir, "sdf.manifest.json"), JSON.stringify(metadata, null, 2))

    super.synth()
  }
}
