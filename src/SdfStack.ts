import { TerraformStack } from "cdktf";
import { Construct } from "constructs";
import { SdfApp } from "./SdfApp";
import { SdfService, SdfServiceMetadata } from "./SdfService";
import { join } from "path";

export interface SdfStackBuildMetadata {
  name: string;
  path: string;
  services: Array<SdfServiceMetadata>;
}

export abstract class SdfStack extends TerraformStack {
  private sdfApp: SdfApp;

  constructor(scope: Construct, id: string) {
    super(scope, id);
    this.node.setContext(SdfStack.name, this);
    this.sdfApp = SdfApp.getAppFromContext(scope);
  }

  static getStackFromCtx(scope: Construct): SdfStack {
    return SdfApp.getFromContext(scope, SdfStack);
  }

  get relDir(): string {
    return "services";
  }

  get absDir(): string {
    return join(this.sdfApp.absDir, this.relDir);
  }

  _getBuildMetadata(): SdfStackBuildMetadata {
    return {
      name: this.node.id,
      path: this.relDir,
      services: this.node
        .findAll()
        .filter<SdfService>(
          (construct): construct is SdfService =>
            construct instanceof SdfService
        )
        .map((service) => service._getBuildMetadata()),
    };
  }

  async _synth() {
    await Promise.all(
      this.node
        .findAll()
        .filter<SdfService>(
          (construct): construct is SdfService =>
            construct instanceof SdfService
        )
        .map((service) => service._synth())
    );
  }
}
