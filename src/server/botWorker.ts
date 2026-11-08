import {
  ChatworkClient,
  detectConsecutiveEmojis,
  type ChatworkWebhookPayload,
  type ChatworkUser,
} from './chatwork.ts';
import {
  addToBlacklist,
  revokeFromBlacklist,
  getBlacklist,
  getBlacklistEntryByAccountId,
  getActiveBlacklistMap,
  recordRejectionAttempt,
  addLog,
  getConfig,
} from './db.ts';

export class BotWorker {
  private client: ChatworkClient;
  private intervalTimer: NodeJS.Timeout | null = null;
  private isScanning = false;
  private flushingRooms = new Set<number>();

  constructor(apiToken?: string) {
    this.client = new ChatworkClient(apiToken);
  }

  updateClientToken(apiToken: string): void {
    this.client = new ChatworkClient(apiToken);
  }

  getClient(): ChatworkClient {
    return this.client;
  }

  /**
   * Main entrypoint for processing Chatwork Webhook events
   */
  async handleWebhookEvent(payload: ChatworkWebhookPayload): Promise<{
    handled: boolean;
    action?: string;
    reply?: string;
    error?: string;
  }> {
    if (!payload?.webhook_event) {
      return { handled: false, error: 'Invalid webhook payload structure' };
    }

    const { room_id, account_id, body } = payload.webhook_event;
    const config = await getConfig();

    // 1. First safety check: Is the person sending this message blacklisted?
    const senderBlacklistEntry = await getBlacklistEntryByAccountId(String(account_id));
    if (senderBlacklistEntry) {
      console.warn(`[ALERT] Blacklisted user ${account_id} attempted to send message in Room #${room_id}`);
      
      // Immediately kick the sender if auto-kick is enabled
      if (config.auto_kick_enabled) {
        try {
          const kickRes = await this.client.kickMember(room_id, account_id);
          const { count } = await recordRejectionAttempt(
            String(account_id),
            String(room_id),
            `ブラックリスト対象ユーザー (ID: ${account_id}) による発言・再参加を検知したため即座に強制退室させました`
          );

          if (config.notify_in_chat) {
            const warningMsg = `[info][title]🛡️ ブラックリスト再参加拒否 & 強制退室[/title]ユーザー (ID: ${account_id}) はブラックリストに登録されているため、強制退室させました。\n累計拒否回数: ${count}回[/info]`;
            await this.client.sendMessage(room_id, warningMsg);
          }

          return {
            handled: true,
            action: 'KICK_BLACKLISTED_SENDER',
            reply: `Blacklisted user ${account_id} was kicked immediately.`,
          };
        } catch (err: any) {
          console.error('Failed to kick blacklisted sender:', err);
        }
      }
    }

    // 2. Check for consecutive emoji spam: 5 or more emojis consecutively -> Downgrade to 'readonly' (閲覧のみ)
    const emojiCheck = detectConsecutiveEmojis(body);
    if (emojiCheck.hasSpam) {
      console.warn(
        `[EMOJI SPAM DETECTED] User ${account_id} posted ${emojiCheck.count} consecutive emojis in Room #${room_id}: "${emojiCheck.matchedSequence}"`
      );

      try {
        const roleResult = await this.client.changeMemberRole(room_id, account_id, 'readonly');
        const targetUserName = roleResult.user?.name || `User #${account_id}`;

        await addLog({
          account_id: String(account_id),
          room_id: String(room_id),
          user_name: targetUserName,
          action: 'EMOJI_SPAM_READONLY',
          details: `絵文字の5個以上連続投稿を検知 (${emojiCheck.count}個: "${emojiCheck.matchedSequence.slice(0, 30)}")。ルーム権限を【閲覧のみ】に変更しました。`,
        });

        if (config.notify_in_chat) {
          const warningMsg =
            `[info][title]⚠️ 絵文字連続投稿検知 & 権限制限 (閲覧のみ)[/title]` +
            `対象: ${targetUserName} (ID: ${account_id})\n` +
            `検知内容: 絵文字が5個以上連続で投稿されました (連続数: ${emojiCheck.count}個)\n` +
            `────────────────\n` +
            `荒らし・過度な連続リアクション防止ポリシーに基づき、アカウント権限を【閲覧のみ (Read Only)】に変更しました。\n` +
            `※ クライアントの画面硬直・重延防止のためメッセージ「a」を50件打って画面外へ流し、停止します。[/info]`;

          await this.client.sendMessage(room_id, warningMsg);
        }

        // Heavy emoji post makes Chatwork client lag/freeze on the screen.
        // Send exactly 50 messages of 'a' to push the heavy content out of the active timeline view, then stop.
        const flushResult = await this.flushRoomTimelineWithA(room_id, 50);

        return {
          handled: true,
          action: 'EMOJI_SPAM_READONLY_AND_FLUSHED',
          reply: `User ${account_id} role downgraded to readonly and sent ${flushResult.count} 'a' messages to clear timeline lag (stopped).`,
        };
      } catch (roleErr: any) {
        console.error('Failed to change member role to readonly:', roleErr);
      }
    }

    // 3. Check for commands in message body
    const trimmedBody = (body || '').trim();
    if (!trimmedBody.startsWith('/')) {
      // Normal message, check if there are newly joined members to audit
      this.scanRoomForBlacklistedUsers(room_id).catch(() => {});
      return { handled: true, action: 'NORMAL_MESSAGE_AUDITED' };
    }

    const tokens = trimmedBody.split(/\s+/);
    const command = tokens[0].toLowerCase();
    const args = tokens.slice(1);

    switch (command) {
      case '/blacklist':
      case '/ban': {
        return this.handleBlacklistCommand(room_id, account_id, args);
      }
      case '/del-blacklist':
      case '/del_blacklist':
      case '/unban':
      case '/unblacklist': {
        return this.handleUnbanCommand(room_id, account_id, args);
      }
      case '/flush':
      case '/a50': {
        const isAdmin = await this.isRoomAdmin(room_id, account_id);
        if (!isAdmin) {
          const denyMsg = `[info][title]⚠️ 権限エラー[/title]アカウント ID: ${account_id} は管理者権限がありません。\nタイムライン流しコマンド (/flush) は、このルームの【管理者 (Admin)】のみ実行可能です。[/info]`;
          await this.client.sendMessage(room_id, denyMsg);
          return { handled: true, action: 'PERMISSION_DENIED', reply: denyMsg };
        }
        const flushRes = await this.flushRoomTimelineWithA(room_id, 50);
        const replyMsg = `[info][title]🧹 タイムライン流し完了[/title]重延対策としてメッセージ「a」を${flushRes.count}件送信し、正常に停止しました。[/info]`;
        await this.client.sendMessage(room_id, replyMsg);
        return { handled: true, action: 'MANUAL_FLUSH_COMPLETED', reply: replyMsg };
      }
      case '/check': {
        return this.handleCheckCommand(room_id, args);
      }
      case '/help':
      case '/banhelp': {
        return this.handleHelpCommand(room_id);
      }
      case '/status': {
        return this.handleStatusCommand(room_id);
      }
      default:
        return { handled: false, action: 'UNKNOWN_COMMAND' };
    }
  }

