import { LambdaFunctionConfig } from "@cdktf/provider-aws/lib/lambda-function"
import { Construct } from "constructs"

import { Lambda } from "../lambda/Lambda"
import { BundleManifest, Bundler } from "./Bundler"

export interface BundlerDockerContext {
  command?: Array<string>
  entryPoint?: Array<string>
  workingWirectory?: string
}

export interface BundleDockerManifest extends BundleManifest {
  type: "docker"

  config: BundlerDockerConfig
}

export interface BundlerDockerConfig {
  /** The image URI */
  imageUri: string

  /** The default image configuration */
  imageConfig?: BundlerDockerContext
}

export class BundlerDocker extends Bundler {
  public _context_type: BundlerDockerContext = {}

  constructor(
    scope: Construct,
    id: string,
    public config: BundlerDockerConfig,
  ) {
    super(scope, id)
  }

  public getBundleManifest(): BundleDockerManifest {
    return {
      id: this.node.id,
      type: "docker",
      config: this.config,
    }
  }

  public lambdaConfig(lambda: Lambda<BundlerDocker>): Partial<LambdaFunctionConfig> {
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
