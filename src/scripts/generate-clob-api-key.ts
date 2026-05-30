import 'dotenv/config';
import { ClobClient, Chain } from '@polymarket/clob-client-v2';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { polygon } from 'viem/chains';

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error('Error: PRIVATE_KEY not found in environment. Add it to .env first.');
    process.exit(1);
  }

  if (!privateKey.startsWith('0x') || privateKey.length !== 66) {
    console.error('Error: PRIVATE_KEY looks invalid. Must be 0x + 64 hex characters (32 bytes).');
    process.exit(1);
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: polygon,
    transport: http(),
  });

  const clobClient = new ClobClient({
    host: 'https://clob.polymarket.com',
    chain: Chain.POLYGON,
    signer: walletClient,
    signatureType: 3, // POLY_1271
    funderAddress: process.env.WALLET_ADDRESS,
  });

  console.log('Deriving CLOB API key from wallet...');
  const creds = await clobClient.createOrDeriveApiKey();

  console.log('\n=== CLOB API Credentials ===');
  console.log(`CLOB_API_KEY=${creds.key}`);
  console.log(`CLOB_API_SECRET=${creds.secret}`);
  console.log(`CLOB_API_PASSPHRASE=${creds.passphrase}`);
  console.log('\nCopy these lines into your .env file to enable live trading.');
}

main().catch((err) => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
