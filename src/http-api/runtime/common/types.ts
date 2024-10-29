export type GeneratedRequestShape = {
  path?: Record<string, string | undefined>
  query?: Record<string, string | undefined>
  header?: Record<string, string | undefined>

  authorizer?: unknown
} & (
  | {
      mediaType?: string
      body?: unknown
    }
  | Record<string, never>
)

export type GeneratedResponseShape = {
  headers: {
    [header in string]?: string
  }
} & {
  [mediaType in string]?: unknown
}

export type GeneratedResponsesShape = {
  [statusCode in string]?: GeneratedResponseShape
}

export type GeneratedOperationShape = {
  request: GeneratedRequestShape
  response: GeneratedResponsesShape
}