  /**
   * Checks if a user is an administrator of the room (or global admin).
   * Strict enforcement: Only room administrators or designated admin IDs can execute admin commands.
   */
  async isRoomAdmin(roomId: number, accountId: number): Promise<boolean> {
    const config = await getConfig();
    const strId = String(accountId);

    // 1. Check global admin IDs if defined
    if (config.admin_account_ids.length > 0 && config.admin_account_ids.includes(strId)) {
      return true;
    }

    // 2. Fetch room members to check member's role in this specific room
    try {
      const members = await this.client.getRoomMembers(roomId);
      const member = members.find((m) => m.account_id === accountId);
      if (member && member.role === 'admin') {
        return true;
      }
    } catch (err) {
      console.error(`Failed to verify admin status for user ${accountId} in room #${roomId}:`, err);
    }

    return false;
  }

  /**
   * Handles /blacklist <accountId> [reason]
   * Example: /blacklist 1234567 迷惑行為・荒らしのため
   */
  async handleBlacklistCommand(
    roomId: number,
    senderAccountId: number,
    args: string[]
  ): Promise<{ handled: boolean; action: string; reply: string; error?: string }> {
    // 1. Strict Administrator Authorization Check
    const isAdmin = await this.isRoomAdmin(roomId, senderAccountId);
    if (!isAdmin) {
      const denyMsg = `[info][title]⚠️ 権限エラー[/title]アカウント ID: ${senderAccountId} は管理者権限がありません。\nブラックリスト登録および強制退室コマンドは、このルームの【管理者 (Admin)】のみ実行可能です。[/info]`;
      await this.client.sendMessage(roomId, denyMsg);
      return { handled: true, action: 'PERMISSION_DENIED', reply: denyMsg };
    }

    if (args.length === 0 || args[0].toLowerCase() === 'list') {
      // Show blacklist
      const activeList = await getBlacklist({ status: 'active' });
      let listMsg = `[info][title]📋 現在のブラックリスト登録一覧 (全 ${activeList.length} 件)[/title]`;
      if (activeList.length === 0) {
        listMsg += '現在ブラックリストに登録されているユーザーはいません。[/info]';
      } else {
        const lines = activeList.slice(0, 15).map((b, i) => {
          return `${i + 1}. ID: ${b.account_id} | ${b.name || '名前未設定'}\n   理由: ${b.reason} (再参加拒否: ${b.auto_reject_count}回)`;
        });
        listMsg += lines.join('\n') + '\n────────────────\n/blacklist <ID> [理由] で新規登録\n/del-blacklist <ID> で解除[/info]';
      }
      await this.client.sendMessage(roomId, listMsg);
      return { handled: true, action: 'BLACKLIST_LIST', reply: listMsg };
    }

    const targetAccountId = args[0].replace(/[^0-9]/g, '');
    if (!targetAccountId) {
      const errMsg = `[info][title]⚠️ 入力形式エラー[/title]正しい形式で入力してください。\n例: /blacklist 1234567 荒らし行為のため[/info]`;
      await this.client.sendMessage(roomId, errMsg);
      return { handled: true, action: 'INVALID_INPUT', reply: errMsg };
    }

    const reason = args.slice(1).join(' ').trim() || '管理規約違反・ブラックリスト登録';

    // 2. Add to Database
    const entry = await addToBlacklist({
      account_id: targetAccountId,
      reason,
      room_id: String(roomId),
      added_by: String(senderAccountId),
    });

    // 3. Execute BAN across ALL rooms the bot is in
    let wasKickedInCurrentRoom = false;
    let otherKickedRoomsCount = 0;
    let kickError: string | null = null;
    let targetUserName: string = entry.name || `User #${targetAccountId}`;

    try {
      const allRooms = await this.client.getRooms();
      for (const room of allRooms) {
        try {
          const kickRes = await this.client.kickMember(room.room_id, targetAccountId);
          if (kickRes.wasPresent && kickRes.success) {
            if (room.room_id === roomId) {
              wasKickedInCurrentRoom = true;
              if (kickRes.user) targetUserName = kickRes.user.name;
            } else {
              otherKickedRoomsCount++;
              await addLog({
                account_id: targetAccountId,
                room_id: String(room.room_id),
                user_name: kickRes.user?.name || targetUserName,
                action: 'AUTO_KICK_JOIN',
                details: `全ルーム一括BAN: ルーム #${roomId} での登録に基づき、参加中ルーム「${room.name}」(#${room.room_id}) からも強制退室させました`,
              });
            }
          }
        } catch (rmErr: any) {
          if (room.room_id === roomId) {
            kickError = rmErr.message;
          }
        }
      }
    } catch (err: any) {
      kickError = err.message || '退室API呼び出しエラー';
      console.error('Kick execution error:', err);
    }

    // 4. Log the audit event
    await addLog({
      account_id: targetAccountId,
      room_id: String(roomId),
      user_name: targetUserName,
      action: 'COMMAND_BAN',
      details: `/blacklist コマンドにより登録 (実行管理者: ${senderAccountId})。当ルーム退室: ${wasKickedInCurrentRoom ? '退室完了' : kickError ? `失敗(${kickError})` : '在室なし'}、他参加ルーム退室: ${otherKickedRoomsCount}部屋`,
    });

    // 5. Send Confirmation Notification to Room
    let replyText = `[info][title]🚫 ブラックリスト登録 & 全ルームBAN完了[/title]`;
    replyText += `対象ユーザー: ${targetUserName} (ID: ${targetAccountId})\n`;
    replyText += `登録理由: ${reason}\n`;
    replyText += `実行管理者: ${senderAccountId}\n`;
    replyText += `────────────────\n`;
    if (wasKickedInCurrentRoom) {
      replyText += `⚡ 【当ルーム】対象ユーザーを即座に強制退室(BAN)させました。\n`;
    } else if (kickError) {
      replyText += `⚠️ 【注意】当ルーム退室時にエラーが発生しました: ${kickError}\n`;
    } else {
      replyText += `ℹ️ 【当ルーム】対象ユーザーは現在このルームには在室していません。\n`;
    }
    if (otherKickedRoomsCount > 0) {
      replyText += `🌐 【全ルーム連動】Botが参加する他 ${otherKickedRoomsCount} つのルームからも一括強制退室させました。\n`;
    }
    replyText += `🛡️ 【自動拒否ガード】今後はBotが参加するすべてのルームにおいて、該当ユーザーの入室・再参加・発言を自動で検知し、即座に強制退室(BAN)します。[/info]`;

    await this.client.sendMessage(roomId, replyText);

    return { handled: true, action: 'BAN_EXECUTED', reply: replyText };
  }

