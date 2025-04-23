import * as vscode from 'vscode';
import {
    RemoveBreakpointParams,
    SetBreakpointParams,
    StartDebuggingResponsePayload,
    StopEventData, // 保留，因为 DebugSessionManager 可能需要
    VariableInfo // 保留，因为 DebugSessionManager 可能需要
} from '../types';
import { BreakpointManager } from './breakpointManager';
import { DebugSessionManager } from './debugSessionManager';
import { DebugStateProvider } from './debugStateProvider';
// 移除重复导入
/**
 * Facade for interacting with VS Code Debug API components.
 * Provides a simplified interface over the underlying managers.
 */
export class DebuggerApiWrapper {
    private breakpointManager: BreakpointManager;
    private debugSessionManager: DebugSessionManager;
    private debugStateProvider: DebugStateProvider;

    constructor() {
        this.debugStateProvider = new DebugStateProvider();
        this.breakpointManager = new BreakpointManager();
        this.debugSessionManager = new DebugSessionManager(this.debugStateProvider);
        console.log("DebuggerApiWrapper Facade initialized.");
    }

    /**
     * Adds a breakpoint by delegating to the BreakpointManager.
     * @param payload Breakpoint details.
     * @returns Promise resolving to breakpoint info or error.
     */
    public async addBreakpoint(payload: SetBreakpointParams): Promise<{ breakpoint: any } | { error: { message: string } }> {
        return this.breakpointManager.addBreakpoint(payload);
    }

    /**
     * Gets all current breakpoints by delegating to the BreakpointManager.
     * @returns Array of breakpoint information.
     */
    public getBreakpoints(): any[] {
        return this.breakpointManager.getBreakpoints();
    }

    /**
     * Removes breakpoints by delegating to the BreakpointManager.
     * @param params Criteria for removing breakpoints.
     * @returns Promise resolving to the operation status.
     */
    async removeBreakpoint(params: RemoveBreakpointParams): Promise<{ status: string; message?: string }> {
       return this.breakpointManager.removeBreakpoint(params);
    }

    /**
     * Starts a debugging session and waits for it to stop or complete,
     * delegating to the DebugSessionManager.
     * @param configurationName The name of the debug configuration to launch.
     * @param noDebug Whether to start without debugging.
     * @returns Promise resolving to the session result (stopped, completed, error, timeout).
     */
    public async startDebuggingAndWait(configurationName: string, noDebug: boolean): Promise<StartDebuggingResponsePayload> {
        return this.debugSessionManager.startDebuggingAndWait(configurationName, noDebug);
    }

    /**
     * Retrieves available debugger configurations directly from VS Code workspace settings.
     * This method remains in the Facade as it deals directly with workspace configuration.
     * @returns An array of available debug configurations or an empty array if none are found or an error occurs.
     */
    public getDebuggerConfigurations(): vscode.DebugConfiguration[] {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                console.warn("[DebuggerApiWrapper] No workspace folder found to retrieve debug configurations.");
                return [];
            }
            // Assuming the first workspace folder is the relevant one for launch configurations
            const folder = workspaceFolders[0];
            const launchConfig = vscode.workspace.getConfiguration('launch', folder.uri);
            const configurations = launchConfig.get<vscode.DebugConfiguration[]>('configurations');

            if (!configurations) {
                console.warn("[DebuggerApiWrapper] 'launch.configurations' not found or is not an array.");
                return [];
            }
            return configurations;
        } catch (error: any) {
            console.error("[DebuggerApiWrapper] Error retrieving debugger configurations:", error);
            return [];
        }
    }
}

