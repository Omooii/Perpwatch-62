// Telegram Bot API client — used by the app's WebView only, with the bot
// token the USER entered in the companion page and stored in on-device
// key-value storage. No token is ever committed, bundled, or sent anywhere
// except api.telegram.org (allowlisted in app.json).
//
// Linking flow: the user creates a bot with @BotFather, pastes the token in
// the companion page, taps Start on the bot (or sends it any message), then
// taps "Link chat" here — getUpdates finds their private chat id.

const TG_API = 'https://api.telegram.org'

interface TgResponse<T> {
  ok: boolean
  result?: T
  description?: string
}

interface TgUpdate {
  update_id: number
  message?: {
    chat: { id: number; type: string; title?: string; first_name?: string; username?: string }
  }
}

async function tgPost<T>(token: string, method: string, body: unknown): Promise<T> {
  const res = await fetch(`${TG_API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json()) as TgResponse<T>
  if (!res.ok || !data.ok) {
    throw new Error(data.description ?? `Telegram HTTP ${res.status}`)
  }
  return data.result as T
}

/** Send one plain-text message to a chat. */
export async function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string,
): Promise<void> {
  await tgPost(token, 'sendMessage', { chat_id: chatId, text })
}

/**
 * Find the most recent private chat that messaged the bot (getUpdates).
 * The user must have tapped Start / sent the bot a message first.
 */
export async function fetchTelegramChatId(
  token: string,
): Promise<{ chatId: string; label: string }> {
  const updates = await tgPost<TgUpdate[]>(token, 'getUpdates', {
    timeout: 0,
    allowed_updates: ['message'],
  })
  for (let i = updates.length - 1; i >= 0; i--) {
    const chat = updates[i].message?.chat
    if (chat && chat.type === 'private') {
      const label = chat.username ? `@${chat.username}` : (chat.first_name ?? `chat ${chat.id}`)
      return { chatId: String(chat.id), label }
    }
  }
  throw new Error('No chat found — open the bot in Telegram, tap Start, then try again.')
}