  /**
   * Handles /del-blacklist <accountId> or /unban <accountId>
   */
  async handleUnbanCommand(
    roomId: number,
    senderAccountId: number,
    args: string[]
  ): Promise<{ handled: boolean; action: string; reply: string }> {
    // 1. Strict Administrator Authorization Check
    const isAdmin = await this.isRoomAdmin(roomId, senderAccountId);
    if (!isAdmin) {
      const denyMsg = `[info][title]⚠️ 権限エラー[/title]アカウント ID: ${senderAccountId} は管理者権限がありません。\nブラックリスト解除コマンド (/del-blacklist) は、このルームの【管理者 (Admin)】のみ実行可能です。[/info]`;
      await this.client.sendMessage(roomId, denyMsg);
      return { handled: true, action: 'PERMISSION_DENIED', reply: denyMsg };
    }

    const targetAccountId = (args[0] || '').replace(/[^0-9]/g, '');
    if (!targetAccountId) {
      const errMsg = `[info][title]⚠️ 入力エラー[/title]解除対象のユーザーIDを指定してください。\n例: /del-blacklist 1234567 または /unban 1234567[/info]`;
      await this.client.sendMessage(roomId, errMsg);
      return { handled: true, action: 'INVALID_INPUT', reply: errMsg };
    }

    const revoked = await revokeFromBlacklist(targetAccountId);
    let replyText = '';
    if (revoked) {
      await addLog({
        account_id: targetAccountId,
        room_id: String(roomId),
        action: 'MANUAL_UNBAN',
        details: `ユーザー ID: ${targetAccountId} のブラックリスト登録を解除しました (/del-blacklist 実行者: ${senderAccountId})`,
      });
      replyText = `[info][title]✅ ブラックリスト解除完了[/title]ユーザー ID: ${targetAccountId} のブラックリスト登録を解除しました。(/del-blacklist 実行)\n今後はこのユーザーの入室・参加が許可されます。[/info]`;
    } else {
      replyText = `[info][title]ℹ️ ブラックリスト未登録[/title]ユーザー ID: ${targetAccountId} はアクティブなブラックリストに見つかりませんでした。[/info]`;
    }

    await this.client.sendMessage(roomId, replyText);
    return { handled: true, action: 'UNBAN_EXECUTED', reply: replyText };
  }

