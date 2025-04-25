// 端口配置
const DEFAULT_PORT = 6009;
export const port = parseInt(process.env.MCP_PORT || '', 10) || DEFAULT_PORT;

// 注意：确保日志输出到 stderr，避免干扰 stdout 上的 MCP 通信
export const logger = {
  info: (...args: any[]) => console.error('[INFO]', ...args),
  error: (...args: any[]) => console.error('[ERROR]', ...args),
  warn: (...args: any[]) => console.error('[WARN]', ...args),
  debug: (...args: any[]) => console.error('[DEBUG]', ...args)
};