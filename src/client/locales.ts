// zh/en dictionaries for the token-dashboard surface, registered on the
// shared locale service under namespace 'token-dashboard' (05 decision:
// bilingual UI).

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'token-dashboard': TokenKey
  }
}

export type TokenKey =
  | 'title'
  | 'today'
  | 'week'
  | 'month30'
  | 'all'
  | 'weekView'
  | 'dayView'
  | 'refresh'
  | 'refreshedAt'
  | 'close'
  | 'older'
  | 'newer'
  | 'recentWeeks'
  | 'rangeWeeks'
  | 'legendLess'
  | 'legendMore'
  | 'hoverTotal'
  | 'hoverSplit'
  | 'hoverRequests'
  | 'hoverCache'
  | 'cacheExcluded'
  | 'dayListTitle'
  | 'loading'
  | 'error'
  | 'tzLabel'
  | 'tzLocal'
  | 'tzUtc'
  | 'entryLabel'
  | 'sessions'
  | 'empty'

export const zh: Record<TokenKey, string> = {
  title: 'Token 用量',
  today: '今日',
  week: '本周',
  month30: '近 30 天',
  all: '全部',
  weekView: '周视图',
  dayView: '日视图',
  refresh: '刷新',
  refreshedAt: '上次更新',
  close: '关闭',
  older: '← 更早',
  newer: '更新 →',
  recentWeeks: '最近 {n} 周',
  rangeWeeks: '第 {n} 周',
  legendLess: '少',
  legendMore: '多',
  hoverTotal: '{date} · {total} tokens',
  hoverSplit: '输入 {input} + 输出 {output}',
  hoverRequests: '{n} 次请求',
  hoverCache: '缓存读 {n}（不计入总量）',
  cacheExcluded: '缓存读仅作附注，不计入总量',
  dayListTitle: '近 30 天明细',
  loading: '加载中…',
  error: '加载失败：{message}',
  tzLabel: '日界',
  tzLocal: '本地',
  tzUtc: 'UTC',
  entryLabel: 'Token',
  sessions: '{n} 个会话',
  empty: '暂无数据',
}

export const en: Record<TokenKey, string> = {
  title: 'Token Usage',
  today: 'Today',
  week: 'This week',
  month30: 'Last 30 days',
  all: 'All time',
  weekView: 'Week',
  dayView: 'Day',
  refresh: 'Refresh',
  refreshedAt: 'Updated',
  close: 'Close',
  older: '← Older',
  newer: 'Newer →',
  recentWeeks: 'Last {n} weeks',
  rangeWeeks: 'Weeks {n}',
  legendLess: 'Less',
  legendMore: 'More',
  hoverTotal: '{date} · {total} tokens',
  hoverSplit: 'Input {input} + output {output}',
  hoverRequests: '{n} requests',
  hoverCache: 'Cache read {n} (excluded)',
  cacheExcluded: 'Cache reads are noted but never counted into totals',
  dayListTitle: 'Last 30 days',
  loading: 'Loading…',
  error: 'Failed to load: {message}',
  tzLabel: 'Day boundary',
  tzLocal: 'Local',
  tzUtc: 'UTC',
  entryLabel: 'Token',
  sessions: '{n} sessions',
  empty: 'No data yet',
}
