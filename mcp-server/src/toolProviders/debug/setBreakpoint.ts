import * as path from 'path';
import { z } from 'zod';
import { sendRequestToPlugin, PluginResponse } from '../../pluginCommunicator';
import * as Constants from '../../constants';

export const setBreakpointSchema = z.object({
    file_path: z.string().min(1, "File path cannot be empty."),
    line_number: z.number().int().positive("Line number must be a positive integer."),
    column_number: z.number().int().positive("Column number must be a positive integer.").optional(),
    condition: z.string().optional(),
    hit_condition: z.string().optional(),
    log_message: z.string().optional(),
});

export type SetBreakpointArgs = z.infer<typeof setBreakpointSchema>;

type SetBreakpointResult =
    | { status: typeof Constants.IPC_STATUS_SUCCESS; content: { type: "text", text: string }[] }
    | { status: typeof Constants.IPC_STATUS_ERROR; message: string; content: { type: "text", text: string }[]; isError: true };

/**
 * Handles the set_breakpoint MCP tool request.
 * Sends a request to the VS Code plugin to set a breakpoint.
 * @param args - The arguments for setting the breakpoint.
 * @param extra - Additional context (currently unused).
 * @returns A promise resolving to the result of the operation.
 */
export async function handleSetBreakpoint(
    args: SetBreakpointArgs,
    extra: any
): Promise<SetBreakpointResult> {
    const workspacePath = process.env.VSCODE_WORKSPACE_PATH;
    if (!workspacePath) {
        const errorMsg = 'Unable to get VS Code workspace path (VSCODE_WORKSPACE_PATH environment variable not set).';
        console.error(`[MCP Server] Error in handleSetBreakpoint: ${errorMsg}`);
        return {
            status: Constants.IPC_STATUS_ERROR,
            message: errorMsg,
            content: [{ type: "text", text: errorMsg }],
            isError: true
        };
    }

    let absoluteFilePath = args.file_path;
    if (!path.isAbsolute(args.file_path)) {
        absoluteFilePath = path.resolve(workspacePath, args.file_path);
    }

    const payloadForPlugin = {
        ...args,
        file_path: absoluteFilePath
    };

    try {
        const pluginResponse: PluginResponse = await sendRequestToPlugin({ command: Constants.IPC_COMMAND_SET_BREAKPOINT, payload: payloadForPlugin });

        if (pluginResponse.status === Constants.IPC_STATUS_SUCCESS && pluginResponse.payload && pluginResponse.payload.breakpoint) {
            const resultBreakpoint = pluginResponse.payload.breakpoint;
            // Validate the structure of the returned breakpoint data
            if (
                typeof resultBreakpoint === 'object' && resultBreakpoint !== null &&
                'verified' in resultBreakpoint && typeof resultBreakpoint.verified === 'boolean' &&
                'source' in resultBreakpoint && typeof resultBreakpoint.source === 'object' && resultBreakpoint.source !== null && 'path' in resultBreakpoint.source && typeof resultBreakpoint.source.path === 'string' &&
                'line' in resultBreakpoint && typeof resultBreakpoint.line === 'number' &&
                'timestamp' in resultBreakpoint && typeof resultBreakpoint.timestamp === 'string'
            ) {
                 const breakpointInfo = {
                     id: resultBreakpoint.id,
                     verified: resultBreakpoint.verified,
                     source: { path: resultBreakpoint.source.path },
                     line: resultBreakpoint.line,
                     column: resultBreakpoint.column,
                     message: resultBreakpoint.message,
                     timestamp: resultBreakpoint.timestamp
                 };
                 const successText = JSON.stringify(breakpointInfo, null, 2);
                 return {
                     status: Constants.IPC_STATUS_SUCCESS,
                     content: [{ type: "text", text: successText }]
                 };
             } else {
                 const errorMessage = 'Plugin returned breakpoint data in an unexpected format.';
                 console.error(`[MCP Server] ${errorMessage}`, pluginResponse.payload.breakpoint);
                 return {
                     status: Constants.IPC_STATUS_ERROR,
                     message: errorMessage,
                     content: [{ type: "text", text: errorMessage }],
                     isError: true
                 };
             }
         } else if (pluginResponse.status === Constants.IPC_STATUS_ERROR) {
             const errorMessage = pluginResponse.error?.message || 'Plugin failed to set breakpoint with an unspecified error.';
             console.error(`[MCP Server] Plugin reported error setting breakpoint: ${errorMessage}`);
             return {
                 status: Constants.IPC_STATUS_ERROR,
                 message: errorMessage,
                 content: [{ type: "text", text: errorMessage }],
                 isError: true
             };
         } else {
              const errorMessage = 'Plugin returned success but payload format was unexpected.';
              console.error(`[MCP Server] ${errorMessage}`, pluginResponse.payload);
              return {
                  status: Constants.IPC_STATUS_ERROR,
                  message: errorMessage,
                  content: [{ type: "text", text: errorMessage }],
                  isError: true
              };
         }

     } catch (error: any) {
         const errorMessage = error?.message || "Failed to set breakpoint due to communication error or unexpected issue.";
         console.error(`[MCP Server] Error setting breakpoint: ${errorMessage}`);
         return {
             status: Constants.IPC_STATUS_ERROR,
             message: errorMessage,
             content: [{ type: "text", text: errorMessage }],
             isError: true
         };
     }
 }