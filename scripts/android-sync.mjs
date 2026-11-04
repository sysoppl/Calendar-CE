// Makes the web bundle and copies it into the Android project, ready for a
// Gradle build (`npm run android:sync`).
import { spawnSync } from 'node:child_process';

for (const command of ['npm run build', 'npx cap sync android']) {
  const result = spawnSync(command, { stdio: 'inherit', shell: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
