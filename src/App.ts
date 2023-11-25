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

  async synth(): Promise<void> {
    await mkdir(this.workdir, { recursive: true })

    await AsyncResolvable.resolveApp(this)

    const stacks = this.node.findAll().filter<Stack>((construct): construct is Stack => construct instanceof Stack)

    const metadata: AppManifest = {
      stacks: stacks.map(stack => stack._getStackManifest()),
    }

    await writeFile(join(this.workdir, "sdf.manifest.json"), JSON.stringify(metadata, null, 2))

    super.synth()
  }
}
