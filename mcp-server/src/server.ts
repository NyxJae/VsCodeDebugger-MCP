try {
  // 1.2. 实现基础启动逻辑
  console.log('Debug MCP Server Started');

  // 1.3. 实现优雅停止逻辑
  const handleShutdown = (signal: string) => {
    console.log(`Received ${signal}. Debug MCP Server Stopping...`);
    // 在这里添加任何必要的清理逻辑
    process.exit(0);
  };

  process.on('SIGINT', () => handleShutdown('SIGINT'));
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));

  // 保持进程运行，直到收到停止信号
  // 在实际应用中，这里会有服务器监听逻辑 (例如 http.createServer().listen())
  // 对于这个极简版本，我们可以简单地保持进程活动
  setInterval(() => {
    // 这个定时器只是为了防止 Node.js 在没有活动句柄时自动退出
    // 在实际服务器中，监听端口的操作会保持进程活动
  }, 1000 * 60 * 60); // 每小时执行一次空操作

} catch (error) {
  console.error('Debug MCP Server failed to start:', error);
  process.exit(1); // 异常退出，非零退出码
}