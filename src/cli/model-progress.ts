import { ChatModel } from '../model.js';
import type { Model } from '../types.js';

/** Keep local inference visibly active; finish the line before any tool output. */
export function cliModel(showElapsed: boolean): Model {
  return {
    async complete(messages, tools) {
      const model = ChatModel.fromEnvironment();
      if (!showElapsed) return model.complete(messages, tools);

      const started = Date.now();
      let printed = false;
      const timer = setInterval(() => {
        process.stdout.cursorTo(0);
        process.stdout.write(`Ожидание ответа · ${Math.floor((Date.now() - started) / 1000)} с`);
        printed = true;
      }, 1000);
      try {
        return await model.complete(messages, tools);
      } finally {
        clearInterval(timer);
        if (printed) process.stdout.write('\n');
      }
    },
  };
}
