import * as net from 'net';

export const DEFAULT_MCP_PORT = 6009;
export const MCP_PORT_KEY = 'mcpServerPort';

export function isValidPort(port: number | string): boolean {
    const num = Number(port);
    return Number.isInteger(num) && num > 1024 && num <= 65535;
}

export function isPortInUse(port: number): Promise<boolean> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'EADDRINUSE') {
                resolve(true); // 端口被占用
            } else {
                reject(err); // 其他错误
            }
        });
        server.once('listening', () => {
            server.close(() => {
                resolve(false); // 端口可用
            });
        });
        server.listen(port);
    });
}