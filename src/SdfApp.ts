import { App, AppConfig } from "cdktf"
import { Construct } from "constructs"
import { mkdir, writeFile } from "fs/promises"
import { join, resolve } from "path"

import { SdfStack, SdfStackManifest } from "./SdfStack"

export type NamingCase = "param-case" | "PascalCase"
type namingCaseFunction = (...args: Array<string>) => string

const namingCaseFunction: {
  [c in NamingCase]: namingCaseFunction
} = {
  "param-case": (...args: Array<string>) => args.join("-"),
  PascalCase: (...args: Array<string>) => args.map(arg => (arg[0] || "").toUpperCase() + arg.slice(1)).join(""),
}

export interface SdfAppOptions extends AppConfig {
  namingCase?: NamingCase

  outdir: string
}

export interface SdfAppManifest {
  stacks: Array<SdfStackManifest>
}

export class SdfApp extends App {
  private _workdir: string

  /** The working directory of SDF */
  get workdir(): string {
    return this._workdir
  }

  private namingCaseFunction: namingCaseFunction

  constructor({ outdir: outdir, namingCase = "param-case", ...options }: SdfAppOptions) {
    super({
      ...options,
      outdir: resolve(outdir),
    })

    this.node.setContext(SdfApp.name, this)

    this._workdir = join(this.outdir, ".sdf")
    this.namingCaseFunction = namingCaseFunction[namingCase]
  }

  public _concatName(...args: Array<string>) {
    return this.namingCaseFunction(...args)
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

  static getAppFromContext(construct: Construct): SdfApp {
    return SdfApp.getFromContext(construct, SdfApp)
  }

  async synth(): Promise<void> {
    await mkdir(this.workdir, { recursive: true })

    const stacks = this.node
      .findAll()
      .filter<SdfStack>((construct): construct is SdfStack => construct instanceof SdfStack)

    await Promise.all(stacks.map(stack => stack._synth()))

    const metadata: SdfAppManifest = {
      stacks: stacks.map(stack => stack._getStackManifest()),
    }

    await writeFile(join(this.workdir, "sdf.manifest.json"), JSON.stringify(metadata, null, 2))

    super.synth()
  }
}
