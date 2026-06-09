/**
 * parseUtils.ts — CLI 输出解析共用工具函数
 *
 * 提供 claudeParser 和 codexParser 共享的类型安全解析辅助函数。
 */

/** 安全提取数值，非有限数返回 0。 */
export function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
