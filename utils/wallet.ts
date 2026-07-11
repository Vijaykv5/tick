type MaybeWalletAccount = {
  address?: unknown
} | null | undefined

export function isWalletConnected(account: MaybeWalletAccount): boolean {
  return Boolean(account?.address)
}

export function getWalletAddress(account: MaybeWalletAccount): string {
  return account?.address?.toString() ?? ''
}

export function shortenAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 3) {
    return address
  }

  return `${address.slice(0, chars)}...${address.slice(-chars)}`
}

export function getWalletAvatar(address: string) {
  let hash = 0

  for (let i = 0; i < address.length; i += 1) {
    hash = (hash << 5) - hash + address.charCodeAt(i)
    hash |= 0
  }

  const hue = Math.abs(hash) % 360
  const accentHue = (hue + 48) % 360

  return {
    backgroundColor: `hsl(${hue}, 72%, 42%)`,
    borderColor: `hsl(${accentHue}, 88%, 62%)`,
  }
}

export function getSolscanAccountUrl(address: string): string {
  return `https://solscan.io/account/${address}`
}
