import { HttpStatusCodes } from "../utils/HttpStatusCodes"

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
}
