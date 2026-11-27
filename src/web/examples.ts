import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { projectRoot } from '../cli/paths.js';

/** Read only the two published sessions. Live workspaces use the Studio API. */
export async function submittedExample(kind: 'explicit' | 'ambiguous') {
  const root = join(projectRoot, 'evidence', 'studio-demo', kind);
  const read = (name: string) => readFile(join(root, name), 'utf8');
  const artifact = kind === 'explicit' ? 'answer.json' : 'open.json';
  const [session, doctor, events, answer, count] = await Promise.all([
    read('session.json'),
    read('doctor.json'),
    read('events.jsonl'),
    read(artifact),
    read('count.txt'),
  ]);
  return {
    session: JSON.parse(session),
    doctor: JSON.parse(doctor),
    events: events
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line)),
    artifacts: { [artifact]: answer.trim(), 'count.txt': count.trim() },
  };
}
