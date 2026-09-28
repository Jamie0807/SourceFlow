export type BatchStatus = 'queued' | 'processing' | 'succeeded' | 'failed';

export interface OverviewMetric {
  label: string;
  value: string;
  trend: string;
  trendTone: 'positive' | 'neutral' | 'warning';
}

export interface ContentBatchSummary {
  title: string;
  source: string;
  updatedAt: string;
  assets: number;
  status: BatchStatus;
}

export interface PendingTask {
  title: string;
  description: string;
  due: string;
  tone: 'purple' | 'orange' | 'blue';
}

export const overviewMetrics: OverviewMetric[] = [
  { label: '本周已发布', value: '28', trend: '+18.4%', trendTone: 'positive' },
  { label: '待审核内容', value: '12', trend: '需要关注', trendTone: 'warning' },
  { label: '内容资产', value: '146', trend: '+24 条', trendTone: 'positive' },
  { label: '平均互动率', value: '8.6%', trend: '+2.1%', trendTone: 'positive' },
];

export const recentBatches: ContentBatchSummary[] = [
  {
    title: 'AI 创业访谈：从 0 到 1 的产品方法',
    source: '访谈音频 · 42 分钟',
    updatedAt: '今天 10:24',
    assets: 6,
    status: 'succeeded',
  },
  {
    title: 'SourceFlow 产品幕后记录',
    source: '视频文件 · 18 分钟',
    updatedAt: '昨天 16:08',
    assets: 4,
    status: 'processing',
  },
  {
    title: '个人品牌内容周报',
    source: '文本资料 · 12 篇',
    updatedAt: '9 月 26 日',
    assets: 8,
    status: 'queued',
  },
  {
    title: '创作者增长案例拆解',
    source: '访谈音频 · 36 分钟',
    updatedAt: '9 月 25 日',
    assets: 0,
    status: 'failed',
  },
];

export const pendingTasks: PendingTask[] = [
  {
    title: '审核 4 条小红书笔记',
    description: 'AI 创业访谈 · Editor 提交',
    due: '今天截止',
    tone: 'purple',
  },
  {
    title: '补充品牌语气设置',
    description: '完成后可提升平台适配度',
    due: '建议本周完成',
    tone: 'orange',
  },
  {
    title: '查看上周内容复盘',
    description: '发现 3 个可复用的高表现主题',
    due: '数据已更新',
    tone: 'blue',
  },
];

export const batchStatusLabels: Record<BatchStatus, string> = {
  queued: '排队中',
  processing: '处理中',
  succeeded: '已完成',
  failed: '处理失败',
};
