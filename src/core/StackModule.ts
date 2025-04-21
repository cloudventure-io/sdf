import {
  IResolvable,
  TerraformHclModule,
  TerraformHclModuleConfig,
  TerraformOutput,
  TerraformProvider,
  TerraformStack,
  TerraformVariable,
  ref,
} from "cdktf"
import { Construct } from "constructs"

import { App } from "./App"

export type TerraformVariables = TerraformHclModuleConfig["variables"]
export type TerraformProviders = Record<string, TerraformProvider>

export interface ModuleConfig<Variables extends TerraformVariables, Providers extends TerraformProviders> {
  variables?: Variables
  providers?: Providers
}

export class StackModule<
  Variables extends TerraformVariables = TerraformVariables,
  Providers extends TerraformProviders = TerraformProviders,
  SetContext extends (scope: Construct) => void = (scope: Construct) => void,
> extends TerraformStack {
  public readonly variables: { [key in keyof Variables]: Variables[key] } = {} as any
  public readonly providers: { [key in keyof Providers]: Providers[key] } = {} as any

  public readonly module: TerraformHclModule

  constructor(
    scope: Construct,
    public readonly id: string,
    { variables = {}, providers = {} as Providers }: ModuleConfig<Variables, Providers>,
    setContext?: SetContext,
  ) {
    const path = `module_${id}`
    super(App.getAppFromContext(scope), path)

    if (setContext) {
      setContext(this)
    }

    this.addOverride("terraform.backend", undefined)
    this.addOverride("provider", undefined)

    this.module = new TerraformHclModule(scope, `module-${id}`, {
      source: `../${path}`,
      skipAssetCreationFromLocalModules: true,
      variables,
      providers: Object.entries(providers).map(([, provider]) =>
        provider.alias
          ? {
              moduleAlias: provider.alias,
              provider,
            }
          : provider,
      ),
    })

    this.variables = Object.entries(variables || {}).reduce(
      (acc, [key]) => ({ [key]: new TerraformVariable(this, key, {}).value, ...acc }),
      this.variables,
    )

    this.providers = Object.entries(providers).reduce((acc, [key, provider]) => {
      const ProviderClass: { new (...args: any[]): typeof provider } = provider.constructor as any
      const id = provider.node.id
      return {
        ...acc,
        [key]: new ProviderClass(this, id, { alias: provider.alias }),
      }
    }, this.providers)
  }

  output(name: string): IResolvable {
    return this.module.interpolationForOutput(name)
  }

  private outgoingCrossModuleReferences: Record<string, TerraformOutput> = {}
  public registerOutgoingCrossModuleReference(name: string, identifier: string): string {
    let res = this.outgoingCrossModuleReferences[name]
    if (!res) {
      res = new TerraformOutput(this, `sdf-cmo-${name}`, {
        value: ref(identifier, this),
        description: `Cross module reference for ${name}`,
        sensitive: true,
      })
      this.outgoingCrossModuleReferences[name] = res
    }

    return `module.${this.module.friendlyUniqueId}.${res.friendlyUniqueId}`
  }

  private incomingCrossModuleReferences: Record<string, TerraformVariable> = {}
  public registerIncomingCrossModuleReference(name: string, identifier: string): string {
    let res = this.incomingCrossModuleReferences[name]
    if (!res) {
      res = new TerraformVariable(this, `sdf-cmi-${name}`, {
        sensitive: true,
      })
      this.module.set(res.friendlyUniqueId, ref(identifier, this))
      this.incomingCrossModuleReferences[name] = res
    }
    return `var.${res.friendlyUniqueId}`
  }
}
