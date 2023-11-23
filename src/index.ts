import MevShareClient, { BundleParams, IPendingTransaction } from '@flashbots/mev-share-client';
import { SupportedNetworks } from './api/networks';

/**
 * Sends a bundle with order flow to the Flashbots MEV Share Relay.
 * @param pendingTxHash The hash of the pending transaction to backrun.
 * @param backrunTx The transaction that backruns the pending transaction.
 * @param targetBlock The target block number for bundle inclusion.
 * @param network The network to connect to (e.g., 'goerli').
 * @returns The result of sending the bundle.
 */
async function sendBundle(pendingTxHash: string, backrunTx: string, targetBlock: number, network: SupportedNetworks) {
  try {
    const mevShareClient = MevShareClient.useNetwork(network);

    const bundle: IPendingTransaction[] = [
      { hash: pendingTxHash },
      { tx: backrunTx, canRevert: false },
    ];

    const params: BundleParams = {
      inclusion: {
        block: targetBlock,
        maxBlock: targetBlock + 3,
      },
      body: bundle,
      privacy: {
        hints: {
          txHash: true,
        },
      },
    };

    const bundleResult = await mevShareClient.sendBundle(params);
    return bundleResult;
  } catch (error) {
    console.error('Error sending bundle:', error);
    throw error;
  }
}

// Example usage
const pendingTxHash = '0x1234567890abcdef';
const backrunTx = '0xabcdef1234567890';
const targetBlock = 17539448;
const network = SupportedNetworks.Goerli;

sendBundle(pendingTxHash, backrunTx, targetBlock, network)
  .then((result) => {
    console.log('Bundle sent successfully:', result);
  })
  .catch((error) => {
    console.error('Failed to send bundle:', error);
  });
