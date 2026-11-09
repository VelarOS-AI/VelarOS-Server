/** HTTP 边界错误，不重新定义 Platform 的运行错误。 */
export class HttpError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}
