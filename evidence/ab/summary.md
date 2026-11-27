# Влияние поддержки скиллов

Завершено попыток: 30 из 30.

| Сценарий | Версия | Правильные файлы | Верный выбор | Полный usage | Вход* | Выход* | Инструменты | MCP | Ошибки запуска |
|---|---|---|---|---|---|---|---|---|---|
| open | A | 3/3 | н/п | 3/3 | 20454 | 338 | 9 | 3 | 0 |
| open | B | 3/3 | 3/3 | 3/3 | 23417 | 341 | 12 | 3 | 0 |
| owners | A | 3/3 | н/п | 3/3 | 24376 | 479 | 8 | 0 | 1 |
| owners | B | 3/3 | 0/3 | 3/3 | 30791 | 424 | 12 | 0 | 0 |
| project | A | 0/3 | н/п | 3/3 | 33462 | 465 | 12 | 0 | 0 |
| project | B | 0/3 | 3/3 | 3/3 | 33939 | 469 | 12 | 0 | 0 |
| missing-owner | A | 0/3 | н/п | 3/3 | 36640 | 347 | 13 | 0 | 3 |
| missing-owner | B | 0/3 | 3/3 | 3/3 | 43779 | 437 | 15 | 0 | 0 |
| outage | A | 3/3 | н/п | 3/3 | 19713 | 276 | 9 | 3 | 0 |
| outage | B | 0/3 | 3/3 | 3/3 | 39663 | 354 | 21 | 15 | 3 |
| Всего | A | 9/15 | н/п | 15/15 | 134645 | 1905 | 51 | 6 | 4 |
| Всего | B | 6/15 | 12/15 | 15/15 | 171589 | 2025 | 72 | 18 | 3 |

*Сумма только доступных значений API; полнота указана отдельно. Ошибки исполнения инструмента видны в строках trials.jsonl и событиях, включая ожидаемый отказ трекера.

Ошибки выбора скилла, B: 3 из 15.

На двух целевых сценариях разница B минус A составила 0 успешных попыток из шести. Гипотеза об улучшении на этом наборе не подтвердилась. Три повтора на сценарий ограничивают обобщение.

## Первая парная попытка

- [A · 557f5189-6bf5-4554-bdcd-fb86785e3206](trials/open-A1/events.jsonl) — mcp_tracker_list → write_file → complete_task. Результат проверяющего скрипта: верный файл. Выбранные скиллы: нет.
- [B · 311883f5-0f2b-4a9e-921e-b495ea74baf3](trials/open-B1/events.jsonl) — load_skill → mcp_tracker_list → write_file → complete_task. Результат проверяющего скрипта: верный файл. Выбранные скиллы: open-tasks.

Общий расход API в этой паре: A — 6923, B — 7926 токенов. Разница — 1003. Показатель включает и маршрутизацию Laya, и генерацию ответа.

Различия в действиях этой пары не привели к различию по внешнему критерию. Число обращений и сообщения инструментов доступны по ссылкам.

## Журналы попыток

- [open · A1](trials/open-A1/events.jsonl) — completed, outcome=true, маршрут=n/a
- [open · B1](trials/open-B1/events.jsonl) — completed, outcome=true, маршрут=true
- [open · A2](trials/open-A2/events.jsonl) — completed, outcome=true, маршрут=n/a
- [open · B2](trials/open-B2/events.jsonl) — completed, outcome=true, маршрут=true
- [open · A3](trials/open-A3/events.jsonl) — completed, outcome=true, маршрут=n/a
- [open · B3](trials/open-B3/events.jsonl) — completed, outcome=true, маршрут=true
- [owners · A1](trials/owners-A1/events.jsonl) — completed, outcome=true, маршрут=n/a
- [owners · B1](trials/owners-B1/events.jsonl) — completed, outcome=true, маршрут=false
- [owners · A2](trials/owners-A2/events.jsonl) — completed, outcome=true, маршрут=n/a
- [owners · B2](trials/owners-B2/events.jsonl) — completed, outcome=true, маршрут=false
- [owners · A3](trials/owners-A3/events.jsonl) — failed, outcome=true, маршрут=n/a
- [owners · B3](trials/owners-B3/events.jsonl) — completed, outcome=true, маршрут=false
- [project · A1](trials/project-A1/events.jsonl) — completed, outcome=false, маршрут=n/a
- [project · B1](trials/project-B1/events.jsonl) — completed, outcome=false, маршрут=true
- [project · A2](trials/project-A2/events.jsonl) — completed, outcome=false, маршрут=n/a
- [project · B2](trials/project-B2/events.jsonl) — completed, outcome=false, маршрут=true
- [project · A3](trials/project-A3/events.jsonl) — completed, outcome=false, маршрут=n/a
- [project · B3](trials/project-B3/events.jsonl) — completed, outcome=false, маршрут=true
- [missing-owner · A1](trials/missing-owner-A1/events.jsonl) — blocked, outcome=false, маршрут=n/a
- [missing-owner · B1](trials/missing-owner-B1/events.jsonl) — completed, outcome=false, маршрут=true
- [missing-owner · A2](trials/missing-owner-A2/events.jsonl) — blocked, outcome=false, маршрут=n/a
- [missing-owner · B2](trials/missing-owner-B2/events.jsonl) — completed, outcome=false, маршрут=true
- [missing-owner · A3](trials/missing-owner-A3/events.jsonl) — failed, outcome=false, маршрут=n/a
- [missing-owner · B3](trials/missing-owner-B3/events.jsonl) — completed, outcome=false, маршрут=true
- [outage · A1](trials/outage-A1/events.jsonl) — completed, outcome=true, маршрут=n/a
- [outage · B1](trials/outage-B1/events.jsonl) — blocked, outcome=false, маршрут=true
- [outage · A2](trials/outage-A2/events.jsonl) — completed, outcome=true, маршрут=n/a
- [outage · B2](trials/outage-B2/events.jsonl) — blocked, outcome=false, маршрут=true
- [outage · A3](trials/outage-A3/events.jsonl) — completed, outcome=true, маршрут=n/a
- [outage · B3](trials/outage-B3/events.jsonl) — blocked, outcome=false, маршрут=true
