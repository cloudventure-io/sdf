import { TerraformStack } from "cdktf"
import { Construct } from "constructs"
import { join } from "path"

import { SdfApp } from "./SdfApp"
import { SdfService, SdfServiceMetadata } from "./SdfService"

export interface SdfStackBuildMetadata {
  name: string
  path: string
  services: Array<SdfServiceMetadata>
}

export class SdfStack extends TerraformStack {
  private sdfApp: SdfApp

  constructor(scope: Construct, id: string) {
    super(scope, id)
    this.node.setContext(SdfStack.name, this)
    this.sdfApp = SdfApp.getAppFromContext(scope)
  }

  static getStackFromCtx(scope: Construct): SdfStack {
    return SdfApp.getFromContext(scope, SdfStack)
  }

  get relDir(): string {
    return "services"
  }

  get absDir(): string {
    return join(this.sdfApp.absDir, this.relDir)
  }

  _getBuildManifest(): SdfStackBuildMetadata {
    return {
      name: this.node.id,
      path: this.relDir,
      services: this.node
        .findAll()
        .filter<SdfService>((construct): construct is SdfService => construct instanceof SdfService)
        .map(service => service._getBuildManifest()),
    }
  }

  async _synth() {
    await Promise.all(
      this.node
        .findAll()
        .filter<SdfService>((construct): construct is SdfService => construct instanceof SdfService)
        .map(service => service._synth()),
    )
  }
}
