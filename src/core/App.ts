import { App as CdkTfApp, AppConfig as CdkTfAppConfig, TerraformStack } from "cdktf"
import { Construct } from "constructs"
import { mkdir, writeFile } from "fs/promises"
import { join, resolve } from "path"

import { BundleManifest, Bundler } from "../bundler"
import { Resource } from "./Resource"
import { StackController } from "./StackController"
import { AsyncResolvable } from "./resolvable/AsyncResolvable"
import { TreeResolver } from "./resolvable/TreeResolver"

export interface AppOptions extends CdkTfAppConfig {
  argv?: Array<string>
  outdir: string
  userdata?: unknown
}

export interface StackManifest {
  id: string
  bundles: Array<BundleManifest>
}

export interface AppManifest {
  stacks: Array<StackManifest>
  userdata?: unknown
}

export enum AppLifeCycle {
  /**
   * The construction stage is dedicated for new Construct creation.
   * This stage is applied by top to bottom walk over the construct tree.
   */
  construction = "construction",

  /**
   * The generation stage is dedicated for resource generation.
   * This stage is applied by bottom to top walk over the construct tree.
   */
  generation = "generation",
}

export class App extends CdkTfApp {
  private treeResolver: TreeResolver
  private stackController: StackController

  private _workdir: string

  public userdata?: unknown

  /** The working directory of SDF */
  get workdir(): string {
    return this._workdir
  }

  constructor({ outdir: outdir, userdata, ...options }: AppOptions) {
    super({
      ...options,
      outdir: resolve(outdir),
    })

    this.userdata = userdata

    this.node.setContext(App.name, this)
    this._workdir = join(this.outdir, ".sdf")
    this.treeResolver = new TreeResolver(this)
    this.stackController = new StackController()
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

  public registerResource(resource: Resource, id: string) {
    this.stackController.registerResource(resource, id)
  }

  public getResource(scope: Construct, id: string): Resource {
    return this.stackController.getResource(scope, id)
  }

  public getResources(scope: Construct): Record<string, Resource> {
    return this.stackController.getResources(scope)
  }

  public getStack(scope: Construct): TerraformStack {
    return this.stackController.getStack(scope)
  }

  async synth(): Promise<void> {
    await mkdir(this.workdir, { recursive: true })

    await this.treeResolver.resolve()

    const stacks = this.node
      .findAll()
      .filter<TerraformStack>((construct): construct is TerraformStack => TerraformStack.isStack(construct))

    const metadata: AppManifest = {
      userdata: this.userdata,
      stacks: stacks.map(stack => ({
        id: stack.node.id,
        bundles: stack.node
          .findAll()
          .filter<Bundler>((construct): construct is Bundler => construct instanceof Bundler)
          .map(bundler => bundler.manifest()),
      })),
    }

    await writeFile(join(this.workdir, "sdf.manifest.json"), JSON.stringify(metadata, null, 2))

    super.synth()
  }
}