  /**
   * Handles /check <accountId>
   */
  async handleCheckCommand(roomId: number, args: string[]): Promise<{ handled: boolean; action: string; reply: string }> {
    const targetAccountId = (args[0] || '').replace(/[^0-9]/g, '');
    if (!targetAccountId) {
      const errMsg = `[info][title]⚠️ 入力エラー[/title]照会対象のユーザーIDを指定してください。\n例: /check 1234567[/info]`;
      await this.client.sendMessage(roomId, errMsg);
      return { handled: true, action: 'INVALID_INPUT', reply: errMsg };
    }

    const entry = await getBlacklistEntryByAccountId(targetAccountId);
    let reply = '';
    if (entry) {
      reply = `[info][title]🚨 ブラックリスト該当[/title]ID: ${entry.account_id} (${entry.name || '名前未設定'})\n理由: ${entry.reason}\n登録日: ${new Date(entry.created_at).toLocaleString('ja-JP')}\n累計再参加拒否回数: ${entry.auto_reject_count}回\n状態: BAN対象（入室時は自動強制退室）[/info]`;
    } else {
      reply = `[info][title]🟢 安全 (未登録)[/title]ID: ${targetAccountId} はブラックリストに登録されていません。[/info]`;
    }

    await this.client.sendMessage(roomId, reply);
    return { handled: true, action: 'CHECK_EXECUTED', reply };
  }

