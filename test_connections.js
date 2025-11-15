import ccxt from 'ccxt';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const configPath = join(__dirname, 'config', 'ccxt-accounts.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));

async function testConnections() {
  for (const account of config.accounts) {
    console.log(`\nTesting connection to ${account.name}...`);
    
    try {
      const options = {
        apiKey: account.apiKey,
        secret: account.secret,
        options: {
          ...(account.options || {}),
        },
      };

      const password =
        account.password ??
        (typeof options.options.password === 'string'
          ? options.options.password
          : undefined);
      if (password) {
        options.password = password;
        delete options.options?.password;
      }

      const exchange = new ccxt[account.exchangeId](options);
      
      // Test connection by fetching balance
      const balance = await exchange.fetchBalance();
      console.log(`✅ Successfully connected to ${account.name}`);
      console.log('Available balances:');
      
      // Show non-zero balances
      for (const [currency, info] of Object.entries(balance)) {
        if (info.free > 0 || info.used > 0 || info.total > 0) {
          console.log(`${currency}:`, info);
        }
      }
      
    } catch (error) {
      console.error(`❌ Error connecting to ${account.name}:`, error.message);
    }
  }
}

testConnections().catch(console.error);
