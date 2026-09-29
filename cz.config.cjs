module.exports = {
  types: [
    { value: 'feat', name: 'feat: 新增功能' },
    { value: 'fix', name: 'fix: 修复问题' },
    { value: 'docs', name: 'docs: 更新文档' },
    { value: 'refactor', name: 'refactor: 重构代码' },
    { value: 'test', name: 'test: 增加或修正测试' },
    { value: 'chore', name: 'chore: 工程维护' },
    { value: 'build', name: 'build: 构建系统或依赖' },
    { value: 'ci', name: 'ci: 持续集成配置' },
    { value: 'perf', name: 'perf: 性能优化' },
    { value: 'revert', name: 'revert: 回滚变更' },
  ],
  maxHeaderLength: 100,
  skipQuestions: ['body', 'breaking', 'footerPrefix', 'footer'],
};
