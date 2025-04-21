import { TerraformStack } from "cdktf"
import { Construct } from "constructs"

import { Resource } from "./Resource"
import { StackModule } from "./StackModule"

export class StackController {
  private stacks = new WeakMap<TerraformStack, Record<string, Resource>>()

  public getStack(scope: Construct): TerraformStack {
    const stack = scope.node.scopes
      .reverse()
      .find<TerraformStack>((scope): scope is TerraformStack => TerraformStack.isStack(scope))

    if (!stack) {
      throw new Error(`cannot find stack in scope ${scope.node.path}`)
    }

    return stack
  }

  public getTopTerraformStack(scope: Construct): TerraformStack {
    let stack = this.getStack(scope)

    while (stack instanceof StackModule) {
      stack = this.getStack(stack.module)
    }

    return stack
  }

  public registerResource(resource: Resource, id: string) {
    const stack = this.getTopTerraformStack(resource)

    let resources = this.stacks.get(stack)

    if (!resources) {
      resources = {}
      this.stacks.set(stack, resources)
    }

    if (id in resources && resources[id] !== resource) {
      throw new Error(`resource with id '${id}' already exists in the stack '${stack.node.path}'`)
    }

    resources[id] = resource

    this.stacks.set(stack, resources)
  }

  public getResource(scope: Construct, id: string): Resource {
    const stack = this.getTopTerraformStack(scope)

    const resource = this.stacks.get(stack)?.[id]

    if (!resource) {
      throw new Error(`resource with id '${id}' was not found in the stack '${stack.node.path}'`)
    }

    return resource
  }

  public getResources(scope: Construct): Record<string, Resource> {
    const stack = this.getTopTerraformStack(scope)
    return this.stacks.get(stack) ?? {}
  }
}
