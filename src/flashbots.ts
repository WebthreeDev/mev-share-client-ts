import { id as ethersId, Wallet } from "ethers"

export type JsonRpcData = {
  id: number,
  result?: any,
  error?: { code: number, message: string },
  jsonrpc: string,
}

/**
 * Standardized RPC request for talking to Bundle API (mev-geth/mev-share) directly.
 * @param params - JSON data params
 * @param method - JSON-RPC method
 * @param authSigner - Wallet used to sign Flashbots auth header; for reputation
 * @returns Parameters of payload to send to Bundle API
 */
export const getRpcRequest = async (params: any, method: string, authSigner: Wallet) => {
  const body = {
    params,
    method,
    id: 69,
    jsonrpc: "2.0"
  }

  const signature = await signMessageWithAuthSigner(body, authSigner)

  const headers = {
    'Content-Type': 'application/json',
    'X-Flashbots-Signature': signature,
  }

  return {
    headers,
    signature,
    body,
  }
}

/**
 * Sign a message with the authSigner wallet.
 * @param message - Message to sign
 * @param authSigner - Wallet used to sign the message
 * @returns Signature of the message
 */
export const signMessageWithAuthSigner = async (message: any, authSigner: Wallet) => {
  const messageHash = ethersId(JSON.stringify(message))
  const signature = await authSigner.signMessage(messageHash)
  return `${authSigner.address}:${signature}`
}
