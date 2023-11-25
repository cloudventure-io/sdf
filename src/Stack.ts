import { TerraformStack } from "cdktf"
import { Construct } from "constructs"

import { App } from "./App"
import { BundleManifest, Bundler } from "./bundler/Bundler"
import { Resource } from "./resource/Resource"

export interface StackManifest {
  id: string
  bundles: Array<BundleManifest>
}

export class Stack extends TerraformStack {
  constructor(scope: Construct, id: string) {
    super(scope, id)

    this.node.setContext(Stack.name, this)
  }

  static getStackFromCtx(construct: Construct): Stack {
    return App.getFromContext(construct, Stack)
  }

  _getStackManifest(): StackManifest {
    return {
      id: this.node.id,
      bundles: this.node
        .findAll()
        .filter<Bundler>((construct): construct is Bundler => construct instanceof Bundler)
        .map(bundler => bundler.getBundleManifest()),
    }
  }

  public resources: { [id in string]: Resource } = {}
  public registerResource(resource: Resource, id: string) {
    if (this.resources[id] && this.resources[id] !== resource) {
      throw new Error(`resource with id '${id}' already exists in the bundler '${this.node.id}'`)
    }
    this.resources[id] = resource
  }

  public getResource(id: string) {
    const resource = this.resources[id]
    if (!resource) {
      throw new Error(`resource with id '${id}' was not found in the bundler '${this.node.id}'`)
    }
    return resource
  }
}
