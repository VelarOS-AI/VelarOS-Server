import type { ChangeNotice } from '../../../packages/contracts/src/index.js'

/** 网络订阅只消费变更提示；失败不能传播到运行事实的写入路径。 */
export class ChangeStream {
  private readonly subscribers = new Set<(notice: ChangeNotice) => void>()

  public subscribe(subscriber: (notice: ChangeNotice) => void): () => void {
    this.subscribers.add(subscriber)
    return () => this.subscribers.delete(subscriber)
  }

  public publish(notice: ChangeNotice): void {
    for (const subscriber of this.subscribers) {
      try {
        subscriber(notice)
      } catch {
        this.subscribers.delete(subscriber)
      }
    }
  }

  public get subscriberCount(): number {
    return this.subscribers.size
  }
}
