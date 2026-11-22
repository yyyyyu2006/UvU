import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

// Atomic fixed-window counters shared by processes on the same host/filesystem.
// This does not make account sessions or Worker limits distributed.
export async function createSqliteRateLimiter(file) {
    if (!file || file === ':memory:') throw Error('Shared limiter requires a persistent SQLite file');
    await mkdir(dirname(file),{recursive:true,mode:0o700});
    const {DatabaseSync}=await import('node:sqlite');
    const db=new DatabaseSync(file);
    db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS music_rate (key TEXT PRIMARY KEY, started INTEGER NOT NULL, count INTEGER NOT NULL, expires INTEGER NOT NULL)');
    const read=db.prepare('SELECT started,count FROM music_rate WHERE key=?');
    const put=db.prepare('INSERT INTO music_rate(key,started,count,expires) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET started=excluded.started,count=excluded.count,expires=excluded.expires');
    const clean=db.prepare('DELETE FROM music_rate WHERE expires<?');let operations=0,closed=false;
    return { mode:'sqlite-shared',
        async consume({key,limit,windowMs,now}) {
            if(closed)throw Error('Rate store closed');
            if(!/^[a-f0-9]{64}$/.test(key)||!Number.isSafeInteger(limit)||limit<1||!Number.isSafeInteger(windowMs)||windowMs<1||!Number.isSafeInteger(now))throw Error('Invalid rate counter');
            db.exec('BEGIN IMMEDIATE');
            try { const row=read.get(key),fresh=!row||now-row.started>=windowMs||now<row.started,started=fresh?now:row.started,count=fresh?1:row.count+1;
                put.run(key,started,count,started+windowMs);if(++operations%100===0)clean.run(now);
                db.exec('COMMIT');return {allowed:count<=limit,retryAfterMs:count<=limit?0:Math.max(1,started+windowMs-now)};
            }catch(e){db.exec('ROLLBACK');throw e;}
        },close(){if(!closed){closed=true;db.close();}}
    };
}
