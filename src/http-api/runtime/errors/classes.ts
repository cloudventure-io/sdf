import { HttpStatusCodes } from "../../common/HttpStatusCodes"
import { HttpError } from "./HttpError"

const statusCodesByNumber = Object.fromEntries(Object.entries(HttpStatusCodes).map(([key, value]) => [value, key]))

const defineHttpError = (statusCode: HttpStatusCodes) => {
  const Class = class extends HttpError {
    get statusCode(): typeof statusCode {
      return statusCode
    }
  }
  const name = statusCodesByNumber[statusCode]
  HttpError.classes[name] = Class
  return Class
}

export class BadRequest extends defineHttpError(HttpStatusCodes.BadRequest) {}
export class Unauthorized extends defineHttpError(HttpStatusCodes.Unauthorized) {}
export class PaymentRequired extends defineHttpError(HttpStatusCodes.PaymentRequired) {}
export class Forbidden extends defineHttpError(HttpStatusCodes.Forbidden) {}
export class NotFound extends defineHttpError(HttpStatusCodes.NotFound) {}
export class MethodNotAllowed extends defineHttpError(HttpStatusCodes.MethodNotAllowed) {}
export class NotAcceptable extends defineHttpError(HttpStatusCodes.NotAcceptable) {}
export class ProxyAuthenticationRequired extends defineHttpError(HttpStatusCodes.ProxyAuthenticationRequired) {}
export class RequestTimeout extends defineHttpError(HttpStatusCodes.RequestTimeout) {}
export class Conflict extends defineHttpError(HttpStatusCodes.Conflict) {}
export class Gone extends defineHttpError(HttpStatusCodes.Gone) {}
export class LengthRequired extends defineHttpError(HttpStatusCodes.LengthRequired) {}
export class PreconditionFailed extends defineHttpError(HttpStatusCodes.PreconditionFailed) {}
export class PayloadTooLarge extends defineHttpError(HttpStatusCodes.PayloadTooLarge) {}
export class URITooLong extends defineHttpError(HttpStatusCodes.URITooLong) {}
export class UnsupportedMediaType extends defineHttpError(HttpStatusCodes.UnsupportedMediaType) {}
export class RangeNotSatisfiable extends defineHttpError(HttpStatusCodes.RangeNotSatisfiable) {}
export class ExpectationFailed extends defineHttpError(HttpStatusCodes.ExpectationFailed) {}
export class ImATeapot extends defineHttpError(HttpStatusCodes.ImATeapot) {}
export class UnprocessableContent extends defineHttpError(HttpStatusCodes.UnprocessableContent) {}
export class PreconditionRequired extends defineHttpError(HttpStatusCodes.PreconditionRequired) {}
export class TooManyRequests extends defineHttpError(HttpStatusCodes.TooManyRequests) {}
export class RequestHeaderFieldsTooLarge extends defineHttpError(HttpStatusCodes.RequestHeaderFieldsTooLarge) {}
export class UnavailableForLegalReasons extends defineHttpError(HttpStatusCodes.UnavailableForLegalReasons) {}

export class InternalServerError extends defineHttpError(HttpStatusCodes.InternalServerError) {}
export class NotImplemented extends defineHttpError(HttpStatusCodes.NotImplemented) {}
export class BadGateway extends defineHttpError(HttpStatusCodes.BadGateway) {}
export class ServiceUnavailable extends defineHttpError(HttpStatusCodes.ServiceUnavailable) {}
export class GatewayTimeout extends defineHttpError(HttpStatusCodes.GatewayTimeout) {}

export const classes = {
  [BadRequest.name]: BadRequest,
  [Unauthorized.name]: Unauthorized,
  [PaymentRequired.name]: PaymentRequired,
  [Forbidden.name]: Forbidden,
  [NotFound.name]: NotFound,
  [MethodNotAllowed.name]: MethodNotAllowed,
  [NotAcceptable.name]: NotAcceptable,
  [ProxyAuthenticationRequired.name]: ProxyAuthenticationRequired,
  [RequestTimeout.name]: RequestTimeout,
  [Conflict.name]: Conflict,
  [Gone.name]: Gone,
  [LengthRequired.name]: LengthRequired,
  [PreconditionFailed.name]: PreconditionFailed,
  [PayloadTooLarge.name]: PayloadTooLarge,
  [URITooLong.name]: URITooLong,
  [UnsupportedMediaType.name]: UnsupportedMediaType,
  [RangeNotSatisfiable.name]: RangeNotSatisfiable,
  [ExpectationFailed.name]: ExpectationFailed,
  [ImATeapot.name]: ImATeapot,
  [UnprocessableContent.name]: UnprocessableContent,
  [PreconditionRequired.name]: PreconditionRequired,
  [TooManyRequests.name]: TooManyRequests,
  [RequestHeaderFieldsTooLarge.name]: RequestHeaderFieldsTooLarge,
  [UnavailableForLegalReasons.name]: UnavailableForLegalReasons,

  [InternalServerError.name]: InternalServerError,
  [NotImplemented.name]: NotImplemented,
  [BadGateway.name]: BadGateway,
  [ServiceUnavailable.name]: ServiceUnavailable,
  [GatewayTimeout.name]: GatewayTimeout,
}