  /**
   * Handles /help
   */
  async handleHelpCommand(roomId: number): Promise<{ handled: boolean; action: string; reply: string }> {
    const helpMsg = `[info][title]🛡️ Chatwork Guardian Bot コマンド一覧[/title]` +
      `・/blacklist <ユーザーID> [理由] : 指定ユーザーをブラックリスト登録し、在室時は即時強制退室(BAN)します\n` +
      `・/blacklist list : 現在のブラックリスト登録一覧を表示します\n` +
      `・/del-blacklist <ユーザーID> : ブラックリストから除外してBANを解除します (/unban も可)\n` +
      `・/flush (または /a50) : 画面が重くなった際、メッセージ「a」を50件打ってタイムラインを流し自動停止します\n` +
      `・/check <ユーザーID> : 指定ユーザーがブラックリストに該当するか照会します\n` +
      `・/status : Botの稼働状態と自動退室ガードの動作ステータスを表示します\n` +
      `・/help : このヘルプを表示します\n` +
      `────────────────\n` +
      `🛡️ 自動BAN・拒否機能: 登録されたユーザーが今後ルームに参加、または再参加を試みた場合はシステムが自動検知して即時拒否・強制退室させます。\n` +
      `🚫 絵文字スパム対策: メッセージ内に絵文字が5個以上連続で投稿された場合、自動で検知して権限を【閲覧のみ】へ制限し、クライアントの重延を防ぐためメッセージ「a」を50件打って画面外へ流してから自動停止します。[/info]`;

    await this.client.sendMessage(roomId, helpMsg);
    return { handled: true, action: 'HELP_SENT', reply: helpMsg };
  }

  /**
   * Flushes the chat timeline by posting 'a' exactly 50 times to push heavy lag-inducing
   * emojis out of the active visible client viewport, and then stops immediately.
   */
  async flushRoomTimelineWithA(roomId: number, count = 50): Promise<{ count: number; stopped: boolean }> {
    if (this.flushingRooms.has(roomId)) {
      console.log(`[FLUSH] Room #${roomId} is already being flushed. Skipping concurrent request.`);
      return { count: 0, stopped: true };
    }

    this.flushingRooms.add(roomId);
    console.log(`[FLUSH] Starting timeline flush in Room #${roomId}: posting 'a' ${count} times to clear client lag...`);

    let sent = 0;
    try {
      for (let i = 0; i < count; i++) {
        await this.client.sendMessage(roomId, 'a');
        sent++;
        // Throttled delay to respect API rate limits and avoid socket bursts
        await new Promise((r) => setTimeout(r, this.client.isConfigured() ? 80 : 25));
      }

      console.log(`[FLUSH] Finished sending ${sent} 'a' messages in Room #${roomId}. Stopped successfully.`);

      await addLog({
        account_id: 'SYSTEM',
        room_id: String(roomId),
        action: 'TIMELINE_FLUSH',
        details: `絵文字スパム等の重延防止のためメッセージ「a」を${sent}件送信し、タイムラインを流しました (50件到達後に停止)。`,
      });

      return { count: sent, stopped: true };
    } catch (err: any) {
      console.error(`[FLUSH ERROR] Failed during timeline flush:`, err);
      return { count: sent, stopped: true };
    } finally {
      this.flushingRooms.delete(roomId);
    }
  }

  /**
   * Handles /status
   */
  async handleStatusCommand(roomId: number): Promise<{ handled: boolean; action: string; reply: string }> {
    const config = await getConfig();
    const activeList = await getBlacklist({ status: 'active' });
    const totalRejections = activeList.reduce((acc, cur) => acc + (cur.auto_reject_count || 0), 0);

    const statusMsg = `[info][title]🤖 Chatwork Guardian Bot ステータス[/title]` +
      `・稼働状態: 正常稼働中 (Active)\n` +
      `・アクティブBAN数: ${activeList.length} 件\n` +
      `・累積再参加拒否回数: ${totalRejections} 回\n` +
      `・自動強制退室 (Auto-Kick): ${config.auto_kick_enabled ? '有効 (ON)' : '無効 (OFF)'}\n` +
      `・再参加自動拒否 (Auto-Reject): ${config.auto_reject_enabled ? '有効 (ON)' : '無効 (OFF)'}\n` +
      `・定期監視スキャン間隔: ${config.polling_interval_seconds}秒\n` +
      `・監視対象ルーム: ${config.monitored_rooms.length > 0 ? config.monitored_rooms.join(', ') : '全参加ルーム'}[/info]`;

    await this.client.sendMessage(roomId, statusMsg);
    return { handled: true, action: 'STATUS_SENT', reply: statusMsg };
  }

