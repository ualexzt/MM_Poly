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
    orderType: 'GTC' | 'FOK' | 'FAK',
    postOnly?: boolean
  ): Promise<{ orderID: string; takingAmount?: string; makingAmount?: string }>;
  cancelOrder(payload: { orderID: string }): Promise<any>;
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
    let resp: { orderID: string; takingAmount?: string; makingAmount?: string };
    try {
      resp = await this.client.createAndPostOrder(
        {
          tokenID: quote.tokenId,
          side: quote.side,
          price: quote.price,
          size: quote.size,
        },
        {
          tickSize: String(meta.tickSize),
          ...(meta.negRisk !== undefined ? { negRisk: meta.negRisk } : {}),
        },
        'GTC',
        true
      );
    } catch (err) {
      console.log(JSON.stringify({ level: 'error', time: Date.now(), message: 'SUBMIT_ERROR', error: err instanceof Error ? err.message : String(err) }));
      throw err;
    }
    console.log(JSON.stringify({ level: 'info', time: Date.now(), message: 'SUBMIT_RESULT', resp: JSON.stringify(resp).slice(0, 200) }));

    const takingAmount = parseFloat(resp.takingAmount || '0');
    const makingAmount = parseFloat(resp.makingAmount || '0');
    const sizeAmount = quote.side === 'BUY' ? takingAmount : makingAmount;
    const priceAmount = quote.side === 'BUY' ? makingAmount : takingAmount;
    const filledSize = Number.isFinite(sizeAmount) && sizeAmount > 0 ? sizeAmount : undefined;
    const filledPrice = filledSize !== undefined && Number.isFinite(priceAmount) && priceAmount > 0
      ? priceAmount / filledSize
      : undefined;

    return { orderID: resp.orderID, filledSize, filledPrice };
  }

  async cancel(orderId: string): Promise<void> {
    const result = await this.client.cancelOrder({ orderID: orderId });
    if (result?.not_canceled && Object.prototype.hasOwnProperty.call(result.not_canceled, orderId)) {
      throw new Error(`Order not canceled: ${orderId} ${result.not_canceled[orderId] ?? ''}`.trim());
    }
    if (Array.isArray(result?.canceled) && !result.canceled.includes(orderId)) {
      throw new Error(`Cancel response missing order id: ${orderId}`);
    }
  }

  async getOpenOrders(): Promise<any[]> {
    const result = await this.client.getOpenOrders() as any;
    if (Array.isArray(result)) return result;
    if (result && Array.isArray(result.orders)) return result.orders;
    if (result && Array.isArray(result.data)) return result.data;
    throw new Error('Unexpected open orders response payload');
  }
}
