/**
 * 活动事件流的本地缓存（localStorage）：源数据要从飞书逐条聚合记录历史，
 * 首刷 30–70s；挂载时先渲染上次快照秒开，后台刷新落地后原位替换。
 *
 * 三层分工：
 *   1. 本文件（localStorage）——跨会话/跨 host 重启仍可秒开，最旧的一层；
 *   2. host 内存 60s TTL——刷新完立刻再进活动视图时不重新聚合；
 *   3. 云端 record-history——唯一真相来源，仅前两层未命中时才全量拉取。
 *
 * 模块级变量 + localStorage 双写（与 state-cache.ts 同范式）：软刷新（SPA
 * 路由切换只重挂组件）走内存，硬刷新/新会话走 localStorage。写入失败
 * （隐私模式 / quota 超限）静默忽略——缓存是体验优化，不是正确性依赖。
 */
import type { ActivityEvent } from '../protocol.ts'

const CACHE_KEY = 'devtask.activityCache.v1'

/** 单条事件的最小形状校验（旧版本写入 / 手改的脏数据直接丢弃）。 */
function looksLikeEvent(e: unknown): boolean {
  if (e === null || typeof e !== 'object') return false
  const p = e as Partial<ActivityEvent>
  return typeof p.id === 'string' && p.id !== ''
    && typeof p.recordId === 'string'
    && typeof p.taskTitle === 'string'
    && typeof p.operator === 'string'
    && typeof p.at === 'string'
    && (p.type === 'create' || p.type === 'update')
    && Array.isArray(p.changes)
}

/** 按 id 合并新旧快照（新事件覆盖同 id），保持时间倒序——分页追加不会缩水。 */
function merge(prev: ActivityEvent[], next: ActivityEvent[]): ActivityEvent[] {
  const byId = new Map(prev.map(e => [e.id, e]))
  for (const e of next) byId.set(e.id, e)
  return [...byId.values()].sort((a, b) => b.at.localeCompare(a.at))
}

let memory: ActivityEvent[] | null = null

/** 读取本地缓存；没有/读失败/全脏返回 null。 */
export function loadCachedActivity(): ActivityEvent[] | null {
  if (memory !== null) return memory
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    const events = parsed.filter(looksLikeEvent)
    memory = events
    return events
  } catch {
    return null
  }
}

/** 写入本地缓存（与已有快照按 id 合并，见 merge）。 */
export function saveCachedActivity(events: ActivityEvent[]): void {
  const merged = merge(loadCachedActivity() ?? [], events)
  memory = merged
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(merged))
  } catch {
    // ignored: storage full / unavailable — cache is best-effort only
  }
}
