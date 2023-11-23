import { providers, Wallet } from 'ethers'; import { FlashbotsBundleProvider } from './index';

const FLASHBOTS_AUTH_KEY = process.env.FLASHBOTS_AUTH_KEY; const CHAIN_ID = 5; // Goerli chain ID

const main = async () => { try { const provider = new providers.InfuraProvider(CHAIN_ID, process.env.INFURA_API_KEY); const authSigner = FLASHBOTS_AUTH_KEY ? new Wallet(FLASHBOTS_AUTH_KEY) : Wallet.createRandom(); const flashbotsProvider = await FlashbotsBundleProvider.create(provider, authSigner);

const info = await flashbotsProvider.getEventHistoryInfo();
console.log(info);

let i = 0;
let done = false;

while (!done) {
  const resHistory = await flashbotsProvider.getEventHistory({
    limit: info.maxLimit,
    offset: i * info.maxLimit,
    blockStart: info.minBlock,
  });

  for (const event of resHistory) {
    if (event.hint.txs) {
      console.log("event", event);
      console.log("txs", event.hint.txs);
      break;
    }
  }

  for (const event of resHistory) {
    if (event.hint.logs) {
      console.log("logs", event.hint.logs);
      done = true;
      break;
    }
  }

  i++;
}

} catch (error) { console.error("An error occurred:", error); } };

main();
