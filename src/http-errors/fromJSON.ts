import { HttpError } from "./HttpError"
import { classes } from "./classes"

export const fromJSON = (error: Record<string, unknown>): HttpError => {
  const className = error?.class
  const code = error?.code
  const message = error?.message
  const details = error?.details

  if (typeof className !== "string" || typeof code !== "string" || typeof message !== "string") {
    throw new Error(JSON.stringify(error))
  }

  const cls = classes[className as string]

  if (!cls) {
    throw new Error(`malformed error data, error class ${className} not found: ${JSON.stringify(error)}`)
  }

  return new cls(code, message, details)
}
