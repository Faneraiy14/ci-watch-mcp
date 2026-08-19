// watch.js — логіка очікування завершення GitHub Actions CI для поточного
// коміту через gh CLI. Мотивація: без цього інструменту доводиться вручну
// пушити, sleep, gh run list, і за провалу ще окремо gh run view --log-failed
// - кілька викликів замість одного.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Жорсткий стеля на timeout_ms, щоб один виклик інструменту не міг
// заблокувати MCP-сесію на невизначено довгий час через друкарську
// помилку в аргументі (напр. зайвий нуль).
const MAX_TIMEOUT_MS = 20 * 60 * 1000;
const MAX_LOG_CHARS = 8000;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function gh(args, cwd) {
    try {
        const { stdout } = await execFileAsync('gh', args, { cwd, maxBuffer: 20 * 1024 * 1024 });
        return stdout;
    } catch (err) {
        const detail = err.stderr || err.message;
        throw new Error(`gh ${args.join(' ')} провалився: ${detail}`);
    }
}

// Приймає і повний SHA, і короткий (напр. з git log --oneline), і "HEAD" -
// завжди повертає повний 40-символьний SHA, бо саме такий формат віддає
// gh run list у полі headSha (порівняння коротких з повними завжди false).
async function resolveSha(cwd, ref = 'HEAD') {
    try {
        const { stdout } = await execFileAsync('git', ['rev-parse', ref], { cwd });
        return stdout.trim();
    } catch (err) {
        throw new Error(`Не вдалось розпізнати "${ref}" у ${cwd}: ${err.stderr || err.message}`);
    }
}

/**
 * Чекає на завершення CI-запуску (GitHub Actions) для заданого коміту.
 *
 * @param {object} opts
 * @param {string} opts.cwd - тека локального клону репозиторію (з налаштованим origin на GitHub)
 * @param {string} [opts.ref] - конкретний SHA коміту; за замовчуванням HEAD у cwd
 * @param {string} [opts.workflow] - назва workflow для фільтрації (напр. "CI"); без фільтра бере перший знайдений запуск на цьому SHA
 * @param {number} [opts.timeout_ms] - максимальний час очікування, типово 5 хв, стеля 20 хв
 * @param {number} [opts.poll_interval_ms] - інтервал опитування, типово 5 с
 */
export async function watchCi({
    cwd = process.cwd(),
    ref,
    workflow,
    timeout_ms = 300_000,
    poll_interval_ms = 5_000,
} = {}) {
    const effectiveTimeout = Math.min(timeout_ms, MAX_TIMEOUT_MS);
    const sha = await resolveSha(cwd, ref);
    const deadline = Date.now() + effectiveTimeout;

    let lastSeen = null;

    while (true) {
        const stdout = await gh(
            [
                'run', 'list',
                '--limit', '30',
                '--json', 'databaseId,status,conclusion,headSha,workflowName,url,createdAt',
            ],
            cwd
        );
        const runs = JSON.parse(stdout);
        const run = runs.find(
            (r) => r.headSha === sha && (!workflow || r.workflowName === workflow)
        );

        if (run) {
            lastSeen = run;
            if (run.status === 'completed') {
                if (run.conclusion === 'success') {
                    return { ok: true, conclusion: run.conclusion, url: run.url, sha, workflowName: run.workflowName };
                }

                let failedLogs;
                try {
                    failedLogs = await gh(['run', 'view', String(run.databaseId), '--log-failed'], cwd);
                } catch (err) {
                    failedLogs = `(не вдалося отримати лог: ${err.message})`;
                }
                if (failedLogs.length > MAX_LOG_CHARS) {
                    failedLogs = `...(обрізано, показано останні ${MAX_LOG_CHARS} символів)...\n` + failedLogs.slice(-MAX_LOG_CHARS);
                }

                return {
                    ok: false,
                    conclusion: run.conclusion,
                    url: run.url,
                    sha,
                    workflowName: run.workflowName,
                    failedLogs,
                };
            }
        }

        if (Date.now() >= deadline) {
            return {
                ok: false,
                timedOut: true,
                sha,
                status: lastSeen?.status ?? 'not_found',
                url: lastSeen?.url ?? null,
                message: lastSeen
                    ? 'Запуск CI ще не завершився за відведений час.'
                    : 'Жодного запуску CI для цього коміту не знайдено за відведений час (можливо, ще не стартував або немає workflow на push).',
            };
        }

        await sleep(poll_interval_ms);
    }
}
