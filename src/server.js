#!/usr/bin/env node
// server.js — реєструє інструмент watch_ci в MCP SDK і піднімає stdio-транспорт.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { watchCi } from './watch.js';

const server = new McpServer({ name: 'ci-watch-mcp', version: '0.1.0' });

server.registerTool(
    'watch_ci',
    {
        title: 'Дочекатись завершення GitHub Actions CI',
        description:
            'Чекає, поки GitHub Actions CI завершиться для поточного (або заданого) коміту в локальному ' +
            'git-репозиторії, і повертає підсумок ОДНИМ викликом: ok/conclusion/url, а за провалу - одразу ' +
            'хвіст логу невдалих кроків (--log-failed), без окремого запиту. Заміняє ручний цикл ' +
            '"push -> sleep -> gh run list -> (якщо впало) gh run view --log-failed".',
        inputSchema: {
            cwd: z.string().describe('Абсолютний шлях до локального клону репозиторію (з origin на GitHub)'),
            ref: z.string().optional().describe('SHA коміту для перевірки; за замовчуванням поточний HEAD у cwd'),
            workflow: z.string().optional().describe('Назва workflow для фільтрації (напр. "CI"), якщо в репо їх декілька'),
            timeout_ms: z.number().int().min(5_000).max(1_200_000).optional()
                .describe('Максимальний час очікування в мс, типово 300000 (5 хв), стеля 1200000 (20 хв)'),
            poll_interval_ms: z.number().int().min(1_000).max(60_000).optional()
                .describe('Інтервал опитування в мс, типово 5000'),
        },
    },
    async (args) => {
        const result = await watchCi(args);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
);

const transport = new StdioServerTransport();
await server.connect(transport);
