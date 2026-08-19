# ci-watch-mcp

MCP-сервер із одним інструментом `watch_ci` — чекає, поки GitHub Actions
CI завершиться для коміту в локальному git-репозиторії, і одним викликом
повертає підсумок разом із логом помилки, якщо щось впало.

## Навіщо

Без цього перевірка "чи пройшов CI після мого пушу" — це вручну:
push → sleep → `gh run list` → якщо в статусі "in_progress", ще sleep →
знову `gh run list` → якщо `conclusion: failure`, окремий виклик
`gh run view <id> --log-failed`, щоб побачити, що саме зламалось.
`watch_ci` робить усе це за один виклик і одразу повертає лог провалу,
без ручного циклу очікування.

## Інструмент

### `watch_ci`

| Параметр | Тип | За замовчуванням | Опис |
|---|---|---|---|
| `cwd` | string | — (обов'язковий) | Шлях до локального клону репозиторію з `origin` на GitHub |
| `ref` | string | `HEAD` | SHA (повний чи короткий) або будь-який git-ref |
| `workflow` | string | — | Фільтр за назвою workflow, якщо в репо їх декілька |
| `timeout_ms` | number | `300000` (5 хв) | Стеля `1200000` (20 хв) |
| `poll_interval_ms` | number | `5000` | Інтервал опитування `gh run list` |

Повертає:
- `{ ok: true, conclusion: "success", url, sha, workflowName }` — CI пройшов;
- `{ ok: false, conclusion: "failure", url, sha, workflowName, failedLogs }` — CI впав, `failedLogs` — хвіст `gh run view --log-failed` (обрізаний до 8000 символів, з кінця — там найінформативніше);
- `{ ok: false, timedOut: true, status, url, message }` — не встиг завершитись/стартувати за відведений час.

Якщо `ref` не резолвиться в реальний коміт (одруківка в SHA), інструмент
одразу кидає помилку замість мовчазного очікування до таймауту.

## Встановлення

```bash
cd ci-watch-mcp
npm install
```

Підключення до Claude Code:

```bash
claude mcp add ci-watch -s user -- node /шлях/до/ci-watch-mcp/src/server.js
```

Потрібен встановлений і автентифікований `gh` CLI (`gh auth status`).

## Тести

```bash
npm test
```

Ганяються проти вже завершених реальних запусків у репозиторії
`secretscan` (успішний, провалений, і коміт без жодного CI-запуску) —
без потреби чекати живий пуш.

## Ліцензія

MIT — Faneraiy14.
