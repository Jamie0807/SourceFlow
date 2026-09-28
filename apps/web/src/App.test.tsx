import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { App } from './App';

describe('SourceFlow Web 首屏', () => {
  afterEach(() => {
    cleanup();
  });

  it('展示带语义标签的登录演示页', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: '欢迎回来' })).toBeInTheDocument();
    expect(screen.getByLabelText('邮箱')).toBeInTheDocument();
    expect(screen.getByLabelText('密码')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '进入演示工作台' })).toBeInTheDocument();
    expect(screen.getByText('演示模式')).toBeInTheDocument();
  });

  it('拒绝无效邮箱并保留登录页', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText('邮箱'), 'creator');
    await user.type(screen.getByLabelText('密码'), 'sourceflow123');
    await user.click(screen.getByRole('button', { name: '进入演示工作台' }));

    expect(screen.getByRole('alert')).toHaveTextContent('请输入有效的邮箱地址');
    expect(screen.getByRole('heading', { name: '欢迎回来' })).toBeInTheDocument();
  });

  it('拒绝过短密码并保留登录页', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText('邮箱'), 'creator@sourceflow.local');
    await user.type(screen.getByLabelText('密码'), '1234567');
    await user.click(screen.getByRole('button', { name: '进入演示工作台' }));

    expect(screen.getByRole('alert')).toHaveTextContent('密码至少需要 8 位');
  });

  it('合法登录后进入内容经营工作台', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText('邮箱'), 'creator@sourceflow.local');
    await user.type(screen.getByLabelText('密码'), 'sourceflow123');
    await user.click(screen.getByRole('button', { name: '进入演示工作台' }));

    expect(screen.getByRole('heading', { name: '内容经营工作台' })).toBeInTheDocument();
    expect(screen.getByText('最近内容批次')).toBeInTheDocument();
    expect(screen.getByText('演示模式')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建内容批次' })).toBeInTheDocument();
  });
});
