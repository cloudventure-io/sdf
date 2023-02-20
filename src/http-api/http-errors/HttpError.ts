import { HttpStatusCodes } from "../HttpStatusCodes"

export abstract class HttpError extends Error {
  constructor(public code: string, public message: string, public details?: unknown) {
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

  // @ts-expect-error this function is overwritten
  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
  static fromJSON(error: Record<string, unknown>): HttpError {}
}
