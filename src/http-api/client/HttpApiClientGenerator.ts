import { camelCase, pascalCase } from "change-case"
import { dirname, join, relative } from "path"

import { BundlerTypeScript } from "../../bundler"
import { writeMustacheTemplate } from "../../utils/writeMustacheTemplate"
import { HttpApi } from "../HttpApi"
import { HttpStatusCodes } from "../enum/HttpStatusCodes"
import { OperationParser } from "../openapi/OperationParser"
import { Document } from "../openapi/types"
import clientTemplate from "./client.ts.mu"

export interface HttpApiClientGeneratorConfig<OperationType extends object> {
  document: Document<OperationType>
  bundler: BundlerTypeScript
  httpApi: HttpApi
  name: string
}

export class HttpApiClientGenerator<OperationType extends object> {
  private operationParser: OperationParser<OperationType>

  constructor(private config: HttpApiClientGeneratorConfig<OperationType>) {
    this.operationParser = new OperationParser<OperationType>(config.document)
  }

  async render() {
    interface TplOp {
      OperationName: string
      OperationModel: string
      PathPatternEscaped: string
      Method: string
      SuccessCodesList: string
      SuccessCodesUnion: string
      Description?: string
    }

    const operations: Array<TplOp> = []
    this.operationParser.walkOperations(operation => {
      const successCodes =
        operation.operationSpec["x-sdf-success-codes"] ??
        Object.keys(operation.operationSpec.responses)
          .map(parseInt)
          .filter(statusCode => statusCode < HttpStatusCodes.BadRequest)

      operations.push({
        OperationName: camelCase(operation.operationId),
        OperationModel: pascalCase(`operation-${operation.operationId}`),
        Method: operation.method.toUpperCase(),
        PathPatternEscaped: JSON.stringify(operation.pathPattern),
        SuccessCodesList: successCodes.join(", "),
        SuccessCodesUnion: successCodes.join(" | "),
        Description: operation.operationSpec.description?.replace(/\*\//g, "* /"), // break closing comments
      })
    })

    const className = pascalCase(`base-${this.config.name}-client`)
    const clientClassPath = join(this.config.bundler.genDir, "client", className)

    await writeMustacheTemplate({
      template: clientTemplate,
      path: `${clientClassPath}.ts`,
      context: {
        ClassName: className,
        Operations: operations,
        InterfacesImport: relative(dirname(clientClassPath), this.config.bundler._interfacesAbsPath),
      },
      overwrite: true,
    })
  }
}
