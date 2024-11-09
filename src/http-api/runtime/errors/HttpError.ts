import { HttpStatusCodes } from "../../common/HttpStatusCodes"

export abstract class HttpError extends Error {
  constructor(
    public code: string,
    public message: string,
    public details?: unknown,
    public internal?: unknown,
  ) {
    super(`[${code}]: ${message}`)
  }

  abstract get statusCode(): HttpStatusCodes

  get class() {
    return this.constructor.name
  }

  toJSON() {
    return {
      class: this.class,
      code: this.code,
      message: this.message,
      details: this.details,
    }
  }

  static classes: Record<string, new (code: string, message: string, details?: unknown) => HttpError> = {}

  static fromJSON(error: unknown): HttpError {
    if (typeof error !== "object" || error === null) {
      throw new Error(JSON.stringify(error))
    }

    const className = error?.["class"]
    const code = error?.["code"]
    const message = error?.["message"]
    const details = error?.["details"]

    if (typeof className !== "string" || typeof code !== "string" || typeof message !== "string") {
      throw new Error(JSON.stringify(error))
    }

    const Class = this.classes[className as string]

    if (!Class) {
      throw new Error(`malformed error data, error class ${className} not found: ${JSON.stringify(error)}`)
    }

    return new Class(code, message, details)
  }
}
