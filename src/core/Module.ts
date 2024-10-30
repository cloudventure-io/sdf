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

export interface ModuleConfig<Variables extends TerraformHclModuleConfig["variables"]> {
  variables?: Variables
  providers?: Array<TerraformProvider>
}

export class Module<
  Variables extends TerraformHclModuleConfig["variables"] = TerraformHclModuleConfig["variables"],
  SetContext extends (scope: Construct) => void = (scope: Construct) => void,
> extends TerraformStack {
  public readonly variables: { [key in keyof Variables]: Variables[key] } = {} as any

  public readonly module: TerraformHclModule

  constructor(
    scope: Construct,
    public readonly id: string,
    { variables = {}, providers = [] }: ModuleConfig<Variables>,
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
      providers,
    })

    this.variables = Object.entries(variables || {}).reduce(
      (acc, [key]) => ({ [key]: new TerraformVariable(this, key, {}).value, ...acc }),
      this.variables,
    )

    providers.forEach(provider => {
      const ProviderClass: { new (...args: any[]): typeof provider } = provider.constructor as any
      const key = provider.node.id
      new ProviderClass(this, key)
    })
  }

  output(name: string): IResolvable {
    return this.module.interpolationForOutput(name)
  }
}
