
import {
  HttpApiClient,
  HttpApiClientConfig,
  OperationRequest,
  OperationRequestDefaultMediaType,
} from "@cloudventure/sdf/http-api/runtime/client/HttpApiClient"

import { Document } from "@cloudventure/sdf/http-api/openapi/Document"
import { BundledDocument } from "@cloudventure/sdf/http-api/openapi/types"
import { dereference } from "@cloudventure/sdf/http-api/openapi/utils"

import {
{{#Operations}}
  {{ OperationModel }},
{{/Operations}}
} from "./{{ InterfacesImport }}"

{{#Operations}}
import * as Operation{{ OperationModel }} from "./{{ OperationImport }}"
{{/Operations}}

import document from "./{{ DocumentImport }}"

export class {{ ClassName }} extends HttpApiClient {
  #document: Document

  constructor(config: HttpApiClientConfig) {
    super(config)
    this.#document = new Document(dereference(document as BundledDocument))
  }

{{#Operations}}
  {{#Description}}
  /**
    * {{ Description }}
    */
  {{/Description}}
  public async {{ OperationName }}(
    request: OperationRequest{{#if IsSingleRequestBody}}DefaultMediaType{{/if}}<{{ OperationModel }}["request"]>{{#IsOperationEmpty}} = {}{{/IsOperationEmpty}},
  ): Promise<Operation{{ OperationModel }}.SuccessResponse> {
    return await this.request<Operation{{ OperationModel }}.SuccessResponse>(
      this.#document.operations["{{ OperationId }}"],
      request,
    )
  }
{{/Operations}}
}
