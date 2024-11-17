import { OpenAPIV3 } from "openapi-types"

import { Resource } from "../../core/Resource"
import { HttpApi } from "../../http-api"
import { HttpApiLambdaAuthorizer } from "../../http-api/authorizer"
import { OperationSchema } from "../../http-api/core/DocumentSchemaAdapter"
import { LambdaConfigCore, LambdaEntryPoint } from "../../lambda"

export interface BundlerLanguageGenerateOptions {
  schemas: Record<string, OpenAPIV3.SchemaObject>
  resources: Record<string, Resource>
}

/**
 * BundlerLanguage is the interface that must be implemented by all the languages supported by the bundler
 */
export interface BundlerLanguage {
  /** the name of the language */
  readonly language: string

  /** the path where the build output will be stored */
  readonly buildDir?: string

  /** genereate the language specific files */
  generate: (options: BundlerLanguageGenerateOptions) => Promise<void>

  /** generate http api handler */
  generateHttpApiHandler: <SchemaType>(
    httpApi: HttpApi,
    operation: OperationSchema<SchemaType>,
  ) => LambdaEntryPoint | void

  /** generate http api client */
  generateHttpApiClient: (httpApi: HttpApi) => Promise<void>

  /** generate http api specification */
  generateHttpApiDocument: (httpApi: HttpApi) => string | void

  /** generate http api authorizer */
  generateHttpApiAuthorizer: (authorizer: HttpApiLambdaAuthorizer) => Promise<LambdaEntryPoint | void>

  /** register a new lambda entry point */
  registerEntryPoint: (handler: LambdaEntryPoint) => string | void

  /** get the manifest of the language */
  manifest: () => Record<string, any>

  /** language specific lambda config customization */
  readonly lambdaConfigCustomization?: Partial<LambdaConfigCore>
}
