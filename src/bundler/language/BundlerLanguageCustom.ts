import { Construct } from "constructs"

import { HttpApi, HttpApiOperation } from "../../http-api"
import { HttpApiLambdaAuthorizer } from "../../http-api/authorizer"
import { LambdaEntryPoint } from "../../lambda"
import { BundlerLanguage, BundlerLanguageGenerateOptions } from "./BundlerLanguage"

export interface BundlerLanguageCustomConfig {
  path?: string

  generate?: BundlerLanguage["generate"]
  generateHttpApiHandler?: BundlerLanguage["generateHttpApiHandler"]
  generateHttpApiClient?: BundlerLanguage["generateHttpApiClient"]
  generateHttpApiSpecification?: BundlerLanguage["generateHttpApiSpecification"]
  generateHttpApiAuthorizer?: BundlerLanguage["generateHttpApiAuthorizer"]
  registerHandler?: BundlerLanguage["registerEntryPoint"]
}

export class BundlerLanguageCustom extends Construct implements BundlerLanguage {
  public readonly language = "custom"

  constructor(
    scope: Construct,
    id: string,
    private config: BundlerLanguageCustomConfig,
  ) {
    super(scope, id)
  }

  get buildDir(): string | undefined {
    return this.config.path
  }

  async generate(options: BundlerLanguageGenerateOptions): Promise<void> {
    if (this.config.generate) {
      await this.config.generate(options)
    }
  }

  async generateHttpApiHandler(httpApi: HttpApi, operation: HttpApiOperation) {
    if (this.config.generateHttpApiHandler) {
      return await this.config.generateHttpApiHandler(httpApi, operation)
    }
  }

  async generateHttpApiClient(httpApi: HttpApi): Promise<void> {
    if (this.config.generateHttpApiClient) {
      await this.config.generateHttpApiClient(httpApi)
    }
  }

  async generateHttpApiSpecification(httpApi: HttpApi): Promise<void> {
    if (this.config.generateHttpApiSpecification) {
      await this.config.generateHttpApiSpecification(httpApi)
    }
  }

  public manifest(): Record<string, any> {
    return {}
  }

  public registerEntryPoint(handler: LambdaEntryPoint): string | void {
    if (this.config.registerHandler) {
      return this.config.registerHandler(handler)
    }
  }

  async generateHttpApiAuthorizer(authorizer: HttpApiLambdaAuthorizer): Promise<LambdaEntryPoint | void> {
    if (this.config.generateHttpApiAuthorizer) {
      return await this.config.generateHttpApiAuthorizer(authorizer)
    }
  }
}
