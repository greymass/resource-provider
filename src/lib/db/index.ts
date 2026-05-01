import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';

import { generalLog } from '$lib/logger';
import { DATABASE_FILE } from 'src/config';

const _dirname =
	import.meta.dir.startsWith('/$bunfs/root') || import.meta.dir.startsWith('B:\\~BUN\\root')
		? `${process.execPath}/..` // bun binary location
		: `${import.meta.dir}/../../..`; // root of the project

export const dbPath = `${_dirname}/${DATABASE_FILE}`;

generalLog.debug('Using database file', { dbPath });

const sqlite = new Database(dbPath, { create: true });
export const database = drizzle({ client: sqlite });
