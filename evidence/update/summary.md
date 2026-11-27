# Проверка кандидата обновления

Завершено попыток: 30 из 30.

| Сценарий | Версия | Правильные файлы | Верный выбор | Полный usage | Вход* | Выход* | Инструменты | MCP | Ошибки запуска |
|---|---|---|---|---|---|---|---|---|---|
| open | old | 3/3 | 3/3 | 3/3 | 23421 | 342 | 12 | 3 | 0 |
| open | new | 3/3 | 3/3 | 3/3 | 23707 | 339 | 12 | 3 | 0 |
| owners | old | 3/3 | 0/3 | 3/3 | 30816 | 426 | 12 | 0 | 0 |
| owners | new | 3/3 | 0/3 | 3/3 | 31196 | 426 | 12 | 0 | 0 |
| project | old | 0/3 | 3/3 | 3/3 | 31248 | 443 | 11 | 0 | 0 |
| project | new | 0/3 | 3/3 | 3/3 | 31209 | 440 | 11 | 0 | 0 |
| missing-owner | old | 0/3 | 3/3 | 3/3 | 43932 | 437 | 16 | 0 | 1 |
| missing-owner | new | 0/3 | 3/3 | 3/3 | 43828 | 478 | 17 | 0 | 2 |
| outage | old | 0/3 | 3/3 | 3/3 | 39681 | 370 | 21 | 13 | 3 |
| outage | new | 0/3 | 3/3 | 3/3 | 40212 | 402 | 21 | 9 | 3 |
| Всего | old | 6/15 | 12/15 | 15/15 | 169098 | 2018 | 72 | 16 | 4 |
| Всего | new | 6/15 | 12/15 | 15/15 | 170152 | 2085 | 73 | 12 | 5 |

*Сумма только доступных значений API; полнота указана отдельно. Ошибки исполнения инструмента видны в строках trials.jsonl и событиях, включая ожидаемый отказ трекера.

Ошибки выбора скилла, old: 3 из 15.

Ошибки выбора скилла, new: 3 из 15.

**Решение:** отклонить. missing-owner: регрессия действий. Правильный файл получен менее чем в половине попыток одной из версий.

## Первая парная попытка

- [old · 880a44d2-6983-4bea-89fe-24a4aadb1b7e](trials/open-old1/events.jsonl) — load_skill → mcp_tracker_list → write_file → complete_task. Результат проверяющего скрипта: верный файл. Выбранные скиллы: open-tasks.
- [new · 117c8e46-0d8a-4d79-862f-d44ec31fa734](trials/open-new1/events.jsonl) — load_skill → mcp_tracker_list → write_file → complete_task. Результат проверяющего скрипта: верный файл. Выбранные скиллы: open-tasks.

Общий расход API в этой паре: old — 7911, new — 8010 токенов. Разница — 99. Показатель включает и маршрутизацию Laya, и генерацию ответа.

Различия в действиях этой пары не привели к различию по внешнему критерию. Число обращений и сообщения инструментов доступны по ссылкам.

## Журналы попыток

- [open · old1](trials/open-old1/events.jsonl) — completed, outcome=true, маршрут=true
- [open · new1](trials/open-new1/events.jsonl) — completed, outcome=true, маршрут=true
- [open · old2](trials/open-old2/events.jsonl) — completed, outcome=true, маршрут=true
- [open · new2](trials/open-new2/events.jsonl) — completed, outcome=true, маршрут=true
- [open · old3](trials/open-old3/events.jsonl) — completed, outcome=true, маршрут=true
- [open · new3](trials/open-new3/events.jsonl) — completed, outcome=true, маршрут=true
- [owners · old1](trials/owners-old1/events.jsonl) — completed, outcome=true, маршрут=false
- [owners · new1](trials/owners-new1/events.jsonl) — completed, outcome=true, маршрут=false
- [owners · old2](trials/owners-old2/events.jsonl) — completed, outcome=true, маршрут=false
- [owners · new2](trials/owners-new2/events.jsonl) — completed, outcome=true, маршрут=false
- [owners · old3](trials/owners-old3/events.jsonl) — completed, outcome=true, маршрут=false
- [owners · new3](trials/owners-new3/events.jsonl) — completed, outcome=true, маршрут=false
- [project · old1](trials/project-old1/events.jsonl) — completed, outcome=false, маршрут=true
- [project · new1](trials/project-new1/events.jsonl) — completed, outcome=false, маршрут=true
- [project · old2](trials/project-old2/events.jsonl) — completed, outcome=false, маршрут=true
- [project · new2](trials/project-new2/events.jsonl) — completed, outcome=false, маршрут=true
- [project · old3](trials/project-old3/events.jsonl) — completed, outcome=false, маршрут=true
- [project · new3](trials/project-new3/events.jsonl) — completed, outcome=false, маршрут=true
- [missing-owner · old1](trials/missing-owner-old1/events.jsonl) — blocked, outcome=false, маршрут=true
- [missing-owner · new1](trials/missing-owner-new1/events.jsonl) — blocked, outcome=false, маршрут=true
- [missing-owner · old2](trials/missing-owner-old2/events.jsonl) — completed, outcome=false, маршрут=true
- [missing-owner · new2](trials/missing-owner-new2/events.jsonl) — completed, outcome=false, маршрут=true
- [missing-owner · old3](trials/missing-owner-old3/events.jsonl) — completed, outcome=false, маршрут=true
- [missing-owner · new3](trials/missing-owner-new3/events.jsonl) — blocked, outcome=false, маршрут=true
- [outage · old1](trials/outage-old1/events.jsonl) — blocked, outcome=false, маршрут=true
- [outage · new1](trials/outage-new1/events.jsonl) — blocked, outcome=false, маршрут=true
- [outage · old2](trials/outage-old2/events.jsonl) — blocked, outcome=false, маршрут=true
- [outage · new2](trials/outage-new2/events.jsonl) — blocked, outcome=false, маршрут=true
- [outage · old3](trials/outage-old3/events.jsonl) — blocked, outcome=false, маршрут=true
- [outage · new3](trials/outage-new3/events.jsonl) — blocked, outcome=false, маршрут=true
