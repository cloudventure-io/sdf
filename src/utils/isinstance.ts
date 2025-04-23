export const isinstance = <T extends (new (...args: any[]) => any) | (abstract new (...args: any[]) => any), O>(
  obj: O,
  type: T,
  symbol: symbol,
): obj is InstanceType<T> => obj instanceof type || (obj !== null && typeof obj === "object" && symbol in obj)
