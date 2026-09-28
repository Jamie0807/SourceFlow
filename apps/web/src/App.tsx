import { useState } from 'react';
import type { FormEvent } from 'react';

import { batchStatusLabels, overviewMetrics, pendingTasks, recentBatches } from './dashboard-data';
import './styles.css';

type AppView = 'login' | 'dashboard';

const navigationItems = [
  { label: '总览', icon: '⌂' },
  { label: '内容批次', icon: '✦' },
  { label: '资产库', icon: '▤' },
  { label: '数据复盘', icon: '◒' },
];

function validateLogin(email: string, password: string): string | null {
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return '请输入有效的邮箱地址';
  }

  if (password.length < 8) {
    return '密码至少需要 8 位';
  }

  return null;
}

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={compact ? 'brand-mark brand-mark--compact' : 'brand-mark'} aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextError = validateLogin(email, password);

    if (nextError) {
      setError(nextError);
      return;
    }

    setError(null);
    onLogin();
  }

  return (
    <main className="auth-page">
      <section className="auth-visual" aria-label="SourceFlow 产品介绍">
        <div className="auth-visual__glow auth-visual__glow--one" />
        <div className="auth-visual__glow auth-visual__glow--two" />
        <div className="auth-visual__content">
          <div className="brand-lockup brand-lockup--light">
            <BrandMark />
            <span>SourceFlow</span>
          </div>
          <p className="eyebrow eyebrow--light">CONTENT OPERATING SYSTEM</p>
          <h1>
            让一份灵感，
            <br />
            流动成全平台内容。
          </h1>
          <p className="auth-visual__description">
            从原始素材到可发布资产，SourceFlow 帮你把内容生产、平台适配和数据复盘放进同一个工作流。
          </p>
          <div className="flow-preview" aria-hidden="true">
            <div className="flow-preview__node flow-preview__node--source">
              <span className="flow-preview__icon">◉</span>
              <span>一份原始内容</span>
            </div>
            <span className="flow-preview__line" />
            <div className="flow-preview__node flow-preview__node--result">
              <span className="flow-preview__icon">✦</span>
              <span>多平台内容资产</span>
            </div>
          </div>
        </div>
        <p className="auth-visual__footer">© 2026 SourceFlow · AI Content Repurposing Workspace</p>
      </section>

      <section className="auth-panel">
        <div className="auth-panel__inner">
          <div className="auth-panel__mobile-brand brand-lockup">
            <BrandMark compact />
            <span>SourceFlow</span>
          </div>
          <div className="auth-heading">
            <p className="eyebrow">WELCOME BACK</p>
            <h2>欢迎回来</h2>
            <p>登录你的内容工作区，继续创造有影响力的内容。</p>
          </div>

          <div className="demo-notice" role="status">
            <span className="demo-notice__dot" aria-hidden="true" />
            <span>
              <strong>演示模式</strong> · 当前使用本地演示数据
            </span>
          </div>

          <form className="auth-form" onSubmit={handleSubmit} noValidate>
            <div className="field-group">
              <label htmlFor="email">邮箱</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-invalid={error?.includes('邮箱') ?? false}
              />
            </div>
            <div className="field-group">
              <div className="field-label-row">
                <label htmlFor="password">密码</label>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setError('演示模式暂不支持找回密码')}
                >
                  忘记密码？
                </button>
              </div>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder="请输入密码"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={error?.includes('密码') ?? false}
              />
            </div>

            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}

            <button type="submit" className="primary-button primary-button--full">
              进入演示工作台
              <span aria-hidden="true">→</span>
            </button>
          </form>

          <p className="auth-panel__hint">
            还没有账号？
            <button
              type="button"
              className="text-button"
              onClick={() => setError('演示模式暂不支持注册')}
            >
              创建一个工作区
            </button>
          </p>
        </div>
      </section>
    </main>
  );
}

