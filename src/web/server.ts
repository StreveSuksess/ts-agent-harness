import { createStudioApi } from '../studio/api.js';
import { studioServer } from './transport.js';

const port = Number(process.env.STUDIO_PORT ?? '4173');
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('STUDIO_PORT должен быть числом от 1 до 65535.');
const api = await createStudioApi();
const server = studioServer(api);
server.on('error', (error) => {
  console.error(error.message);
  api.close?.();
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () =>
  console.log(`Студия агента открывается по адресу http://127.0.0.1:${port}`),
);
process.once('SIGINT', () => server.close());
process.once('SIGTERM', () => server.close());
