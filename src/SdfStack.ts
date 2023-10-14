import { TerraformStack } from "cdktf"
import { Construct } from "constructs"

import { SdfApp } from "./SdfApp"
import { SdfBundleManifest, SdfBundler } from "./bundlers/SdfBundler"

export interface SdfStackManifest {
  id: string
  bundles: Array<SdfBundleManifest>
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

  _getStackManifest(): SdfStackManifest {
    return {
      id: this.node.id,
      bundles: this.node
        .findAll()
        .filter<SdfBundler>((construct): construct is SdfBundler => construct instanceof SdfBundler)
        .map(bundler => bundler.getBundleManifest()),
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
