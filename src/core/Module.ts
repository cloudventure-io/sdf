import {
  IResolvable,
  TerraformHclModule,
  TerraformHclModuleConfig,
  TerraformProvider,
  TerraformStack,
  TerraformVariable,
} from "cdktf"
import { Construct } from "constructs"

import { App } from "./App"

export type TerraformVariables = TerraformHclModuleConfig["variables"]
export type TerraformProviders = Record<string, TerraformProvider>

export interface ModuleConfig<Variables extends TerraformVariables, Providers extends TerraformProviders> {
  variables?: Variables
  providers?: Providers
}

export class Module<
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
    super(App.getAppFromContext(scope), id)

    if (setContext) {
      setContext(this)
    }

    this.addOverride("terraform.backend", undefined)
    this.addOverride("provider", undefined)

    this.module = new TerraformHclModule(scope, `${id}-module`, {
      source: `../${id}`,
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
}
