import React from 'react'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { AppButton } from '@/components/app-button'

export function AccountFeatureDisconnect() {
  const { account, disconnect } = useMobileWallet()

  return <AppButton disabled={!account} title="Disconnect" onPress={disconnect} />
}
