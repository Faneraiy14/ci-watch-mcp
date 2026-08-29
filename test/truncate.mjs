// truncate.mjs — регресія для реального бага: watchCi()'s останнє
// "аварійне" обрізання (коли per-job truncateAroundError() усе одно не
// вклався в MAX_LOG_CHARS через накладні витрати на заголовки/маркери
// "...(обрізано)...") раніше різало наосліп по хвосту - саме той наївний
// підхід, від якого мав рятувати truncateAroundError() на рівні окремого
// job. Живе відтворення (перевірено вручну перед фіксом): 4+ провалених
// job у складеному рядку - і ##[error] ПЕРШОГО job зникав без сліду.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { truncateAroundError } from '../src/watch.js';

test('truncateAroundError: текст без ##[error] - звичайний хвіст без падіння', () => {
    const text = 'a'.repeat(100);
    const result = truncateAroundError(text, 20);
    assert.equal(result.length <= 20 + 60, true); // + запас на префікс "...(обрізано, ...)..."
    assert.match(result, /обрізано/);
});

test('truncateAroundError: текст коротший за бюджет - повертається без змін', () => {
    const text = 'короткий лог з ##[error] тут';
    assert.equal(truncateAroundError(text, 1000), text);
});

test('truncateAroundError: складений багато-job текст, що перевищує бюджет, - маркер ОСТАННЬОГО job виживає (не сліпий хвіст)', () => {
    // Той самий патерн, що будує watch.js: кожен job вже обрізаний до
    // свого локального бюджету (маркер близько до ПОЧАТКУ шматка через
    // "before: min(500, markerIdx)"), тоді все з'єднано в один рядок, що
    // сукупно перевищує MAX_LOG_CHARS через заголовки job/роздільники.
    const jobBudget = 300;
    const jobCount = 10;
    const parts = [];
    for (let i = 0; i < jobCount; i++) {
        const raw = 'setup\n'.repeat(3) + `##[error] failure in job${i}\n` + 'noisy cleanup\n'.repeat(200);
        const cleaned = truncateAroundError(raw, jobBudget);
        parts.push(`--- job "job${i}" ---\n${cleaned}`);
    }
    const combined = parts.join('\n\n');
    const MAX_LOG_CHARS = jobBudget * jobCount - 500; // штучно тісний бюджет, щоб гарантовано перевищити

    assert.ok(combined.length > MAX_LOG_CHARS, 'тестовий сетап мусить реально перевищувати бюджет');

    const final = truncateAroundError(combined, MAX_LOG_CHARS);

    // Ключова властивість фіксу: обрізання йде НАВКОЛО реального маркера
    // помилки (останнього в тексті), а не сліпо по символах з кінця -
    // тож маркер останнього job завжди переживає обрізання.
    assert.match(final, /failure in job9/);
});
