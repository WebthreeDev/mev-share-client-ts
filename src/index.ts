import { JsonRpcProvider, formatEther, keccak256 } from 'ethers';
import { Mutex } from "async-mutex";
import MevShareClient, { BundleParams, IPendingTransaction } from '..';
import { getProvider, initExample } from './lib/helpers';
import { sendTx, setupTxExample } from './lib/sendTx';
import { AsyncArray } from './lib/async';

const NUM_TARGET_BLOCKS = 3;

const getBuyTokenAmountWithExtra = async (provider: JsonRpcProvider): Promise<bigint> => {
  // Add your logic here to calculate the desired output amount for the trade
  // You can use Uniswap SDK or any other method to determine the output amount
  // For simplicity, let's assume a fixed output amount of 100 tokens
  return BigInt(100);
};

const backrunAttempt = async (
  provider: JsonRpcProvider,
  mevshare: MevShareClient,
  pendingTx: IPendingTransaction,
  targetBlock: number
): Promise<void> => {
  try {
    const gasPrice = pendingTx.tx.gasPrice || BigInt(1e9) * BigInt(1e3);
    const backrunGasPrice = gasPrice + BigInt(100) * BigInt(1e9);

    const { tx, wallet } = await setupTxExample(provider, backrunGasPrice, "im backrunniiiiing");
    const backrunTx = {
      ...tx,
      nonce: tx.nonce ? tx.nonce + 1 : undefined,
    };

    const outputAmount = await getBuyTokenAmountWithExtra(provider);
    if (outputAmount > BigInt(0)) {
      backrunTx.value = outputAmount;
    }

    const bundle = [
      { hash: pendingTx.hash },
      { tx: await wallet.signTransaction(backrunTx), canRevert: false },
    ];

    console.log(`Sending backrun bundles targeting next ${NUM_TARGET_BLOCKS} blocks with enhanced gas fee strategy...`);

    const bundleParams: BundleParams = {
      inclusion: {
        block: targetBlock,
        maxBlock: targetBlock + NUM_TARGET_BLOCKS,
      },
      body: bundle,
    };

    const backrunResult = await mevshare.sendBundle(bundleParams);
    console.log("Backrun result", backrunResult);
  } catch (error) {
    console.error("Error sending backrun bundle:", error);
    throw error;
  }
};

const handleBackrun = async (
  pendingTx: IPendingTransaction,
  provider: JsonRpcProvider,
  mevshare: MevShareClient,
  pendingMutex: Mutex,
  pendingTxHashes: AsyncArray<string>,
): Promise<void> => {
  try {
    console.log("PendingTxHashes", await pendingTxHashes.get());

    if (!(await pendingTxHashes.includes(pendingTx.hash))) {
      return;
    } else {
      console.log("Pending tx", pendingTx);
    }

    const targetBlock = await provider.getBlockNumber() + 1;

    await backrunAttempt(provider, mevshare, pendingTx, targetBlock);

    for (let i = 0; i < NUM_TARGET_BLOCKS; i++) {
      const currentBlock = targetBlock + i;

      if (!pendingMutex.isLocked()) {
        break;
      }

      console.log(`Tx ${pendingTx.hash} waiting for block ${currentBlock}`);

      const delay = (currentBlock - await provider.getBlockNumber()) * 6000;
      await new Promise(resolve => setTimeout(resolve, delay));

      const backrunTx = (bundleParams.body[1] as any).tx;

      if (backrunTx) {
        const checkTxHash = keccak256(backrunTx);
        const receipt = await provider.getTransactionReceipt(checkTxHash);

        if (receipt?.status === 1) {
          console.log(`Bundle included! (found tx ${receipt.hash})`);

          const simOptions = {
            parentBlock: receipt.blockNumber - 1,
          };

          const simResult = await mevshare.simulateBundle(bundleParams, simOptions);

          console.log(`SimResult (simOptions=${JSON.stringify(simOptions, null, 2)})`, simResult);
          console.log(`Profit: ${formatEther(simResult.profit)} ETH`);

          pendingMutex.release();
          break;
        } else {
          console.warn(`Backrun tx ${checkTxHash} not included in block ${currentBlock}`);
        }
      }
    }

    await pendingTxHashes.filter(hash => hash !== pendingTx.hash);
    console.log("Dropped target tx", pendingTx.hash);
  } catch (error) {
    console.error("Error handling backrun:", error);
    throw error;
  }
};

const main = async () => {
  try {
    const provider = getProvider();
    const { mevshare } = await initExample(provider);

    const pendingTxHashes = new AsyncArray<string>();
    const pendingMutex = new Mutex();

    const txHandler = mevshare.on("transaction", async (pendingTx: IPendingTransaction) => {
      await handleBackrun(pendingTx, provider, mevshare, pendingMutex, pendingTxHashes);
    });

    console.log("Listening for transactions...");

    await pendingMutex.acquire();

    const blockHandler = await provider.on("block", async (blockNum) => {
      if (await pendingTxHashes.length() === 0) {
        const res = await sendTx(provider, { logs: true, contractAddress: true, calldata: true, functionSelector: true }, blockNum + NUM_TARGET_BLOCKS);
        console.log("Sent tx", res);
        pendingTxHashes.push(res);
      }
    });

    await pendingMutex.acquire();
    pendingMutex.release();

    txHandler.close();
    await blockHandler.removeAllListeners();
  } catch (error) {
    console.error("An error occurred:", error);
  }
};

main().then(() => {
  process.exit(0);
});
