import axios, { AxiosError } from "axios";
import EventSource from "eventsource";
import { Wallet, providers, utils } from "ethers";
import {
  JsonRpcError,
  NetworkFailure,
  UnimplementedStreamEvent,
} from "./error";
import {
  getRpcRequest,
  JsonRpcData,
  mungeBundleParams,
  mungePrivateTxParams,
  mungeSimBundleOptions,
} from "./flashbots";
import {
  BundleParams,
  MevShareNetwork,
  TransactionOptions,
  IMevShareEvent,
  StreamEventType,
  IPendingTransaction,
  IPendingBundle,
  SimBundleOptions,
  SimBundleResult,
  ISimBundleResult,
  ISendBundleResult,
  SendBundleResult,
  StreamEventName,
  EventHistoryInfo,
  EventHistoryParams,
  IEventHistoryEntry,
  EventHistoryEntry,
} from "./api/interfaces";
import { SupportedNetworks } from "./api/networks";
import { PendingBundle, PendingTransaction } from "./api/events";
import { URLSearchParams } from "url";

const TIMEOUT_QUERY_TX_MS = 5 * 60 * 1000;

export default class MevShareClient {
  private authSigner: Wallet;
  private network: MevShareNetwork;
  private provider: providers.Provider;

  constructor(authSigner: Wallet, network: MevShareNetwork) {
    this.authSigner = authSigner;
    this.network = network;
    this.provider = network.provider;
  }

  static useEthereumMainnet(authSigner: Wallet): MevShareClient {
    const network = SupportedNetworks.mainnet;
    return new MevShareClient(authSigner, network);
  }

  static useEthereumGoerli(authSigner: Wallet): MevShareClient {
    const network = SupportedNetworks.goerli;
    return new MevShareClient(authSigner, network);
  }

  static fromNetwork(
    authSigner: Wallet,
    { chainId }: { chainId: number | bigint }
  ): MevShareClient {
    const chainNum = typeof chainId == "bigint" ? Number(chainId) : chainId;
    const network = SupportedNetworks.getNetwork(chainNum);
    return new MevShareClient(authSigner, network);
  }

  private async postRpc(url: string, payload: { body?: any; headers?: any }) {
    const res = await axios.post(url, payload.body, {
      headers: payload.headers,
    });
    const data = res.data as JsonRpcData;
    if (data.error) {
      throw new JsonRpcError(data.error);
    }
    return data.result;
  }

  private async streamGet(urlSuffix: string) {
    let url = this.network.streamUrl;
    url = url.endsWith("/") ? url : url + "/";
    const res = await axios.get(url + "api/v1/" + urlSuffix);
    return res.data;
  }

  private async handleApiRequest(params: Array<any>, method: any) {
    try {
      return this.postRpc(
        this.network.apiUrl,
        await getRpcRequest(params, method, this.authSigner)
      );
    } catch (e) {
      if (e instanceof AxiosError) {
        throw new NetworkFailure(e);
      } else {
        throw e;
      }
    }
  }

  private onTransaction(
    event: IMevShareEvent,
    callback: (data: IPendingTransaction) => void
  ) {
    if (!event.txs || (event.txs && event.txs.length === 1)) {
      callback(new PendingTransaction(event));
    }
  }

  private onBundle(
    event: IMevShareEvent,
    callback: (data: IPendingBundle) => void
  ) {
    if (event.txs && event.txs.length > 1) {
      callback(new PendingBundle(event));
    }
  }

  public on(
    eventType: StreamEventType | StreamEventName,
    callback: (data: IPendingBundle | IPendingTransaction) => void
  ): EventSource {
    const events = new EventSource(this.network.streamUrl);

    const eventHandler =
      eventType === StreamEventType.Transaction
        ? this.onTransaction
        : eventType === StreamEventType.Bundle
        ? this.onBundle
        : () => {
            throw new UnimplementedStreamEvent(eventType);
          };

    events.onmessage = (event) => {
      try {
        eventHandler(JSON.parse(event.data), callback);
      } catch (e) {
        if (e instanceof AxiosError) {
          throw new NetworkFailure(e);
        } else {
          throw e;
        }
      }
    };

    return events;
  }

  public async sendTransaction(
    signedTx: string,
    options?: TransactionOptions
  ): Promise<string> {
    const params = mungePrivateTxParams(signedTx, options);
    return await this.handleApiRequest(params, "eth_sendPrivateTransaction");
  }

  public async sendBundle(params: BundleParams): Promise<ISendBundleResult> {
    return SendBundleResult(
      await this.handleApiRequest([mungeBundleParams(params)], "mev_sendBundle")
    );
  }

  private async simBundle(
    params: BundleParams,
    simOptions?: SimBundleOptions
  ): Promise<ISimBundleResult> {
    return SimBundleResult(
      await this.handleApiRequest(
        [mungeBundleParams(params), simOptions ? mungeSimBundleOptions(simOptions) : {}],
        "mev_simBundle"
      )
    );
  }

  public async simulateBundle(
    params: BundleParams,
    simOptions?: SimBundleOptions
  ): Promise<ISimBundleResult> {
    const firstTx = params.body[0];
    if ("hash" in firstTx) {
      console.log(
        "Transaction hash: " +
          firstTx.hash +
          " must appear onchain before simulation is possible, waiting"
      );
      return new Promise(async (resolve, reject) => {
        const waitForTx = async () => {
          const tx = await this.provider.getTransaction(firstTx.hash);
          if (tx) {
            const signedTx = utils.serializeTransaction(tx);
            console.log(
              `Found transaction hash: ${firstTx.hash} onchain at block number: ${tx.blockNumber}`
            );
            if (!tx.blockNumber) {
              return reject(
                new Error("Transaction hash: " + firstTx.hash + " does not have blockNumber")
              );
            }
            const simBlock = simOptions?.parentBlock || tx.blockNumber - 1;
            const paramsWithSignedTx = {
              ...params,
              body: [
                {
                  tx: signedTx,
                  canRevert: false,
                },
                ...params.body.slice(1),
              ],
            };
            resolve(
              this.simBundle(paramsWithSignedTx, { ...simOptions, parentBlock: simBlock })
            );
            return true;
          }
          return false;
        };

        if (await waitForTx()) {
          return;
        }

        this.provider.on("block", waitForTx);
        setTimeout(() => {
          this.provider.removeListener("block", waitForTx);
          console.error("Gave up waiting for " + firstTx.hash);
          reject(
            new Error("Target transaction did not appear onchain before TIMEOUT_QUERY_TX_MS")
          );
        }, TIMEOUT_QUERY_TX_MS);
      });
    }
    return await this.simBundle(params, simOptions);
  }

  public async getEventHistoryInfo(): Promise<EventHistoryInfo> {
    return await this.streamGet("history/info");
  }

  public async getEventHistory(
    params?: EventHistoryParams
  ): Promise<Array<EventHistoryEntry>> {
    const _params = params || {};
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(_params)) {
      query.set(key, value.toString());
    }
    const res: Array<IEventHistoryEntry> = await this.streamGet(
      "history" + `?${query.toString()}`
    );
    return res.map((entry) => new EventHistoryEntry(entry));
  }
}