  /**
   * Scans a specific room for blacklisted members.
   * If any blacklisted user is detected, immediately kicks them and logs the rejection.
   */
  async scanRoomForBlacklistedUsers(roomId: number | string): Promise<{
    scannedMembers: number;
    kickedCount: number;
    kickedUsers: ChatworkUser[];
  }> {
    const rid = Number(roomId);
    const config = await getConfig();
    if (!config.auto_kick_enabled && !config.auto_reject_enabled) {
      return { scannedMembers: 0, kickedCount: 0, kickedUsers: [] };
    }

    try {
      const members = await this.client.getRoomMembers(rid);
      const activeMap = await getActiveBlacklistMap();
      const kickedUsers: ChatworkUser[] = [];

      for (const member of members) {
        const blacklistEntry = activeMap.get(String(member.account_id));
        if (blacklistEntry) {
          console.warn(`[DETECTED] Blacklisted member ${member.name} (${member.account_id}) in room #${rid}`);

          try {
            const kickRes = await this.client.kickMember(rid, member.account_id);
            if (kickRes.success) {
              kickedUsers.push(member);
              const { count } = await recordRejectionAttempt(
                String(member.account_id),
                String(rid),
                `再参加・在室スキャン検知: ブラックリスト対象「${member.name}」(ID: ${member.account_id}) を自動強制退室・拒否しました`
              );

              if (config.notify_in_chat) {
                const notifyMsg = `[info][title]🛡️ ブラックリスト再参加拒否 & 強制退室[/title]ブラックリスト対象「${member.name}」(ID: ${member.account_id}) の入室・再参加を検知したため、自動で拒否し強制退室させました。\n理由: ${blacklistEntry.reason}\n累計拒否回数: ${count}回[/info]`;
                await this.client.sendMessage(rid, notifyMsg);
              }
            }
          } catch (kickErr) {
            console.error(`Failed to auto-kick blacklisted user ${member.account_id}:`, kickErr);
          }
        }
      }

      return {
        scannedMembers: members.length,
        kickedCount: kickedUsers.length,
        kickedUsers,
      };
    } catch (err) {
      console.error(`Error scanning room #${rid}:`, err);
      return { scannedMembers: 0, kickedCount: 0, kickedUsers: [] };
    }
  }

  /**
   * Scans all configured rooms or all joined rooms
   */
  async scanAllMonitoredRooms(): Promise<{
    roomsScanned: number;
    totalKicked: number;
    details: Array<{ roomId: number; kickedCount: number }>;
  }> {
    if (this.isScanning) {
      return { roomsScanned: 0, totalKicked: 0, details: [] };
    }

    this.isScanning = true;
    try {
      const config = await getConfig();
      let roomIdsToScan: number[] = [];

      try {
        const rooms = await this.client.getRooms();
        const roomSet = new Set<number>(rooms.map((r) => r.room_id));
        if (config.monitored_rooms && config.monitored_rooms.length > 0) {
          for (const m of config.monitored_rooms) {
            const n = Number(m);
            if (!Number.isNaN(n) && n > 0) roomSet.add(n);
          }
        }
        roomIdsToScan = Array.from(roomSet);
      } catch {
        roomIdsToScan = [10001, 10002]; // fallback to mock rooms
      }

      let totalKicked = 0;
      const details: Array<{ roomId: number; kickedCount: number }> = [];

      for (const rid of roomIdsToScan) {
        const result = await this.scanRoomForBlacklistedUsers(rid);
        totalKicked += result.kickedCount;
        details.push({ roomId: rid, kickedCount: result.kickedCount });
      }

      return {
        roomsScanned: roomIdsToScan.length,
        totalKicked,
        details,
      };
    } finally {
      this.isScanning = false;
    }
  }

  /**
   * Start the background watchdog timer to continuously monitor rooms
   */
  startBackgroundWatcher(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
    }

    const runWatchdog = async () => {
      try {
        const config = await getConfig();
        const intervalSec = Math.max(10, config.polling_interval_seconds || 20);
        await this.scanAllMonitoredRooms();

        // Reset with current interval
        if (this.intervalTimer) clearInterval(this.intervalTimer);
        this.intervalTimer = setTimeout(runWatchdog, intervalSec * 1000);
      } catch (err) {
        console.error('Watchdog cycle error:', err);
        this.intervalTimer = setTimeout(runWatchdog, 20000);
      }
    };

    this.intervalTimer = setTimeout(runWatchdog, 5000);
    console.log('Background Auto-Kick & Re-entry Watchdog started.');
  }

  stopBackgroundWatcher(): void {
    if (this.intervalTimer) {
      clearTimeout(this.intervalTimer);
      this.intervalTimer = null;
    }
  }
}
