import { cliCommand } from './paths.js';
export const HELP = `Агент для работы с кодом

Начать
  ${cliCommand}                           Открыть диалог и вводить запросы по очереди
  ${cliCommand} "Исправь расчёт заказа"    Запустить задачу на отдельной копии примера
  ${cliCommand} run "Проверь тесты" --workspace ./project --policy ./policy.json

Во время работы
  После ответа вводите следующий запрос в той же рабочей папке. Выход — /exit.
  В терминале видны вызовы модели и ответы инструментов. На запрос решения
  введите да, нет или нажмите Enter, чтобы отложить. При отказе от плана
  можно пояснить причину, например «нет запусти тесты через unittest».

Сохранённые запуски
  ${cliCommand} runs                       История с короткими ID
  ${cliCommand} resume [ID]                Продолжить с места остановки
  ${cliCommand} status [ID]                Состояние и причина остановки
  ${cliCommand} trace [ID]                 Предложения модели и результаты инструментов
  ${cliCommand} tasks [ID]                 Чеклист задач
  ${cliCommand} diff [ID]                  Изменения файлов

  Если ID опущен, выбирается последний созданный запуск в выбранной базе.
  Для более раннего запуска укажите ID целиком или его однозначное начало.

Пошаговое управление
  ${cliCommand} start --task "Текст"       Выполнить до ближайшей паузы
  ${cliCommand} approve-plan ID --decision approve|reject [--feedback "Исправление"]
  ${cliCommand} approve-action ID --decision allow|deny
  ${cliCommand} resolve ID --decision retry|fail|abort [--attribute yes|no]
  ${cliCommand} rollback ID
  ${cliCommand} resolve-rollback ID
  ${cliCommand} demo                       Демо со сценарной моделью и реальным Bash

Параметры
  --workspace ПАПКА     Рабочая папка. По умолчанию run создаёт копию workspace,
                       start работает в workspace.
  --policy ФАЙЛ        По умолчанию policy.example.json
  --mode safe|auto     По умолчанию safe
  --no-plan            Начать сразу с исполнения
  --no-input           Остановиться на решении без вопроса в терминале
  --json               Вывести один JSON для скриптов и отключить вопросы
  --db ФАЙЛ            По умолчанию .agent/state.sqlite
  --fault ТОЧКА        after_reservation, after_execute, after_rollback_write
  --help, -h           Справка

Подключение модели задаётся в .env (OPENAI_BASE_URL, OPENAI_API_KEY, OPENAI_MODEL).`;
