import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { Conversation } from '../../../../src/core/types';
import { OpencodeConversationHistoryService } from '../../../../src/providers/opencode/history/OpencodeConversationHistoryService';

describe('OpencodeConversationHistoryService', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudian-opencode-conversation-history-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { force: true, recursive: true });
  });

  it('retries after a session-level hydration diagnostic', async () => {
    const dbPath = path.join(tmpRoot, 'opencode.db');
    const sessionId = 'session-retry';
    const conversation = createConversation(sessionId, dbPath);
    const service = new OpencodeConversationHistoryService();

    const db = new DatabaseSync(dbPath);
    try {
      db.exec(`
        create table message (
          id text primary key,
          session_id text not null,
          time_created integer not null,
          data text not null
        );
      `);
      db.prepare('insert into message (id, session_id, time_created, data) values (?, ?, ?, ?)').run(
        'msg-user',
        sessionId,
        1_000,
        JSON.stringify({
          role: 'user',
          time: { created: 1_000 },
        }),
      );
    } finally {
      db.close();
    }

    await service.hydrateConversationHistory(conversation, null);

    expect(conversation.messages).toHaveLength(1);
    expect(conversation.messages[0]).toMatchObject({
      id: 'opencode-hydration-error-session-session-retry',
      role: 'assistant',
    });

    const repairedDb = new DatabaseSync(dbPath);
    try {
      repairedDb.exec(`
        create table part (
          id text primary key,
          session_id text not null,
          message_id text not null,
          data text not null
        );
      `);
      repairedDb.prepare('insert into part (id, session_id, message_id, data) values (?, ?, ?, ?)').run(
        'part-user',
        sessionId,
        'msg-user',
        JSON.stringify({ text: 'Recovered prompt', type: 'text' }),
      );
    } finally {
      repairedDb.close();
    }

    await service.hydrateConversationHistory(conversation, null);

    expect(conversation.messages).toEqual([
      {
        assistantMessageId: undefined,
        content: 'Recovered prompt',
        id: 'msg-user',
        role: 'user',
        timestamp: 1_000,
        userMessageId: 'msg-user',
      },
    ]);
  });

  it('rejects a persisted database hint outside OpenCode-owned roots', async () => {
    const trustedRoot = path.join(tmpRoot, '.local', 'share', 'opencode');
    const trustedDb = path.join(trustedRoot, 'opencode.db');
    const untrustedDb = path.join(tmpRoot, 'synced', 'secret.db');
    fs.mkdirSync(trustedRoot, { recursive: true });
    fs.mkdirSync(path.dirname(untrustedDb), { recursive: true });
    createEmptyDatabase(trustedDb);
    createEmptyDatabase(untrustedDb);

    const conversation = createConversation('session-untrusted', untrustedDb);
    const service = new OpencodeConversationHistoryService();
    await service.hydrateConversationHistory(conversation, null, {
      environment: {
        HOME: tmpRoot,
        XDG_DATA_HOME: path.join(tmpRoot, '.local', 'share'),
      },
    });

    expect(conversation.providerState?.databasePath).toBe(trustedDb);
  });
});

function createEmptyDatabase(databasePath: string): void {
  const db = new DatabaseSync(databasePath);
  db.close();
}

function createConversation(sessionId: string, databasePath: string): Conversation {
  return {
    createdAt: 1,
    id: 'conv-opencode',
    messages: [],
    providerId: 'opencode',
    providerState: { databasePath },
    sessionId,
    title: 'OpenCode conversation',
    updatedAt: 1,
  };
}
