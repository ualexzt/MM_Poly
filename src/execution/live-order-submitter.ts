import { QuoteCandidate } from '../types/quote';

export interface LiveOrderResult {
  orderID: string;
  filledSize?: number;
  filledPrice?: number;
}

export interface LiveOrderSubmitterClient {
  createAndPostOrder(
    orderArgs: {
      tokenID: string;
      side: 'BUY' | 'SELL';
      price: string | number;
      size: string | number;
    },
    options: { tickSize: string; negRisk?: boolean },
    orderType: 'GTC' | 'FOK' | 'FAK'
  ): Promise<{ orderID: string; takingAmount?: string; makingAmount?: string }>;
  cancelOrder(orderId: string): Promise<any>;
  getOpenOrders(): Promise<any[]>;
}

export interface LiveMarketMeta {
  tickSize: number;
  negRisk?: boolean;
}

export class LiveOrderSubmitter {
  constructor(private client: LiveOrderSubmitterClient) {}

  async submit(quote: QuoteCandidate, meta: LiveMarketMeta): Promise<LiveOrderResult> {
    console.log(JSON.stringify({ level: 'info', time: Date.now(), message: 'SUBMIT_START', tokenId: quote.tokenId?.slice(0,20), side: quote.side, price: quote.price, size: quote.size, tickSize: meta.tickSize, negRisk: meta.negRisk }));
    const resp = await this.client.createAndPostOrder(
      {
        tokenID: quote.tokenId,
        side: quote.side,
        price: String(quote.price),
        size: String(quote.size),
      },
      {
        tickSize: String(meta.tickSize),
        ...(meta.negRisk !== undefined ? { negRisk: meta.negRisk } : {}),
      },
      'GTC'
    );
    console.log(JSON.stringify({ level: 'info', time: Date.now(), message: 'SUBMIT_RESULT', resp: JSON.stringify(resp).slice(0, 200) }));

    const takingAmount = parseFloat(resp.takingAmount || '0');
    const makingAmount = parseFloat(resp.makingAmount || '0');
    const filledSize = takingAmount > 0 ? takingAmount : undefined;
    const filledPrice = (filledSize && filledSize > 0) ? (makingAmount / filledSize) : undefined;

    return { orderID: resp.orderID, filledSize, filledPrice };
  }

  async cancel(orderId: string): Promise<void> {
    await this.client.cancelOrder(orderId);
  }

  async getOpenOrders(): Promise<any[]> {
    try {
      const result = await this.client.getOpenOrders() as any;
      if (Array.isArray(result)) return result;
      if (result && Array.isArray(result.orders)) return result.orders;
      if (result && Array.isArray(result.data)) return result.data;
      return [];
    } catch {
      return [];
    }
  }
}
