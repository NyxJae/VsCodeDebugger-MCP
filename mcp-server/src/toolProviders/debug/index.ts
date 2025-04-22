// mcp-server/src/toolProviders/debug/index.ts
export * from './getConfigurations';
export * from './setBreakpoint';
export * from './getBreakpoints';
export * from './removeBreakpoint'; // Exports handleRemoveBreakpoint, RemoveBreakpointInputSchema, BaseRemoveBreakpointInputSchema, RemoveBreakpointInput
// 确保导出了所有需要被外部使用的函数、类型和 Schema