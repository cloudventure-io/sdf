import { LambdaFunctionConfig } from "@cdktf/provider-aws/lib/lambda-function"
import { SdfBundleManifest, SdfBundler } from "./SdfBundler"
import { Construct } from "constructs"
import { SdfLambda } from "../constructs"

export interface SdfBundlerDockerContext {
  command?: Array<string>
  entryPoint?: Array<string>
  workingWirectory?: string
}

export interface SdfBundleDockerManifest extends SdfBundleManifest {
  type: "docker"

  config: SdfBundlerDockerConfig
}

export interface SdfBundlerDockerConfig {
  /** The image URI */
  imageUri: string

  /** The default image configuration */
  imageConfig?: SdfBundlerDockerContext
}

export class SdfBundlerDocker extends SdfBundler {
  public _context_type: SdfBundlerDockerContext = {}

  constructor(
    scope: Construct,
    id: string,
    public config: SdfBundlerDockerConfig,
  ) {
    super(scope, id)
  }

  public getBundleManifest(): SdfBundleDockerManifest {
    return {
      id: this.node.id,
      type: "docker",
      config: this.config,
    }
  }

  public lambdaConfig(lambda: SdfLambda<SdfBundlerDocker>): Partial<LambdaFunctionConfig> {
    const imageConfig = { ...this.config.imageConfig, ...lambda.context }

    const config: Partial<{
      -readonly [P in keyof LambdaFunctionConfig]: LambdaFunctionConfig[P]
    }> = {
      packageType: "Image",
      imageUri: this.config.imageUri,
    }

    if (Object.values(imageConfig).length > 0) {
      config.imageConfig = imageConfig
    }

    return config
  }
}
