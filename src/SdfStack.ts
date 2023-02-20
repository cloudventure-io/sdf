import { TerraformStack } from "cdktf"
import { Construct } from "constructs"
import { join } from "path"

import { SdfApp } from "./SdfApp"
import { SdfBundleMetadata, SdfBundler } from "./SdfBundler"

export interface SdfStackBuildMetadata {
  name: string
  path: string
  bundles: Array<SdfBundleMetadata>
}

export class SdfStack extends TerraformStack {
  private sdfApp: SdfApp

  constructor(scope: Construct, id: string) {
    super(scope, id)
    this.node.setContext(SdfStack.name, this)
    this.sdfApp = SdfApp.getAppFromContext(this)
  }

  static getStackFromCtx(construct: Construct): SdfStack {
    return SdfApp.getFromContext(construct, SdfStack)
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
      bundles: this.node
        .findAll()
        .filter<SdfBundler>((construct): construct is SdfBundler => construct instanceof SdfBundler)
        .map(bundler => bundler._getBuildManifest()),
    }
  }

  async _synth() {
    const runSynth = async (prop: string) => {
      for (const c of this.node.findAll()) {
        if (c !== this && typeof c[prop] === "function") {
          await (c[prop] as () => Promise<void>)()
        }
      }
    }
    await runSynth("_preSynth")
    await runSynth("_synth")
    await runSynth("_postSynth")
  }
}
