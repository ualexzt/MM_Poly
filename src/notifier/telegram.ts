export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export class TelegramNotifier {
  private baseUrl: string;

  constructor(private config: TelegramConfig) {
    this.baseUrl = `https://api.telegram.org/bot${config.botToken}`;
  }

  async sendMessage(text: string): Promise<void> {
    const url = `${this.baseUrl}/sendMessage`;
    const body = new URLSearchParams({
      chat_id: this.config.chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: 'true'
    });

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
      });
      const data = await res.json() as { ok: boolean; description?: string };
      if (!data.ok) {
        console.error('Telegram send failed:', data.description);
      }
    } catch (err) {
      console.error('Telegram network error:', err);
    }
  }

  async sendTradeAlert(params: {
    question: string;
    side: 'BUY' | 'SELL';
    price: number;
    size: number;
    fairPrice: number;
    spread: number;
    slug?: string;
    mode?: string;
  }): Promise<void> {
    const { question, side, price, size, fairPrice, spread, slug, mode = 'paper' } = params;
    const emoji = side === 'BUY' ? '🟢' : '🔴';
    const marketUrl = slug ? `https://polymarket.com/market/${slug}` : '';
    const text = `
<b>${emoji} Quote Generated</b>

<b>Market:</b> ${marketUrl ? `<a href="${marketUrl}">${question}</a>` : question}
<b>Side:</b> ${side}
<b>Price:</b> ${price.toFixed(4)}
<b>Size:</b> ${size.toFixed(2)}

<b>Fair:</b> ${fairPrice.toFixed(4)}
<b>Spread:</b> ${(spread * 100).toFixed(2)}¢

<i>Mode: ${mode}</i>
    `.trim();

    await this.sendMessage(text);
  }
}

