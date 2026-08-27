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

// Прибирає ISO-таймстемп на початку кожного рядка логу
// ("2026-08-19T11:54:01.8569953Z ...") - шум, що займає чверть бюджету
// MAX_LOG_CHARS і не несе сенсу для читача (AI-асистент чи людина), якого
// цікавить ЩО впало, а не мілісекунда, коли рядок долетів до буфера.
function stripLogTimestamps(text) {
    return text.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z /gm, '');
}

// Просте обрізання по "хвосту" (останні N символів) ненадійне для логів
// CI: після реальної помилки крокy зазвичай іде ПОСТ-job прибирання
// (Post Run actions/checkout, git config --unset тощо) - може бути довшим
// за саму помилку й виштовхнути ##[error] за межі вікна повністю. Замість
// цього шукаємо ОСТАННЄ входження "##[error]" (маркер GitHub Actions для
// падіння кроку) і тримаємо вікно НАВКОЛО нього - трохи контексту до, весь
// бюджет після. Якщо маркера нема (нетиповий формат падіння) - звичайний
// хвіст як безпечний фолбек.
function truncateAroundError(text, budget) {
    if (text.length <= budget) return text;

    const markerIdx = text.lastIndexOf('##[error]');
    if (markerIdx === -1) {
        return `...(обрізано, показано останні ${budget} символів)...\n` + text.slice(-budget);
    }

    const before = Math.min(500, markerIdx);
    const start = markerIdx - before;
    const sliced = text.slice(start, start + budget);
    const prefix = start > 0 ? `...(обрізано)...\n` : '';
    const suffix = start + budget < text.length ? `\n...(обрізано)...` : '';
    return prefix + sliced + suffix;
}

// gh run view --log-failed - емпірично ненадійна: на реальному провальному
// запуску (secretscan, run 32249846187) повертає ПОРОЖНІЙ рядок з exitCode
// 0, БЕЗ жодної помилки в stderr - хоча gh run view (без --log) сам же
// підказує "To see what failed, try: gh run view <id> --log-failed", і
// сирі логи РЕАЛЬНО є на GitHub (перевірено напряму: gh api .../jobs/<id>/
// logs повертає повний текст логу, 200 OK). Це не протухлі/видалені логи
// (сталось на запуску 8-денної давності, задовго до 90-денного retention),
// а конкретний баг команди `--log-failed` у gh CLI 2.46.0. Тому - напряму
// REST API на кожен job з conclusion "failure", а не покладатись на цю
// команду взагалі.
async function fetchFailedJobLogs(cwd, run) {
    const nameWithOwner = (await gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], cwd)).trim();

    const jobsJson = await gh(['run', 'view', String(run.databaseId), '--json', 'jobs'], cwd);
    const { jobs } = JSON.parse(jobsJson);
    const failedJobs = jobs.filter((j) => j.conclusion === 'failure');

    if (failedJobs.length === 0) {
        // Увесь run провалився, але жоден job не позначений failure окремо
        // (напр. сам workflow-файл не розпарсився) - логів на рівні job
        // тоді нема що тягнути.
        return '(жоден job не позначений як failure - можливо, помилка в самому workflow-файлі; дивись url)';
    }

    // Бюджет ділиться порівну між провальними job - інакше один job із
    // шумним хвостом міг би одноосібно виїсти весь MAX_LOG_CHARS і
    // залишити інші зовсім без місця.
    const perJobBudget = Math.floor(MAX_LOG_CHARS / failedJobs.length);

    const parts = [];
    for (const job of failedJobs) {
        try {
            const raw = await gh(['api', `repos/${nameWithOwner}/actions/jobs/${job.databaseId}/logs`], cwd);
            const cleaned = truncateAroundError(stripLogTimestamps(raw), perJobBudget);
            parts.push(`--- job "${job.name}" ---\n${cleaned}`);
        } catch (err) {
            parts.push(`--- job "${job.name}" ---\n(не вдалося отримати лог: ${err.message})`);
        }
    }
    return parts.join('\n\n');
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
                    failedLogs = await fetchFailedJobLogs(cwd, run);
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
