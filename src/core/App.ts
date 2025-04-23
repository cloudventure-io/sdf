import { App as CdkTfApp, AppConfig as CdkTfAppConfig, TerraformStack } from "cdktf"
import { Construct } from "constructs"
import { mkdir, writeFile } from "fs/promises"
import { join, resolve } from "path"

import { BundleManifest, Bundler } from "../bundler"
import { isinstance } from "../utils/isinstance"
import { Resource } from "./Resource"
import { StackController } from "./StackController"
import { StackModule } from "./StackModule"
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

const APP_SYMBOL = Symbol.for("sdf/core/App")

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
    Object.defineProperty(this, APP_SYMBOL, { value: true })

    this.userdata = userdata

    this._workdir = join(this.outdir, ".sdf")
    this.treeResolver = new TreeResolver(this)
    this.stackController = new StackController()
  }

  public static isApp(x: any): x is App {
    return isinstance(x, App, APP_SYMBOL)
  }

  public static findInScopes<T extends (new (...args: any[]) => any) | (abstract new (...args: any[]) => any)>(
    construct: Construct,
    isinstance: (c: Construct) => c is InstanceType<T>,
  ): InstanceType<T> {
    let value: InstanceType<T> | undefined
    let currentScope = construct

    do {
      value = [...currentScope.node.scopes].reverse().find((scope: Construct) => isinstance(scope))

      if (value) {
        break
      }

      const stack = TerraformStack.of(construct)
      if (StackModule.isStackModule(stack)) {
        currentScope = stack.module
      } else {
        break
      }
    } while (currentScope)

    if (!value) {
      throw new Error(`cannot find the construct in context`)
    }

    return value
  }

  public static of(construct: Construct): App {
    return App.findInScopes(construct, App.isApp)
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

  private intersectStacks(
    srcStack: TerraformStack,
    dstStack: TerraformStack,
  ): { srcChain: Array<StackModule>; dstChain: Array<StackModule>; srcRoot: TerraformStack; dstRoot: TerraformStack } {
    const getStackChain = (stack: TerraformStack): [Array<StackModule>, TerraformStack] => {
      const chain: Array<StackModule> = []
      while (StackModule.isStackModule(stack)) {
        chain.push(stack)
        stack = this.getStack(stack.module)
      }
      return [chain, stack]
    }

    const [srcChain, srcRoot] = getStackChain(srcStack)
    const [dstChain, dstRoot] = getStackChain(dstStack)

    if (srcRoot !== dstRoot) {
      return {
        srcChain,
        dstChain: dstChain.reverse(),
        srcRoot,
        dstRoot,
      }
    }

    let ancestor: TerraformStack | undefined
    for (const src of srcChain) {
      if (dstChain.includes(src)) {
        ancestor = src
        break
      }
    }

    if (!ancestor) {
      ancestor = srcRoot
    }

    const srcAncestorIndex = srcChain.indexOf(ancestor as StackModule)
    if (srcAncestorIndex !== -1) {
      srcChain.splice(srcAncestorIndex)
    }
    const dstAncestorIndex = dstChain.indexOf(ancestor as StackModule)
    if (dstAncestorIndex !== -1) {
      dstChain.splice(dstAncestorIndex)
    }
    dstChain.reverse()

    return {
      srcChain,
      dstChain,
      srcRoot,
      dstRoot,
    }
  }

  public crossStackReference(fromStack: TerraformStack, toStack: TerraformStack, identifier: string): string {
    const intersection = this.intersectStacks(fromStack, toStack)
    const uniqueId = `${fromStack.node.id}.${identifier}`

    let currentOutputId = identifier

    intersection.srcChain.forEach(src => {
      currentOutputId = src.registerOutgoingCrossModuleReference(uniqueId, currentOutputId)
    })

    if (intersection.srcRoot !== intersection.dstRoot) {
      currentOutputId = super.crossStackReference(intersection.srcRoot, intersection.dstRoot, currentOutputId)
    }

    intersection.dstChain.forEach(dst => {
      currentOutputId = dst.registerIncomingCrossModuleReference(uniqueId, currentOutputId)
    })

    return currentOutputId
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
          .filter<Bundler>((construct: Construct) => Bundler.isBundler(construct))
          .map(bundler => bundler.manifest()),
      })),
    }

    await writeFile(join(this.workdir, "sdf.manifest.json"), JSON.stringify(metadata, null, 2))

    super.synth()
  }
}
