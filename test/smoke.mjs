// smoke.mjs — перевіряє watchCi() на вже завершених запусках у реальному
// репозиторії (secretscan), щоб не чекати живого пушу: обидва SHA нижче
// вже мають готовий CI-результат, тож перший же опит має повернути
// відповідь миттєво, без жодного sleep.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { watchCi } from '../src/watch.js';

const REPO = '/home/sviat/Projects/secretscan';

test('watchCi: успішний завершений запуск повертає ok=true без очікування', async () => {
    const result = await watchCi({ cwd: REPO, ref: '9027ff2', timeout_ms: 30_000, poll_interval_ms: 2_000 });
    assert.equal(result.ok, true);
    assert.equal(result.conclusion, 'success');
    assert.ok(result.url.includes('secretscan'));
});

test('watchCi: провалений завершений запуск повертає ok=false і лог', async () => {
    const result = await watchCi({ cwd: REPO, ref: 'eca6d49', timeout_ms: 30_000, poll_interval_ms: 2_000 });
    assert.equal(result.ok, false);
    assert.equal(result.conclusion, 'failure');
    assert.ok(typeof result.failedLogs === 'string' && result.failedLogs.length > 0);
});

test('watchCi: коміт без жодного CI-запуску повертає timedOut після короткого таймауту', async () => {
    // fb653ef - початковий коміт secretscan, до того як з'явився ci.yml,
    // тож для нього CI ніколи не запускався й не запуститься.
    const result = await watchCi({ cwd: REPO, ref: 'fb653ef', timeout_ms: 3_000, poll_interval_ms: 1_000 });
    assert.equal(result.ok, false);
    assert.equal(result.timedOut, true);
});

test('watchCi: неіснуючий SHA кидає зрозумілу помилку замість мовчазного зависання', async () => {
    await assert.rejects(
        () => watchCi({ cwd: REPO, ref: '0000000000000000000000000000000000dead', timeout_ms: 3_000 }),
        /Не вдалось розпізнати/
    );
});