function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [activeNav, setActiveNav] = useState('总览');
  const [notice, setNotice] = useState<string | null>(null);

  function handleNavigation(label: string) {
    setActiveNav(label);
    if (label !== '总览') {
      setNotice(`${label}页面将在连接 API 后开放`);
    } else {
      setNotice(null);
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="sidebar__brand brand-lockup">
          <BrandMark />
          <span>SourceFlow</span>
        </div>
        <div className="workspace-switcher">
          <span className="workspace-switcher__avatar">J</span>
          <span className="workspace-switcher__text">
            <strong>Jamie 的工作区</strong>
            <small>个人创作者</small>
          </span>
          <span className="workspace-switcher__chevron" aria-hidden="true">
            ⌄
          </span>
        </div>
        <nav className="sidebar__nav" aria-label="主导航">
          <p className="sidebar__label">WORKSPACE</p>
          {navigationItems.map((item) => (
            <button
              type="button"
              className={activeNav === item.label ? 'nav-item nav-item--active' : 'nav-item'}
              key={item.label}
              onClick={() => handleNavigation(item.label)}
              aria-current={activeNav === item.label ? 'page' : undefined}
            >
              <span className="nav-item__icon" aria-hidden="true">
                {item.icon}
              </span>
              {item.label}
              {item.label === '内容批次' ? <span className="nav-item__count">3</span> : null}
            </button>
          ))}
          <p className="sidebar__label sidebar__label--spaced">MANAGE</p>
          <button
            type="button"
            className="nav-item"
            onClick={() => setNotice('团队成员管理将在连接 API 后开放')}
          >
            <span className="nav-item__icon" aria-hidden="true">
              ♧
            </span>
            团队成员
          </button>
          <button
            type="button"
            className="nav-item"
            onClick={() => setNotice('设置将在连接 API 后开放')}
          >
            <span className="nav-item__icon" aria-hidden="true">
              ⚙
            </span>
            设置
          </button>
        </nav>
        <div className="sidebar__bottom">
          <div className="usage-card">
            <div className="usage-card__header">
              <span>本月使用量</span>
              <strong>68%</strong>
            </div>
            <div className="usage-card__track">
              <span />
            </div>
            <p>还可生成 32 条内容资产</p>
          </div>
          <button type="button" className="user-menu" onClick={onLogout}>
            <span className="user-menu__avatar">J</span>
            <span>
              <strong>Jamie</strong>
              <small>退出演示</small>
            </span>
            <span className="user-menu__more" aria-hidden="true">
              •••
            </span>
          </button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="topbar__mobile-brand brand-lockup">
            <BrandMark compact />
            <span>SourceFlow</span>
          </div>
          <div className="breadcrumb">
            <span>工作区</span>
            <span aria-hidden="true">/</span>
            <strong>{activeNav}</strong>
          </div>
          <div className="topbar__actions">
            <span className="mode-pill">
              <span aria-hidden="true" />
              演示模式
            </span>
            <button
              type="button"
              className="icon-button"
              aria-label="查看通知"
              onClick={() => setNotice('目前没有新的通知')}
            >
              ♢<span className="notification-dot" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="topbar__avatar"
              aria-label="退出演示"
              onClick={onLogout}
            >
              J
            </button>
          </div>
        </header>

        <div className="workspace__content">
          {notice ? (
            <div className="workspace-notice" role="status">
              {notice}
              <button type="button" aria-label="关闭提示" onClick={() => setNotice(null)}>
                ×
              </button>
            </div>
          ) : null}
          <div className="page-heading">
            <div>
              <p className="eyebrow">MONDAY, SEPTEMBER 28, 2026</p>
              <h1>
                内容经营工作台 <span aria-hidden="true">✦</span>
              </h1>
              <p>早上好，Jamie。今天也让好内容持续流动。</p>
            </div>
            <button
              type="button"
              className="primary-button"
              onClick={() => setNotice('内容批次创建将在连接 API 后开放')}
            >
              <span aria-hidden="true">＋</span> 新建内容批次
            </button>
          </div>

          <section className="metrics-grid" aria-label="内容概览">
            {overviewMetrics.map((metric) => (
              <article className="metric-card" key={metric.label}>
                <div className="metric-card__top">
                  <span>{metric.label}</span>
                  <span className="metric-card__menu" aria-hidden="true">
                    •••
                  </span>
                </div>
                <strong>{metric.value}</strong>
                <span className={`metric-card__trend metric-card__trend--${metric.trendTone}`}>
                  <span aria-hidden="true">{metric.trendTone === 'warning' ? '!' : '↗'}</span>
                  {metric.trend}
                </span>
              </article>
            ))}
          </section>

          <section className="dashboard-grid">
            <article className="panel panel--batches">
              <div className="panel__header">
                <div>
                  <h2>最近内容批次</h2>
                  <p>追踪每一份内容的生产进度</p>
                </div>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => handleNavigation('内容批次')}
                >
                  查看全部 <span aria-hidden="true">→</span>
                </button>
              </div>
              <div className="batch-list">
                {recentBatches.map((batch) => (
                  <button
                    type="button"
                    className="batch-row"
                    key={batch.title}
                    onClick={() => setNotice(`${batch.title}详情将在连接 API 后开放`)}
                  >
                    <span
                      className={`batch-row__thumb batch-row__thumb--${batch.status}`}
                      aria-hidden="true"
                    >
                      {batch.status === 'succeeded' ? '✦' : batch.status === 'failed' ? '!' : '◌'}
                    </span>
                    <span className="batch-row__main">
                      <strong>{batch.title}</strong>
                      <small>
                        {batch.source} · {batch.updatedAt}
                      </small>
                    </span>
                    <span className="batch-row__assets">
                      {batch.assets > 0 ? `${batch.assets} 条资产` : '待重试'}
                    </span>
                    <span className={`status-badge status-badge--${batch.status}`}>
                      <span aria-hidden="true" />
                      {batchStatusLabels[batch.status]}
                    </span>
                    <span className="batch-row__arrow" aria-hidden="true">
                      ›
                    </span>
                  </button>
                ))}
              </div>
            </article>

            <article className="panel panel--tasks">
              <div className="panel__header">
                <div>
                  <h2>待处理事项</h2>
                  <p>保持你的内容工作流顺畅</p>
                </div>
                <span className="task-count">3</span>
              </div>
              <div className="task-list">
                {pendingTasks.map((task) => (
                  <button
                    type="button"
                    className="task-row"
                    key={task.title}
                    onClick={() => setNotice(`${task.title}将在连接 API 后开放`)}
                  >
                    <span
                      className={`task-row__icon task-row__icon--${task.tone}`}
                      aria-hidden="true"
                    >
                      ✦
                    </span>
                    <span>
                      <strong>{task.title}</strong>
                      <small>{task.description}</small>
                      <em>{task.due}</em>
                    </span>
                    <span className="task-row__arrow" aria-hidden="true">
                      ›
                    </span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="secondary-button secondary-button--full"
                onClick={() => setNotice('全部任务将在连接 API 后开放')}
              >
                查看全部任务
              </button>
            </article>
          </section>
        </div>
      </section>
    </main>
  );
}

export function App() {
  const [view, setView] = useState<AppView>('login');

  return view === 'login' ? (
    <LoginPage onLogin={() => setView('dashboard')} />
  ) : (
    <Dashboard onLogout={() => setView('login')} />
  );
}
