import { QuoteCandidate } from '../types/quote';

export interface LiveOrderSubmitterClient {
  createAndPostOrder(
    orderArgs: {
      tokenID: string;
      side: 'BUY' | 'SELL';
      price: number;
      size: number;
    },
    options: { tickSize: string; negRisk: boolean },
    orderType: 'GTC' | 'FOK' | 'FAK'
  ): Promise<{ orderID: string }>;
  cancelOrder(orderId: string): Promise<any>;
  getOpenOrders(): Promise<any[]>;
}

export interface LiveMarketMeta {
  tickSize: number;
  negRisk: boolean;
}

export class LiveOrderSubmitter {
  constructor(private client: LiveOrderSubmitterClient) {}

  async submit(quote: QuoteCandidate, meta: LiveMarketMeta): Promise<string> {
    const resp = await this.client.createAndPostOrder(
      {
        tokenID: quote.tokenId,
        side: quote.side,
        price: quote.price,
        size: quote.size,
      },
      {
        tickSize: String(meta.tickSize),
        negRisk: meta.negRisk,
      },
      'GTC'
    );
    return resp.orderID;
  }

  async cancel(orderId: string): Promise<void> {
    await this.client.cancelOrder(orderId);
  }

  async getOpenOrders(): Promise<any[]> {
    return this.client.getOpenOrders();
  }
}
