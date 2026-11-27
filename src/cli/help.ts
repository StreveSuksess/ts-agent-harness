export const HELP = `Агент для работы с кодом

Начать
  ./agent                           Ввести задачу в терминале
  ./agent "Исправь расчёт заказа"    Запустить задачу на отдельной копии примера
  ./agent run "Проверь тесты" --workspace ./project --policy ./policy.json

Во время работы
  В терминале видны вызовы модели и ответы инструментов. На запрос решения
  введите да, нет или нажмите Enter, чтобы отложить. При отказе от плана
  можно пояснить причину, например «нет запусти тесты через unittest».

Сохранённые запуски
  ./agent runs                       История с короткими ID
  ./agent resume [ID]                Продолжить с места остановки
  ./agent status [ID]                Состояние и причина остановки
  ./agent trace [ID]                 Предложения модели и результаты инструментов
  ./agent tasks [ID]                 Чеклист задач
  ./agent diff [ID]                  Изменения файлов

  Если ID опущен, выбирается последний созданный запуск в выбранной базе.
  Для более раннего запуска укажите ID целиком или его однозначное начало.

Пошаговое управление
  ./agent start --task "Текст"       Выполнить до ближайшей паузы
  ./agent approve-plan ID --decision approve|reject [--feedback "Исправление"]
  ./agent approve-action ID --decision allow|deny
  ./agent resolve ID --decision retry|fail|abort [--attribute yes|no]
  ./agent rollback ID
  ./agent resolve-rollback ID
  ./agent demo                       Демо со сценарной моделью и реальным Bash

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
