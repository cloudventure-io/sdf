import { MimeTypes } from "../../utils/MimeTypes"
import { HttpHeaders } from "../enum/HttpHeaders"
import { ApiResponse, Operation } from "../runtime"
import { HttpApiClientAuthorizer } from "./HttpApiClientAuthorizer"

type RequestInit = Exclude<ConstructorParameters<typeof Request>[1], undefined>

type ExtractOperationRequest<T extends Operation["request"]> = T extends { contentType: "application/json" }
  ? Omit<T, "contentType"> & Partial<Pick<T, "contentType">>
  : T

export type OperationRequest<T extends Operation> = ExtractOperationRequest<Omit<T["request"], "authorizer">>

export type OperationResponses<T extends Operation, StatusCodes extends number = 200> = Extract<
  T["responses"],
  { statusCode: StatusCodes }
>

export class HttpApiRequest extends Request {
  public attempt: number = 0
}

export interface HttpApiClientConfig {
  baseUrl: string
  authorizer?: HttpApiClientAuthorizer

  client?: (request: Request) => Promise<Response>
}

export class HttpApiClient {
  public baseUrl: string
  public authorizer?: HttpApiClientAuthorizer
  public client: (request: Request) => Promise<Response>

  constructor({ baseUrl, authorizer, client }: HttpApiClientConfig) {
    this.baseUrl = baseUrl
    this.authorizer = authorizer
    this.client = client ?? fetch
  }

  private filterUndefined(input: Record<string, string | undefined>): Record<string, string> {
    return Object.entries(input).reduce(
      (acc, [key, value]) => (value === undefined ? acc : { ...acc, [key]: value }),
      {} as Record<string, string>,
    )
  }

  private substitutePathParams(pathPattern: string, params: Record<string, string>) {
    return pathPattern.replace(/\{(\w+)\}/g, (_, paramName) => {
      // Check if the parameter exists in the provided map, if not, throw an error.
      if (!(paramName in params)) {
        throw new Error(`Parameter "${paramName}" not found in the provided parameters map.`)
      }
      // Replace the parameter with the value from the map.
      return encodeURIComponent(params[paramName])
    })
  }

  protected async createRequest(
    req: Partial<Omit<Operation["request"], "authorizer">>,
    pathPattern: string,
    method: string,
  ): Promise<HttpApiRequest> {
    let body: string | undefined
    const contentType = req.body && req.contentType === undefined ? MimeTypes.APPLICATION_JSON : req.contentType
    if (req.body) {
      if (contentType === MimeTypes.APPLICATION_JSON) {
        body = JSON.stringify(req.body)
      } else {
        // TODO: handle binary types and application/x-www-form-urlencoded
        body = String(req.body)
      }
    }

    const requestInit: RequestInit = {
      method: method.toUpperCase(),
      headers: new Headers(
        this.filterUndefined({
          [HttpHeaders.ContentType]: contentType,
          ...req.header,
        }),
      ),
      redirect: "manual",
      body,
    }

    const url = new URL(this.substitutePathParams(pathPattern, this.filterUndefined(req.path || {})), this.baseUrl)
    Object.entries(this.filterUndefined(req.query || {})).forEach(([key, value]) => url.searchParams.set(key, value))

    return new HttpApiRequest(url, requestInit)
  }

  protected async createResponse<OpType extends Operation>(response: Response): Promise<OpType["responses"]> {
    let body: OpType["responses"]["body"] = null
    if (response.headers.get(HttpHeaders.ContentType)?.split(";")[0] === MimeTypes.APPLICATION_JSON) {
      const rawBody = await response.text()
      body = rawBody.length ? JSON.parse(rawBody) : null
    } else {
      body = await response.blob()
    }

    return new ApiResponse(
      body,
      response.status,
      Array.from(response.headers.entries()).reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {}),
    ) as OpType["responses"]
  }

  public async request<OpType extends Operation, SuccessCodes extends number>(
    req: Partial<Omit<OpType["request"], "authorizer">>,
    pathPattern: string,
    method: string,
    successCodes: Array<number>,
  ): Promise<OperationResponses<OpType, SuccessCodes>> {
    const request = await this.createRequest(req, pathPattern, method)

    while (request.attempt < 3) {
      request.attempt++
      if (this.authorizer) {
        await this.authorizer.sign(request)
      }
      const response = await this.createResponse(await this.client(request))

      if (successCodes.includes(response.statusCode)) {
        return response as OperationResponses<OpType, SuccessCodes>
      }

      throw response
    }

    // TODO fix the error
    throw new Error(`failed after retries`)
  }
}
