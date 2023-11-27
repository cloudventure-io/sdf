import { HttpApiClient, OperationRequest, OperationResponses } from "@cloudventure/sdf/http-api/client/HttpApiClient"

import {
{{#Operations}}
  {{ OperationModel }},
{{/Operations}}
} from "./{{ InterfacesImport }}"

export class {{ ClassName }} extends HttpApiClient {
{{#Operations}}
  {{#Description}}
  /**
    * {{ Description }}
    */
  {{/Description}}
  public async {{ OperationName }}(
    request: OperationRequest<{{ OperationModel }}>
  ): Promise<OperationResponses<{{ OperationModel }}, {{ SuccessCodesUnion }}>> {
    return await this.request<{{ OperationModel }}, {{ SuccessCodesUnion }}>(
      request,
      {{ PathPatternEscaped }},
      "{{ Method }}",
      [{{ SuccessCodesList }}]
    )
  }
{{/Operations}}
}
