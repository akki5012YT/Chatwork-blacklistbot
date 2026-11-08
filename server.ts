import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

import {
  initDb,
  getBlacklist,
  getBlacklistEntryByAccountId,
  addToBlacklist,
  revokeFromBlacklist,
  getLogs,
  addLog,
  getConfig,
  updateConfig,
} from './src/server/db.ts';
import { verifyWebhookSignature, type ChatworkWebhookPayload } from './src/server/chatwork.ts';
import { BotWorker } from './src/server/botWorker.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

let dbStatus = { type: 'local_file', status: 'initializing' };
const botWorker = new BotWorker(process.env.CHATWORK_API_TOKEN);

async function startServer() {
  const app = express();

  // Initialize Database (PostgreSQL if DATABASE_URL exists, or local persistent JSON)
  dbStatus = await initDb();

  // Start background room watchdog
  botWorker.startBackgroundWatcher();

  // Middleware for JSON & URL-encoded bodies with raw body capture for HMAC verification
  app.use(
    express.json({
      verify: (req: Request, _res: Response, buf: Buffer) => {
        (req as any).rawBody = buf;
      },
    })
  );

  app.use(
    express.urlencoded({
      extended: true,
      verify: (req: Request, _res: Response, buf: Buffer) => {
        (req as any).rawBody = buf;
      },
    })
  );

  // -------------------------------------------------------------
  // 1. Chatwork Webhook Endpoint
  // -------------------------------------------------------------
  app.post('/api/chatwork/webhook', async (req: Request, res: Response) => {
    try {
      const signatureHeader =
        (req.headers['chatwork_webhook_signature'] as string) ||
        (req.headers['x-chatworkwebhooksignature'] as string) ||
        (req.headers['x-chatwork-webhook-signature'] as string);

      const config = await getConfig();
      const webhookSecret = config.webhook_token || process.env.CHATWORK_WEBHOOK_TOKEN;

      // Verify signature if webhook secret is configured
      if (webhookSecret && webhookSecret.length > 0) {
        const rawBody = (req as any).rawBody || Buffer.from(JSON.stringify(req.body));
        const isValid = verifyWebhookSignature(rawBody, signatureHeader, webhookSecret);
        if (!isValid) {
          console.warn('[Webhook] Invalid Chatwork signature received.');
          return res.status(401).json({ error: 'Invalid webhook signature' });
        }
      }

      const payload = req.body as ChatworkWebhookPayload;
      if (!payload || !payload.webhook_event) {
        return res.status(400).json({ error: 'Missing webhook_event payload' });
      }

      console.log(
        `[Webhook Received] Event: ${payload.webhook_event_type}, Room: ${payload.webhook_event.room_id}, Sender: ${payload.webhook_event.account_id}`
      );

      const result = await botWorker.handleWebhookEvent(payload);
      return res.status(200).json({ status: 'ok', result });
    } catch (err: any) {
      console.error('[Webhook Error]:', err);
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  // -------------------------------------------------------------
  // 2. Health & Status API
  // -------------------------------------------------------------
  app.get('/api/status', async (_req: Request, res: Response) => {
    try {
      const config = await getConfig();
      const client = botWorker.getClient();
      const activeBlacklist = await getBlacklist({ status: 'active' });
      const totalRejections = activeBlacklist.reduce((acc, cur) => acc + (cur.auto_reject_count || 0), 0);
      const isTokenSet = client.isConfigured();

      let botAccount = null;
      try {
        botAccount = await client.getMe();
      } catch {
        // no-op
      }

      return res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        database: dbStatus,
        bot: {
          isConfigured: isTokenSet,
          account: botAccount,
          autoKickEnabled: config.auto_kick_enabled,
          autoRejectEnabled: config.auto_reject_enabled,
          monitoredRoomsCount: config.monitored_rooms.length,
          activeBanCount: activeBlacklist.length,
          totalRejectionsCount: totalRejections,
          pollingIntervalSeconds: config.polling_interval_seconds,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // -------------------------------------------------------------
  // 3. Bot Configuration API
  // -------------------------------------------------------------
  app.get('/api/config', async (_req: Request, res: Response) => {
    try {
      const config = await getConfig();
      // Mask sensitive tokens for response
      const masked = {
        ...config,
        api_token: config.api_token ? `${config.api_token.substring(0, 4)}...${config.api_token.slice(-4)}` : '',
        webhook_token: config.webhook_token ? '●●●●●●●●' : '',
        hasApiToken: Boolean(config.api_token),
        hasWebhookToken: Boolean(config.webhook_token),
      };
      return res.json(masked);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/config', async (req: Request, res: Response) => {
    try {
      const current = await getConfig();
      const updates = req.body;

      // Only update tokens if new non-masked value passed
      const safeUpdates: any = { ...updates };
      if (!updates.api_token || updates.api_token.includes('...')) {
        delete safeUpdates.api_token;
      }
      if (!updates.webhook_token || updates.webhook_token.includes('●')) {
        delete safeUpdates.webhook_token;
      }

      const updated = await updateConfig(safeUpdates);
      if (safeUpdates.api_token) {
        botWorker.updateClientToken(safeUpdates.api_token);
      }

      return res.json({
        success: true,
        config: {
          ...updated,
          api_token: updated.api_token ? `${updated.api_token.substring(0, 4)}...${updated.api_token.slice(-4)}` : '',
          webhook_token: updated.webhook_token ? '●●●●●●●●' : '',
        },
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // -------------------------------------------------------------
  // 4. Blacklist API
  // -------------------------------------------------------------
  app.get('/api/blacklist', async (req: Request, res: Response) => {
    try {
      const { status, search, roomId } = req.query;
      const list = await getBlacklist({
        status: status ? String(status) : undefined,
        search: search ? String(search) : undefined,
        roomId: roomId ? String(roomId) : undefined,
      });
      return res.json(list);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/blacklist', async (req: Request, res: Response) => {
    try {
      const { account_id, name, reason, room_id, kick_now } = req.body;
      if (!account_id) {
        return res.status(400).json({ error: 'account_id is required' });
      }

      const entry = await addToBlacklist({
        account_id: String(account_id),
        name: name || undefined,
        reason: reason || '管理コンソールからの手動ブラックリスト登録',
        room_id: room_id || 'GLOBAL',
        added_by: 'WEB_ADMIN',
      });

      let kickResult = null;
      if (kick_now && room_id && room_id !== 'GLOBAL') {
        try {
          const client = botWorker.getClient();
          kickResult = await client.kickMember(room_id, account_id);
        } catch (kickErr: any) {
          console.warn('Manual kick failed:', kickErr);
          kickResult = { wasPresent: false, success: false, message: kickErr.message };
        }
      }

      await addLog({
        account_id: String(account_id),
        room_id: room_id || 'GLOBAL',
        user_name: name,
        action: 'MANUAL_BAN',
        details: `管理コンソールよりブラックリスト登録。${kickResult?.wasPresent ? '対象ルームから即時退室実行済み' : '即時退室なし (再入室時は自動拒否)'}`,
      });

      return res.status(201).json({ entry, kickResult });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/blacklist/:accountId', async (req: Request, res: Response) => {
    try {
      const { accountId } = req.params;
      const revoked = await revokeFromBlacklist(accountId);
      if (revoked) {
        await addLog({
          account_id: accountId,
          room_id: 'GLOBAL',
          action: 'MANUAL_UNBAN',
          details: `管理コンソールよりブラックリスト登録解除`,
        });
      }
      return res.json({ success: revoked });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // -------------------------------------------------------------
  // 5. Chatwork Rooms & Members API
  // -------------------------------------------------------------
  app.get('/api/rooms', async (_req: Request, res: Response) => {
    try {
      const client = botWorker.getClient();
      const rooms = await client.getRooms();
      return res.json(rooms);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/rooms/:roomId/members', async (req: Request, res: Response) => {
    try {
      const { roomId } = req.params;
      const client = botWorker.getClient();
      const members = await client.getRoomMembers(roomId);
      const activeMap = await getBlacklist({ status: 'active' });
      const blacklistSet = new Set(activeMap.map((b) => b.account_id));

      const enriched = members.map((m) => ({
        ...m,
        isBlacklisted: blacklistSet.has(String(m.account_id)),
      }));

      return res.json(enriched);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/rooms/:roomId/kick/:accountId', async (req: Request, res: Response) => {
    try {
      const { roomId, accountId } = req.params;
      const client = botWorker.getClient();
      const result = await client.kickMember(roomId, accountId);

      await addLog({
        account_id: accountId,
        room_id: roomId,
        action: 'MANUAL_BAN',
        details: `管理コンソールから強制退室APIを実行: ${result.message}`,
      });

      return res.json(result);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // -------------------------------------------------------------
  // 6. Audit Logs API
  // -------------------------------------------------------------
  app.get('/api/logs', async (req: Request, res: Response) => {
    try {
      const limit = Number(req.query.limit) || 100;
      const logs = await getLogs(limit);
      return res.json(logs);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // -------------------------------------------------------------
  // 7. Manual Scan Trigger
  // -------------------------------------------------------------
  app.post('/api/scan-now', async (_req: Request, res: Response) => {
    try {
      const scanResult = await botWorker.scanAllMonitoredRooms();
      return res.json(scanResult);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // -------------------------------------------------------------
  // 8. Event Simulator (For Testing in UI)
  // -------------------------------------------------------------
  app.post('/api/simulate', async (req: Request, res: Response) => {
    try {
      const { type, roomId, accountId, name, text } = req.body;
      const targetRoomId = Number(roomId) || 10001;
      const targetAccountId = Number(accountId) || 777888;
      const client = botWorker.getClient();

      if (type === 'command') {
        // Simulate sending a command like /blacklist 1234567 荒らし
        const fakePayload: ChatworkWebhookPayload = {
          webhook_event_type: 'message_created',
          webhook_event: {
            message_id: `sim_msg_${Date.now()}`,
            room_id: targetRoomId,
            account_id: req.body.senderId ? Number(req.body.senderId) : 111111, // Admin (111111) or Member (222222)
            body: text || `/blacklist ${targetAccountId} 悪質行為シミュレーション`,
            send_time: Math.floor(Date.now() / 1000),
            update_time: Math.floor(Date.now() / 1000),
          },
        };

        const result = await botWorker.handleWebhookEvent(fakePayload);
        return res.json({ success: true, result });
      }

      if (type === 'reentry') {
        // Simulate a blacklisted user attempting to re-join the room!
        const existingEntry = await getBlacklistEntryByAccountId(String(targetAccountId));
        if (!existingEntry) {
          // If not in blacklist, add them first
          await addToBlacklist({
            account_id: String(targetAccountId),
            name: name || `侵入試行者 #${targetAccountId}`,
            reason: 'シミュレーション用ブラックリスト登録',
            room_id: String(targetRoomId),
            added_by: 'SIMULATOR',
          });
        }

        // Add to simulated room members
        client.simulateMemberJoin(targetRoomId, {
          account_id: targetAccountId,
          role: 'member',
          name: name || `侵入試行者 #${targetAccountId}`,
          chatwork_id: `user_${targetAccountId}`,
          avatar_image_url: `https://avatar.vercel.sh/${targetAccountId}.svg?text=TR`,
        });

        // Trigger scan/re-entry check
        const scanRes = await botWorker.scanRoomForBlacklistedUsers(targetRoomId);

        return res.json({
          success: true,
          reentryDetected: scanRes.kickedCount > 0,
          kickedCount: scanRes.kickedCount,
          details: `ブラックリスト対象ユーザー (ID: ${targetAccountId}) がルーム #${targetRoomId} への再入室を試行しました。Botが検知し、即時強制退室および拒否カウントを記録しました。`,
        });
      }

      if (type === 'emoji_spam') {
        // Ensure user is present in mock room as 'member'
        client.simulateMemberJoin(targetRoomId, {
          account_id: targetAccountId,
          role: 'member',
          name: name || `連続投稿テストユーザー #${targetAccountId}`,
          chatwork_id: `user_${targetAccountId}`,
          avatar_image_url: `https://avatar.vercel.sh/${targetAccountId}.svg?text=ES`,
        });

        const fakePayload: ChatworkWebhookPayload = {
          webhook_event_type: 'message_created',
          webhook_event: {
            message_id: `sim_msg_${Date.now()}`,
            room_id: targetRoomId,
            account_id: targetAccountId,
            body: text || '(bow)(bow)(bow)(bow)(bow) 絵文字5連投テスト',
            send_time: Math.floor(Date.now() / 1000),
            update_time: Math.floor(Date.now() / 1000),
          },
        };

        const result = await botWorker.handleWebhookEvent(fakePayload);
        return res.json({ success: true, result });
      }

      return res.status(400).json({ error: 'Unknown simulation type' });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // -------------------------------------------------------------
  // 9. Vite or Static Production Asset Handler
  // -------------------------------------------------------------
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (_req: Request, res: Response) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    } else {
      // In case dist not yet built
      app.get('/', (_req: Request, res: Response) => {
        res.send('Server running. Please build client with npm run build.');
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(`🛡️  Chatwork Guardian Bot Server listening on port ${PORT}`);
    console.log(`📁 Database Mode: ${dbStatus.type} (${dbStatus.status})`);
    console.log(`🔗 Webhook Endpoint: /api/chatwork/webhook`);
    console.log(`=======================================================`);
  });
}

startServer().catch((err) => {
  console.error('Fatal Server Boot Error:', err);
  process.exit(1);
});
